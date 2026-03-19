import { authConfig } from "@/lib/auth/config";
import {
  DiscordRateLimitError,
  fetchDiscordGuilds,
  type DiscordGuild,
  refreshDiscordToken,
} from "@/lib/auth/discord";
import {
  type CurrentAuthSession,
  getCurrentAuthSessionFromCookie,
  updateSessionDiscordTokens,
  updateSessionGuildsCache,
} from "@/lib/auth/session";

const DISCORD_ADMINISTRATOR = BigInt(8);
const DISCORD_MANAGE_GUILD = BigInt(32);
const GUILD_CACHE_TTL_MS = 30 * 60 * 1000;

export type DiscordGuildChannel = {
  id: string;
  guild_id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string | null;
};

export type DiscordGuildRole = {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
};

export function isGuildId(value: string) {
  return /^\d{10,25}$/.test(value);
}

function isTokenExpired(tokenExpiresAt: string | null) {
  if (!tokenExpiresAt) return true;
  return Date.now() >= new Date(tokenExpiresAt).getTime() - 15_000;
}

function hasAdminAccess(permissions: string, owner: boolean) {
  if (owner) return true;

  try {
    const bits = BigInt(permissions);
    return (
      (bits & DISCORD_ADMINISTRATOR) === DISCORD_ADMINISTRATOR ||
      (bits & DISCORD_MANAGE_GUILD) === DISCORD_MANAGE_GUILD
    );
  } catch {
    return false;
  }
}

function isGuildCacheFresh(cachedAt: string | null) {
  if (!cachedAt) return false;
  const timestamp = new Date(cachedAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < GUILD_CACHE_TTL_MS;
}

export async function resolveSessionAccessToken() {
  const authSession = await getCurrentAuthSessionFromCookie();
  if (!authSession) return null;

  let accessToken = authSession.discordAccessToken;
  let refreshToken = authSession.discordRefreshToken;
  let tokenExpiresAt = authSession.discordTokenExpiresAt;

  if ((!accessToken || isTokenExpired(tokenExpiresAt)) && refreshToken) {
    const refreshed = await refreshDiscordToken(refreshToken);

    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token || refreshToken;
    tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

    await updateSessionDiscordTokens(authSession.id, {
      discordAccessToken: accessToken,
      discordRefreshToken: refreshToken,
      discordTokenExpiresAt: tokenExpiresAt,
    });
  }

  return {
    authSession,
    accessToken,
  };
}

type SessionAccessContext = {
  authSession: CurrentAuthSession;
  accessToken: string;
};

function filterAccessibleGuilds(guilds: DiscordGuild[]) {
  return guilds.filter((guild) => hasAdminAccess(guild.permissions, guild.owner));
}

export async function getAccessibleGuildsForSession(
  sessionContext: SessionAccessContext,
) {
  const cachedGuilds = sessionContext.authSession.discordGuildsCache;
  if (
    cachedGuilds !== null &&
    isGuildCacheFresh(sessionContext.authSession.discordGuildsCachedAt)
  ) {
    return filterAccessibleGuilds(cachedGuilds);
  }

  try {
    const guilds = await fetchDiscordGuilds(sessionContext.accessToken);
    const accessibleGuilds = filterAccessibleGuilds(guilds);

    await updateSessionGuildsCache(sessionContext.authSession.id, guilds);
    return accessibleGuilds;
  } catch (error) {
    if (cachedGuilds !== null) {
      return filterAccessibleGuilds(cachedGuilds);
    }

    if (error instanceof DiscordRateLimitError) {
      return [];
    }

    throw error;
  }
}

export async function assertUserAdminInGuildOrNull(
  sessionContext: SessionAccessContext,
  guildId: string,
) {
  const guild = (await getAccessibleGuildsForSession(sessionContext))
    .find((item) => item.id === guildId);

  return guild || null;
}

function resolveBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

export async function fetchGuildChannelsByBot(guildId: string) {
  const botToken = resolveBotToken();
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado no ambiente do site.");
  }

  const response = await fetch(`https://discord.com/api/guilds/${guildId}/channels`, {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    cache: "no-store",
  });

  if (response.status === 404 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao buscar canais do servidor: ${text}`);
  }

  return (await response.json()) as DiscordGuildChannel[];
}

export async function fetchGuildRolesByBot(guildId: string) {
  const botToken = resolveBotToken();
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado no ambiente do site.");
  }

  const response = await fetch(`https://discord.com/api/guilds/${guildId}/roles`, {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    cache: "no-store",
  });

  if (response.status === 404 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao buscar cargos do servidor: ${text}`);
  }

  return (await response.json()) as DiscordGuildRole[];
}

export function buildBotInviteUrl(guildId: string) {
  const rawPermissions = process.env.DISCORD_BOT_INVITE_PERMISSIONS || "0";
  let permissions = DISCORD_ADMINISTRATOR;

  try {
    if (/^\d+$/.test(rawPermissions)) {
      permissions = BigInt(rawPermissions) | DISCORD_ADMINISTRATOR;
    }
  } catch {
    permissions = DISCORD_ADMINISTRATOR;
  }

  const params = new URLSearchParams({
    client_id: authConfig.discordClientId,
    scope: "bot applications.commands",
    permissions: permissions.toString(),
    guild_id: guildId,
    disable_guild_select: "true",
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
