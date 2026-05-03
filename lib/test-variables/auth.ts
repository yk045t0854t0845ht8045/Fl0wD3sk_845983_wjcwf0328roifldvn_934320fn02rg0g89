import "server-only";

import crypto from "node:crypto";
import {
  decryptFlowSecureValue,
  encryptFlowSecureValue,
  hashFlowSecureValue,
} from "@/lib/security/flowSecure";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { resolveDeveloperIdentityForAuthUser } from "@/lib/test-variables/service";

const DEV_LOGIN_ATTEMPT_TTL_MINUTES = 10;
const DEV_AUTH_TOKEN_TTL_DAYS = 30;

type DevAuthTokenRow = {
  id: string;
  auth_user_id: number;
  token_hash: string;
  label: string | null;
  status: "active" | "revoked" | "expired";
  last_used_at: string | null;
  expires_at: string | null;
};

type DevLoginAttemptRow = {
  id: string;
  auth_token_id: string | null;
  status: "pending" | "completed" | "expired" | "revoked";
  expires_at: string;
  completed_token_encrypted: string | null;
};

type DeveloperUserRow = {
  id: number;
  display_name: string;
  email: string | null;
};

export type DeveloperTokenContext = {
  tokenId: string;
  authUserId: number;
  label: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  displayName: string;
  email: string | null;
  staffProfileId: string;
  permissions: string[];
};

export type DeveloperLoginAttemptStart = {
  verificationUrl: string;
  attemptToken: string;
  pollToken: string;
  expiresAt: string;
};

export type DeveloperLoginAttemptPoll =
  | {
      status: "pending";
      expiresAt: string;
    }
  | {
      status: "completed";
      expiresAt: string;
      authToken: string | null;
    }
  | {
      status: "expired" | "revoked";
      expiresAt: string | null;
    };

function resolveAppOrigin() {
  const rawOrigin =
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    "http://localhost:3000";

  return rawOrigin.replace(/\/+$/, "");
}

function buildIsoFromNow(input: { minutes?: number; days?: number }) {
  const now = new Date();
  const nextDate = new Date(now);
  if (input.minutes) {
    nextDate.setMinutes(nextDate.getMinutes() + input.minutes);
  }
  if (input.days) {
    nextDate.setDate(nextDate.getDate() + input.days);
  }
  return nextDate.toISOString();
}

function hashDeveloperLoginToken(
  token: string,
  subcontext: "attempt" | "poll",
) {
  const hash = hashFlowSecureValue(token, {
    purpose: "dev_login_token",
    subcontext,
    encoding: "hex",
  });

  if (!hash) {
    throw new Error("Nao foi possivel proteger o token temporario de login.");
  }

  return hash;
}

function hashDeveloperAccessToken(token: string) {
  const hash = hashFlowSecureValue(token, {
    purpose: "dev_auth_token",
    subcontext: "access_token",
    encoding: "hex",
  });

  if (!hash) {
    throw new Error("Nao foi possivel proteger o token de acesso do desenvolvedor.");
  }

  return hash;
}

function encryptCompletedAuthToken(token: string, attemptId: string) {
  const encrypted = encryptFlowSecureValue(token, {
    purpose: "dev_auth_token",
    aad: `dev_login_attempt:${attemptId}`,
    subcontext: "completed_token",
  });

  if (!encrypted) {
    throw new Error("Nao foi possivel proteger a entrega do token do CLI.");
  }

  return encrypted;
}

function decryptCompletedAuthToken(
  encryptedToken: string,
  attemptId: string,
) {
  const decrypted = decryptFlowSecureValue(encryptedToken, {
    purpose: "dev_auth_token",
    aad: `dev_login_attempt:${attemptId}`,
    subcontext: "completed_token",
  });

  if (!decrypted) {
    throw new Error("Nao foi possivel recuperar o token concluido do CLI.");
  }

  return decrypted;
}

function buildDeveloperAccessToken() {
  return `flw_dev_${crypto.randomBytes(24).toString("base64url")}`;
}

function buildDeveloperLoginToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function buildDeveloperVerificationUrl(attemptToken: string) {
  const origin = resolveAppOrigin();
  return `${origin}/dev-auth/complete?token=${encodeURIComponent(attemptToken)}`;
}

async function markAttemptExpired(attemptId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  await supabase
    .from("dev_login_attempts")
    .update({
      status: "expired",
    })
    .eq("id", attemptId)
    .eq("status", "pending");
}

async function readDeveloperUser(authUserId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const userResult = await supabase
    .from("auth_users")
    .select("id, display_name, email")
    .eq("id", authUserId)
    .maybeSingle<DeveloperUserRow>();

  if (userResult.error) {
    throw new Error(userResult.error.message);
  }

  if (!userResult.data) {
    throw new Error("Usuario do desenvolvedor nao encontrado.");
  }

  return userResult.data;
}

function assertDeveloperCliPermission(permissions: string[]) {
  if (
    !permissions.includes("test_variables.request_access") &&
    !permissions.includes("test_variables.read") &&
    !permissions.includes("admin.access")
  ) {
    throw new Error("Seu perfil interno nao possui permissao para usar o ambiente dev.");
  }
}

export async function startDeveloperLoginAttempt(input?: {
  redirectUrl?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const attemptToken = buildDeveloperLoginToken();
  const pollToken = buildDeveloperLoginToken();
  const expiresAt = buildIsoFromNow({
    minutes: DEV_LOGIN_ATTEMPT_TTL_MINUTES,
  });

  const insertResult = await supabase.from("dev_login_attempts").insert({
    attempt_token_hash: hashDeveloperLoginToken(attemptToken, "attempt"),
    poll_token_hash: hashDeveloperLoginToken(pollToken, "poll"),
    status: "pending",
    redirect_url: input?.redirectUrl || null,
    expires_at: expiresAt,
  });

  if (insertResult.error) {
    throw new Error(insertResult.error.message);
  }

  return {
    verificationUrl: buildDeveloperVerificationUrl(attemptToken),
    attemptToken,
    pollToken,
    expiresAt,
  } satisfies DeveloperLoginAttemptStart;
}

export async function completeDeveloperLoginAttempt(input: {
  attemptToken: string;
  authUserId: number;
  label?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = new Date().toISOString();
  const attemptHash = hashDeveloperLoginToken(input.attemptToken, "attempt");

  const attemptResult = await supabase
    .from("dev_login_attempts")
    .select("id, auth_token_id, status, expires_at")
    .eq("attempt_token_hash", attemptHash)
    .maybeSingle<Omit<DevLoginAttemptRow, "completed_token_encrypted">>();

  if (attemptResult.error) {
    throw new Error(attemptResult.error.message);
  }

  if (!attemptResult.data) {
    throw new Error("Tentativa de login dev invalida.");
  }

  if (attemptResult.data.expires_at <= nowIso) {
    await markAttemptExpired(attemptResult.data.id);
    throw new Error("Esta tentativa de login dev expirou.");
  }

  if (attemptResult.data.status === "completed") {
    return {
      status: "completed" as const,
      alreadyCompleted: true,
    };
  }

  if (attemptResult.data.status !== "pending") {
    throw new Error("Esta tentativa de login dev nao esta mais disponivel.");
  }

  const developerIdentity = await resolveDeveloperIdentityForAuthUser(
    input.authUserId,
  );
  if (!developerIdentity) {
    throw new Error("Seu usuario nao possui perfil interno ativo para concluir este login.");
  }

  assertDeveloperCliPermission(developerIdentity.permissions);

  const accessToken = buildDeveloperAccessToken();
  const accessTokenHash = hashDeveloperAccessToken(accessToken);
  const accessTokenExpiresAt = buildIsoFromNow({
    days: DEV_AUTH_TOKEN_TTL_DAYS,
  });

  const tokenInsertResult = await supabase
    .from("dev_auth_tokens")
    .insert({
      auth_user_id: input.authUserId,
      token_hash: accessTokenHash,
      label: input.label?.trim() || "flowdesk-cli",
      status: "active",
      expires_at: accessTokenExpiresAt,
    })
    .select("id")
    .single<{ id: string }>();

  if (tokenInsertResult.error || !tokenInsertResult.data) {
    throw new Error(
      tokenInsertResult.error?.message ||
        "Nao foi possivel emitir o token de acesso do desenvolvedor.",
    );
  }

  const updateAttemptResult = await supabase
    .from("dev_login_attempts")
    .update({
      auth_token_id: tokenInsertResult.data.id,
      completed_by_user_id: input.authUserId,
      status: "completed",
      completed_at: nowIso,
      completed_token_encrypted: encryptCompletedAuthToken(
        accessToken,
        attemptResult.data.id,
      ),
    })
    .eq("id", attemptResult.data.id)
    .eq("status", "pending");

  if (updateAttemptResult.error) {
    throw new Error(updateAttemptResult.error.message);
  }

  return {
    status: "completed" as const,
    alreadyCompleted: false,
  };
}

export async function pollDeveloperLoginAttempt(input: {
  pollToken: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = new Date().toISOString();
  const pollHash = hashDeveloperLoginToken(input.pollToken, "poll");

  const attemptResult = await supabase
    .from("dev_login_attempts")
    .select("id, auth_token_id, status, expires_at, completed_token_encrypted")
    .eq("poll_token_hash", pollHash)
    .maybeSingle<DevLoginAttemptRow>();

  if (attemptResult.error) {
    throw new Error(attemptResult.error.message);
  }

  if (!attemptResult.data) {
    return {
      status: "expired",
      expiresAt: null,
    } satisfies DeveloperLoginAttemptPoll;
  }

  if (attemptResult.data.expires_at <= nowIso) {
    await markAttemptExpired(attemptResult.data.id);
    return {
      status: "expired",
      expiresAt: attemptResult.data.expires_at,
    } satisfies DeveloperLoginAttemptPoll;
  }

  if (attemptResult.data.status === "pending") {
    return {
      status: "pending",
      expiresAt: attemptResult.data.expires_at,
    } satisfies DeveloperLoginAttemptPoll;
  }

  if (attemptResult.data.status === "revoked") {
    return {
      status: "revoked",
      expiresAt: attemptResult.data.expires_at,
    } satisfies DeveloperLoginAttemptPoll;
  }

  const authToken = attemptResult.data.completed_token_encrypted
    ? decryptCompletedAuthToken(
        attemptResult.data.completed_token_encrypted,
        attemptResult.data.id,
      )
    : null;

  if (attemptResult.data.completed_token_encrypted) {
    const clearResult = await supabase
      .from("dev_login_attempts")
      .update({
        completed_token_encrypted: null,
      })
      .eq("id", attemptResult.data.id);

    if (clearResult.error) {
      throw new Error(clearResult.error.message);
    }
  }

  return {
    status: "completed",
    expiresAt: attemptResult.data.expires_at,
    authToken,
  } satisfies DeveloperLoginAttemptPoll;
}

export async function resolveDeveloperAccessToken(accessToken: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = new Date().toISOString();
  const tokenHash = hashDeveloperAccessToken(accessToken);

  const tokenResult = await supabase
    .from("dev_auth_tokens")
    .select("id, auth_user_id, token_hash, label, status, last_used_at, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<DevAuthTokenRow>();

  if (tokenResult.error) {
    throw new Error(tokenResult.error.message);
  }

  if (!tokenResult.data) {
    return null;
  }

  if (
    tokenResult.data.status !== "active" ||
    (tokenResult.data.expires_at && tokenResult.data.expires_at <= nowIso)
  ) {
    if (
      tokenResult.data.status === "active" &&
      tokenResult.data.expires_at &&
      tokenResult.data.expires_at <= nowIso
    ) {
      await supabase
        .from("dev_auth_tokens")
        .update({
          status: "expired",
        })
        .eq("id", tokenResult.data.id)
        .eq("status", "active");
    }

    return null;
  }

  const [developerIdentity, developerUser] = await Promise.all([
    resolveDeveloperIdentityForAuthUser(tokenResult.data.auth_user_id),
    readDeveloperUser(tokenResult.data.auth_user_id),
  ]);

  if (!developerIdentity) {
    return null;
  }

  assertDeveloperCliPermission(developerIdentity.permissions);

  const updateResult = await supabase
    .from("dev_auth_tokens")
    .update({
      last_used_at: nowIso,
    })
    .eq("id", tokenResult.data.id);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  return {
    tokenId: tokenResult.data.id,
    authUserId: tokenResult.data.auth_user_id,
    label: tokenResult.data.label,
    expiresAt: tokenResult.data.expires_at,
    lastUsedAt: nowIso,
    displayName: developerUser.display_name,
    email: developerUser.email,
    staffProfileId: developerIdentity.staffProfileId,
    permissions: developerIdentity.permissions,
  } satisfies DeveloperTokenContext;
}
