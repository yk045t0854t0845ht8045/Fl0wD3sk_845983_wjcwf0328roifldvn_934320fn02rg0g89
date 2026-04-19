import {
  DEFAULT_PLAN_BILLING_PERIOD_CODE,
  DEFAULT_PLAN_CODE,
  normalizePlanBillingPeriodCodeFromSlug,
  normalizePlanCodeFromSlug,
  resolvePlanDefinition,
  type PlanBillingPeriodCode,
} from "@/lib/plans/catalog";
import { buildConfigCheckoutSearchParams } from "@/lib/plans/configRouting";
import { buildPaymentCheckoutEntryHref } from "@/lib/payments/paymentRouting";
import type { UserPlanStateRecord } from "@/lib/plans/state";

type QueryValue = string | number | boolean | null | undefined;
type QueryValueInput = QueryValue | QueryValue[];

type ConfigSearchParams =
  | URLSearchParams
  | Record<string, QueryValueInput>;

type ConfigAccessPlanState = Pick<UserPlanStateRecord, "plan_code" | "status"> | null | undefined;

export function hasActivePaidConfigPlan(
  userPlanState: ConfigAccessPlanState,
) {
  if (!userPlanState || userPlanState.status !== "active") {
    return false;
  }

  return !resolvePlanDefinition(
    userPlanState.plan_code || DEFAULT_PLAN_CODE,
  ).isTrial;
}

export function normalizeConfigReturnPath(value: string | null | undefined) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 600) return null;
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  if (!trimmed.startsWith("/config")) return null;

  return trimmed;
}

export function buildConfigPaymentRequiredHref(input?: {
  planCode?: unknown;
  billingPeriodCode?: unknown;
  searchParams?: ConfigSearchParams;
  omitSearchParamKeys?: string[];
  returnPath?: string | null;
}) {
  const requestedPlanCode = normalizePlanCodeFromSlug(
    input?.planCode,
    DEFAULT_PLAN_CODE,
  );
  const normalizedPlanCode = resolvePlanDefinition(requestedPlanCode).isTrial
    ? DEFAULT_PLAN_CODE
    : requestedPlanCode;
  const plan = resolvePlanDefinition(normalizedPlanCode);
  const normalizedBillingPeriodCode = plan.isTrial
    ? DEFAULT_PLAN_BILLING_PERIOD_CODE
    : normalizePlanBillingPeriodCodeFromSlug(
        input?.billingPeriodCode,
        DEFAULT_PLAN_BILLING_PERIOD_CODE,
      );
  const params = buildConfigCheckoutSearchParams({
    searchParams: input?.searchParams,
    omitKeys: [
      ...(input?.omitSearchParamKeys || []),
      "return",
      "returnPath",
    ],
  });
  const returnPath = normalizeConfigReturnPath(input?.returnPath || null);

  params.set("return", "config");
  params.set("source", "config-plan-guard");

  if (returnPath) {
    params.set("returnPath", returnPath);
  }

  return buildPaymentCheckoutEntryHref({
    planCode: normalizedPlanCode,
    billingPeriodCode: normalizedBillingPeriodCode as PlanBillingPeriodCode,
    searchParams: params,
  });
}
