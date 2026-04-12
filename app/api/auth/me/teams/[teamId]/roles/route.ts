import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import { assertTeamPermission } from "@/lib/teams/userTeams";

// POST /api/auth/me/teams/[teamId]/roles - Create a new role
export async function POST(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const originGuard = ensureSameOriginJsonMutationRequest(req);
  if (originGuard) return applyNoStoreHeaders(originGuard);

  try {
    const authSession = await getCurrentAuthSessionFromCookie();
    if (!authSession) {
      return applyNoStoreHeaders(NextResponse.json({ ok: false, message: "Nao autenticado." }, { status: 401 }));
    }

    const { teamId: teamIdStr } = await params;
    const teamId = Number(teamIdStr);
    const body = await req.json();
    const { name, permissions } = body;

    if (!name || String(name).trim().length < 2) {
      return applyNoStoreHeaders(NextResponse.json({ ok: false, message: "Nome do cargo invalido" }, { status: 400 }));
    }

    const supabase = getSupabaseAdminClientOrThrow();
    await assertTeamPermission(teamId, authSession.user.id, "manage_roles");

    const { data, error } = await supabase
      .from("auth_user_team_roles")
      .insert({
        team_id: teamId,
        name: String(name).trim(),
        permissions: Array.isArray(permissions) ? permissions : [],
      })
      .select()
      .single();

    if (error) throw error;

    return applyNoStoreHeaders(NextResponse.json({ ok: true, role: data }));
  } catch (err: any) {
    console.error("[POST /teams/roles]", err);
    return applyNoStoreHeaders(NextResponse.json({ ok: false, message: err?.message || "Erro interno." }, { status: 500 }));
  }
}
