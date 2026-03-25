import { NextResponse } from "next/server";
import { FEATURED_SERVER_IDS } from "@/lib/landing/featuredServers";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DiscordBotGuild = {
  id: string;
  name: string;
  icon: string | null;
};

type DiscordGuildWithCounts = {
  id: string;
  name?: string;
  icon?: string | null;
  approximate_member_count?: number;
};

type AuthSessionGuildCacheRow = {
  discord_guilds_cache: unknown;
  discord_guilds_cached_at: string | null;
};

type CachedDiscordGuild = {
  id: string;
  name?: string;
  icon?: string | null;
};

const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const ICONS_CACHE_TTL_MS = 60_000;
const MAX_RETURNED_ICONS = 48;
const GUILD_COUNT_FETCH_CONCURRENCY = 12;
const MAX_SESSION_CACHE_ROWS = 400;

let cachedIcons: { id: string; name: string; iconUrl: string }[] = [];
let cachedIconsAt = 0;
let activeIconsFetchPromise:
  | Promise<{ id: string; name: string; iconUrl: string }[]>
  | null = null;
type QualifiedGuildIcon = {
  id: string;
  name: string;
  iconUrl: string;
};

function resolveBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

function buildGuildIconUrl(guildId: string, icon: string | null) {
  if (!icon) return null;

  const extension = icon.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${extension}?size=256`;
}

function parseCachedDiscordGuilds(cache: unknown) {
  if (!Array.isArray(cache)) return [];

  return cache.filter((item): item is CachedDiscordGuild => {
    if (!item || typeof item !== "object") return false;

    const guild = item as Partial<CachedDiscordGuild>;
    return typeof guild.id === "string";
  });
}

async function fetchBotGuildPage(botToken: string, before?: string) {
  const url = new URL("https://discord.com/api/v10/users/@me/guilds");
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (before) {
    url.searchParams.set("before", before);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    cache: "no-store",
  });

  if (response.status === 401 || response.status === 403) {
    return [];
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Falha ao buscar icones dos servidores do bot: ${text}`);
  }

  return (await response.json()) as DiscordBotGuild[];
}

async function fetchGuildApproximateMemberCount(
  botToken: string,
  guildId: string,
) {
  const url = new URL(`https://discord.com/api/v10/guilds/${guildId}`);
  url.searchParams.set("with_counts", "true");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    cache: "no-store",
  });

  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404 ||
    response.status === 429
  ) {
    return {
      memberCount: null,
      name: null,
      icon: null,
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Falha ao buscar contagem do servidor ${guildId}: ${text}`);
  }

  const payload = (await response.json()) as DiscordGuildWithCounts;
  return {
    memberCount:
      typeof payload.approximate_member_count === "number"
        ? payload.approximate_member_count
        : null,
    name: payload.name ?? null,
    icon: payload.icon ?? null,
  };
}

async function fetchGuildPreview(guildId: string) {
  const response = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/preview`,
    {
      cache: "no-store",
    },
  );

  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404 ||
    response.status === 429
  ) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Falha ao buscar preview publico do servidor ${guildId}: ${text}`);
  }

  const payload = (await response.json()) as DiscordGuildWithCounts;
  return {
    id: payload.id,
    name: payload.name ?? null,
    icon: payload.icon ?? null,
    memberCount:
      typeof payload.approximate_member_count === "number"
        ? payload.approximate_member_count
        : null,
  };
}

async function fetchBotGuilds(botToken: string) {
  const guilds: DiscordBotGuild[] = [];
  let before: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await fetchBotGuildPage(botToken, before);
    if (!batch.length) break;

    guilds.push(...batch);

    if (batch.length < PAGE_SIZE) {
      break;
    }

    before = batch[batch.length - 1]?.id;
    if (!before) break;
  }

  return guilds;
}

async function fetchGuildsFromSessionCache() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return new Map<string, { name: string; iconUrl: string }>();
  }

  const result = await supabase
    .from("auth_sessions")
    .select("discord_guilds_cache, discord_guilds_cached_at")
    .not("discord_guilds_cache", "is", null)
    .order("discord_guilds_cached_at", { ascending: false })
    .limit(MAX_SESSION_CACHE_ROWS);

  if (result.error || !result.data) {
    return new Map<string, { name: string; iconUrl: string }>();
  }

  const cacheMap = new Map<string, { name: string; iconUrl: string }>();

  for (const row of result.data as AuthSessionGuildCacheRow[]) {
    const guilds = parseCachedDiscordGuilds(row.discord_guilds_cache);

    for (const guild of guilds) {
      if (!FEATURED_SERVER_IDS.includes(guild.id as (typeof FEATURED_SERVER_IDS)[number])) {
        continue;
      }

      if (cacheMap.has(guild.id)) {
        continue;
      }

      const iconUrl = buildGuildIconUrl(guild.id, guild.icon ?? null);
      if (!iconUrl) {
        continue;
      }

      cacheMap.set(guild.id, {
        name: guild.name ?? guild.id,
        iconUrl,
      });
    }
  }

  return cacheMap;
}

async function mapGuildsToIcons(botToken: string, guilds: DiscordBotGuild[]) {
  const guildMap = new Map(guilds.map((guild) => [guild.id, guild]));
  const sessionCacheMap = await fetchGuildsFromSessionCache();
  const qualifiedGuilds: QualifiedGuildIcon[] = [];

  for (let index = 0; index < FEATURED_SERVER_IDS.length; index += GUILD_COUNT_FETCH_CONCURRENCY) {
    const chunk = Array.from(
      FEATURED_SERVER_IDS.slice(index, index + GUILD_COUNT_FETCH_CONCURRENCY),
    ) as string[];
    const chunkResults: Array<QualifiedGuildIcon | null> = await Promise.all(
      chunk.map(async (guildId): Promise<QualifiedGuildIcon | null> => {
        const botGuild = guildMap.get(guildId) || null;

        if (botGuild) {
          const metadata = await fetchGuildApproximateMemberCount(botToken, guildId);
          const iconUrl = buildGuildIconUrl(
            guildId,
            metadata.icon ?? botGuild.icon,
          );

          if (!iconUrl) {
            return null;
          }

          return {
            id: guildId,
            name: metadata.name ?? botGuild.name,
            iconUrl,
          };
        }

        const preview = await fetchGuildPreview(guildId);
        if (preview) {
          const iconUrl = buildGuildIconUrl(guildId, preview.icon ?? null);
          if (!iconUrl) {
            return null;
          }

          return {
            id: guildId,
            name: preview.name ?? guildId,
            iconUrl,
          };
        }

        const cachedGuild = sessionCacheMap.get(guildId);
        if (!cachedGuild) {
          return null;
        }

        return {
          id: guildId,
          name: cachedGuild.name,
          iconUrl: cachedGuild.iconUrl,
        };
      }),
    );

    qualifiedGuilds.push(
      ...chunkResults.filter(
        (guild): guild is QualifiedGuildIcon => Boolean(guild),
      ),
    );
  }

  return qualifiedGuilds
    .sort(
      (left, right) =>
        FEATURED_SERVER_IDS.indexOf(left.id as (typeof FEATURED_SERVER_IDS)[number]) -
        FEATURED_SERVER_IDS.indexOf(right.id as (typeof FEATURED_SERVER_IDS)[number]),
    )
    .slice(0, MAX_RETURNED_ICONS)
    .map((guild) => ({
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconUrl,
    }));
}

async function resolveIcons(botToken: string) {
  const now = Date.now();
  if (cachedIcons.length && now - cachedIconsAt < ICONS_CACHE_TTL_MS) {
    return cachedIcons;
  }

  if (activeIconsFetchPromise) {
    return activeIconsFetchPromise;
  }

  activeIconsFetchPromise = (async () => {
    const guilds = await fetchBotGuilds(botToken);
    const icons = await mapGuildsToIcons(botToken, guilds);

    cachedIcons = icons;
    cachedIconsAt = Date.now();
    return icons;
  })();

  try {
    return await activeIconsFetchPromise;
  } finally {
    activeIconsFetchPromise = null;
  }
}

export async function GET() {
  try {
    const botToken = resolveBotToken();
    if (!botToken) {
      return NextResponse.json(
        { icons: [] },
        {
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        },
      );
    }

    const icons = await resolveIcons(botToken);

    return NextResponse.json(
      { icons },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { icons: [] },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
