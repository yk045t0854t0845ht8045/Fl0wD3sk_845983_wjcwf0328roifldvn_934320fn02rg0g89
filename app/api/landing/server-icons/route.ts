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
const MAX_RETURNED_ICONS = 48;
const GUILD_COUNT_FETCH_CONCURRENCY = 12;
const MAX_SESSION_CACHE_ROWS = 400;

let cachedIcons: QualifiedGuildIcon[] = [];
let cachedIconsAt = 0;
let isRefreshing = false;
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
        const metadata = await fetchGuildApproximateMemberCount(botToken, guildId);
        const botResolvedIcon = buildGuildIconUrl(
          guildId,
          metadata.icon ?? botGuild?.icon ?? null,
        );

        if (botResolvedIcon) {
          return {
            id: guildId,
            name: metadata.name ?? botGuild?.name ?? guildId,
            iconUrl: botResolvedIcon,
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

async function backgroundSync(botToken: string) {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    const guilds = await fetchBotGuilds(botToken);
    const icons = await mapGuildsToIcons(botToken, guilds);

    if (icons.length > 0) {
      cachedIcons = icons;
      cachedIconsAt = Date.now();

      const supabase = createSupabaseAdminClient();
      if (supabase) {
        // Upsert icons to persistent cache
        for (const icon of icons) {
          await supabase.from("discord_cdn_cache").upsert({
            id: icon.id,
            name: icon.name,
            icon_url: icon.iconUrl,
            last_updated_at: new Date().toISOString(),
            is_featured: true
          });
        }
      }
    }
  } catch (err) {
    console.error("Back-end CDN Sync Error:", err);
  } finally {
    isRefreshing = false;
  }
}

async function resolveIconsFromDb() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("discord_cdn_cache")
    .select("id, name, icon_url")
    .eq("is_featured", true)
    .order("last_updated_at", { ascending: false })
    .limit(MAX_RETURNED_ICONS);

  if (error || !data) return [];
  return data.map(row => ({
    id: row.id,
    name: row.name,
    iconUrl: row.icon_url
  }));
}

export async function GET() {
  const now = Date.now();
  const botToken = resolveBotToken();
  const CACHE_STALE_THRESHOLD = 3600_000 * 6; // 6 hours

  try {
    // 1. Check Memory Cache
    if (cachedIcons.length > 0) {
      // If stale, trigger background sync but return stale data
      if (now - cachedIconsAt > CACHE_STALE_THRESHOLD && botToken) {
        backgroundSync(botToken);
      }
      return NextResponse.json({ icons: cachedIcons }, { headers: { "Cache-Control": "no-store", "X-Cache": "MEMORY_STALE" }});
    }

    // 2. Check DB Cache (Survives server restarts)
    const dbIcons = await resolveIconsFromDb();
    if (dbIcons.length > 0) {
      cachedIcons = dbIcons;
      cachedIconsAt = now; // Mark as fresh in memory to avoid constant DB calls
      if (botToken) backgroundSync(botToken);
      return NextResponse.json({ icons: dbIcons }, { headers: { "Cache-Control": "no-store", "X-Cache": "DB_PERSISTENT" }});
    }

    // 3. Absolute Fallback: Fresh sync (only if cache is empty)
    if (!botToken) return NextResponse.json({ icons: [] });
    
    const guilds = await fetchBotGuilds(botToken);
    const icons = await mapGuildsToIcons(botToken, guilds);
    
    cachedIcons = icons;
    cachedIconsAt = now;
    backgroundSync(botToken); // Updates DB in background
    
    return NextResponse.json({ icons }, { headers: { "Cache-Control": "no-store", "X-Cache": "MISS" }});

  } catch {
    return NextResponse.json({ icons: cachedIcons || [] }, { headers: { "Cache-Control": "no-store", "X-Cache": "ERROR_FALLBACK" }});
  }
}
