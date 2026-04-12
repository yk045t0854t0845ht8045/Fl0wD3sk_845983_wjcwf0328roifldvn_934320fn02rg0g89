import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { assertTeamPermission } from "@/lib/teams/userTeams";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string; memberId: string }> },
) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) return applyNoStoreHeaders(originGuard);

  try {
    const authSession = await getCurrentAuthSessionFromCookie();
    if (!authSession) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Não autenticado." }, { status: 401 }),
      );
    }

    const { teamId: teamIdStr, memberId: memberIdStr } = await params;
    const teamId = Number(teamIdStr);
    const memberId = Number(memberIdStr);

    if (!Number.isFinite(teamId) || !Number.isFinite(memberId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "IDs inválidos." }, { status: 400 }),
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    await assertTeamPermission(teamId, authSession.user.id, "manage_members");

    const deleteResult = await supabase
      .from("auth_user_team_members")
      .delete()
      .eq("id", memberId)
      .eq("team_id", teamId);

    if (deleteResult.error) throw new Error(deleteResult.error.message);

    return applyNoStoreHeaders(NextResponse.json({ ok: true }));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: sanitizeErrorMessage(error, "Erro ao remover membro.") },
        { status: 500 },
      ),
    );
  }
}
