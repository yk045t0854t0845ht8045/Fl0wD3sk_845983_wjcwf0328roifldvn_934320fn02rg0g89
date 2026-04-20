import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { DiscordGuild, DiscordUser } from "@/lib/auth/discord";
import type { GoogleUser } from "@/lib/auth/google";
import type { MicrosoftUser } from "@/lib/auth/microsoft";
import { authConfig } from "@/lib/auth/config";
import type { ConfigDraft, ConfigStep } from "@/lib/auth/configContext";
import {
  createEmptyConfigDraft,
  normalizeConfigStep,
  sanitizeConfigDraft,
} from "@/lib/auth/configContext";
import {
  getSharedAuthCookieProofName,
  validateSharedAuthCookieIntegrity,
} from "@/lib/auth/cookies";
import {
  buildEmailDisplayName,
  buildEmailUsername,
  normalizeAuthEmail,
} from "@/lib/auth/email";
import {
  decryptFlowSecureValue,
  encryptFlowSecureValue,
  hashFlowSecureValue,
} from "@/lib/security/flowSecure";
import { isDatabaseAvailabilityError } from "@/lib/security/databaseAvailability";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CreateSessionContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

export type AuthMethod = "discord" | "email" | "google" | "microsoft";

type SessionTokens = {
  authMethod?: AuthMethod;
  discordAccessToken?: string | null;
  discordRefreshToken?: string | null;
  discordTokenExpiresAt?: string | null;
};

type CreateSessionOptions = {
  rememberSession?: boolean;
  sessionTtlHours?: number | null;
};

export type AuthUserRecord = {
  id: number;
  discord_user_id: string | null;
  google_user_id: string | null;
  microsoft_user_id: string | null;
  username: string;
  global_name: string | null;
  display_name: string;
  avatar: string | null;
  email: string | null;
  email_normalized: string | null;
  email_verified_at: string | null;
  locale: string | null;
};

type AuthSessionRecord = {
  id: string;
  session_token_hash?: string | null;
  created_at?: string | null;
  discord_access_token: string | null;
  discord_refresh_token: string | null;
  discord_token_expires_at: string | null;
  active_guild_id: string | null;
  discord_guilds_cache: unknown;
  discord_guilds_cached_at: string | null;
  config_current_step: number | null;
  config_draft: unknown;
  config_context_updated_at: string | null;
  user: AuthUserRecord | AuthUserRecord[] | null;
};

export type CurrentAuthSession = {
  id: string;
  user: AuthUserRecord;
  discordAccessToken: string | null;
  discordRefreshToken: string | null;
  discordTokenExpiresAt: string | null;
  activeGuildId: string | null;
  discordGuildsCache: DiscordGuild[] | null;
  discordGuildsCachedAt: string | null;
  configCurrentStep: ConfigStep;
  configDraft: ConfigDraft;
  configContextUpdatedAt: string | null;
};

type AuthSessionCacheEntry = {
  cachedAt: number;
  staleUntil: number;
  value: CurrentAuthSession | null;
};

type SafeAuthSessionResult = {
  session: CurrentAuthSession | null;
  degraded: boolean;
};

function buildDisplayName(discordUser: DiscordUser) {
  return discordUser.global_name || discordUser.username;
}

const AUTH_USER_SELECT_COLUMNS =
  "id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale";
const AUTH_SESSION_CACHE_TTL_MS = 15_000;
const AUTH_SESSION_STALE_TTL_MS = 2 * 60_000;
const AUTH_SESSION_CACHE_MAX_ENTRIES = 1_500;
const AUTH_SESSION_CIRCUIT_OPEN_MS = 12_000;

const authSessionCache = new Map<string, AuthSessionCacheEntry>();
const authSessionInflight = new Map<string, Promise<CurrentAuthSession | null>>();
let authSessionCircuitOpenUntilMs = 0;

function hashLegacyToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashToken(token: string) {
  const hash = hashFlowSecureValue(token, {
    purpose: "sensitive_lookup",
    subcontext: "auth_session_token",
    encoding: "hex",
  });
  if (!hash) {
    throw new Error("Nao foi possivel proteger o identificador da sessao.");
  }
  return `h2:${hash}`;
}

function buildSessionTokenHashCandidates(token: string) {
  const primaryHash = hashToken(token);
  const legacyHash = hashLegacyToken(token);
  return primaryHash === legacyHash
    ? [primaryHash]
    : [primaryHash, legacyHash];
}

function encryptStoredOAuthToken(token: string | null | undefined) {
  return encryptFlowSecureValue(token, {
    purpose: "auth_session_oauth",
  });
}

function decryptStoredOAuthToken(token: string | null | undefined) {
  return decryptFlowSecureValue(token, {
    purpose: "auth_session_oauth",
    allowPlaintextFallback: true,
  });
}

function cloneAuthSession<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildAuthSessionCacheKey(
  sessionTokenHash: string,
  options: GetAuthSessionOptions,
) {
  return `${sessionTokenHash}:${options.fullContext ? "full" : "base"}`;
}

function pruneAuthSessionCacheIfNeeded() {
  if (authSessionCache.size <= AUTH_SESSION_CACHE_MAX_ENTRIES) {
    return;
  }

  const nowMs = Date.now();
  for (const [key, entry] of authSessionCache.entries()) {
    if (entry.staleUntil <= nowMs) {
      authSessionCache.delete(key);
    }
  }

  if (authSessionCache.size <= AUTH_SESSION_CACHE_MAX_ENTRIES) {
    return;
  }

  const sortedEntries = Array.from(authSessionCache.entries()).sort(
    (left, right) => left[1].cachedAt - right[1].cachedAt,
  );
  const overflowCount = authSessionCache.size - AUTH_SESSION_CACHE_MAX_ENTRIES;

  for (const [key] of sortedEntries.slice(0, overflowCount)) {
    authSessionCache.delete(key);
  }
}

function readAuthSessionCache(
  cacheKey: string,
  options?: {
    allowStale?: boolean;
  },
) {
  const entry = authSessionCache.get(cacheKey);
  if (!entry) {
    return {
      hit: false,
      value: null as CurrentAuthSession | null,
    };
  }

  const nowMs = Date.now();
  if (entry.staleUntil <= nowMs) {
    authSessionCache.delete(cacheKey);
    return {
      hit: false,
      value: null as CurrentAuthSession | null,
    };
  }

  const isFresh = entry.cachedAt + AUTH_SESSION_CACHE_TTL_MS > nowMs;
  if (!isFresh && !options?.allowStale) {
    return {
      hit: false,
      value: null as CurrentAuthSession | null,
    };
  }

  return {
    hit: true,
    value: cloneAuthSession(entry.value),
  };
}

function writeAuthSessionCache(
  cacheKey: string,
  value: CurrentAuthSession | null,
) {
  pruneAuthSessionCacheIfNeeded();
  authSessionCache.set(cacheKey, {
    cachedAt: Date.now(),
    staleUntil: Date.now() + AUTH_SESSION_STALE_TTL_MS,
    value: cloneAuthSession(value),
  });
}

export function isAuthSessionAvailabilityError(error: unknown) {
  if (isDatabaseAvailabilityError(error)) {
    return true;
  }

  if (!(error instanceof Error)) return false;
  const normalizedMessage = error.message.toLowerCase();
  return normalizedMessage.includes("erro ao validar sessao");
}

export function createOAuthState() {
  return crypto.randomBytes(24).toString("hex");
}

function createSessionToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function resolveSessionTtlHours(options?: CreateSessionOptions) {
  if (
    typeof options?.sessionTtlHours === "number" &&
    Number.isFinite(options.sessionTtlHours) &&
    options.sessionTtlHours > 0
  ) {
    return options.sessionTtlHours;
  }

  if (options?.rememberSession) {
    return Math.max(24, authConfig.rememberedDeviceDays * 24);
  }

  return authConfig.sessionTtlHours;
}

function unwrapUser(user: AuthSessionRecord["user"]) {
  if (!user) return null;
  if (Array.isArray(user)) return user[0] || null;
  return user;
}

function parseDiscordGuildsCache(cache: unknown): DiscordGuild[] | null {
  if (!Array.isArray(cache)) return null;

  const guilds = cache.filter((item): item is DiscordGuild => {
    if (!item || typeof item !== "object") return false;

    const guild = item as Partial<DiscordGuild>;
    return (
      typeof guild.id === "string" &&
      typeof guild.name === "string" &&
      typeof guild.owner === "boolean" &&
      typeof guild.permissions === "string"
    );
  });

  if (guilds.length) return guilds;
  return cache.length === 0 ? [] : null;
}

export async function findReusableDiscordSessionTokensForUser(
  userId: number,
  options?: {
    excludeSessionId?: string | null;
  },
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_sessions")
    .select(
      "id, created_at, discord_access_token, discord_refresh_token, discord_token_expires_at",
    )
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(16)
    .returns<AuthSessionRecord[]>();

  if (result.error) {
    throw new Error(
      `Erro ao reutilizar tokens Discord da conta: ${result.error.message}`,
    );
  }

  const nowMs = Date.now();
  const excludeSessionId = options?.excludeSessionId || null;
  const candidates = (result.data || [])
    .map((session) => ({
      ...session,
      discord_access_token: decryptStoredOAuthToken(session.discord_access_token),
      discord_refresh_token: decryptStoredOAuthToken(session.discord_refresh_token),
    }))
    .filter((session) => session.id !== excludeSessionId)
    .filter(
      (session) =>
        Boolean(session.discord_access_token || session.discord_refresh_token),
    )
    .sort((left, right) => {
      const leftHasRefresh = left.discord_refresh_token ? 1 : 0;
      const rightHasRefresh = right.discord_refresh_token ? 1 : 0;
      if (leftHasRefresh !== rightHasRefresh) {
        return rightHasRefresh - leftHasRefresh;
      }

      const leftExpiryMs = left.discord_token_expires_at
        ? Date.parse(left.discord_token_expires_at)
        : Number.NaN;
      const rightExpiryMs = right.discord_token_expires_at
        ? Date.parse(right.discord_token_expires_at)
        : Number.NaN;
      const leftIsFresh = Number.isFinite(leftExpiryMs) && leftExpiryMs > nowMs ? 1 : 0;
      const rightIsFresh =
        Number.isFinite(rightExpiryMs) && rightExpiryMs > nowMs ? 1 : 0;
      if (leftIsFresh !== rightIsFresh) {
        return rightIsFresh - leftIsFresh;
      }

      const leftCreatedAtMs = left.created_at ? Date.parse(left.created_at) : Number.NaN;
      const rightCreatedAtMs = right.created_at ? Date.parse(right.created_at) : Number.NaN;

      if (Number.isFinite(leftCreatedAtMs) && Number.isFinite(rightCreatedAtMs)) {
        return rightCreatedAtMs - leftCreatedAtMs;
      }

      return 0;
    });

  const reusableSession = candidates[0] || null;
  if (!reusableSession) {
    return null;
  }

  return {
    discordAccessToken: reusableSession.discord_access_token,
    discordRefreshToken: reusableSession.discord_refresh_token,
    discordTokenExpiresAt: reusableSession.discord_token_expires_at,
  };
}

async function selectAuthUserBy(
  column:
    | "id"
    | "discord_user_id"
    | "google_user_id"
    | "microsoft_user_id"
    | "username"
    | "email_normalized",
  value: number | string,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_users")
    .select(AUTH_USER_SELECT_COLUMNS)
    .eq(column, value)
    .maybeSingle<AuthUserRecord>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data;
}

export async function findAuthUserById(userId: number) {
  return selectAuthUserBy("id", userId);
}

export async function findAuthUserByDiscordUserId(discordUserId: string) {
  return selectAuthUserBy("discord_user_id", discordUserId);
}

export async function findAuthUserByGoogleUserId(googleUserId: string) {
  return selectAuthUserBy("google_user_id", googleUserId);
}

export async function findAuthUserByMicrosoftUserId(microsoftUserId: string) {
  return selectAuthUserBy("microsoft_user_id", microsoftUserId);
}

export async function findAuthUserByUsername(username: string) {
  const normalizedUsername = sanitizeAuthUsername(username);
  if (!normalizedUsername) return null;
  return selectAuthUserBy("username", normalizedUsername);
}

export async function findAuthUserByEmail(email: string) {
  const normalizedEmail = normalizeAuthEmail(email);
  if (!normalizedEmail) return null;
  return selectAuthUserBy("email_normalized", normalizedEmail);
}

function sanitizeAuthUsername(value: string | null | undefined) {
  if (typeof value !== "string") return "flowdesk-user";

  const sanitized = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 32);

  return sanitized || "flowdesk-user";
}

function buildAuthUsernameVariant(baseUsername: string, attempt: number) {
  const normalizedBase = sanitizeAuthUsername(baseUsername);
  if (attempt <= 0) {
    return normalizedBase;
  }

  const suffix = `-${attempt + 1}`;
  const truncatedBase = normalizedBase
    .slice(0, Math.max(1, 32 - suffix.length))
    .replace(/^[-._]+|[-._]+$/g, "");

  return `${truncatedBase || "flowdesk-user"}${suffix}`;
}

async function resolveAvailableAuthUsername(
  baseUsername: string,
  excludeUserId?: number | null,
) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = buildAuthUsernameVariant(baseUsername, attempt);
    const existing = await findAuthUserByUsername(candidate);
    if (!existing || existing.id === excludeUserId) {
      return candidate;
    }
  }

  const randomSuffix = crypto.randomBytes(3).toString("hex");
  const fallbackBase = sanitizeAuthUsername(baseUsername)
    .slice(0, Math.max(1, 32 - randomSuffix.length - 1))
    .replace(/^[-._]+|[-._]+$/g, "");

  return `${fallbackBase || "flowdesk-user"}-${randomSuffix}`;
}

type AuthUserMutationPayload = {
  discord_user_id: string | null;
  google_user_id: string | null;
  microsoft_user_id: string | null;
  username: string;
  global_name: string | null;
  display_name: string;
  avatar: string | null;
  email: string | null;
  email_normalized: string | null;
  email_verified_at: string | null;
  locale: string | null;
  raw_user: {
    source: string;
    providers: Record<string, unknown>;
  };
};

function isDuplicateUsernameInsertError(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("duplicate key value violates unique constraint") &&
    normalizedMessage.includes("username")
  );
}

async function insertAuthUserWithResolvedUsername(
  payload: AuthUserMutationPayload,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const username = await resolveAvailableAuthUsername(payload.username);
    const result = await supabase
      .from("auth_users")
      .insert({
        ...payload,
        username,
      })
      .select(AUTH_USER_SELECT_COLUMNS)
      .single<AuthUserRecord>();

    if (!result.error) {
      return result.data;
    }

    lastError = new Error(result.error.message);
    if (!isDuplicateUsernameInsertError(result.error.message)) {
      break;
    }
  }

  throw lastError || new Error("Erro desconhecido ao criar usuario.");
}

function buildEmailUserPayload(email: string, emailVerifiedAt: string | null) {
  const normalizedEmail = normalizeAuthEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email invalido para criar a conta.");
  }

  return {
    discord_user_id: null,
    google_user_id: null,
    microsoft_user_id: null,
    username: buildEmailUsername(normalizedEmail),
    global_name: null,
    display_name: buildEmailDisplayName(normalizedEmail),
    avatar: null,
    email: normalizedEmail,
    email_normalized: normalizedEmail,
    email_verified_at: emailVerifiedAt,
    locale: null,
    raw_user: {
      source: "email",
      providers: {
        email: {
          email: normalizedEmail,
        },
      },
    },
  };
}

export async function createEmailAuthUser(input: {
  email: string;
  emailVerifiedAt?: string | null;
}) {
  const normalizedEmail = normalizeAuthEmail(input.email);
  if (!normalizedEmail) {
    throw new Error("Informe um email valido.");
  }

  const existing = await findAuthUserByEmail(normalizedEmail);
  if (existing) {
    return existing;
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_users")
    .insert(
      buildEmailUserPayload(
        normalizedEmail,
        input.emailVerifiedAt ?? new Date().toISOString(),
      ),
    )
    .select(AUTH_USER_SELECT_COLUMNS)
    .single<AuthUserRecord>();

  if (result.error) {
    if (normalizedEmail) {
      const concurrent = await findAuthUserByEmail(normalizedEmail);
      if (concurrent) return concurrent;
    }

    throw new Error(`Erro ao criar usuario por email: ${result.error.message}`);
  }

  return result.data;
}

async function saveDiscordUserToAuthUser(
  discordUser: DiscordUser,
  linkToUserId?: number | null,
) {
  const normalizedEmail = discordUser.verified
    ? normalizeAuthEmail(discordUser.email)
    : null;
  const existingLinkedUser =
    typeof linkToUserId === "number" ? await findAuthUserById(linkToUserId) : null;

  const payload = {
    discord_user_id: discordUser.id,
    google_user_id: existingLinkedUser?.google_user_id || null,
    microsoft_user_id: existingLinkedUser?.microsoft_user_id || null,
    username: discordUser.username,
    global_name: discordUser.global_name,
    display_name: buildDisplayName(discordUser),
    avatar: discordUser.avatar,
    email: normalizedEmail || existingLinkedUser?.email || null,
    email_normalized: normalizedEmail || existingLinkedUser?.email_normalized || null,
    email_verified_at:
      normalizedEmail
        ? existingLinkedUser?.email_verified_at || new Date().toISOString()
        : existingLinkedUser?.email_verified_at || null,
    locale: discordUser.locale || null,
    raw_user: {
      source: "discord",
      providers: {
        discord: discordUser,
      },
    },
  };

  const supabase = getSupabaseAdminClientOrThrow();

  if (typeof linkToUserId === "number") {
    const result = await supabase
      .from("auth_users")
      .update(payload)
      .eq("id", linkToUserId)
      .select(AUTH_USER_SELECT_COLUMNS)
      .single<AuthUserRecord>();

    if (result.error) {
      throw new Error(`Erro ao vincular usuario Discord: ${result.error.message}`);
    }

    return result.data;
  }

  try {
    return await insertAuthUserWithResolvedUsername(payload);
  } catch (error) {
    const existingByDiscord = await findAuthUserByDiscordUserId(discordUser.id);
    if (existingByDiscord) {
      return saveDiscordUserToAuthUser(discordUser, existingByDiscord.id);
    }

    if (normalizedEmail) {
      const byEmail = await findAuthUserByEmail(normalizedEmail);
      if (byEmail && (!byEmail.discord_user_id || byEmail.discord_user_id === discordUser.id)) {
        return saveDiscordUserToAuthUser(discordUser, byEmail.id);
      }
    }

    throw new Error(
      `Erro ao salvar usuario no Supabase: ${
        error instanceof Error ? error.message : "erro_desconhecido"
      }`,
    );
  }
}

export async function resolveAuthUserForDiscordLogin(
  discordUser: DiscordUser,
  input?: {
    currentUserId?: number | null;
  },
) {
  const existingByDiscord = await findAuthUserByDiscordUserId(discordUser.id);
  const normalizedDiscordEmail = discordUser.verified
    ? normalizeAuthEmail(discordUser.email)
    : null;

  if (typeof input?.currentUserId === "number") {
    const currentUser = await findAuthUserById(input.currentUserId);
    if (!currentUser) {
      throw new Error("Sua sessao atual nao foi encontrada para concluir a vinculacao.");
    }

    if (existingByDiscord && existingByDiscord.id !== currentUser.id) {
      throw new Error("Esta conta do Discord ja esta vinculada a outra conta Flowdesk.");
    }

    if (
      currentUser.discord_user_id &&
      currentUser.discord_user_id !== discordUser.id
    ) {
      throw new Error("Sua conta Flowdesk ja esta vinculada a outro Discord.");
    }

    return saveDiscordUserToAuthUser(discordUser, currentUser.id);
  }

  if (existingByDiscord) {
    return saveDiscordUserToAuthUser(discordUser, existingByDiscord.id);
  }

  if (!normalizedDiscordEmail) {
    throw new Error("Sua conta Discord precisa ter um email verificado para entrar.");
  }

  const existingByEmail = await findAuthUserByEmail(normalizedDiscordEmail);
  if (existingByEmail) {
    if (
      existingByEmail.discord_user_id &&
      existingByEmail.discord_user_id !== discordUser.id
    ) {
      throw new Error("O email desta conta ja esta vinculado a outro Discord.");
    }

    return saveDiscordUserToAuthUser(discordUser, existingByEmail.id);
  }

  return saveDiscordUserToAuthUser(discordUser);
}

async function touchAuthUserLastLogin(userId: number, authMethod: AuthMethod) {
  const supabase = getSupabaseAdminClientOrThrow();

  try {
    await supabase
      .from("auth_users")
      .update({
        last_login_at: new Date().toISOString(),
        last_auth_method: authMethod,
      })
      .eq("id", userId);
  } catch {
    // Mantemos o login funcional mesmo se colunas auxiliares ainda nao existirem.
  }
}

export async function markAuthUserLastLogin(
  userId: number,
  authMethod: AuthMethod,
) {
  await touchAuthUserLastLogin(userId, authMethod);
}

async function createSession(
  userId: number,
  context: CreateSessionContext,
  tokens: SessionTokens,
  options?: CreateSessionOptions,
) {
  const sessionToken = createSessionToken();
  const sessionTokenHash = hashToken(sessionToken);
  const ttlHours = resolveSessionTtlHours(options);
  const maxAgeSeconds = Math.max(60, Math.round(ttlHours * 60 * 60));
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();

  const supabase = getSupabaseAdminClientOrThrow();
  const reusableDiscordTokens =
    tokens.discordAccessToken || tokens.discordRefreshToken
      ? null
      : await findReusableDiscordSessionTokensForUser(userId);
  const discordAccessToken =
    tokens.discordAccessToken ?? reusableDiscordTokens?.discordAccessToken ?? null;
  const discordRefreshToken =
    tokens.discordRefreshToken ?? reusableDiscordTokens?.discordRefreshToken ?? null;
  const discordTokenExpiresAt =
    tokens.discordTokenExpiresAt ??
    reusableDiscordTokens?.discordTokenExpiresAt ??
    null;
  const authMethod =
    tokens.authMethod || (discordAccessToken ? "discord" : "email");
  const insertPayload = {
    user_id: userId,
    session_token_hash: sessionTokenHash,
    ip_address: context.ipAddress,
    user_agent: context.userAgent,
    expires_at: expiresAt,
    auth_method: authMethod,
    discord_access_token: encryptStoredOAuthToken(discordAccessToken),
    discord_refresh_token: encryptStoredOAuthToken(discordRefreshToken),
    discord_token_expires_at: discordTokenExpiresAt,
  };

  let insertResult = await supabase.from("auth_sessions").insert(insertPayload);

  if (
    insertResult.error &&
    insertResult.error.message.toLowerCase().includes("auth_method")
  ) {
    const legacyInsertPayload = { ...insertPayload } as Record<string, unknown>;
    delete legacyInsertPayload.auth_method;
    insertResult = await supabase.from("auth_sessions").insert(legacyInsertPayload);
  }

  if (insertResult.error) {
    throw new Error(`Erro ao criar sessao no Supabase: ${insertResult.error.message}`);
  }

  await touchAuthUserLastLogin(userId, authMethod);

  return {
    sessionToken,
    expiresAt,
    maxAgeSeconds,
  };
}

export async function createSessionForUser(
  userId: number,
  context: CreateSessionContext,
  tokens: SessionTokens = {},
  options?: CreateSessionOptions,
) {
  return createSession(userId, context, tokens, options);
}

export async function createUserSessionFromDiscordUser(
  discordUser: DiscordUser,
  context: CreateSessionContext,
  tokens: SessionTokens,
  options?: {
    currentUserId?: number | null;
    rememberSession?: boolean;
  },
) {
  const user = await resolveAuthUserForDiscordLogin(discordUser, {
    currentUserId: options?.currentUserId ?? null,
  });
  const session = await createSession(
    user.id,
    context,
    {
      ...tokens,
      authMethod: "discord",
    },
    {
      rememberSession: options?.rememberSession ?? false,
    },
  );

  return {
    user,
    session,
  };
}

export async function createUserSessionFromGoogleUser(
  googleUser: GoogleUser,
  context: CreateSessionContext,
  options?: {
    currentUserId?: number | null;
    rememberSession?: boolean;
  },
) {
  const user = await resolveAuthUserForGoogleLogin(googleUser, {
    currentUserId: options?.currentUserId ?? null,
  });
  const session = await createSession(
    user.id,
    context,
    {
      authMethod: "google",
      discordAccessToken: null,
      discordRefreshToken: null,
      discordTokenExpiresAt: null,
    },
    {
      rememberSession: options?.rememberSession ?? false,
    },
  );

  return {
    user,
    session,
  };
}

export async function createUserSessionFromMicrosoftUser(
  microsoftUser: MicrosoftUser,
  context: CreateSessionContext,
  options?: {
    currentUserId?: number | null;
    rememberSession?: boolean;
  },
) {
  const user = await resolveAuthUserForMicrosoftLogin(microsoftUser, {
    currentUserId: options?.currentUserId ?? null,
  });
  const session = await createSession(
    user.id,
    context,
    {
      authMethod: "microsoft",
      discordAccessToken: null,
      discordRefreshToken: null,
      discordTokenExpiresAt: null,
    },
    {
      rememberSession: options?.rememberSession ?? false,
    },
  );

  return {
    user,
    session,
  };
}

async function saveGoogleUserToAuthUser(
  googleUser: GoogleUser,
  linkToUserId?: number | null,
) {
  const normalizedEmail = normalizeAuthEmail(googleUser.email);
  if (!normalizedEmail || !googleUser.email_verified) {
    throw new Error("Sua conta Google precisa ter um email verificado para entrar.");
  }

  const existingLinkedUser =
    typeof linkToUserId === "number" ? await findAuthUserById(linkToUserId) : null;
  const preserveExistingIdentity = Boolean(existingLinkedUser?.discord_user_id);

  const payload = {
    discord_user_id: existingLinkedUser?.discord_user_id || null,
    google_user_id: googleUser.sub,
    microsoft_user_id: existingLinkedUser?.microsoft_user_id || null,
    username: existingLinkedUser?.username || buildEmailUsername(normalizedEmail),
    global_name:
      preserveExistingIdentity
        ? existingLinkedUser?.global_name || null
        : existingLinkedUser?.global_name || googleUser.given_name || null,
    display_name:
      preserveExistingIdentity
        ? existingLinkedUser?.display_name || buildEmailDisplayName(normalizedEmail)
        : googleUser.name?.trim() ||
          existingLinkedUser?.display_name ||
          buildEmailDisplayName(normalizedEmail),
    avatar: existingLinkedUser?.avatar || null,
    email: normalizedEmail,
    email_normalized: normalizedEmail,
    email_verified_at:
      existingLinkedUser?.email_verified_at || new Date().toISOString(),
    locale:
      preserveExistingIdentity
        ? existingLinkedUser?.locale || googleUser.locale || null
        : googleUser.locale || existingLinkedUser?.locale || null,
    raw_user: {
      source: "google",
      providers: {
        google: googleUser,
      },
    },
  };

  const supabase = getSupabaseAdminClientOrThrow();

  if (typeof linkToUserId === "number") {
    const result = await supabase
      .from("auth_users")
      .update(payload)
      .eq("id", linkToUserId)
      .select(AUTH_USER_SELECT_COLUMNS)
      .single<AuthUserRecord>();

    if (result.error) {
      throw new Error(`Erro ao vincular usuario Google: ${result.error.message}`);
    }

    return result.data;
  }

  try {
    return await insertAuthUserWithResolvedUsername(payload);
  } catch (error) {
    const byGoogle = await findAuthUserByGoogleUserId(googleUser.sub);
    if (byGoogle) {
      return saveGoogleUserToAuthUser(googleUser, byGoogle.id);
    }

    const byEmail = await findAuthUserByEmail(normalizedEmail);
    if (byEmail && (!byEmail.google_user_id || byEmail.google_user_id === googleUser.sub)) {
      return saveGoogleUserToAuthUser(googleUser, byEmail.id);
    }

    throw new Error(
      `Erro ao salvar usuario Google no Supabase: ${
        error instanceof Error ? error.message : "erro_desconhecido"
      }`,
    );
  }
}

export async function resolveAuthUserForGoogleLogin(
  googleUser: GoogleUser,
  input?: {
    currentUserId?: number | null;
  },
) {
  const normalizedEmail = normalizeAuthEmail(googleUser.email);
  if (!normalizedEmail || !googleUser.email_verified) {
    throw new Error("Sua conta Google nao retornou um email verificado.");
  }

  const existingByGoogle = await findAuthUserByGoogleUserId(googleUser.sub);

  if (typeof input?.currentUserId === "number") {
    const currentUser = await findAuthUserById(input.currentUserId);
    if (!currentUser) {
      throw new Error("Sua sessao atual nao foi encontrada para concluir a vinculacao.");
    }

    if (existingByGoogle && existingByGoogle.id !== currentUser.id) {
      throw new Error("Esta conta Google ja esta vinculada a outra conta Flowdesk.");
    }

    if (currentUser.google_user_id && currentUser.google_user_id !== googleUser.sub) {
      throw new Error("Sua conta Flowdesk ja esta vinculada a outra conta Google.");
    }

    return saveGoogleUserToAuthUser(googleUser, currentUser.id);
  }

  if (existingByGoogle) {
    return saveGoogleUserToAuthUser(googleUser, existingByGoogle.id);
  }

  const existingByEmail = await findAuthUserByEmail(normalizedEmail);
  if (existingByEmail) {
    if (
      existingByEmail.google_user_id &&
      existingByEmail.google_user_id !== googleUser.sub
    ) {
      throw new Error("O email desta conta ja esta vinculado a outra conta Google.");
    }

    return saveGoogleUserToAuthUser(googleUser, existingByEmail.id);
  }

  return saveGoogleUserToAuthUser(googleUser);
}

async function saveMicrosoftUserToAuthUser(
  microsoftUser: MicrosoftUser,
  linkToUserId?: number | null,
) {
  const normalizedEmail = normalizeAuthEmail(microsoftUser.email);
  if (!normalizedEmail) {
    throw new Error("Sua conta Microsoft nao retornou um email utilizavel para continuar.");
  }

  const existingLinkedUser =
    typeof linkToUserId === "number" ? await findAuthUserById(linkToUserId) : null;
  const preserveExistingIdentity = Boolean(existingLinkedUser?.discord_user_id);

  const payload = {
    discord_user_id: existingLinkedUser?.discord_user_id || null,
    google_user_id: existingLinkedUser?.google_user_id || null,
    microsoft_user_id: microsoftUser.id,
    username: existingLinkedUser?.username || buildEmailUsername(normalizedEmail),
    global_name:
      preserveExistingIdentity
        ? existingLinkedUser?.global_name || null
        : existingLinkedUser?.global_name ||
          microsoftUser.givenName ||
          microsoftUser.surname ||
          null,
    display_name:
      preserveExistingIdentity
        ? existingLinkedUser?.display_name || buildEmailDisplayName(normalizedEmail)
        : microsoftUser.displayName?.trim() ||
          existingLinkedUser?.display_name ||
          buildEmailDisplayName(normalizedEmail),
    avatar: existingLinkedUser?.avatar || null,
    email: normalizedEmail,
    email_normalized: normalizedEmail,
    email_verified_at:
      existingLinkedUser?.email_verified_at || new Date().toISOString(),
    locale:
      preserveExistingIdentity
        ? existingLinkedUser?.locale || microsoftUser.preferredLanguage || null
        : microsoftUser.preferredLanguage || existingLinkedUser?.locale || null,
    raw_user: {
      source: "microsoft",
      providers: {
        microsoft: microsoftUser,
      },
    },
  };

  const supabase = getSupabaseAdminClientOrThrow();

  if (typeof linkToUserId === "number") {
    const result = await supabase
      .from("auth_users")
      .update(payload)
      .eq("id", linkToUserId)
      .select(AUTH_USER_SELECT_COLUMNS)
      .single<AuthUserRecord>();

    if (result.error) {
      throw new Error(`Erro ao vincular usuario Microsoft: ${result.error.message}`);
    }

    return result.data;
  }

  try {
    return await insertAuthUserWithResolvedUsername(payload);
  } catch (error) {
    const byMicrosoft = await findAuthUserByMicrosoftUserId(microsoftUser.id);
    if (byMicrosoft) {
      return saveMicrosoftUserToAuthUser(microsoftUser, byMicrosoft.id);
    }

    const byEmail = await findAuthUserByEmail(normalizedEmail);
    if (
      byEmail &&
      (!byEmail.microsoft_user_id || byEmail.microsoft_user_id === microsoftUser.id)
    ) {
      return saveMicrosoftUserToAuthUser(microsoftUser, byEmail.id);
    }

    throw new Error(
      `Erro ao salvar usuario Microsoft no Supabase: ${
        error instanceof Error ? error.message : "erro_desconhecido"
      }`,
    );
  }
}

export async function resolveAuthUserForMicrosoftLogin(
  microsoftUser: MicrosoftUser,
  input?: {
    currentUserId?: number | null;
  },
) {
  const normalizedEmail = normalizeAuthEmail(microsoftUser.email);
  if (!normalizedEmail) {
    throw new Error("Sua conta Microsoft nao retornou um email utilizavel.");
  }

  const existingByMicrosoft = await findAuthUserByMicrosoftUserId(microsoftUser.id);

  if (typeof input?.currentUserId === "number") {
    const currentUser = await findAuthUserById(input.currentUserId);
    if (!currentUser) {
      throw new Error("Sua sessao atual nao foi encontrada para concluir a vinculacao.");
    }

    if (existingByMicrosoft && existingByMicrosoft.id !== currentUser.id) {
      throw new Error("Esta conta Microsoft ja esta vinculada a outra conta Flowdesk.");
    }

    if (
      currentUser.microsoft_user_id &&
      currentUser.microsoft_user_id !== microsoftUser.id
    ) {
      throw new Error("Sua conta Flowdesk ja esta vinculada a outra conta Microsoft.");
    }

    return saveMicrosoftUserToAuthUser(microsoftUser, currentUser.id);
  }

  if (existingByMicrosoft) {
    return saveMicrosoftUserToAuthUser(microsoftUser, existingByMicrosoft.id);
  }

  const existingByEmail = await findAuthUserByEmail(normalizedEmail);
  if (existingByEmail) {
    if (
      existingByEmail.microsoft_user_id &&
      existingByEmail.microsoft_user_id !== microsoftUser.id
    ) {
      throw new Error("O email desta conta ja esta vinculado a outra conta Microsoft.");
    }

    return saveMicrosoftUserToAuthUser(microsoftUser, existingByEmail.id);
  }

  return saveMicrosoftUserToAuthUser(microsoftUser);
}


export type GetAuthSessionOptions = {
  fullContext?: boolean;
};

export async function getCurrentAuthSessionFromCookie(
  options: GetAuthSessionOptions = {},
): Promise<CurrentAuthSession | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(authConfig.sessionCookieName)?.value;
  const sessionProofCookie = cookieStore.get(
    getSharedAuthCookieProofName(authConfig.sessionCookieName),
  )?.value;

  if (!sessionCookie) return null;
  if (
    validateSharedAuthCookieIntegrity(
      authConfig.sessionCookieName,
      sessionCookie,
      sessionProofCookie,
    ) === "invalid"
  ) {
    return null;
  }

  const sessionTokenHashes = buildSessionTokenHashCandidates(sessionCookie);
  const primarySessionTokenHash = sessionTokenHashes[0];
  const cacheKey = buildAuthSessionCacheKey(primarySessionTokenHash, options);
  const cachedSession = readAuthSessionCache(cacheKey);
  if (cachedSession.hit) {
    return cachedSession.value;
  }

  if (authSessionCircuitOpenUntilMs > Date.now()) {
    const staleSession = readAuthSessionCache(cacheKey, { allowStale: true });
    if (staleSession.hit) {
      return staleSession.value;
    }
  }

  const inflight = authSessionInflight.get(cacheKey);
  if (inflight) {
    return cloneAuthSession(await inflight);
  }

  const loadPromise = (async () => {
    const supabase = getSupabaseAdminClientOrThrow();
    const nowIso = new Date().toISOString();

    const selectColumns = options.fullContext
      ? "id, session_token_hash, discord_access_token, discord_refresh_token, discord_token_expires_at, active_guild_id, discord_guilds_cache, discord_guilds_cached_at, config_current_step, config_draft, config_context_updated_at, user:auth_users(id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale)"
      : "id, session_token_hash, discord_access_token, discord_refresh_token, discord_token_expires_at, active_guild_id, discord_guilds_cached_at, config_current_step, config_context_updated_at, user:auth_users(id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale)";

    try {
      const result = await supabase
        .from("auth_sessions")
        .select(selectColumns)
        .in("session_token_hash", sessionTokenHashes)
        .is("revoked_at", null)
        .gt("expires_at", nowIso)
        .limit(2)
        .returns<AuthSessionRecord[]>();

      if (result.error) {
        throw new Error(`Erro ao validar sessao: ${result.error.message}`);
      }

      const matchedRecord =
        (result.data || []).sort((left, right) => {
          const leftPriority =
            left.session_token_hash === primarySessionTokenHash ? 0 : 1;
          const rightPriority =
            right.session_token_hash === primarySessionTokenHash ? 0 : 1;
          return leftPriority - rightPriority;
        })[0] || null;

      if (!matchedRecord) {
        writeAuthSessionCache(cacheKey, null);
        return null;
      }

      if (
        matchedRecord.session_token_hash &&
        matchedRecord.session_token_hash !== primarySessionTokenHash
      ) {
        await supabase
          .from("auth_sessions")
          .update({
            session_token_hash: primarySessionTokenHash,
          })
          .eq("id", matchedRecord.id)
          .eq("session_token_hash", matchedRecord.session_token_hash);
      }

      const user = unwrapUser(matchedRecord.user);
      if (!user) {
        writeAuthSessionCache(cacheKey, null);
        return null;
      }

      const session = {
        id: matchedRecord.id,
        user,
        discordAccessToken: decryptStoredOAuthToken(matchedRecord.discord_access_token),
        discordRefreshToken: decryptStoredOAuthToken(matchedRecord.discord_refresh_token),
        discordTokenExpiresAt: matchedRecord.discord_token_expires_at,
        activeGuildId: matchedRecord.active_guild_id,
        discordGuildsCache: options.fullContext
          ? parseDiscordGuildsCache(matchedRecord.discord_guilds_cache)
          : null,
        discordGuildsCachedAt: matchedRecord.discord_guilds_cached_at,
        configCurrentStep: normalizeConfigStep(matchedRecord.config_current_step) || 1,
        configDraft: options.fullContext
          ? sanitizeConfigDraft(matchedRecord.config_draft)
          : createEmptyConfigDraft(),
        configContextUpdatedAt: matchedRecord.config_context_updated_at,
      } satisfies CurrentAuthSession;

      authSessionCircuitOpenUntilMs = 0;
      writeAuthSessionCache(cacheKey, session);
      return session;
    } catch (error) {
      if (isAuthSessionAvailabilityError(error)) {
        authSessionCircuitOpenUntilMs = Date.now() + AUTH_SESSION_CIRCUIT_OPEN_MS;
        const staleSession = readAuthSessionCache(cacheKey, { allowStale: true });
        if (staleSession.hit) {
          return staleSession.value;
        }
      }

      throw error;
    }
  })();

  authSessionInflight.set(cacheKey, loadPromise);

  try {
    return cloneAuthSession(await loadPromise);
  } finally {
    authSessionInflight.delete(cacheKey);
  }
}

export async function getCurrentAuthSessionFromCookieSafe(
  options: GetAuthSessionOptions = {},
): Promise<SafeAuthSessionResult> {
  try {
    return {
      session: await getCurrentAuthSessionFromCookie(options),
      degraded: false,
    };
  } catch (error) {
    if (isAuthSessionAvailabilityError(error)) {
      return {
        session: null,
        degraded: true,
      };
    }

    throw error;
  }
}

export async function updateSessionDiscordTokens(
  sessionId: string,
  tokens: SessionTokens,
) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("auth_sessions")
    .update({
      discord_access_token: encryptStoredOAuthToken(tokens.discordAccessToken ?? null),
      discord_refresh_token: encryptStoredOAuthToken(tokens.discordRefreshToken ?? null),
      discord_token_expires_at: tokens.discordTokenExpiresAt ?? null,
    })
    .eq("id", sessionId);

  if (result.error) {
    throw new Error(`Erro ao atualizar token da sessao: ${result.error.message}`);
  }
}

export async function updateSessionGuildsCache(
  sessionId: string,
  guilds: DiscordGuild[],
) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("auth_sessions")
    .update({
      discord_guilds_cache: guilds,
      discord_guilds_cached_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (result.error) {
    throw new Error(`Erro ao atualizar cache de servidores: ${result.error.message}`);
  }
}

export async function updateSessionActiveGuild(
  sessionId: string,
  guildId: string | null,
) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("auth_sessions")
    .update({
      active_guild_id: guildId,
      config_context_updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (result.error) {
    throw new Error(`Erro ao atualizar servidor ativo da sessao: ${result.error.message}`);
  }
}

type UpdateSessionConfigContextInput = {
  activeGuildId?: string | null;
  configCurrentStep?: ConfigStep;
  configDraft?: ConfigDraft;
};

type SessionConfigContextRecord = {
  active_guild_id: string | null;
  config_current_step: number | null;
  config_draft: unknown;
  config_context_updated_at: string | null;
};

export async function updateSessionConfigContext(
  sessionId: string,
  input: UpdateSessionConfigContextInput,
) {
  const updates: Record<string, unknown> = {
    config_context_updated_at: new Date().toISOString(),
  };

  if (Object.prototype.hasOwnProperty.call(input, "activeGuildId")) {
    updates.active_guild_id = input.activeGuildId ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(input, "configCurrentStep")) {
    updates.config_current_step = input.configCurrentStep ?? 1;
  }

  if (Object.prototype.hasOwnProperty.call(input, "configDraft")) {
    updates.config_draft = input.configDraft ?? createEmptyConfigDraft();
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_sessions")
    .update(updates)
    .eq("id", sessionId)
    .select("active_guild_id, config_current_step, config_draft, config_context_updated_at")
    .single<SessionConfigContextRecord>();

  if (result.error) {
    throw new Error(`Erro ao atualizar contexto da sessao: ${result.error.message}`);
  }

  return {
    activeGuildId: result.data.active_guild_id,
    configCurrentStep: normalizeConfigStep(result.data.config_current_step) || 1,
    configDraft: sanitizeConfigDraft(result.data.config_draft),
    configContextUpdatedAt: result.data.config_context_updated_at,
  };
}

export async function getCurrentUserFromSessionCookie(
  options: GetAuthSessionOptions = {},
) {
  const session = await getCurrentAuthSessionFromCookie(options);
  return session?.user || null;
}

export async function getCurrentUserFromSessionCookieSafe(
  options: GetAuthSessionOptions = {},
) {
  const result = await getCurrentAuthSessionFromCookieSafe(options);
  return {
    user: result.session?.user || null,
    degraded: result.degraded,
  };
}

export async function revokeCurrentSessionFromCookie() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(authConfig.sessionCookieName)?.value;

  if (!sessionCookie) {
    return false;
  }

  const sessionTokenHashes = buildSessionTokenHashCandidates(sessionCookie);
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("auth_sessions")
    .update({
      revoked_at: new Date().toISOString(),
    })
    .in("session_token_hash", sessionTokenHashes)
    .is("revoked_at", null);

  if (result.error) {
    throw new Error(`Erro ao revogar sessao: ${result.error.message}`);
  }

  return true;
}
