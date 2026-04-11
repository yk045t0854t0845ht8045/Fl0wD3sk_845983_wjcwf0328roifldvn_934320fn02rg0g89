import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export async function POST(
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
        NextResponse.json({ ok: false, message: "ID inválido." }, { status: 400 }),
      );
    }

    let body: { discordUserId?: unknown } = {};
    try {
      body = (await request.json()) as { discordUserId?: unknown };
    } catch {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Payload inválido." }, { status: 400 }),
      );
    }

    const discordUserId = typeof body.discordUserId === "string" ? body.discordUserId.trim() : "";
    if (!/^\d{10,25}$/.test(discordUserId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Discord User ID inválido." }, { status: 400 }),
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

    // Avoid duplicate invite
    const existingResult = await supabase
      .from("auth_user_team_members")
      .select("id, status")
      .eq("team_id", teamId)
      .eq("invited_discord_user_id", discordUserId)
      .maybeSingle<{ id: number; status: string }>();

    if (existingResult.data && existingResult.data.status !== "declined") {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Usuário já é membro ou possui convite pendente nesta equipe." }, { status: 409 }),
      );
    }

    // Resolve auth user if they exist
    const authUserResult = await supabase
      .from("auth_users")
      .select("id")
      .eq("discord_user_id", discordUserId)
      .maybeSingle<{ id: number }>();

    const invitedAuthUserId = authUserResult.data?.id || null;

    if (existingResult.data?.status === "declined") {
      // Re-invite
      await supabase
        .from("auth_user_team_members")
        .update({ status: "pending", invited_auth_user_id: invitedAuthUserId, accepted_at: null })
        .eq("id", existingResult.data.id);
    } else {
      const insertResult = await supabase.from("auth_user_team_members").insert({
        team_id: teamId,
        invited_discord_user_id: discordUserId,
        invited_auth_user_id: invitedAuthUserId,
        invited_by_user_id: authSession.user.id,
        status: "pending",
      });
      if (insertResult.error) throw new Error(insertResult.error.message);
    }

    return applyNoStoreHeaders(NextResponse.json({ ok: true }));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: sanitizeErrorMessage(error, "Erro ao convidar membro.") },
        { status: 500 },
      ),
    );
  }
}
