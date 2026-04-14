import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { getUserPlanState } from "@/lib/plans/state";
import { OFFICIAL_DISCORD_GUILD_ID } from "@/lib/discordLink/config";
import {
  getSupportTicketsForDiscordUser,
  type SupportTicket,
} from "@/lib/account/supportTickets";

export type AccountSummary = {
  plan: {
    name: string;
    status: string;
    maxServers: number;
  } | null;
  teamsCount: number;
  apiKeysCount: number;
  paymentMethodsCount: number;
  ordersCount: number;
  ticketsCount: number;
  flowPoints: number;
  initialTickets?: SupportTicket[];
};

export async function getAccountSummary(userId: string, discordUserId: string): Promise<AccountSummary> {
  const supabase = getSupabaseAdminClientOrThrow();

  try {
    const [
      planState,
      { count: teamsCount },
      { count: apiKeysCount },
      { count: paymentMethodsCount },
      { count: ordersCount },
      { count: ticketsCountResult },
      { data: flowPointsData },
      supportTickets,
    ] = await Promise.all([
      getUserPlanState(parseInt(userId)),
      supabase.from("auth_user_teams").select("*", { count: "exact", head: true }).eq("owner_user_id", userId),
      supabase.from("auth_user_api_keys").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("payment_methods").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "active"),
      supabase.from("payment_orders").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("tickets").select("*", { count: "exact", head: true }).eq("user_id", discordUserId).eq("guild_id", OFFICIAL_DISCORD_GUILD_ID),
      supabase.from("auth_user_plan_flow_points").select("balance_amount").eq("user_id", userId).maybeSingle(),
      getSupportTicketsForDiscordUser(discordUserId),
    ]);

    return {
      plan: planState ? {
        name: planState.plan_name,
        status: planState.status,
        maxServers: planState.max_licensed_servers
      } : null,
      teamsCount: teamsCount || 0,
      apiKeysCount: apiKeysCount || 0,
      paymentMethodsCount: paymentMethodsCount || 0,
      ordersCount: ordersCount || 0,
      ticketsCount: ticketsCountResult || 0,
      flowPoints: flowPointsData?.balance_amount || 0,
      initialTickets: supportTickets
    };
  } catch (err) {
    console.error("[Summary Service] Critical error:", err);
    throw err;
  }
}
