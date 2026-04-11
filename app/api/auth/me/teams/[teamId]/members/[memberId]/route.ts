import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

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
        NextResponse.json({ ok: false, message: "Sem permissão." }, { status: 403 }),
      );
    }

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
