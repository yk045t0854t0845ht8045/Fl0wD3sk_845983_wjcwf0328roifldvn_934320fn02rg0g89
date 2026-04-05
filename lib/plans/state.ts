import {
  DEFAULT_PLAN_BILLING_PERIOD_CODE,
  DEFAULT_PLAN_CODE,
  buildPlanSnapshot,
  normalizePlanBillingPeriodCode,
  isPlanCode,
  resolvePlanDefinition,
  resolvePlanPricing,
  type PlanBillingPeriodCode,
  type PlanCode,
} from "@/lib/plans/catalog";
import {
  resolveBillingPeriodMonthsFromCycleDays,
  resolvePlanCycleExpirationIso,
} from "@/lib/plans/cycle";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type GuildPlanSettingsRecord = {
  plan_code: PlanCode;
  monthly_amount: string | number;
  currency: string;
  recurring_enabled: boolean;
  recurring_method_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UserPlanStateRecord = {
  user_id: number;
  plan_code: PlanCode;
  plan_name: string;
  status: "inactive" | "trial" | "active" | "expired";
  amount: string | number;
  compare_amount: string | number;
  currency: string;
  billing_cycle_days: number;
  max_licensed_servers: number;
  max_active_tickets: number;
  max_automations: number;
  max_monthly_actions: number;
  last_payment_order_id: number | null;
  last_payment_guild_id: string | null;
  activated_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const USER_PLAN_STATE_SELECT_COLUMNS =
  "user_id, plan_code, plan_name, status, amount, compare_amount, currency, billing_cycle_days, max_licensed_servers, max_active_tickets, max_automations, max_monthly_actions, last_payment_order_id, last_payment_guild_id, activated_at, expires_at, metadata, created_at, updated_at";

const LATEST_APPROVED_ORDER_FOR_PLAN_STATE_SELECT_COLUMNS =
  "id, user_id, guild_id, plan_code, plan_name, amount, currency, plan_billing_cycle_days, plan_max_licensed_servers, plan_max_active_tickets, plan_max_automations, plan_max_monthly_actions, paid_at, expires_at, created_at";

type PaymentOrderPlanRecord = {
  id: number;
  user_id: number;
  guild_id: string;
  plan_code?: string | null;
  plan_name?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  plan_billing_cycle_days?: number | null;
  plan_max_licensed_servers?: number | null;
  plan_max_active_tickets?: number | null;
  plan_max_automations?: number | null;
  plan_max_monthly_actions?: number | null;
  paid_at?: string | null;
  expires_at?: string | null;
  created_at: string;
};

function parseNumeric(value: string | number | null | undefined, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveActivePlanStateStatus(planCode: PlanCode, expiresAt: string | null) {
  if (!expiresAt) {
    return planCode === "basic" ? "trial" : "active";
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return planCode === "basic" ? "trial" : "active";
  }

  if (Date.now() > expiresAtMs) {
    return "expired";
  }

  return planCode === "basic" ? "trial" : "active";
}

function normalizeValidIso(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export async function getGuildPlanSettingsRecord(userId: number, guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_plan_settings")
    .select(
      "plan_code, monthly_amount, currency, recurring_enabled, recurring_method_id, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .maybeSingle<GuildPlanSettingsRecord>();

  if (result.error) {
    throw new Error(`Erro ao carregar plano salvo do servidor: ${result.error.message}`);
  }

  return result.data || null;
}

export async function getUserPlanState(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const [planStateResult, latestApprovedOrderResult] = await Promise.all([
    supabase
      .from("auth_user_plan_state")
      .select(USER_PLAN_STATE_SELECT_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle<UserPlanStateRecord>(),
    supabase
      .from("payment_orders")
      .select(LATEST_APPROVED_ORDER_FOR_PLAN_STATE_SELECT_COLUMNS)
      .eq("user_id", userId)
      .eq("status", "approved")
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<PaymentOrderPlanRecord>(),
  ]);

  if (planStateResult.error) {
    throw new Error(`Erro ao carregar plano da conta: ${planStateResult.error.message}`);
  }

  if (latestApprovedOrderResult.error) {
    throw new Error(
      `Erro ao carregar o ultimo pagamento aprovado da conta: ${latestApprovedOrderResult.error.message}`,
    );
  }

  const currentPlanState = planStateResult.data || null;
  const latestApprovedOrder = latestApprovedOrderResult.data || null;

  if (!latestApprovedOrder) {
    return currentPlanState;
  }

  const resolvedPlanCode = isPlanCode(latestApprovedOrder.plan_code)
    ? latestApprovedOrder.plan_code
    : DEFAULT_PLAN_CODE;
  const resolvedPlan = resolvePlanDefinition(resolvedPlanCode);
  const resolvedBillingCycleDays = Math.max(
    latestApprovedOrder.plan_billing_cycle_days || resolvedPlan.billingCycleDays,
    1,
  );
  const expectedActivatedAt =
    latestApprovedOrder.paid_at || latestApprovedOrder.created_at;
  const expectedExpiresAt =
    normalizeValidIso(latestApprovedOrder.expires_at) ||
    resolvePlanCycleExpirationIso({
      baseTimestamp: expectedActivatedAt,
      billingCycleDays: resolvedBillingCycleDays,
      billingPeriodMonths: resolveBillingPeriodMonthsFromCycleDays(
        resolvedBillingCycleDays,
      ),
      fallbackBillingCycleDays: resolvedPlan.billingCycleDays,
    });

  const shouldResyncPlanState =
    !currentPlanState ||
    currentPlanState.last_payment_order_id !== latestApprovedOrder.id ||
    currentPlanState.plan_code !== resolvedPlanCode ||
    currentPlanState.billing_cycle_days !== resolvedBillingCycleDays ||
    currentPlanState.activated_at !== expectedActivatedAt ||
    currentPlanState.expires_at !== expectedExpiresAt;

  if (shouldResyncPlanState) {
    return syncUserPlanStateFromOrder(latestApprovedOrder);
  }

  return currentPlanState;
}

export async function resolveEffectivePlanSelection(input: {
  userId: number;
  guildId: string;
  preferredPlanCode?: unknown;
  preferredBillingPeriodCode?: unknown;
}) {
  const [guildSettings, userPlanState] = await Promise.all([
    getGuildPlanSettingsRecord(input.userId, input.guildId),
    getUserPlanState(input.userId),
  ]);

  const preferredPlanCode =
    typeof input.preferredPlanCode === "string" && isPlanCode(input.preferredPlanCode)
      ? input.preferredPlanCode
      : null;
  const activeAccountPlanCode =
    userPlanState &&
    (userPlanState.status === "active" ||
      userPlanState.status === "trial" ||
      userPlanState.status === "expired")
      ? userPlanState.plan_code
      : null;

  const selectedPlanCode =
    preferredPlanCode ||
    guildSettings?.plan_code ||
    activeAccountPlanCode ||
    DEFAULT_PLAN_CODE;
  const selectedBillingPeriodCode = normalizePlanBillingPeriodCode(
    input.preferredBillingPeriodCode,
    DEFAULT_PLAN_BILLING_PERIOD_CODE,
  ) as PlanBillingPeriodCode;
  const plan = resolvePlanPricing(selectedPlanCode, selectedBillingPeriodCode);

  return {
    plan,
    guildSettings,
    userPlanState,
  };
}

export async function syncUserPlanStateFromOrder(order: PaymentOrderPlanRecord) {
  const supabase = getSupabaseAdminClientOrThrow();
  const resolvedPlanCode = isPlanCode(order.plan_code) ? order.plan_code : DEFAULT_PLAN_CODE;
  const plan = resolvePlanDefinition(resolvedPlanCode);
  const activatedAt = order.paid_at || order.created_at;
  const resolvedBillingCycleDays = Math.max(
    order.plan_billing_cycle_days || plan.billingCycleDays,
    1,
  );
  const resolvedBillingPeriodMonths =
    resolveBillingPeriodMonthsFromCycleDays(resolvedBillingCycleDays);
  const expiresAt =
    normalizeValidIso(order.expires_at) ||
    resolvePlanCycleExpirationIso({
      baseTimestamp: activatedAt,
      billingCycleDays: resolvedBillingCycleDays,
      billingPeriodMonths: resolvedBillingPeriodMonths,
      fallbackBillingCycleDays: plan.billingCycleDays,
    });

  const payload = {
    user_id: order.user_id,
    plan_code: resolvedPlanCode,
    plan_name: order.plan_name || plan.name,
    status: resolveActivePlanStateStatus(resolvedPlanCode, expiresAt),
    amount: parseNumeric(order.amount, plan.price),
    compare_amount: plan.comparePrice,
    currency: (order.currency || plan.currency || "BRL").trim() || "BRL",
    billing_cycle_days: resolvedBillingCycleDays,
    max_licensed_servers: Math.max(
      order.plan_max_licensed_servers || plan.entitlements.maxLicensedServers,
      1,
    ),
    max_active_tickets: Math.max(
      order.plan_max_active_tickets || plan.entitlements.maxActiveTickets,
      0,
    ),
    max_automations: Math.max(
      order.plan_max_automations || plan.entitlements.maxAutomations,
      0,
    ),
    max_monthly_actions: Math.max(
      order.plan_max_monthly_actions || plan.entitlements.maxMonthlyActions,
      0,
    ),
    last_payment_order_id: order.id,
    last_payment_guild_id: order.guild_id,
    activated_at: activatedAt,
    expires_at: expiresAt,
    metadata: {
      plan: {
        ...buildPlanSnapshot(resolvedPlanCode),
        billingCycleDays: resolvedBillingCycleDays,
        billingPeriodMonths: resolvedBillingPeriodMonths,
      },
    },
  };

  const result = await supabase
    .from("auth_user_plan_state")
    .upsert(payload, {
      onConflict: "user_id",
    })
    .select(USER_PLAN_STATE_SELECT_COLUMNS)
    .single<UserPlanStateRecord>();

  if (result.error || !result.data) {
    throw new Error(result.error?.message || "Falha ao sincronizar plano da conta.");
  }

  return result.data;
}
