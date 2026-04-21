import {
  DEFAULT_PLAN_BILLING_PERIOD_CODE,
  resolvePlanPricing,
  type PlanBillingPeriodCode,
  type PlanCode,
} from "@/lib/plans/catalog";
import { applyBetaProgramPricing } from "@/lib/payments/betaProgram";

function normalizePositiveInteger(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

export function resolvePlanBillingPeriodCodeFromCycleDays(
  billingCycleDays: unknown,
): PlanBillingPeriodCode {
  switch (normalizePositiveInteger(billingCycleDays)) {
    case 90:
      return "quarterly";
    case 180:
      return "semiannual";
    case 365:
      return "annual";
    case 30:
    default:
      return DEFAULT_PLAN_BILLING_PERIOD_CODE;
  }
}

export function resolveActivePlanCyclePricing(input: {
  planCode: unknown;
  billingCycleDays: unknown;
  metadata?: unknown;
  fallbackPlanCode?: PlanCode;
}) {
  const billingPeriodCode = resolvePlanBillingPeriodCodeFromCycleDays(
    input.billingCycleDays,
  );

  return applyBetaProgramPricing(
    resolvePlanPricing(input.planCode, billingPeriodCode),
    input.metadata || null,
  );
}
