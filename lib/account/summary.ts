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

function isLocalDevRuntime() {
  return process.env.NODE_ENV !== "production";
}

function isMissingOptionalLocalTableError(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("relation") ||
    message.includes("does not exist")
  );
}

async function safeLocalCount(
  query: PromiseLike<{ count: number | null; error?: unknown }>,
) {
  const result = await query;
  if (result.error) {
    if (isLocalDevRuntime() && isMissingOptionalLocalTableError(result.error)) {
      return 0;
    }
    throw result.error;
  }
  return result.count || 0;
}

async function safeLocalMaybeSingle<T>(
  query: PromiseLike<{ data: T | null; error?: unknown }>,
) {
  const result = await query;
  if (result.error) {
    if (isLocalDevRuntime() && isMissingOptionalLocalTableError(result.error)) {
      return null;
    }
    throw result.error;
  }
  return result.data || null;
}

async function safeLocalSupportTickets(
  discordUserId: string | null,
): Promise<SupportTicket[]> {
  try {
    return await getSupportTicketsForDiscordUser(discordUserId);
  } catch (error) {
    if (isLocalDevRuntime() && isMissingOptionalLocalTableError(error)) {
      return [];
    }
    throw error;
  }
}

async function safeLocalPlanState(userId: number) {
  try {
    return await getUserPlanState(userId);
  } catch (error) {
    if (isLocalDevRuntime() && isMissingOptionalLocalTableError(error)) {
      return null;
    }
    throw error;
  }
}

export async function getAccountSummary(
  userId: string,
  discordUserId: string | null,
): Promise<AccountSummary> {
  const supabase = getSupabaseAdminClientOrThrow();

  try {
    const [
      planState,
      teamsCount,
      apiKeysCount,
      paymentMethodsCount,
      ordersCount,
      ticketsCountResult,
      flowPointsData,
      supportTickets,
    ] = await Promise.all([
      safeLocalPlanState(parseInt(userId)),
      safeLocalCount(supabase.from("auth_user_teams").select("*", { count: "exact", head: true }).eq("owner_user_id", userId)),
      safeLocalCount(supabase.from("auth_user_api_keys").select("*", { count: "exact", head: true }).eq("user_id", userId)),
      safeLocalCount(supabase.from("auth_user_payment_methods").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("is_active", true)),
      safeLocalCount(supabase.from("payment_orders").select("*", { count: "exact", head: true }).eq("user_id", userId)),
      discordUserId
        ? safeLocalCount(supabase
            .from("tickets")
            .select("*", { count: "exact", head: true })
            .eq("user_id", discordUserId)
            .eq("guild_id", OFFICIAL_DISCORD_GUILD_ID))
        : Promise.resolve(0),
      safeLocalMaybeSingle<{ balance_amount?: number | string | null }>(
        supabase.from("auth_user_plan_flow_points").select("balance_amount").eq("user_id", userId).maybeSingle(),
      ),
      safeLocalSupportTickets(discordUserId),
    ]);

    return {
      plan: planState ? {
        name: planState.plan_name,
        status: planState.status,
        maxServers: planState.max_licensed_servers
      } : null,
      teamsCount,
      apiKeysCount,
      paymentMethodsCount,
      ordersCount,
      ticketsCount: ticketsCountResult,
      flowPoints: Number(flowPointsData?.balance_amount || 0),
      initialTickets: supportTickets
    };
  } catch (err) {
    console.error("[Summary Service] Critical error:", err);
    throw err;
  }
}
