import { authConfig } from "@/lib/auth/config";
import {
  DiscordRateLimitError,
  fetchDiscordGuilds,
  type DiscordGuild,
  refreshDiscordToken,
} from "@/lib/auth/discord";
import {
  type CurrentAuthSession,
  findReusableDiscordSessionTokensForUser,
  getCurrentAuthSessionFromCookie,
  updateSessionDiscordTokens,
  updateSessionGuildsCache,
} from "@/lib/auth/session";
import { getAcceptedTeamGuildIdsForUser } from "@/lib/teams/userTeams";

const DISCORD_ADMINISTRATOR = BigInt(8);
const DISCORD_MANAGE_GUILD = BigInt(32);
const GUILD_CACHE_TTL_MS = 30 * 60 * 1000;
const BOT_RESOURCE_FRESH_TTL_MS = 25 * 1000;
const BOT_RESOURCE_STALE_TTL_MS = 5 * 60 * 1000;
const BOT_RESOURCE_RETRY_DELAYS_MS = [180, 420, 900];

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

export type DiscordGuildMemberSummary = {
  avatarUrl: string | null;
  displayName: string;
  memberId: string;
  mentionLabel: string;
};

type DiscordBotGuildMemberPayload = {
  avatar?: string | null;
  nick?: string | null;
  user?: {
    avatar?: string | null;
    global_name?: string | null;
    id?: string;
    username?: string | null;
  } | null;
};

type BotResourceCacheEntry<T> = {
  timestamp: number;
  value: T;
};

const botGuildSummaryCache = new Map<string, BotResourceCacheEntry<BotGuildSummary>>();
const botGuildChannelsCache = new Map<
  string,
  BotResourceCacheEntry<DiscordGuildChannel[]>
>();
const botGuildRolesCache = new Map<
  string,
  BotResourceCacheEntry<DiscordGuildRole[]>
>();
const botGuildMemberSummaryCache = new Map<
  string,
  BotResourceCacheEntry<DiscordGuildMemberSummary>
>();

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

function readBotResourceCache<T>(
  cache: Map<string, BotResourceCacheEntry<T>>,
  cacheKey: string,
  maxAgeMs: number,
) {
  const cached = cache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > maxAgeMs) {
    cache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function writeBotResourceCache<T>(
  cache: Map<string, BotResourceCacheEntry<T>>,
  cacheKey: string,
  value: T,
) {
  cache.set(cacheKey, {
    timestamp: Date.now(),
    value,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeDiscordBotFailureMessage(resourceLabel: string) {
  return `Nao foi possivel sincronizar ${resourceLabel} do Discord agora. Tente novamente em instantes.`;
}

function buildDiscordAvatarUrl(
  userId: string,
  avatarHash: string | null | undefined,
) {
  if (!avatarHash) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${extension}?size=64`;
}

function buildDiscordGuildMemberAvatarUrl(
  guildId: string,
  userId: string,
  avatarHash: string | null | undefined,
) {
  if (!avatarHash) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatarHash}.${extension}?size=64`;
}

function buildFallbackGuildMemberSummary(memberId: string): DiscordGuildMemberSummary {
  const suffix = memberId.slice(-6);
  return {
    avatarUrl: null,
    displayName: `Membro ${suffix}`,
    memberId,
    mentionLabel: `@${suffix}`,
  };
}

async function recoverLinkedDiscordTokens(authSession: CurrentAuthSession) {
  if (!authSession.user.discord_user_id) {
    return null;
  }

  const recoveredTokens = await findReusableDiscordSessionTokensForUser(
    authSession.user.id,
    {
      excludeSessionId: authSession.id,
    },
  );

  if (!recoveredTokens) {
    return null;
  }

  await updateSessionDiscordTokens(authSession.id, recoveredTokens);
  return recoveredTokens;
}

export async function resolveSessionAccessToken() {
  const authSession = await getCurrentAuthSessionFromCookie();
  if (!authSession) return null;

  let accessToken = authSession.discordAccessToken;
  let refreshToken = authSession.discordRefreshToken;
  let tokenExpiresAt = authSession.discordTokenExpiresAt;

  if (!accessToken && !refreshToken) {
    try {
      const recoveredTokens = await recoverLinkedDiscordTokens(authSession);
      if (recoveredTokens) {
        accessToken = recoveredTokens.discordAccessToken;
        refreshToken = recoveredTokens.discordRefreshToken;
        tokenExpiresAt = recoveredTokens.discordTokenExpiresAt;
      }
    } catch {
      // Mantemos a sessao funcional para os fluxos que nao exigem OAuth do Discord.
    }
  }

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

type AccessibleGuildsOptions = {
  forceFresh?: boolean;
};

export function filterAccessibleGuilds(guilds: DiscordGuild[]) {
  return guilds.filter((guild) => hasAdminAccess(guild.permissions, guild.owner));
}

export async function getAccessibleGuildsFromAccessToken(accessToken: string) {
  try {
    const guilds = await fetchDiscordGuilds(accessToken);
    return filterAccessibleGuilds(guilds);
  } catch (error) {
    if (error instanceof DiscordRateLimitError) {
      return [];
    }

    throw error;
  }
}

export async function getAccessibleGuildsForSession(
  sessionContext: SessionAccessContext,
  options: AccessibleGuildsOptions = {},
) {
  const cachedGuilds = sessionContext.authSession.discordGuildsCache;
  if (
    !options.forceFresh &&
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

export async function hasAcceptedTeamAccessToGuild(
  sessionContext: SessionAccessContext,
  guildId: string,
) {
  const guildIds = await getAcceptedTeamGuildIdsForUser({
    authUserId: sessionContext.authSession.user.id,
    discordUserId: sessionContext.authSession.user.discord_user_id,
  });

  return guildIds.includes(guildId);
}

type BotGuildSummary = Pick<DiscordGuild, "id" | "name" | "icon">;

function resolveBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

async function fetchDiscordBotJsonWithRetry<T>(
  input: {
    url: string;
    botToken: string;
    resourceLabel: string;
  },
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= BOT_RESOURCE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(input.url, {
        headers: {
          Authorization: `Bot ${input.botToken}`,
        },
        cache: "no-store",
      });

      if (response.status === 404 || response.status === 403) {
        return null;
      }

      if (!response.ok) {
        const text = await response.text();
        const isRetryable = response.status >= 500 || response.status === 429;

        if (isRetryable && attempt < BOT_RESOURCE_RETRY_DELAYS_MS.length) {
          await sleep(BOT_RESOURCE_RETRY_DELAYS_MS[attempt]);
          continue;
        }

        throw new Error(
          `Falha ao buscar ${input.resourceLabel} do servidor: ${text}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < BOT_RESOURCE_RETRY_DELAYS_MS.length) {
        await sleep(BOT_RESOURCE_RETRY_DELAYS_MS[attempt]);
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(sanitizeDiscordBotFailureMessage(input.resourceLabel));
}

export async function fetchGuildSummaryByBot(guildId: string): Promise<BotGuildSummary | null> {
  const botToken = resolveBotToken();
  if (!botToken) {
    return null;
  }

  const freshCached = readBotResourceCache(
    botGuildSummaryCache,
    guildId,
    BOT_RESOURCE_FRESH_TTL_MS,
  );
  if (freshCached) {
    return freshCached;
  }

  const staleCached = readBotResourceCache(
    botGuildSummaryCache,
    guildId,
    BOT_RESOURCE_STALE_TTL_MS,
  );

  try {
    const payload = await fetchDiscordBotJsonWithRetry<Partial<DiscordGuild>>({
      url: `https://discord.com/api/v10/guilds/${guildId}`,
      botToken,
      resourceLabel: "resumo",
    });

    if (!payload) {
      return null;
    }

    if (typeof payload.id !== "string" || typeof payload.name !== "string") {
      return null;
    }

    const summary = {
      id: payload.id,
      name: payload.name,
      icon: typeof payload.icon === "string" ? payload.icon : null,
    };

    writeBotResourceCache(botGuildSummaryCache, guildId, summary);
    return summary;
  } catch (error) {
    if (staleCached) {
      return staleCached;
    }

    console.error("discord bot summary fetch failed", {
      guildId,
      error,
    });

    throw new Error(sanitizeDiscordBotFailureMessage("o resumo"));
  }
}

export async function fetchGuildChannelsByBot(guildId: string) {
  const botToken = resolveBotToken();
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado no ambiente do site.");
  }

  const freshCached = readBotResourceCache(
    botGuildChannelsCache,
    guildId,
    BOT_RESOURCE_FRESH_TTL_MS,
  );
  if (freshCached) {
    return freshCached;
  }

  const staleCached = readBotResourceCache(
    botGuildChannelsCache,
    guildId,
    BOT_RESOURCE_STALE_TTL_MS,
  );

  try {
    const payload = await fetchDiscordBotJsonWithRetry<DiscordGuildChannel[]>({
      url: `https://discord.com/api/v10/guilds/${guildId}/channels`,
      botToken,
      resourceLabel: "canais",
    });

    if (!payload) {
      return null;
    }

    writeBotResourceCache(botGuildChannelsCache, guildId, payload);
    return payload;
  } catch (error) {
    if (staleCached) {
      return staleCached;
    }

    console.error("discord bot channels fetch failed", {
      guildId,
      error,
    });

    throw new Error(sanitizeDiscordBotFailureMessage("os canais"));
  }
}

export async function fetchGuildRolesByBot(guildId: string) {
  const botToken = resolveBotToken();
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado no ambiente do site.");
  }

  const freshCached = readBotResourceCache(
    botGuildRolesCache,
    guildId,
    BOT_RESOURCE_FRESH_TTL_MS,
  );
  if (freshCached) {
    return freshCached;
  }

  const staleCached = readBotResourceCache(
    botGuildRolesCache,
    guildId,
    BOT_RESOURCE_STALE_TTL_MS,
  );

  try {
    const payload = await fetchDiscordBotJsonWithRetry<DiscordGuildRole[]>({
      url: `https://discord.com/api/v10/guilds/${guildId}/roles`,
      botToken,
      resourceLabel: "cargos",
    });

    if (!payload) {
      return null;
    }

    writeBotResourceCache(botGuildRolesCache, guildId, payload);
    return payload;
  } catch (error) {
    if (staleCached) {
      return staleCached;
    }

    console.error("discord bot roles fetch failed", {
      guildId,
      error,
    });

    throw new Error(sanitizeDiscordBotFailureMessage("os cargos"));
  }
}

export async function fetchGuildMemberSummaryByBot(
  guildId: string,
  memberId: string,
): Promise<DiscordGuildMemberSummary | null> {
  const botToken = resolveBotToken();
  if (!botToken) {
    return buildFallbackGuildMemberSummary(memberId);
  }

  const cacheKey = `${guildId}:${memberId}`;
  const freshCached = readBotResourceCache(
    botGuildMemberSummaryCache,
    cacheKey,
    BOT_RESOURCE_FRESH_TTL_MS,
  );
  if (freshCached) {
    return freshCached;
  }

  const staleCached = readBotResourceCache(
    botGuildMemberSummaryCache,
    cacheKey,
    BOT_RESOURCE_STALE_TTL_MS,
  );

  try {
    const payload = await fetchDiscordBotJsonWithRetry<DiscordBotGuildMemberPayload>({
      url: `https://discord.com/api/v10/guilds/${guildId}/members/${memberId}`,
      botToken,
      resourceLabel: "o membro",
    });

    if (!payload?.user?.id) {
      return staleCached || buildFallbackGuildMemberSummary(memberId);
    }

    const displayName =
      payload.nick?.trim() ||
      payload.user.global_name?.trim() ||
      payload.user.username?.trim() ||
      buildFallbackGuildMemberSummary(memberId).displayName;
    const mentionLabel = displayName.startsWith("@")
      ? displayName
      : `@${displayName}`;
    const avatarUrl =
      buildDiscordGuildMemberAvatarUrl(guildId, payload.user.id, payload.avatar) ||
      buildDiscordAvatarUrl(payload.user.id, payload.user.avatar);
    const summary = {
      avatarUrl,
      displayName,
      memberId: payload.user.id,
      mentionLabel,
    } satisfies DiscordGuildMemberSummary;

    writeBotResourceCache(botGuildMemberSummaryCache, cacheKey, summary);
    return summary;
  } catch (error) {
    if (staleCached) {
      return staleCached;
    }

    console.error("discord bot member summary fetch failed", {
      error,
      guildId,
      memberId,
    });

    return buildFallbackGuildMemberSummary(memberId);
  }
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
