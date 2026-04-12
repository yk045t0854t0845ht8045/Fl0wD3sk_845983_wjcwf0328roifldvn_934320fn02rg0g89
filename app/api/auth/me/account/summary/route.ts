import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getUserPlanState } from "@/lib/plans/state";

export async function GET() {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) return NextResponse.json({ ok: false }, { status: 401 });

  const userId = sessionData.authSession.user.id;
  const supabase = getSupabaseAdminClientOrThrow();

  try {
    const [
      planState,
      { count: teamsCount },
      { count: apiKeysCount },
      { count: paymentMethodsCount },
      { count: ordersCount },
      { count: ticketsCount },
      { data: flowPointsData }
    ] = await Promise.all([
      getUserPlanState(userId),
      supabase.from("auth_user_teams").select("*", { count: "exact", head: true }).eq("owner_user_id", userId),
      supabase.from("auth_user_api_keys").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("payment_methods").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "active"),
      supabase.from("payment_orders").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("tickets").select("*", { count: "exact", head: true }).eq("user_id", sessionData.authSession.user.discord_user_id),
      supabase.from("auth_user_plan_flow_points").select("balance_amount").eq("user_id", userId).maybeSingle()
    ]);

    return applyNoStoreHeaders(NextResponse.json({
      ok: true,
      summary: {
        plan: planState ? {
          name: planState.plan_name,
          status: planState.status,
          maxServers: planState.max_licensed_servers
        } : null,
        teamsCount: teamsCount || 0,
        apiKeysCount: apiKeysCount || 0,
        paymentMethodsCount: paymentMethodsCount || 0,
        ordersCount: ordersCount || 0,
        ticketsCount: ticketsCount || 0,
        flowPoints: flowPointsData?.balance_amount || 0
      }
    }));
  } catch (error) {
    return NextResponse.json({ ok: false, message: "Erro ao buscar resumo." }, { status: 500 });
  }
}
