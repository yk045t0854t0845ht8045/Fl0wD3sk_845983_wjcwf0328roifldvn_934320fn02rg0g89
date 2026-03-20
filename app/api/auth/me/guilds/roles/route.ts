import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildRolesByBot,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { applyNoStoreHeaders } from "@/lib/security/http";

type RoleOption = {
  id: string;
  name: string;
  color: number;
  position: number;
};

function sortRoles(roles: RoleOption[]) {
  return [...roles].sort((a, b) => {
    if (a.position !== b.position) return b.position - a.position;
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

    const rawRoles = await fetchGuildRolesByBot(guildId);
    if (!rawRoles) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Bot nao possui acesso aos cargos deste servidor." },
        { status: 403 },
        ),
      );
    }

    const roles = sortRoles(
      rawRoles
        .filter((role) => role.id !== guildId && !role.managed)
        .map((role) => ({
          id: role.id,
          name: role.name,
          color: role.color,
          position: role.position,
        })),
    );

    return applyNoStoreHeaders(
      NextResponse.json({
      ok: true,
      guild: {
        id: accessibleGuild?.id || guildId,
        name: accessibleGuild?.name || "Servidor selecionado",
      },
      roles,
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
            : "Erro ao listar cargos do servidor.",
      },
      { status: 500 },
      ),
    );
  }
}
