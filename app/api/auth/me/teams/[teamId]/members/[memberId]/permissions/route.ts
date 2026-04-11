import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";

// PATCH /api/auth/me/teams/[teamId]/members/[memberId]/permissions - Update custom perms for member
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ teamId: string; memberId: string }> }
) {
  const originGuard = ensureSameOriginJsonMutationRequest(req);
  if (originGuard) return applyNoStoreHeaders(originGuard);

  try {
    const authSession = await getCurrentAuthSessionFromCookie();
    if (!authSession) {
      return applyNoStoreHeaders(NextResponse.json({ ok: false, message: "Nao autenticado." }, { status: 401 }));
    }

    const { teamId: teamIdStr, memberId: memberIdStr } = await params;
    const teamId = Number(teamIdStr);
    const memberId = Number(memberIdStr);
    const body = await req.json();
    const { permissions } = body;

    const supabase = getSupabaseAdminClientOrThrow();

    const teamCheck = await supabase
      .from("auth_user_teams")
      .select("owner_user_id")
      .eq("id", teamId)
      .single();

    if (teamCheck.error || teamCheck.data?.owner_user_id !== authSession.user.id) {
      return applyNoStoreHeaders(NextResponse.json({ ok: false, message: "Somente o dono pode gerenciar permissoes individuais" }, { status: 403 }));
    }

    const { error } = await supabase
      .from("auth_user_team_members")
      .update({
        custom_permissions: Array.isArray(permissions) ? permissions : [],
      })
      .eq("id", memberId)
      .eq("team_id", teamId);

    if (error) throw error;

    return applyNoStoreHeaders(NextResponse.json({ ok: true }));
  } catch (err: any) {
    console.error("[PATCH /teams/members/:memberId/permissions]", err);
    return applyNoStoreHeaders(NextResponse.json({ ok: false, message: err?.message || "Erro interno." }, { status: 500 }));
  }
}
