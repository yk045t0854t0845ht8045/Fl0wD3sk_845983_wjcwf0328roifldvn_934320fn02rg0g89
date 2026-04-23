import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  createUserTeamForUser,
  getUserTeamsSnapshotForUser,
  UserTeamActionError,
  type UserTeam,
} from "@/lib/teams/userTeams";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import { getManagedServersForCurrentSession } from "@/lib/servers/managedServers";
import { getPlanGuildsForUser } from "@/lib/plans/planGuilds";

const TEAM_ICON_KEYS = [
  "aurora",
  "ember",
  "ocean",
  "amethyst",
  "forest",
  "sunset",
] as const;

function normalizeStringArray(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string");
}

const OWNER_TEAM_PERMISSIONS: UserTeam["currentUserPermissions"] = [
  "manage_servers",
  "manage_members",
  "manage_roles",
  "view_audit_logs",
  "server_manage_tickets_overview",
  "server_manage_tickets_message",
  "server_manage_welcome_overview",
  "server_manage_welcome_message",
  "server_manage_antilink",
  "server_manage_autorole",
  "server_view_security_logs",
];

function isDiscordSnowflake(value: string) {
  return /^\d{10,25}$/.test(value);
}

function buildCreatedTeamFallback(input: {
  createdTeamId: number;
  name: string;
  iconKey: string;
  guildIds: string[];
  ownerUserId: number;
  ownerDisplayName: string;
  memberDiscordIds: string[];
}) {
  const nowIso = new Date().toISOString();

  return {
    id: input.createdTeamId,
    name: input.name,
    iconKey: input.iconKey || "aurora",
    role: "owner",
    currentUserPermissions: OWNER_TEAM_PERMISSIONS,
    ownerUserId: input.ownerUserId,
    ownerDisplayName: input.ownerDisplayName || "Equipe Flowdesk",
    linkedGuildIds: input.guildIds,
    members: input.memberDiscordIds.map((discordUserId, index) => ({
      id: -(index + 1),
      discordUserId,
      displayName: null,
      status: "pending" as const,
      roleId: null,
      roleName: null,
      customPermissions: [],
      acceptedAt: null,
      createdAt: nowIso,
    })),
    availableRoles: [],
    memberCount: 1,
    pendingCount: input.memberDiscordIds.length,
    createdAt: nowIso,
    updatedAt: nowIso,
  } satisfies UserTeam;
}

export async function GET() {
  try {
    const authSession = await getCurrentAuthSessionFromCookie();

    if (!authSession) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Nao autenticado." },
          { status: 401 },
        ),
      );
    }

    const payload = await getUserTeamsSnapshotForUser({
      authUserId: authSession.user.id,
      discordUserId: authSession.user.discord_user_id,
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        ...payload,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        teams: [],
        pendingInvites: [],
        message: sanitizeErrorMessage(
          error,
          "As equipes entraram em modo seguro temporario.",
        ),
      }),
    );
  }
}

export async function POST(request: Request) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) {
    return applyNoStoreHeaders(originGuard);
  }

  try {
    const authSession = await getCurrentAuthSessionFromCookie();

    if (!authSession) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Nao autenticado." },
          { status: 401 },
        ),
      );
    }

    let body: {
      name: string;
      iconKey?: (typeof TEAM_ICON_KEYS)[number];
      guildIds: string[];
      memberDiscordIds?: string[];
    };

    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          name: flowSecureDto.string({
            minLength: 3,
            maxLength: 64,
            normalizeWhitespace: true,
          }),
          iconKey: flowSecureDto.optional(flowSecureDto.enum(TEAM_ICON_KEYS)),
          guildIds: flowSecureDto.array(flowSecureDto.discordSnowflake(), {
            minLength: 1,
            maxLength: 100,
          }),
          memberDiscordIds: flowSecureDto.optional(
            flowSecureDto.array(flowSecureDto.discordSnowflake(), {
              maxLength: 50,
            }),
          ),
        },
        {
          rejectUnknown: true,
        },
      );
    } catch (error) {
      if (!(error instanceof FlowSecureDtoError)) {
        throw error;
      }
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: error.issues[0] || error.message },
          { status: 400 },
        ),
      );
    }

    const name = body.name;
    const iconKey = body.iconKey || "";
    const guildIds = normalizeStringArray(body.guildIds);
    const memberDiscordIds = normalizeStringArray(body.memberDiscordIds);
    const allowedGuildIds = new Set<string>();

    try {
      const managedServers = await getManagedServersForCurrentSession();
      managedServers
        .filter((server) => server.canManage)
        .forEach((server) => allowedGuildIds.add(server.guildId));
    } catch {
      // Fallback DB-only para nao matar a criacao da equipe se a sync ao vivo falhar.
    }

    if (!allowedGuildIds.size) {
      const ownedPlanGuilds = await getPlanGuildsForUser(authSession.user.id, {
        includeInactive: true,
      }).catch(() => []);

      for (const record of ownedPlanGuilds) {
        if (typeof record.guild_id === "string" && isDiscordSnowflake(record.guild_id)) {
          allowedGuildIds.add(record.guild_id);
        }
      }
    }

    const validatedGuildIds = guildIds.filter((guildId) => allowedGuildIds.has(guildId));

    if (!validatedGuildIds.length) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Os servidores selecionados nao estao mais disponiveis para esta equipe. Atualize a lista e tente novamente.",
          },
          { status: 409 },
        ),
      );
    }

    const createdTeamId = await createUserTeamForUser({
      authUserId: authSession.user.id,
      discordUserId: authSession.user.discord_user_id,
      name,
      iconKey,
      guildIds: validatedGuildIds,
      memberDiscordIds,
    });

    const payload = await getUserTeamsSnapshotForUser({
      authUserId: authSession.user.id,
      discordUserId: authSession.user.discord_user_id,
    }).catch(() => ({
      teams: [],
      pendingInvites: [],
    }));

    const nextTeams = payload.teams || [];
    const hasCreatedTeam = nextTeams.some((team) => team.id === createdTeamId);
    const fallbackTeam = buildCreatedTeamFallback({
      createdTeamId,
      name,
      iconKey,
      guildIds: validatedGuildIds,
      ownerUserId: authSession.user.id,
      ownerDisplayName: authSession.user.display_name,
      memberDiscordIds,
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        createdTeamId,
        teams: hasCreatedTeam ? nextTeams : [...nextTeams, fallbackTeam],
        pendingInvites: payload.pendingInvites || [],
      }),
    );
  } catch (error) {
    if (error instanceof UserTeamActionError) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message: error.message,
          },
          { status: error.statusCode },
        ),
      );
    }

    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Erro ao criar equipe."),
        },
        { status: 500 },
      ),
    );
  }
}
