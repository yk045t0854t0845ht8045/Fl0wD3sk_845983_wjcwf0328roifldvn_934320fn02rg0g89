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
  buildEmailDisplayName,
  buildEmailUsername,
  normalizeAuthEmail,
} from "@/lib/auth/email";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CreateSessionContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

type AuthMethod = "discord" | "email" | "google" | "microsoft";

type SessionTokens = {
  authMethod?: AuthMethod;
  discordAccessToken?: string | null;
  discordRefreshToken?: string | null;
  discordTokenExpiresAt?: string | null;
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

function buildDisplayName(discordUser: DiscordUser) {
  return discordUser.global_name || discordUser.username;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createOAuthState() {
  return crypto.randomBytes(24).toString("hex");
}

function createSessionToken() {
  return crypto.randomBytes(48).toString("base64url");
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

async function selectAuthUserBy(
  column:
    | "id"
    | "discord_user_id"
    | "google_user_id"
    | "microsoft_user_id"
    | "email_normalized",
  value: number | string,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_users")
    .select(
      "id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale",
    )
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

export async function findAuthUserByEmail(email: string) {
  const normalizedEmail = normalizeAuthEmail(email);
  if (!normalizedEmail) return null;
  return selectAuthUserBy("email_normalized", normalizedEmail);
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
    .select(
      "id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale",
    )
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
      .select(
        "id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale",
      )
      .single<AuthUserRecord>();

    if (result.error) {
      throw new Error(`Erro ao vincular usuario Discord: ${result.error.message}`);
    }

    return result.data;
  }

  const result = await supabase
    .from("auth_users")
    .upsert(payload, { onConflict: "discord_user_id" })
    .select(
      "id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale",
    )
    .single<AuthUserRecord>();

  if (result.error) {
    if (normalizedEmail) {
      const byEmail = await findAuthUserByEmail(normalizedEmail);
      if (byEmail && (!byEmail.discord_user_id || byEmail.discord_user_id === discordUser.id)) {
        return saveDiscordUserToAuthUser(discordUser, byEmail.id);
      }
    }

    throw new Error(`Erro ao salvar usuario no Supabase: ${result.error.message}`);
  }

  return result.data;
}

export async function resolveAuthUserForDiscordLogin(
  discordUser: DiscordUser,
  input?: {
    currentUserId?: number | null;
  },
) {
  const existingByDiscord = await findAuthUserByDiscordUserId(discordUser.id);

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

  if (discordUser.verified) {
    const normalizedEmail = normalizeAuthEmail(discordUser.email);
    if (normalizedEmail) {
      const existingByEmail = await findAuthUserByEmail(normalizedEmail);
      if (existingByEmail) {
        if (
          existingByEmail.discord_user_id &&
          existingByEmail.discord_user_id !== discordUser.id
        ) {
          throw new Error("O email desta conta ja esta vinculado a outro Discord.");
        }

        return saveDiscordUserToAuthUser(discordUser, existingByEmail.id);
      }
    }
  }

  return saveDiscordUserToAuthUser(discordUser);
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
      .select(
        "id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale",
      )
      .single<AuthUserRecord>();

    if (result.error) {
      throw new Error(`Erro ao vincular usuario Google: ${result.error.message}`);
    }

    return result.data;
  }

  const result = await supabase
    .from("auth_users")
    .upsert(payload, { onConflict: "google_user_id" })
    .select(
      "id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale",
    )
    .single<AuthUserRecord>();

  if (result.error) {
    const byEmail = await findAuthUserByEmail(normalizedEmail);
    if (byEmail && (!byEmail.google_user_id || byEmail.google_user_id === googleUser.sub)) {
      return saveGoogleUserToAuthUser(googleUser, byEmail.id);
    }

    throw new Error(`Erro ao salvar usuario Google no Supabase: ${result.error.message}`);
  }

  return result.data;
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
      .select(
        "id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale",
      )
      .single<AuthUserRecord>();

    if (result.error) {
      throw new Error(`Erro ao vincular usuario Microsoft: ${result.error.message}`);
    }

    return result.data;
  }

  const result = await supabase
    .from("auth_users")
    .upsert(payload, { onConflict: "microsoft_user_id" })
    .select(
      "id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale",
    )
    .single<AuthUserRecord>();

  if (result.error) {
    const byEmail = await findAuthUserByEmail(normalizedEmail);
    if (
      byEmail &&
      (!byEmail.microsoft_user_id || byEmail.microsoft_user_id === microsoftUser.id)
    ) {
      return saveMicrosoftUserToAuthUser(microsoftUser, byEmail.id);
    }

    throw new Error(`Erro ao salvar usuario Microsoft no Supabase: ${result.error.message}`);
  }

  return result.data;
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

async function createSession(
  userId: number,
  context: CreateSessionContext,
  tokens: SessionTokens,
) {
  const sessionToken = createSessionToken();
  const sessionTokenHash = hashToken(sessionToken);
  const expiresAt = new Date(
    Date.now() + authConfig.sessionTtlHours * 60 * 60 * 1000,
  ).toISOString();

  const supabase = getSupabaseAdminClientOrThrow();
  const authMethod =
    tokens.authMethod || (tokens.discordAccessToken ? "discord" : "email");

  const insertResult = await supabase.from("auth_sessions").insert({
    user_id: userId,
    session_token_hash: sessionTokenHash,
    ip_address: context.ipAddress,
    user_agent: context.userAgent,
    expires_at: expiresAt,
    discord_access_token: tokens.discordAccessToken ?? null,
    discord_refresh_token: tokens.discordRefreshToken ?? null,
    discord_token_expires_at: tokens.discordTokenExpiresAt ?? null,
  });

  if (insertResult.error) {
    throw new Error(`Erro ao criar sessao no Supabase: ${insertResult.error.message}`);
  }

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

  return {
    sessionToken,
    expiresAt,
  };
}

export async function createSessionForUser(
  userId: number,
  context: CreateSessionContext,
  tokens: SessionTokens = {},
) {
  return createSession(userId, context, tokens);
}

export async function createUserSessionFromDiscordUser(
  discordUser: DiscordUser,
  context: CreateSessionContext,
  tokens: SessionTokens,
  options?: {
    currentUserId?: number | null;
  },
) {
  const user = await resolveAuthUserForDiscordLogin(discordUser, {
    currentUserId: options?.currentUserId ?? null,
  });
  const session = await createSession(user.id, context, {
    ...tokens,
    authMethod: "discord",
  });

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
  },
) {
  const user = await resolveAuthUserForGoogleLogin(googleUser, {
    currentUserId: options?.currentUserId ?? null,
  });
  const session = await createSession(user.id, context, {
    authMethod: "google",
    discordAccessToken: null,
    discordRefreshToken: null,
    discordTokenExpiresAt: null,
  });

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
  },
) {
  const user = await resolveAuthUserForMicrosoftLogin(microsoftUser, {
    currentUserId: options?.currentUserId ?? null,
  });
  const session = await createSession(user.id, context, {
    authMethod: "microsoft",
    discordAccessToken: null,
    discordRefreshToken: null,
    discordTokenExpiresAt: null,
  });

  return {
    user,
    session,
  };
}

export type GetAuthSessionOptions = {
  fullContext?: boolean;
};

export async function getCurrentAuthSessionFromCookie(
  options: GetAuthSessionOptions = {},
): Promise<CurrentAuthSession | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(authConfig.sessionCookieName)?.value;

  if (!sessionCookie) return null;

  const sessionTokenHash = hashToken(sessionCookie);
  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = new Date().toISOString();

  const selectColumns = options.fullContext
    ? "id, discord_access_token, discord_refresh_token, discord_token_expires_at, active_guild_id, discord_guilds_cache, discord_guilds_cached_at, config_current_step, config_draft, config_context_updated_at, user:auth_users(id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale)"
    : "id, discord_access_token, discord_refresh_token, discord_token_expires_at, active_guild_id, discord_guilds_cached_at, config_current_step, config_context_updated_at, user:auth_users(id, discord_user_id, google_user_id, microsoft_user_id, username, global_name, display_name, avatar, email, email_normalized, email_verified_at, locale)";

  const result = await supabase
    .from("auth_sessions")
    .select(selectColumns)
    .eq("session_token_hash", sessionTokenHash)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle<AuthSessionRecord>();

  if (result.error) {
    throw new Error(`Erro ao validar sessao: ${result.error.message}`);
  }

  if (!result.data) return null;

  const user = unwrapUser(result.data.user);
  if (!user) return null;

  return {
    id: result.data.id,
    user,
    discordAccessToken: result.data.discord_access_token,
    discordRefreshToken: result.data.discord_refresh_token,
    discordTokenExpiresAt: result.data.discord_token_expires_at,
    activeGuildId: result.data.active_guild_id,
    discordGuildsCache: options.fullContext
      ? parseDiscordGuildsCache(result.data.discord_guilds_cache)
      : null,
    discordGuildsCachedAt: result.data.discord_guilds_cached_at,
    configCurrentStep: normalizeConfigStep(result.data.config_current_step) || 1,
    configDraft: options.fullContext
      ? sanitizeConfigDraft(result.data.config_draft)
      : createEmptyConfigDraft(),
    configContextUpdatedAt: result.data.config_context_updated_at,
  };
}

export async function updateSessionDiscordTokens(
  sessionId: string,
  tokens: SessionTokens,
) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("auth_sessions")
    .update({
      discord_access_token: tokens.discordAccessToken ?? null,
      discord_refresh_token: tokens.discordRefreshToken ?? null,
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

export async function revokeCurrentSessionFromCookie() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(authConfig.sessionCookieName)?.value;

  if (!sessionCookie) {
    return false;
  }

  const sessionTokenHash = hashToken(sessionCookie);
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("auth_sessions")
    .update({
      revoked_at: new Date().toISOString(),
    })
    .eq("session_token_hash", sessionTokenHash)
    .is("revoked_at", null);

  if (result.error) {
    throw new Error(`Erro ao revogar sessao: ${result.error.message}`);
  }

  return true;
}
