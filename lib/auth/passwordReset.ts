import crypto from "node:crypto";
import { normalizeAuthEmail } from "@/lib/auth/email";
import { findAuthUserByEmail } from "@/lib/auth/session";
import { upsertPasswordCredential } from "@/lib/auth/emailAuth";
import { validatePasswordPolicy } from "@/lib/auth/passwordPolicy";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const PASSWORD_RESET_TOKEN_LENGTH = 50;
const PASSWORD_RESET_TTL_MINUTES = 45;
const PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS = 45;

type PasswordResetTokenRow = {
  id: string;
  user_id: number;
  email_normalized: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
};

type RecentPasswordResetTokenRow = {
  created_at: string;
  consumed_at: string | null;
  expires_at: string;
};

function createNumericResetToken() {
  let token = "";
  while (token.length < PASSWORD_RESET_TOKEN_LENGTH) {
    token += crypto.randomInt(0, 10).toString();
  }
  return token;
}

function hashResetToken(token: string) {
  return crypto.createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

function sanitizeResetToken(value: string) {
  return value.replace(/\D/g, "").slice(0, PASSWORD_RESET_TOKEN_LENGTH);
}

export function normalizePasswordResetToken(value: string | null | undefined) {
  if (typeof value !== "string") return "";
  const token = sanitizeResetToken(value);
  return token.length === PASSWORD_RESET_TOKEN_LENGTH ? token : "";
}

export function getPasswordResetExpiresAt() {
  return new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString();
}

export async function createPasswordResetRequest(input: {
  email: string;
  ipAddress: string | null;
  userAgent: string | null;
}) {
  const normalizedEmail = normalizeAuthEmail(input.email);
  if (!normalizedEmail) {
    throw new Error("Informe um email valido.");
  }

  const user = await findAuthUserByEmail(normalizedEmail);
  if (!user?.email) {
    return null;
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const recentTokenResult = await supabase
    .from("auth_password_reset_tokens")
    .select("created_at, consumed_at, expires_at")
    .eq("user_id", user.id)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RecentPasswordResetTokenRow>();

  if (recentTokenResult.error) {
    throw new Error(recentTokenResult.error.message);
  }

  const recentToken = recentTokenResult.data;
  if (
    recentToken &&
    Date.parse(recentToken.expires_at) > Date.now() &&
    Date.now() - Date.parse(recentToken.created_at) <
      PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS * 1000
  ) {
    return null;
  }

  await supabase
    .from("auth_password_reset_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("consumed_at", null);

  const token = createNumericResetToken();
  const expiresAt = getPasswordResetExpiresAt();
  const result = await supabase.from("auth_password_reset_tokens").insert({
    user_id: user.id,
    email_normalized: normalizedEmail,
    token_hash: hashResetToken(token),
    ip_address: input.ipAddress,
    user_agent: input.userAgent,
    expires_at: expiresAt,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return {
    user,
    token,
    expiresAt,
    expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
  };
}

export async function resolvePasswordResetToken(token: string) {
  const normalizedToken = normalizePasswordResetToken(token);
  if (!normalizedToken) {
    return { ok: false as const, reason: "invalid" as const };
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_password_reset_tokens")
    .select("id, user_id, email_normalized, attempts, max_attempts, expires_at, consumed_at")
    .eq("token_hash", hashResetToken(normalizedToken))
    .maybeSingle<PasswordResetTokenRow>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  const row = result.data;
  if (!row || row.consumed_at) {
    return { ok: false as const, reason: "invalid" as const };
  }

  if (Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false as const, reason: "expired" as const };
  }

  if (row.attempts >= row.max_attempts) {
    return { ok: false as const, reason: "attempts" as const };
  }

  const user = await findAuthUserByEmail(row.email_normalized);
  if (!user || user.id !== row.user_id) {
    return { ok: false as const, reason: "invalid" as const };
  }

  return {
    ok: true as const,
    token: normalizedToken,
    row,
    email: user.email || row.email_normalized,
  };
}

export async function consumePasswordResetToken(input: {
  token: string;
  password: string;
  confirmPassword: string;
}) {
  const resolved = await resolvePasswordResetToken(input.token);
  if (!resolved.ok) {
    throw new Error(
      resolved.reason === "expired"
        ? "Este link de redefinicao expirou. Solicite um novo link."
        : "Este link de redefinicao nao e mais valido.",
    );
  }

  const passwordError = validatePasswordPolicy(input.password, input.confirmPassword);
  if (passwordError) {
    const supabase = getSupabaseAdminClientOrThrow();
    await supabase
      .from("auth_password_reset_tokens")
      .update({ attempts: resolved.row.attempts + 1 })
      .eq("id", resolved.row.id);
    throw new Error(passwordError);
  }

  await upsertPasswordCredential(resolved.row.user_id, input.password);

  const supabase = getSupabaseAdminClientOrThrow();
  const consumedAt = new Date().toISOString();
  await supabase
    .from("auth_password_reset_tokens")
    .update({
      consumed_at: consumedAt,
      attempts: resolved.row.attempts + 1,
    })
    .eq("id", resolved.row.id);

  return {
    email: resolved.email,
  };
}
