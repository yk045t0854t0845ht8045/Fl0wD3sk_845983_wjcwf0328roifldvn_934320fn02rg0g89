import crypto from "node:crypto";
import { authConfig } from "@/lib/auth/config";
import { validateSharedAuthCookieIntegrity } from "@/lib/auth/cookies";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type TrustedDeviceRow = {
  id: string;
  user_id: number;
  token_hash: string;
  user_agent_hash: string | null;
  expires_at: string;
  revoked_at: string | null;
};

export type TrustedDeviceValidationResult =
  | {
      ok: true;
      shouldClearCookie: false;
    }
  | {
      ok: false;
      shouldClearCookie: boolean;
    };

function resolveTrustedDeviceSalt() {
  const candidates = [
    process.env.AUTH_REMEMBER_DEVICE_SECRET,
    process.env.AUTH_SECRET,
    process.env.DISCORD_CLIENT_SECRET,
    process.env.NEXTAUTH_SECRET,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "flowdesk-trusted-device-secret";
}

function hashTrustedDeviceToken(token: string) {
  return crypto
    .createHash("sha256")
    .update(`${resolveTrustedDeviceSalt()}:${token}`)
    .digest("hex");
}

function hashUserAgent(userAgent: string | null) {
  if (!userAgent) return null;

  return crypto
    .createHash("sha256")
    .update(`${resolveTrustedDeviceSalt()}:ua:${userAgent}`)
    .digest("hex");
}

function createTrustedDeviceToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function getTrustedDeviceExpiryIso() {
  return new Date(
    Date.now() + authConfig.rememberedDeviceDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function isPlausibleTrustedDeviceToken(token: string) {
  return /^[A-Za-z0-9_-]{32,200}$/.test(token);
}

export async function issueTrustedDevice(input: {
  userId: number;
  userAgent: string | null;
}) {
  const token = createTrustedDeviceToken();
  const supabase = getSupabaseAdminClientOrThrow();
  const expiresAt = getTrustedDeviceExpiryIso();
  const result = await supabase.from("auth_user_trusted_devices").insert({
    user_id: input.userId,
    token_hash: hashTrustedDeviceToken(token),
    user_agent_hash: hashUserAgent(input.userAgent),
    expires_at: expiresAt,
    last_used_at: new Date().toISOString(),
  });

  if (result.error) {
    throw new Error(`Nao foi possivel registrar o dispositivo confiavel: ${result.error.message}`);
  }

  return {
    token,
    expiresAt,
  };
}

export async function validateTrustedEmailDevice(input: {
  userId: number;
  token: string | null;
  tokenProof?: string | null;
  userAgent: string | null;
}): Promise<TrustedDeviceValidationResult> {
  if (!input.token || !isPlausibleTrustedDeviceToken(input.token)) {
    return {
      ok: false,
      shouldClearCookie: Boolean(input.token),
    };
  }

  if (
    validateSharedAuthCookieIntegrity(
      authConfig.rememberedDeviceCookieName,
      input.token,
      input.tokenProof ?? null,
    ) === "invalid"
  ) {
    return {
      ok: false,
      shouldClearCookie: true,
    };
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const tokenHash = hashTrustedDeviceToken(input.token);
  const result = await supabase
    .from("auth_user_trusted_devices")
    .select("id, user_id, token_hash, user_agent_hash, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<TrustedDeviceRow>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  const row = result.data;
  if (!row) {
    return {
      ok: false,
      shouldClearCookie: true,
    };
  }

  const userAgentHash = hashUserAgent(input.userAgent);
  const isExpired = Date.parse(row.expires_at) <= Date.now();
  const isRevoked = Boolean(row.revoked_at);
  const belongsToUser = row.user_id === input.userId;
  const matchesUserAgent =
    !row.user_agent_hash || !userAgentHash || row.user_agent_hash === userAgentHash;

  if (isExpired || isRevoked || !belongsToUser || !matchesUserAgent) {
    if (!isRevoked && !isExpired) {
      await supabase
        .from("auth_user_trusted_devices")
        .update({
          revoked_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }

    return {
      ok: false,
      shouldClearCookie: true,
    };
  }

  await supabase
    .from("auth_user_trusted_devices")
    .update({
      last_used_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return {
    ok: true,
    shouldClearCookie: false,
  };
}

export const issueTrustedEmailDevice = issueTrustedDevice;
export const validateTrustedDevice = validateTrustedEmailDevice;
