import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  acceptUserTeamInviteForUser,
  getUserTeamsSnapshotForUser,
} from "@/lib/teams/userTeams";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";

type TeamRouteParams = {
  params: Promise<{
    teamId: string;
  }>;
};

function normalizeTeamId(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: Request, { params }: TeamRouteParams) {
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

    const routeParams = await params;
    const teamId = normalizeTeamId(routeParams.teamId);

    if (!teamId) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Equipe invalida." },
          { status: 400 },
        ),
      );
    }

    await acceptUserTeamInviteForUser({
      authUserId: authSession.user.id,
      discordUserId: authSession.user.discord_user_id,
      teamId,
    });

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
            error instanceof Error
              ? error.message
              : "Erro ao aceitar convite da equipe.",
        },
        { status: 500 },
      ),
    );
  }
}
