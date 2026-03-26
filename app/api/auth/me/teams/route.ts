import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  createUserTeamForUser,
  getUserTeamsSnapshotForUser,
} from "@/lib/teams/userTeams";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import { getManagedServersForCurrentSession } from "@/lib/servers/managedServers";

type CreateTeamPayload = {
  name?: unknown;
  iconKey?: unknown;
  guildIds?: unknown;
  memberDiscordIds?: unknown;
};

function normalizeStringArray(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string");
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
      NextResponse.json(
        {
          ok: false,
          message:
            error instanceof Error ? error.message : "Erro ao carregar equipes.",
        },
        { status: 500 },
      ),
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

    let body: CreateTeamPayload = {};

    try {
      body = (await request.json()) as CreateTeamPayload;
    } catch {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Payload JSON invalido." },
          { status: 400 },
        ),
      );
    }

    const name = typeof body.name === "string" ? body.name : "";
    const iconKey = typeof body.iconKey === "string" ? body.iconKey : "";
    const guildIds = normalizeStringArray(body.guildIds);
    const memberDiscordIds = normalizeStringArray(body.memberDiscordIds);
    const managedServers = await getManagedServersForCurrentSession();
    const allowedGuildIds = new Set(managedServers.map((server) => server.guildId));
    const validatedGuildIds = guildIds.filter((guildId) => allowedGuildIds.has(guildId));

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
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        createdTeamId,
        ...payload,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message:
            error instanceof Error ? error.message : "Erro ao criar equipe.",
        },
        { status: 500 },
      ),
    );
  }
}
