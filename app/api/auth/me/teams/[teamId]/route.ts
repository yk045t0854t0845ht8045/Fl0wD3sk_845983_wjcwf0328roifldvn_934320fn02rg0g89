import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { getUserTeamsSnapshotForUser } from "@/lib/teams/userTeams";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
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

    const { teamId: teamIdStr } = await params;
    const teamId = Number(teamIdStr);
    if (!Number.isFinite(teamId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "ID de equipe inválido." }, { status: 400 }),
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();

    // Verify ownership
    const teamResult = await supabase
      .from("auth_user_teams")
      .select("id, owner_user_id")
      .eq("id", teamId)
      .maybeSingle<{ id: number; owner_user_id: number }>();

    if (teamResult.error) throw new Error(teamResult.error.message);
    if (!teamResult.data) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Equipe não encontrada." }, { status: 404 }),
      );
    }
    if (teamResult.data.owner_user_id !== authSession.user.id) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Sem permissão para excluir esta equipe." }, { status: 403 }),
      );
    }

    // Cascade delete
    await supabase.from("auth_user_team_members").delete().eq("team_id", teamId);
    await supabase.from("auth_user_team_servers").delete().eq("team_id", teamId);
    const deleteResult = await supabase.from("auth_user_teams").delete().eq("id", teamId);

    if (deleteResult.error) throw new Error(deleteResult.error.message);

    return applyNoStoreHeaders(NextResponse.json({ ok: true }));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: sanitizeErrorMessage(error, "Erro ao excluir equipe.") },
        { status: 500 },
      ),
    );
  }
}
