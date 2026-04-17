import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { DiscordGuild, DiscordUser } from "@/lib/auth/discord";
import { authConfig } from "@/lib/auth/config";
import type { ConfigDraft, ConfigStep } from "@/lib/auth/configContext";
import {
  createEmptyConfigDraft,
  normalizeConfigStep,
  sanitizeConfigDraft,
} from "@/lib/auth/configContext";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CreateSessionContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

type DiscordSessionTokens = {
  discordAccessToken: string;
  discordRefreshToken: string | null;
  discordTokenExpiresAt: string | null;
};

type AuthUserRecord = {
  id: number;
  discord_user_id: string;
  username: string;
  global_name: string | null;
  display_name: string;
  avatar: string | null;
  email: string | null;
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

async function upsertAuthUser(discordUser: DiscordUser) {
  const supabase = getSupabaseAdminClientOrThrow();

  const payload = {
    discord_user_id: discordUser.id,
    username: discordUser.username,
    global_name: discordUser.global_name,
    display_name: buildDisplayName(discordUser),
    avatar: discordUser.avatar,
    email: discordUser.email || null,
    locale: discordUser.locale || null,
    raw_user: discordUser,
  };

  const result = await supabase
    .from("auth_users")
    .upsert(payload, { onConflict: "discord_user_id" })
    .select(
      "id, discord_user_id, username, global_name, display_name, avatar, email",
    )
    .single<AuthUserRecord>();

  if (result.error) {
    throw new Error(`Erro ao salvar usuario no Supabase: ${result.error.message}`);
  }

  return result.data;
}

async function createSession(
  userId: number,
  context: CreateSessionContext,
  tokens: DiscordSessionTokens,
) {
  const sessionToken = createSessionToken();
  const sessionTokenHash = hashToken(sessionToken);
  const expiresAt = new Date(
    Date.now() + authConfig.sessionTtlHours * 60 * 60 * 1000,
  ).toISOString();

  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase.from("auth_sessions").insert({
    user_id: userId,
    session_token_hash: sessionTokenHash,
    ip_address: context.ipAddress,
    user_agent: context.userAgent,
    expires_at: expiresAt,
    discord_access_token: tokens.discordAccessToken,
    discord_refresh_token: tokens.discordRefreshToken,
    discord_token_expires_at: tokens.discordTokenExpiresAt,
  });

  if (result.error) {
    throw new Error(`Erro ao criar sessao no Supabase: ${result.error.message}`);
  }

  return {
    sessionToken,
    expiresAt,
  };
}

export async function createUserSessionFromDiscordUser(
  discordUser: DiscordUser,
  context: CreateSessionContext,
  tokens: DiscordSessionTokens,
) {
  const user = await upsertAuthUser(discordUser);
  const session = await createSession(user.id, context, tokens);

  return {
    user,
    session,
  };
}

export type GetAuthSessionOptions = {
  /**
   * Se true, carrega colunas pesadas (JSON) como cache de servidores e rascunhos de configuração.
   * Use apenas páginas que realmente precisam desse contexto.
   */
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

  // Otimização: Não buscamos colunas JSON pesadas por padrão para acelerar a validação da sessão.
  const selectColumns = options.fullContext
    ? "id, discord_access_token, discord_refresh_token, discord_token_expires_at, active_guild_id, discord_guilds_cache, discord_guilds_cached_at, config_current_step, config_draft, config_context_updated_at, user:auth_users(id, discord_user_id, username, global_name, display_name, avatar, email)"
    : "id, discord_access_token, discord_refresh_token, discord_token_expires_at, active_guild_id, discord_guilds_cached_at, config_current_step, config_context_updated_at, user:auth_users(id, discord_user_id, username, global_name, display_name, avatar, email)";

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
  tokens: DiscordSessionTokens,
) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("auth_sessions")
    .update({
      discord_access_token: tokens.discordAccessToken,
      discord_refresh_token: tokens.discordRefreshToken,
      discord_token_expires_at: tokens.discordTokenExpiresAt,
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
