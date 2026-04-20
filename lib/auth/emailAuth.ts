import type { AuthUserRecord } from "@/lib/auth/session";
import {
  createEmailAuthUser,
  createSessionForUser,
  findAuthUserByEmail,
} from "@/lib/auth/session";
import { normalizeAuthEmail } from "@/lib/auth/email";
import { createLoginOtpChallenge, resendLoginOtpChallenge, verifyLoginOtpChallenge } from "@/lib/auth/emailOtp";
import {
  hashPassword,
  shouldUpgradePasswordHash,
  verifyPassword,
} from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/passwordPolicy";
import { validateTrustedDevice } from "@/lib/auth/trustedDevice";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type PasswordCredentialRow = {
  user_id: number;
  password_hash: string;
};

export type EmailAuthNextStep = "password" | "set_password";

async function getPasswordCredentialForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_credentials")
    .select("user_id, password_hash")
    .eq("user_id", userId)
    .maybeSingle<PasswordCredentialRow>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data;
}

async function upsertPasswordCredential(userId: number, password: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const passwordHash = await hashPassword(password);
  const nowIso = new Date().toISOString();
  const result = await supabase
    .from("auth_user_credentials")
    .upsert(
      {
        user_id: userId,
        password_hash: passwordHash,
        password_set_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "user_id" },
    );

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function markPasswordLogin(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  await supabase
    .from("auth_user_credentials")
    .update({
      last_password_login_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

export async function resolveEmailAuthStart(email: string): Promise<{
  email: string;
  user: AuthUserRecord | null;
  nextStep: EmailAuthNextStep;
  hasGoogleLinked?: boolean;
}> {
  const normalizedEmail = normalizeAuthEmail(email);
  if (!normalizedEmail) {
    throw new Error("Informe um email valido.");
  }

  const user = await findAuthUserByEmail(normalizedEmail);
  if (!user) {
    return {
      email: normalizedEmail,
      user: null,
      nextStep: "set_password",
      hasGoogleLinked: false,
    };
  }

  const credential = await getPasswordCredentialForUser(user.id);
  return {
    email: normalizedEmail,
    user,
    nextStep: credential ? "password" : "set_password",
    hasGoogleLinked: Boolean(user.google_user_id),
  };
}

export async function authenticateEmailPasswordAndIssueOtp(input: {
  email: string;
  password: string;
  confirmPassword?: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  trustedDeviceToken?: string | null;
  trustedDeviceProof?: string | null;
}) {
  const start = await resolveEmailAuthStart(input.email);
  let user = start.user;
  let clearTrustedDeviceCookie = false;

  if (start.nextStep === "password") {
    if (!user) {
      throw new Error("Conta nao encontrada para este email.");
    }

    const credential = await getPasswordCredentialForUser(user.id);
    if (!credential) {
      throw new Error("Esta conta ainda nao possui senha configurada.");
    }

    const passwordOk = await verifyPassword(input.password, credential.password_hash);
    if (!passwordOk) {
      throw new Error("Senha incorreta. Revise e tente novamente.");
    }

    if (shouldUpgradePasswordHash(credential.password_hash)) {
      await upsertPasswordCredential(user.id, input.password).catch(() => null);
    }

    await markPasswordLogin(user.id);
  } else {
    const passwordError = validatePasswordPolicy(
      input.password,
      input.confirmPassword,
    );
    if (passwordError) {
      throw new Error(passwordError);
    }

    if (!user) {
      user = await createEmailAuthUser({
        email: start.email,
        emailVerifiedAt: new Date().toISOString(),
      });
    }

    await upsertPasswordCredential(user.id, input.password);
  }

  if (!user?.email) {
    throw new Error("Nao foi possivel identificar o email desta conta.");
  }

  const trustedDeviceValidation = await validateTrustedDevice({
    userId: user.id,
    token: input.trustedDeviceToken || null,
    tokenProof: input.trustedDeviceProof || null,
    userAgent: input.userAgent,
  });

  clearTrustedDeviceCookie = trustedDeviceValidation.shouldClearCookie;

  if (trustedDeviceValidation.ok) {
    return {
      nextStep: "session" as const,
      passwordStep: start.nextStep,
      userId: user.id,
      maskedEmail: user.email,
      clearTrustedDeviceCookie,
      rememberSession: true,
    };
  }

  const challenge = await createLoginOtpChallenge({
    userId: user.id,
    email: user.email,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    nextStep: "otp" as const,
    passwordStep: start.nextStep,
    userId: user.id,
    challengeId: challenge.challengeId,
    maskedEmail: challenge.maskedEmail,
    expiresAt: challenge.expiresAt,
    resendAvailableAt: challenge.resendAvailableAt,
    clearTrustedDeviceCookie,
    rememberSession: false,
  };
}

export async function resendEmailLoginOtp(challengeId: string) {
  return resendLoginOtpChallenge(challengeId);
}

export async function verifyEmailLoginOtp(challengeId: string, code: string) {
  return verifyLoginOtpChallenge({
    challengeId,
    code,
  });
}

export async function createEmailSession(input: {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
  rememberSession?: boolean;
}) {
  return createSessionForUser(
    input.userId,
    {
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
    {
      authMethod: "email",
      discordAccessToken: null,
      discordRefreshToken: null,
      discordTokenExpiresAt: null,
    },
    {
      rememberSession: input.rememberSession ?? false,
    },
  );
}
