import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
  fetchGuildRolesByBot,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const GUILD_CATEGORY = 4;
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;

type ChannelOption = {
  id: string;
  name: string;
  type: number;
  position: number;
};

type RoleOption = {
  id: string;
  name: string;
  color: number;
  position: number;
};

function sortChannels(channels: ChannelOption[]) {
  return [...channels].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

function sortRoles(roles: RoleOption[]) {
  return [...roles].sort((a, b) => {
    if (a.position !== b.position) return b.position - a.position;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

async function ensureGuildAccess(guildId: string) {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    };
  }

  if (!sessionData.accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      ),
    };
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

  if (
    !accessibleGuild &&
    !hasTeamAccess &&
    sessionData.authSession.activeGuildId !== guildId
  ) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    sessionData,
    accessibleGuild,
  };
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

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return applyNoStoreHeaders(access.response);
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: access.sessionData.authSession.user.id,
      guildId,
      source: "guild_dashboard_settings_get",
    });

    const supabase = getSupabaseAdminClientOrThrow();
    const [rawChannels, rawRoles, ticketResult, staffResult] = await Promise.all([
      fetchGuildChannelsByBot(guildId),
      fetchGuildRolesByBot(guildId),
      supabase
        .from("guild_ticket_settings")
        .select(
          "menu_channel_id, tickets_category_id, logs_created_channel_id, logs_closed_channel_id, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
      supabase
        .from("guild_ticket_staff_settings")
        .select(
          "admin_role_id, claim_role_ids, close_role_ids, notify_role_ids, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
    ]);

    if (!rawChannels) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message: "Bot nao possui acesso aos canais deste servidor.",
          },
          { status: 403 },
        ),
      );
    }

    if (!rawRoles) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message: "Bot nao possui acesso aos cargos deste servidor.",
          },
          { status: 403 },
        ),
      );
    }

    if (ticketResult.error) {
      throw new Error(ticketResult.error.message);
    }

    if (staffResult.error) {
      throw new Error(staffResult.error.message);
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
          id: access.accessibleGuild?.id || guildId,
          name: access.accessibleGuild?.name || "Servidor selecionado",
        },
        channels: {
          text: textChannels,
          categories,
        },
        roles,
        ticketSettings: ticketResult.data
          ? {
              menuChannelId: ticketResult.data.menu_channel_id,
              ticketsCategoryId: ticketResult.data.tickets_category_id,
              logsCreatedChannelId: ticketResult.data.logs_created_channel_id,
              logsClosedChannelId: ticketResult.data.logs_closed_channel_id,
              updatedAt: ticketResult.data.updated_at,
            }
          : null,
        staffSettings: staffResult.data
          ? {
              adminRoleId: staffResult.data.admin_role_id,
              claimRoleIds: Array.isArray(staffResult.data.claim_role_ids)
                ? staffResult.data.claim_role_ids.filter(
                    (roleId): roleId is string => typeof roleId === "string",
                  )
                : [],
              closeRoleIds: Array.isArray(staffResult.data.close_role_ids)
                ? staffResult.data.close_role_ids.filter(
                    (roleId): roleId is string => typeof roleId === "string",
                  )
                : [],
              notifyRoleIds: Array.isArray(staffResult.data.notify_role_ids)
                ? staffResult.data.notify_role_ids.filter(
                    (roleId): roleId is string => typeof roleId === "string",
                  )
                : [],
              updatedAt: staffResult.data.updated_at,
            }
          : null,
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
              : "Erro ao carregar configuracoes do servidor.",
        },
        { status: 500 },
      ),
    );
  }
}
