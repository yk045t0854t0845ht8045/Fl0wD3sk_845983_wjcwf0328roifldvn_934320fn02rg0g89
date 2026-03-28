import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { applyNoStoreHeaders } from "@/lib/security/http";

type DiscordGuildEmoji = {
  id: string;
  name: string;
  animated?: boolean;
};

type EmojiCacheEntry = {
  expiresAt: number;
  emojis: DiscordGuildEmoji[] | null;
};

type EmojiAssetCacheEntry = {
  expiresAt: number;
  url: string | null;
  animated: boolean;
};

const EMOJI_CACHE_TTL_MS = 5 * 60 * 1000;
const guildEmojiCache = new Map<string, EmojiCacheEntry>();
const emojiAssetCache = new Map<string, EmojiAssetCacheEntry>();

function resolveBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

function isEmojiId(value: string) {
  return /^\d{10,25}$/.test(value);
}

async function fetchGuildEmojisByBot(guildId: string) {
  const cached = guildEmojiCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.emojis;
  }

  const botToken = resolveBotToken();
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado no ambiente do site.");
  }

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/emojis`,
    {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
      cache: "no-store",
    },
  );

  if (response.status === 404 || response.status === 403) {
    guildEmojiCache.set(guildId, {
      expiresAt: Date.now() + EMOJI_CACHE_TTL_MS,
      emojis: null,
    });
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao validar emojis do servidor: ${text}`);
  }

  const payload = (await response.json()) as DiscordGuildEmoji[];
  guildEmojiCache.set(guildId, {
    expiresAt: Date.now() + EMOJI_CACHE_TTL_MS,
    emojis: payload,
  });

  return payload;
}

async function resolveEmojiAssetById(emojiId: string) {
  const cached = emojiAssetCache.get(emojiId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const candidates = [
    {
      animated: true,
      url: `https://cdn.discordapp.com/emojis/${emojiId}.gif?size=96&quality=lossless`,
    },
    {
      animated: false,
      url: `https://cdn.discordapp.com/emojis/${emojiId}.webp?size=96&quality=lossless`,
    },
  ];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        method: "HEAD",
        cache: "no-store",
      });

      if (response.ok) {
        const entry = {
          expiresAt: Date.now() + EMOJI_CACHE_TTL_MS,
          url: candidate.url,
          animated: candidate.animated,
        };
        emojiAssetCache.set(emojiId, entry);
        return entry;
      }
    } catch {
      // Ignora e tenta o proximo formato.
    }
  }

  const missingEntry = {
    expiresAt: Date.now() + EMOJI_CACHE_TTL_MS,
    url: null,
    animated: false,
  };
  emojiAssetCache.set(emojiId, missingEntry);
  return missingEntry;
}

export async function GET(request: Request) {
  try {
    const sessionData = await resolveSessionAccessToken();
    if (!sessionData?.authSession) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Nao autenticado." },
          { status: 401 },
        ),
      );
    }

    if (!sessionData.accessToken) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Token OAuth ausente na sessao." },
          { status: 401 },
        ),
      );
    }

    const requestUrl = new URL(request.url);
    const guildId = requestUrl.searchParams.get("guildId")?.trim() || "";
    const emojiId = requestUrl.searchParams.get("emojiId")?.trim() || "";
    const query = requestUrl.searchParams.get("query")?.trim().toLowerCase() || "";
    const limit = Math.min(
      Math.max(Number.parseInt(requestUrl.searchParams.get("limit") || "24", 10) || 24, 1),
      100,
    );

    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Parametros invalidos." },
          { status: 400 },
        ),
      );
    }

    const accessibleGuild = await assertUserAdminInGuildOrNull(
      {
        authSession: sessionData.authSession,
        accessToken: sessionData.accessToken,
      },
      guildId,
    );

    const hasTeamAccess = accessibleGuild
      ? false
      : await hasAcceptedTeamAccessToGuild(
          {
            authSession: sessionData.authSession,
            accessToken: sessionData.accessToken,
          },
          guildId,
        );

    const isActiveGuild = sessionData.authSession.activeGuildId === guildId;
    if (!accessibleGuild && !hasTeamAccess && !isActiveGuild) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Servidor nao encontrado para este usuario." },
          { status: 403 },
        ),
      );
    }

    const emojis = await fetchGuildEmojisByBot(guildId);

    if (!emojiId) {
      const filtered = (emojis || [])
        .filter((emoji) => {
          if (!query) return true;
          return emoji.name.toLowerCase().includes(query);
        })
        .sort((left, right) => {
          if (!query) return left.name.localeCompare(right.name);
          const leftStarts = left.name.toLowerCase().startsWith(query);
          const rightStarts = right.name.toLowerCase().startsWith(query);
          if (leftStarts !== rightStarts) {
            return leftStarts ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        })
        .slice(0, limit)
        .map((emoji) => {
          const animated = Boolean(emoji.animated);
          const extension = animated ? "gif" : "webp";
          return {
            id: emoji.id,
            name: emoji.name,
            animated,
            url: `https://cdn.discordapp.com/emojis/${emoji.id}.${extension}?size=96&quality=lossless`,
          };
        });

      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          valid: true,
          emojis: filtered,
        }),
      );
    }

    if (!isEmojiId(emojiId)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Emoji invalido." },
          { status: 400 },
        ),
      );
    }

    const emoji = emojis?.find((item) => item.id === emojiId) || null;

    if (!emoji) {
      const resolvedAsset = await resolveEmojiAssetById(emojiId);
      if (!resolvedAsset.url) {
        return applyNoStoreHeaders(
          NextResponse.json({
            ok: false,
            valid: false,
            url: null,
          }),
        );
      }

      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          valid: true,
          animated: resolvedAsset.animated,
          name: null,
          url: resolvedAsset.url,
        }),
      );
    }

    const animated = Boolean(emoji.animated);
    const extension = animated ? "gif" : "webp";
    const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${extension}?size=96&quality=lossless`;

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        valid: true,
        animated,
        name: emoji.name,
        url,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Erro ao validar emoji do Discord.",
        },
        { status: 500 },
      ),
    );
  }
}
