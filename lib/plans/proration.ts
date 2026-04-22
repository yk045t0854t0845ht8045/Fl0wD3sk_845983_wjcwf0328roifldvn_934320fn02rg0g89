import { PLAN_ORDER, type PlanCode, type PlanPricingDefinition } from "@/lib/plans/catalog";
import { resolveEffectivePlanBillingCycleDays } from "@/lib/plans/cycle";
import type { UserPlanStateRecord } from "@/lib/plans/state";
import { parseUtcTimestampMs } from "@/lib/time/utcTimestamp";

const DAY_MS = 24 * 60 * 60 * 1000;

function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function planTierIndex(planCode: PlanCode) {
  const index = PLAN_ORDER.indexOf(planCode);
  return index >= 0 ? index : PLAN_ORDER.indexOf("pro");
}

export function isPlanUpgrade(currentPlan: PlanCode, targetPlan: PlanCode) {
  return planTierIndex(targetPlan) > planTierIndex(currentPlan);
}

export type PlanUpgradeProration = {
  mode: "upgrade";
  currentPlanCode: PlanCode;
  currentAmount: number;
  currentBillingCycleDays: number;
  currentExpiresAt: string;
  targetPlanCode: PlanCode;
  targetTotalAmount: number;
  targetBillingCycleDays: number;
  remainingDaysExact: number;
  creditAmount: number;
  targetAmountForRemaining: number;
  dueAmount: number;
};

export function resolvePlanUpgradeProration(input: {
  userPlanState: UserPlanStateRecord;
  targetPlan: PlanPricingDefinition;
  nowMs?: number;
}) {
  const nowMs = typeof input.nowMs === "number" ? input.nowMs : Date.now();

  const currentPlanCode = input.userPlanState.plan_code;
  const targetPlanCode = input.targetPlan.code;

  if (!isPlanUpgrade(currentPlanCode, targetPlanCode)) {
    return null;
  }

  const currentExpiresAtMs = parseUtcTimestampMs(input.userPlanState.expires_at || "");
  if (!Number.isFinite(currentExpiresAtMs)) {
    return null;
  }

  const remainingMs = currentExpiresAtMs - nowMs;
  if (remainingMs <= 0) {
    return null;
  }

  const currentBillingCycleDays = resolveEffectivePlanBillingCycleDays({
    billingCycleDays: input.userPlanState.billing_cycle_days,
    planCode: input.userPlanState.plan_code,
    fallbackPlanCode: input.userPlanState.plan_code,
  });
  const targetBillingCycleDays = resolveEffectivePlanBillingCycleDays({
    billingCycleDays: input.targetPlan.billingCycleDays,
    planCode: input.targetPlan.code,
    fallbackPlanCode: input.targetPlan.code,
  });

  // Para manter a regra simples e previsivel: prorata apenas dentro do mesmo ciclo.
  // Ex: mensal->mensal, trimestral->trimestral.
  if (currentBillingCycleDays !== targetBillingCycleDays) {
    return null;
  }

  const remainingDaysExact = Math.max(0, remainingMs / DAY_MS);
  const currentAmount = Math.max(0, Number(input.userPlanState.amount) || 0);
  const targetTotalAmount = Math.max(0, input.targetPlan.totalAmount || 0);

  const currentDailyRate = currentAmount / currentBillingCycleDays;
  const targetDailyRate = targetTotalAmount / targetBillingCycleDays;

  const creditAmount = roundMoney(currentDailyRate * remainingDaysExact);
  const targetAmountForRemaining = roundMoney(targetDailyRate * remainingDaysExact);
  const dueAmount = roundMoney(Math.max(0, targetAmountForRemaining - creditAmount));

  return {
    mode: "upgrade",
    currentPlanCode,
    currentAmount,
    currentBillingCycleDays,
    currentExpiresAt: new Date(currentExpiresAtMs).toISOString(),
    targetPlanCode,
    targetTotalAmount,
    targetBillingCycleDays,
    remainingDaysExact,
    creditAmount,
    targetAmountForRemaining,
    dueAmount,
  } satisfies PlanUpgradeProration;
}
