import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { applyNoStoreHeaders } from "@/lib/security/http";

const GUILD_CATEGORY = 4;
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;

type ChannelOption = {
  id: string;
  name: string;
  type: number;
  position: number;
};

function sortChannels(channels: ChannelOption[]) {
  return [...channels].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = (url.searchParams.get("guildId") || "").trim();

    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
        ),
      );
    }

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

    const accessibleGuild = await assertUserAdminInGuildOrNull(
      {
        authSession: sessionData.authSession,
        accessToken: sessionData.accessToken,
      },
      guildId,
    );

    if (!accessibleGuild && sessionData.authSession.activeGuildId !== guildId) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
        ),
      );
    }

    const rawChannels = await fetchGuildChannelsByBot(guildId);
    if (!rawChannels) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Bot nao possui acesso aos canais deste servidor." },
        { status: 403 },
        ),
      );
    }

    const categories = sortChannels(
      rawChannels
        .filter((channel) => channel.type === GUILD_CATEGORY)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          position: channel.position || 0,
        })),
    );

    const textChannels = sortChannels(
      rawChannels
        .filter(
          (channel) =>
            channel.type === GUILD_TEXT || channel.type === GUILD_ANNOUNCEMENT,
        )
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          position: channel.position || 0,
        })),
    );

    return applyNoStoreHeaders(
      NextResponse.json({
      ok: true,
      guild: {
        id: accessibleGuild?.id || guildId,
        name: accessibleGuild?.name || "Servidor selecionado",
      },
      channels: {
        text: textChannels,
        categories,
      },
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
            : "Erro ao listar canais do servidor.",
      },
      { status: 500 },
      ),
    );
  }
}
