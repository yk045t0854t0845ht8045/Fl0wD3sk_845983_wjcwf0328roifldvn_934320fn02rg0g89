import crypto from "node:crypto";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { maskAuthEmail, normalizeAuthEmail } from "@/lib/auth/email";
import { sendLoginOtpEmail } from "@/lib/mail/authEmail";

type EmailOtpChallengeRow = {
  id: string;
  user_id: number;
  email: string;
  email_normalized: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  resend_count: number;
  last_sent_at: string;
  expires_at: string;
  consumed_at: string | null;
  metadata: unknown;
};

type PendingOtpAuthMethod = "discord" | "email" | "google" | "microsoft";

export type PendingOtpSessionContext = {
  authMethod: PendingOtpAuthMethod;
  nextPath: string | null;
  discordAccessToken: string | null;
  discordRefreshToken: string | null;
  discordTokenExpiresAt: string | null;
};

export class EmailOtpError extends Error {
  statusCode: number;
  errorCode: string;
  retryAfterSeconds: number | null;

  constructor(
    message: string,
    statusCode = 400,
    errorCode = "email_otp_error",
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "EmailOtpError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function getOtpAlphabet() {
  return (
    process.env.AUTH_EMAIL_OTP_ALPHABET?.trim().toUpperCase() ||
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  )
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 36);
}

function getOtpLength() {
  const value = Number(process.env.AUTH_EMAIL_OTP_LENGTH || "6");
  return Number.isInteger(value) && value >= 6 && value <= 8 ? value : 6;
}

function getOtpTtlMs() {
  const value = Number(process.env.AUTH_EMAIL_OTP_TTL_MINUTES || "10");
  const minutes = Number.isFinite(value) && value > 0 ? value : 10;
  return Math.round(minutes * 60 * 1000);
}

function getOtpResendCooldownMs() {
  const value = Number(process.env.AUTH_EMAIL_OTP_RESEND_COOLDOWN_SECONDS || "45");
  const seconds = Number.isFinite(value) && value > 0 ? value : 45;
  return Math.round(seconds * 1000);
}

function getOtpMaxResends() {
  const value = Number(process.env.AUTH_EMAIL_OTP_MAX_RESENDS || "4");
  return Number.isInteger(value) && value >= 0 ? value : 4;
}

function resolveOtpSecret() {
  return (
    process.env.AUTH_EMAIL_OTP_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.DISCORD_CLIENT_SECRET?.trim() ||
    "flowdesk-email-otp-secret"
  );
}

function generateOtpCode() {
  const alphabet = getOtpAlphabet();
  const length = getOtpLength();
  const bytes = crypto.randomBytes(length);
  let code = "";

  for (let index = 0; index < length; index += 1) {
    code += alphabet[bytes[index] % alphabet.length];
  }

  return code;
}

function normalizeOtpCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function hashOtpCode(code: string) {
  return crypto
    .createHmac("sha256", resolveOtpSecret())
    .update(normalizeOtpCode(code))
    .digest("hex");
}

function getOtpExpiresAtIso() {
  return new Date(Date.now() + getOtpTtlMs()).toISOString();
}

function getRetryAfterSeconds(lastSentAt: string) {
  const sentAt = Date.parse(lastSentAt);
  if (!Number.isFinite(sentAt)) return 0;
  const diffMs = sentAt + getOtpResendCooldownMs() - Date.now();
  return diffMs > 0 ? Math.ceil(diffMs / 1000) : 0;
}

async function fetchChallengeById(challengeId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_email_otp_challenges")
    .select(
      "id, user_id, email, email_normalized, code_hash, attempts, max_attempts, resend_count, last_sent_at, expires_at, consumed_at, metadata",
    )
    .eq("id", challengeId)
    .maybeSingle<EmailOtpChallengeRow>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data;
}

async function sendOtpEmailForChallenge(email: string, code: string) {
  const expiresInMinutes = Math.max(1, Math.round(getOtpTtlMs() / 60_000));
  await sendLoginOtpEmail({
    toEmail: email,
    code,
    expiresInMinutes,
  });
}

function parsePendingOtpSessionContext(metadata: unknown): PendingOtpSessionContext | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const session =
    "session" in (metadata as Record<string, unknown>)
      ? (metadata as Record<string, unknown>).session
      : null;

  if (!session || typeof session !== "object") {
    return null;
  }

  const authMethod = (session as Record<string, unknown>).authMethod;
  if (
    authMethod !== "discord" &&
    authMethod !== "email" &&
    authMethod !== "google" &&
    authMethod !== "microsoft"
  ) {
    return null;
  }

  const nextPath = (session as Record<string, unknown>).nextPath;
  const discordAccessToken = (session as Record<string, unknown>).discordAccessToken;
  const discordRefreshToken = (session as Record<string, unknown>).discordRefreshToken;
  const discordTokenExpiresAt = (session as Record<string, unknown>).discordTokenExpiresAt;

  return {
    authMethod,
    nextPath: typeof nextPath === "string" && nextPath.trim() ? nextPath.trim() : null,
    discordAccessToken:
      typeof discordAccessToken === "string" && discordAccessToken.trim()
        ? discordAccessToken
        : null,
    discordRefreshToken:
      typeof discordRefreshToken === "string" && discordRefreshToken.trim()
        ? discordRefreshToken
        : null,
    discordTokenExpiresAt:
      typeof discordTokenExpiresAt === "string" && discordTokenExpiresAt.trim()
        ? discordTokenExpiresAt
        : null,
  };
}

export async function createLoginOtpChallenge(input: {
  userId: number;
  email: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const normalizedEmail = normalizeAuthEmail(input.email);
  if (!normalizedEmail) {
    throw new EmailOtpError("Email invalido para gerar o codigo.", 400, "invalid_email");
  }

  const code = generateOtpCode();
  const supabase = getSupabaseAdminClientOrThrow();
  const expiresAt = getOtpExpiresAtIso();
  const result = await supabase
    .from("auth_email_otp_challenges")
    .insert({
      user_id: input.userId,
      email: normalizedEmail,
      email_normalized: normalizedEmail,
      purpose: "login",
      code_hash: hashOtpCode(code),
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      max_attempts: 6,
      expires_at: expiresAt,
      metadata: input.metadata || {},
    })
    .select("id")
    .single<{ id: string }>();

  if (result.error || !result.data) {
    throw new Error(result.error?.message || "Nao foi possivel criar o desafio OTP.");
  }

  await sendOtpEmailForChallenge(normalizedEmail, code);

  return {
    challengeId: result.data.id,
    maskedEmail: maskAuthEmail(normalizedEmail),
    expiresAt,
    resendAvailableAt: new Date(Date.now() + getOtpResendCooldownMs()).toISOString(),
  };
}

export async function resendLoginOtpChallenge(challengeId: string) {
  const challenge = await fetchChallengeById(challengeId);

  if (!challenge) {
    throw new EmailOtpError("Codigo de verificacao nao encontrado.", 404, "otp_not_found");
  }

  if (challenge.consumed_at) {
    throw new EmailOtpError("Este codigo ja foi utilizado.", 409, "otp_already_used");
  }

  if (Date.parse(challenge.expires_at) <= Date.now()) {
    throw new EmailOtpError("Este codigo expirou. Inicie novamente o login.", 410, "otp_expired");
  }

  const retryAfterSeconds = getRetryAfterSeconds(challenge.last_sent_at);
  if (retryAfterSeconds > 0) {
    throw new EmailOtpError(
      "Aguarde um pouco antes de solicitar outro codigo.",
      429,
      "otp_resend_cooldown",
      retryAfterSeconds,
    );
  }

  if (challenge.resend_count >= getOtpMaxResends()) {
    throw new EmailOtpError(
      "Voce atingiu o limite de reenvios deste codigo. Reinicie o login para receber um novo.",
      429,
      "otp_resend_limit",
    );
  }

  const code = generateOtpCode();
  const expiresAt = getOtpExpiresAtIso();
  const supabase = getSupabaseAdminClientOrThrow();
  const updateResult = await supabase
    .from("auth_email_otp_challenges")
    .update({
      code_hash: hashOtpCode(code),
      attempts: 0,
      resend_count: challenge.resend_count + 1,
      last_sent_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", challenge.id);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  await sendOtpEmailForChallenge(challenge.email, code);

  return {
    challengeId: challenge.id,
    maskedEmail: maskAuthEmail(challenge.email),
    expiresAt,
    resendAvailableAt: new Date(Date.now() + getOtpResendCooldownMs()).toISOString(),
  };
}

export async function verifyLoginOtpChallenge(input: {
  challengeId: string;
  code: string;
}) {
  const normalizedCode = normalizeOtpCode(input.code);
  const otpLength = getOtpLength();
  if (!new RegExp(`^[A-Z0-9]{${otpLength}}$`).test(normalizedCode)) {
    throw new EmailOtpError("Digite um codigo valido para continuar.", 400, "otp_invalid_format");
  }

  const challenge = await fetchChallengeById(input.challengeId);
  if (!challenge) {
    throw new EmailOtpError("Codigo de verificacao nao encontrado.", 404, "otp_not_found");
  }

  if (challenge.consumed_at) {
    throw new EmailOtpError("Este codigo ja foi utilizado.", 409, "otp_already_used");
  }

  if (Date.parse(challenge.expires_at) <= Date.now()) {
    throw new EmailOtpError("Este codigo expirou. Inicie novamente o login.", 410, "otp_expired");
  }

  if (challenge.attempts >= challenge.max_attempts) {
    throw new EmailOtpError(
      "Muitas tentativas invalidas. Reinicie o login para receber um novo codigo.",
      429,
      "otp_attempt_limit",
    );
  }

  const candidateHash = hashOtpCode(normalizedCode);
  const matches =
    candidateHash.length === challenge.code_hash.length &&
    crypto.timingSafeEqual(
      Buffer.from(candidateHash, "utf8"),
      Buffer.from(challenge.code_hash, "utf8"),
    );

  const supabase = getSupabaseAdminClientOrThrow();

  if (!matches) {
    const nextAttempts = challenge.attempts + 1;
    await supabase
      .from("auth_email_otp_challenges")
      .update({
        attempts: nextAttempts,
      })
      .eq("id", challenge.id);

    if (nextAttempts >= challenge.max_attempts) {
      throw new EmailOtpError(
        "Muitas tentativas invalidas. Reinicie o login para receber um novo codigo.",
        429,
        "otp_attempt_limit",
      );
    }

    throw new EmailOtpError("Codigo incorreto. Revise e tente novamente.", 400, "otp_invalid");
  }

  const consumeResult = await supabase
    .from("auth_email_otp_challenges")
    .update({
      consumed_at: new Date().toISOString(),
      attempts: challenge.attempts + 1,
    })
    .eq("id", challenge.id)
    .is("consumed_at", null);

  if (consumeResult.error) {
    throw new Error(consumeResult.error.message);
  }

  return {
    userId: challenge.user_id,
    email: challenge.email,
    maskedEmail: maskAuthEmail(challenge.email),
    sessionContext: parsePendingOtpSessionContext(challenge.metadata),
  };
}
