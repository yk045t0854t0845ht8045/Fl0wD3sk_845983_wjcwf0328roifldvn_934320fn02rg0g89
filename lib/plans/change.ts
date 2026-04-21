import {
  PLAN_ORDER,
  type PlanBillingPeriodCode,
  type PlanCode,
  type PlanPricingDefinition,
} from "@/lib/plans/catalog";
import { resolveActivePlanCyclePricing } from "@/lib/plans/activePlanPricing";
import { resolvePlanCycleMetrics } from "@/lib/plans/cycleMetrics";
import { resolveEffectivePlanBillingCycleDays } from "@/lib/plans/cycle";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import type { UserPlanStateRecord } from "@/lib/plans/state";

export type UserPlanFlowPointsBalanceRecord = {
  user_id: number;
  currency: string;
  balance_amount: string | number;
  created_at: string;
  updated_at: string;
};

export type UserPlanScheduledChangeRecord = {
  id: number;
  user_id: number;
  guild_id: string | null;
  current_plan_code: PlanCode;
  current_billing_cycle_days: number;
  target_plan_code: PlanCode;
  target_billing_period_code: PlanBillingPeriodCode;
  target_billing_cycle_days: number;
  status: "scheduled" | "applied" | "cancelled";
  effective_at: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type PlanChangeKind = "new" | "current" | "upgrade" | "downgrade";
export type PlanChangeExecution =
  | "pay_now"
  | "schedule_for_renewal"
  | "already_active"
  | "trial_activation";

export type PlanChangePreview = {
  kind: PlanChangeKind;
  execution: PlanChangeExecution;
  targetPlanCode: PlanCode;
  targetBillingPeriodCode: PlanBillingPeriodCode;
  targetBillingCycleDays: number;
  targetTotalAmount: number;
  currentPlanCode: PlanCode | null;
  currentBillingCycleDays: number | null;
  currentExpiresAt: string | null;
  currentStatus: UserPlanStateRecord["status"] | null;
  currentCycleAmount: number;
  currentConsumedAmount: number;
  currentCreditAmount: number;
  currentCycleTotalDaysExact: number;
  currentCycleUsedDaysExact: number;
  remainingDaysExact: number;
  creditAppliedToTargetAmount: number;
  surplusCreditAmount: number;
  immediateSubtotalAmount: number;
  flowPointsBalance: number;
  flowPointsGrantPreview: number;
  isCurrentSelectionBlocked: boolean;
  scheduledChange: UserPlanScheduledChangeRecord | null;
  scheduledChangeMatchesTarget: boolean;
  effectiveAt: string | null;
};

export type FlowPointsApplyPreview = {
  appliedAmount: number;
  remainingAmount: number;
  nextBalanceAmount: number;
};

type FlowPointsApplyEventResult = {
  balance_amount: string | number;
  applied_amount: string | number;
  applied: boolean;
};

type OrderPlanTransitionPayload = {
  kind?: PlanChangeKind | null;
  execution?: PlanChangeExecution | null;
  currentPlanCode?: PlanCode | null;
  currentBillingCycleDays?: number | null;
  currentExpiresAt?: string | null;
  currentCycleAmount?: number | string | null;
  currentConsumedAmount?: number | string | null;
  currentCreditAmount?: number | string | null;
  currentCycleTotalDaysExact?: number | string | null;
  currentCycleUsedDaysExact?: number | string | null;
  creditAppliedToTargetAmount?: number | string | null;
  surplusCreditAmount?: number | string | null;
  targetTotalAmount?: number | string | null;
  payableBeforeDiscountsAmount?: number | string | null;
  flowPointsApplied?: number | string | null;
  flowPointsGranted?: number | string | null;
  scheduledChangeId?: number | null;
  appliedImmediately?: boolean | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function parseNumeric(value: string | number | null | undefined, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseUnknownNumeric(value: unknown, fallback = 0) {
  return typeof value === "number" || typeof value === "string"
    ? parseNumeric(value, fallback)
    : fallback;
}

function normalizeIsoOrNull(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function planTierIndex(planCode: PlanCode) {
  const index = PLAN_ORDER.indexOf(planCode);
  return index >= 0 ? index : PLAN_ORDER.indexOf("pro");
}

function isActivePlanState(userPlanState: UserPlanStateRecord | null, nowMs = Date.now()) {
  if (!userPlanState) return false;
  if (userPlanState.status !== "active" && userPlanState.status !== "trial") {
    return false;
  }

  const expiresAtMs = userPlanState.expires_at
    ? Date.parse(userPlanState.expires_at)
    : Number.NaN;
  return !Number.isFinite(expiresAtMs) || nowMs <= expiresAtMs;
}

export function resolvePlanChangeKind(input: {
  userPlanState: UserPlanStateRecord | null;
  targetPlan: Pick<
    PlanPricingDefinition,
    "code" | "billingCycleDays" | "billingPeriodCode" | "isTrial"
  >;
  nowMs?: number;
}): PlanChangeKind {
  const nowMs = typeof input.nowMs === "number" ? input.nowMs : Date.now();
  const currentPlanState = input.userPlanState;
  const hasActivePlan = isActivePlanState(currentPlanState, nowMs);

  if (!currentPlanState || !hasActivePlan) {
    return "new";
  }

  const currentPlanCode = currentPlanState.plan_code;
  const currentBillingCycleDays = resolveEffectivePlanBillingCycleDays({
    billingCycleDays: currentPlanState.billing_cycle_days,
    planCode: currentPlanState.plan_code,
    fallbackPlanCode: currentPlanState.plan_code,
  });
  const targetPlanCode = input.targetPlan.code;
  const targetBillingCycleDays = resolveEffectivePlanBillingCycleDays({
    billingCycleDays: input.targetPlan.billingCycleDays,
    planCode: input.targetPlan.code,
    fallbackPlanCode: input.targetPlan.code,
  });

  if (
    currentPlanCode === targetPlanCode &&
    currentBillingCycleDays === targetBillingCycleDays
  ) {
    return "current";
  }

  const currentTier = planTierIndex(currentPlanCode);
  const targetTier = planTierIndex(targetPlanCode);

  if (targetTier > currentTier) {
    return "upgrade";
  }

  if (targetTier < currentTier) {
    return "downgrade";
  }

  if (targetBillingCycleDays > currentBillingCycleDays) {
    return "upgrade";
  }

  return "downgrade";
}

export function resolveRemainingPlanCredit(input: {
  userPlanState: UserPlanStateRecord | null;
  nowMs?: number;
}) {
  const nowMs = typeof input.nowMs === "number" ? input.nowMs : Date.now();
  const userPlanState = input.userPlanState;
  if (!userPlanState || !isActivePlanState(userPlanState, nowMs)) {
    return {
      currentCycleAmount: 0,
      currentConsumedAmount: 0,
      currentCycleTotalDaysExact: 0,
      currentCycleUsedDaysExact: 0,
      remainingDaysExact: 0,
      creditAmount: 0,
    };
  }

  const expiresAtMs = userPlanState.expires_at
    ? Date.parse(userPlanState.expires_at)
    : Number.NaN;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return {
      currentCycleAmount: 0,
      currentConsumedAmount: 0,
      currentCycleTotalDaysExact: 0,
      currentCycleUsedDaysExact: 0,
      remainingDaysExact: 0,
      creditAmount: 0,
    };
  }

  const cycleMetrics = resolvePlanCycleMetrics({
    activatedAt: userPlanState.activated_at,
    expiresAt: userPlanState.expires_at,
    nowMs,
    billingCycleDays: userPlanState.billing_cycle_days,
    planCode: userPlanState.plan_code,
    fallbackPlanCode: userPlanState.plan_code,
  });
  if (!cycleMetrics || cycleMetrics.remainingMs <= 0 || cycleMetrics.totalCycleMs <= 0) {
    return {
      currentCycleAmount: 0,
      currentConsumedAmount: 0,
      currentCycleTotalDaysExact: 0,
      currentCycleUsedDaysExact: 0,
      remainingDaysExact: 0,
      creditAmount: 0,
    };
  }

  const resolvedCurrentPlanPricing = resolveActivePlanCyclePricing({
    planCode: userPlanState.plan_code,
    billingCycleDays: userPlanState.billing_cycle_days,
    metadata: userPlanState.metadata,
    fallbackPlanCode: userPlanState.plan_code,
  });
  const currentAmount = Math.max(
    0,
    resolvedCurrentPlanPricing.totalAmount || parseNumeric(userPlanState.amount, 0),
  );
  const creditAmount =
    currentAmount * (cycleMetrics.remainingMs / cycleMetrics.totalCycleMs);

  return {
    currentCycleAmount: roundMoney(currentAmount),
    currentConsumedAmount: roundMoney(Math.max(0, currentAmount - creditAmount)),
    currentCycleTotalDaysExact: roundMoney(cycleMetrics.totalDaysExact),
    currentCycleUsedDaysExact: roundMoney(cycleMetrics.elapsedDaysExact),
    remainingDaysExact: cycleMetrics.remainingDaysExact,
    creditAmount: roundMoney(creditAmount),
  };
}

export async function getUserPlanFlowPointsBalance(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_plan_flow_points")
    .select("user_id, currency, balance_amount, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle<UserPlanFlowPointsBalanceRecord>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar saldo de FlowPoints: ${result.error.message}`,
    );
  }

  return result.data || null;
}

export function resolveFlowPointsBalanceAmount(
  balanceRecord: UserPlanFlowPointsBalanceRecord | null | undefined,
) {
  return Math.max(0, roundMoney(parseNumeric(balanceRecord?.balance_amount, 0)));
}

export async function getUserPlanScheduledChange(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_plan_scheduled_changes")
    .select(
      "id, user_id, guild_id, current_plan_code, current_billing_cycle_days, target_plan_code, target_billing_period_code, target_billing_cycle_days, status, effective_at, metadata, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<UserPlanScheduledChangeRecord>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar troca agendada de plano: ${result.error.message}`,
    );
  }

  return result.data || null;
}

export async function scheduleUserPlanDowngrade(input: {
  userId: number;
  guildId: string | null;
  currentPlanCode: PlanCode;
  currentBillingCycleDays: number;
  targetPlanCode: PlanCode;
  targetBillingPeriodCode: PlanBillingPeriodCode;
  targetBillingCycleDays: number;
  effectiveAt: string;
  metadata?: Record<string, unknown> | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const existingScheduledChange = await getUserPlanScheduledChange(input.userId);

  if (existingScheduledChange) {
    const updateResult = await supabase
      .from("auth_user_plan_scheduled_changes")
      .update({
        guild_id: input.guildId,
        current_plan_code: input.currentPlanCode,
        current_billing_cycle_days: input.currentBillingCycleDays,
        target_plan_code: input.targetPlanCode,
        target_billing_period_code: input.targetBillingPeriodCode,
        target_billing_cycle_days: input.targetBillingCycleDays,
        effective_at: input.effectiveAt,
        metadata: input.metadata || {},
      })
      .eq("id", existingScheduledChange.id)
      .select(
        "id, user_id, guild_id, current_plan_code, current_billing_cycle_days, target_plan_code, target_billing_period_code, target_billing_cycle_days, status, effective_at, metadata, created_at, updated_at",
      )
      .single<UserPlanScheduledChangeRecord>();

    if (updateResult.error || !updateResult.data) {
      throw new Error(
        updateResult.error?.message ||
          "Falha ao atualizar a troca agendada do plano.",
      );
    }

    return updateResult.data;
  }

  const insertResult = await supabase
    .from("auth_user_plan_scheduled_changes")
    .insert({
      user_id: input.userId,
      guild_id: input.guildId,
      current_plan_code: input.currentPlanCode,
      current_billing_cycle_days: input.currentBillingCycleDays,
      target_plan_code: input.targetPlanCode,
      target_billing_period_code: input.targetBillingPeriodCode,
      target_billing_cycle_days: input.targetBillingCycleDays,
      effective_at: input.effectiveAt,
      metadata: input.metadata || {},
    })
    .select(
      "id, user_id, guild_id, current_plan_code, current_billing_cycle_days, target_plan_code, target_billing_period_code, target_billing_cycle_days, status, effective_at, metadata, created_at, updated_at",
    )
    .single<UserPlanScheduledChangeRecord>();

  if (insertResult.error || !insertResult.data) {
    throw new Error(
      insertResult.error?.message ||
        "Falha ao criar a troca agendada do plano.",
    );
  }

  return insertResult.data;
}

export async function updateScheduledPlanChangeStatus(input: {
  userId: number;
  scheduledChangeId?: number | null;
  nextStatus: "applied" | "cancelled";
  metadata?: Record<string, unknown> | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  let query = supabase
    .from("auth_user_plan_scheduled_changes")
    .update({
      status: input.nextStatus,
      metadata: input.metadata || {},
    })
    .eq("user_id", input.userId)
    .eq("status", "scheduled");

  if (typeof input.scheduledChangeId === "number" && Number.isFinite(input.scheduledChangeId)) {
    query = query.eq("id", input.scheduledChangeId);
  }

  const result = await query.select(
    "id, user_id, guild_id, current_plan_code, current_billing_cycle_days, target_plan_code, target_billing_period_code, target_billing_cycle_days, status, effective_at, metadata, created_at, updated_at",
  );

  if (result.error) {
    throw new Error(
      `Erro ao atualizar a troca agendada do plano: ${result.error.message}`,
    );
  }

  return result.data || [];
}

export function applyFlowPointsToAmount(input: {
  amount: number;
  flowPointsBalance: number;
}) {
  const amount = Math.max(0, roundMoney(input.amount));
  const flowPointsBalance = Math.max(0, roundMoney(input.flowPointsBalance));
  const appliedAmount = roundMoney(Math.min(amount, flowPointsBalance));
  const remainingAmount = roundMoney(Math.max(0, amount - appliedAmount));
  const nextBalanceAmount = roundMoney(Math.max(0, flowPointsBalance - appliedAmount));

  return {
    appliedAmount,
    remainingAmount,
    nextBalanceAmount,
  } satisfies FlowPointsApplyPreview;
}

export async function applyFlowPointsEvent(input: {
  userId: number;
  eventType: string;
  amount: number;
  currency?: string;
  referenceKey?: string | null;
  paymentOrderId?: number | null;
  metadata?: Record<string, unknown> | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase.rpc("apply_user_plan_flow_points_event", {
    p_user_id: input.userId,
    p_event_type: input.eventType,
    p_amount: roundMoney(input.amount),
    p_currency: input.currency || "BRL",
    p_reference_key: input.referenceKey || null,
    p_payment_order_id: input.paymentOrderId || null,
    p_metadata: input.metadata || {},
  });

  if (result.error) {
    throw new Error(
      `Erro ao aplicar FlowPoints: ${result.error.message}`,
    );
  }

  const payload = Array.isArray(result.data)
    ? (result.data[0] as FlowPointsApplyEventResult | undefined)
    : null;

  return {
    balanceAmount: roundMoney(parseNumeric(payload?.balance_amount, 0)),
    appliedAmount: roundMoney(parseNumeric(payload?.applied_amount, 0)),
    applied: Boolean(payload?.applied),
  };
}

export function resolvePlanChangePreview(input: {
  userPlanState: UserPlanStateRecord | null;
  targetPlan: PlanPricingDefinition;
  flowPointsBalance: number;
  scheduledChange?: UserPlanScheduledChangeRecord | null;
  nowMs?: number;
}): PlanChangePreview {
  const nowMs = typeof input.nowMs === "number" ? input.nowMs : Date.now();
  const userPlanState = input.userPlanState;
  const targetPlan = input.targetPlan;
  const flowPointsBalance = Math.max(0, roundMoney(input.flowPointsBalance));
  const scheduledChange = input.scheduledChange || null;
  const kind = resolvePlanChangeKind({
    userPlanState,
    targetPlan,
    nowMs,
  });
  const hasActivePlan = isActivePlanState(userPlanState, nowMs);
  const currentPlanCode = userPlanState?.plan_code || null;
  const currentBillingCycleDays = userPlanState
    ? resolveEffectivePlanBillingCycleDays({
        billingCycleDays: userPlanState.billing_cycle_days,
        planCode: userPlanState.plan_code,
        fallbackPlanCode: userPlanState.plan_code,
      })
    : null;
  const remainingPlanCredit =
    kind === "upgrade"
      ? resolveRemainingPlanCredit({
          userPlanState,
          nowMs,
        })
      : {
          currentCycleAmount: 0,
          currentConsumedAmount: 0,
          currentCycleTotalDaysExact: 0,
          currentCycleUsedDaysExact: 0,
          remainingDaysExact: 0,
          creditAmount: 0,
        };
  const currentCreditAmount = remainingPlanCredit.creditAmount;
  const currentCycleAmount = roundMoney(remainingPlanCredit.currentCycleAmount);
  const currentConsumedAmount = roundMoney(remainingPlanCredit.currentConsumedAmount);
  const currentCycleTotalDaysExact = roundMoney(
    remainingPlanCredit.currentCycleTotalDaysExact,
  );
  const currentCycleUsedDaysExact = roundMoney(
    remainingPlanCredit.currentCycleUsedDaysExact,
  );
  const creditAppliedToTargetAmount = roundMoney(
    Math.min(currentCreditAmount, roundMoney(targetPlan.totalAmount)),
  );
  const surplusCreditAmount = roundMoney(
    Math.max(0, currentCreditAmount - roundMoney(targetPlan.totalAmount)),
  );
  const immediateSubtotalAmount =
    kind === "upgrade" || kind === "new"
      ? roundMoney(Math.max(0, targetPlan.totalAmount - currentCreditAmount))
      : 0;
  const flowPointsGrantPreview =
    kind === "upgrade" ? surplusCreditAmount : 0;
  const scheduledChangeMatchesTarget = Boolean(
    scheduledChange &&
      scheduledChange.target_plan_code === targetPlan.code &&
      scheduledChange.target_billing_period_code === targetPlan.billingPeriodCode,
  );

  let execution: PlanChangeExecution;
  if (targetPlan.isTrial) {
    execution = hasActivePlan && kind === "current"
      ? "already_active"
      : "trial_activation";
  } else if (kind === "downgrade" && hasActivePlan) {
    execution = "schedule_for_renewal";
  } else if (kind === "current" && hasActivePlan) {
    execution = "already_active";
  } else {
    execution = "pay_now";
  }

  return {
    kind,
    execution,
    targetPlanCode: targetPlan.code,
    targetBillingPeriodCode: targetPlan.billingPeriodCode,
    targetBillingCycleDays: targetPlan.billingCycleDays,
    targetTotalAmount: roundMoney(targetPlan.totalAmount),
    currentPlanCode,
    currentBillingCycleDays,
    currentExpiresAt: normalizeIsoOrNull(userPlanState?.expires_at),
    currentStatus: userPlanState?.status || null,
    currentCycleAmount,
    currentConsumedAmount,
    currentCreditAmount,
    currentCycleTotalDaysExact,
    currentCycleUsedDaysExact,
    remainingDaysExact: roundMoney(remainingPlanCredit.remainingDaysExact),
    creditAppliedToTargetAmount,
    surplusCreditAmount,
    immediateSubtotalAmount,
    flowPointsBalance,
    flowPointsGrantPreview,
    isCurrentSelectionBlocked: Boolean(
      execution === "already_active" &&
        hasActivePlan &&
        currentPlanCode === targetPlan.code &&
        currentBillingCycleDays === targetPlan.billingCycleDays,
    ),
    scheduledChange,
    scheduledChangeMatchesTarget,
    effectiveAt:
      execution === "schedule_for_renewal"
        ? normalizeIsoOrNull(userPlanState?.expires_at)
        : scheduledChangeMatchesTarget
          ? normalizeIsoOrNull(scheduledChange?.effective_at)
          : null,
  };
}

export function buildPlanTransitionPayload(input: {
  preview: PlanChangePreview;
  flowPointsApplied: number;
  flowPointsGranted?: number;
  scheduledChangeId?: number | null;
}) {
  return {
    kind: input.preview.kind,
    execution: input.preview.execution,
    currentPlanCode: input.preview.currentPlanCode,
    currentBillingCycleDays: input.preview.currentBillingCycleDays,
    currentExpiresAt: input.preview.currentExpiresAt,
    currentCycleAmount: roundMoney(input.preview.currentCycleAmount),
    currentConsumedAmount: roundMoney(input.preview.currentConsumedAmount),
    currentCreditAmount: roundMoney(input.preview.currentCreditAmount),
    currentCycleTotalDaysExact: roundMoney(input.preview.currentCycleTotalDaysExact),
    currentCycleUsedDaysExact: roundMoney(input.preview.currentCycleUsedDaysExact),
    creditAppliedToTargetAmount: roundMoney(input.preview.creditAppliedToTargetAmount),
    surplusCreditAmount: roundMoney(input.preview.surplusCreditAmount),
    targetTotalAmount: roundMoney(input.preview.targetTotalAmount),
    payableBeforeDiscountsAmount: roundMoney(input.preview.immediateSubtotalAmount),
    flowPointsApplied: roundMoney(input.flowPointsApplied),
    flowPointsGranted: roundMoney(
      typeof input.flowPointsGranted === "number"
        ? input.flowPointsGranted
        : input.preview.flowPointsGrantPreview,
    ),
    scheduledChangeId:
      typeof input.scheduledChangeId === "number"
        ? input.scheduledChangeId
        : input.preview.scheduledChange?.id || null,
    appliedImmediately: input.preview.execution === "pay_now",
  } satisfies OrderPlanTransitionPayload;
}

export function readOrderPlanTransitionPayload(providerPayload: unknown) {
  if (!isRecord(providerPayload)) return null;
  const transition = isRecord(providerPayload.transition)
    ? providerPayload.transition
    : null;
  if (!transition) return null;

  return {
    kind:
      transition.kind === "new" ||
      transition.kind === "current" ||
      transition.kind === "upgrade" ||
      transition.kind === "downgrade"
        ? transition.kind
        : null,
    execution:
      transition.execution === "pay_now" ||
      transition.execution === "schedule_for_renewal" ||
      transition.execution === "already_active" ||
      transition.execution === "trial_activation"
        ? transition.execution
        : null,
    currentPlanCode:
      transition.currentPlanCode === "basic" ||
      transition.currentPlanCode === "pro" ||
      transition.currentPlanCode === "ultra" ||
      transition.currentPlanCode === "master"
        ? transition.currentPlanCode
        : null,
    currentBillingCycleDays: Number.isFinite(Number(transition.currentBillingCycleDays))
      ? Number(transition.currentBillingCycleDays)
      : null,
    currentExpiresAt: normalizeIsoOrNull(
      typeof transition.currentExpiresAt === "string"
        ? transition.currentExpiresAt
        : null,
    ),
    currentCycleAmount: roundMoney(parseUnknownNumeric(transition.currentCycleAmount, 0)),
    currentConsumedAmount: roundMoney(parseUnknownNumeric(transition.currentConsumedAmount, 0)),
    currentCreditAmount: roundMoney(parseUnknownNumeric(transition.currentCreditAmount, 0)),
    currentCycleTotalDaysExact: roundMoney(
      parseUnknownNumeric(transition.currentCycleTotalDaysExact, 0),
    ),
    currentCycleUsedDaysExact: roundMoney(
      parseUnknownNumeric(transition.currentCycleUsedDaysExact, 0),
    ),
    creditAppliedToTargetAmount: roundMoney(
      parseUnknownNumeric(transition.creditAppliedToTargetAmount, 0),
    ),
    surplusCreditAmount: roundMoney(
      parseUnknownNumeric(transition.surplusCreditAmount, 0),
    ),
    targetTotalAmount: roundMoney(parseUnknownNumeric(transition.targetTotalAmount, 0)),
    payableBeforeDiscountsAmount: roundMoney(
      parseUnknownNumeric(transition.payableBeforeDiscountsAmount, 0),
    ),
    flowPointsApplied: roundMoney(parseUnknownNumeric(transition.flowPointsApplied, 0)),
    flowPointsGranted: roundMoney(parseUnknownNumeric(transition.flowPointsGranted, 0)),
    scheduledChangeId: Number.isFinite(Number(transition.scheduledChangeId))
      ? Number(transition.scheduledChangeId)
      : null,
    appliedImmediately: transition.appliedImmediately === true,
  } satisfies Required<OrderPlanTransitionPayload>;
}

export function orderTransitionAllowsImmediateApproval(
  providerPayload: unknown,
) {
  const transition = readOrderPlanTransitionPayload(providerPayload);
  return Boolean(
    transition &&
      transition.appliedImmediately &&
      transition.execution === "pay_now" &&
      transition.kind === "upgrade",
  );
}
