import {
  DEFAULT_PLAN_CODE,
  resolvePlanDefinition,
  type PlanCode,
} from "@/lib/plans/catalog";
import { parseUtcTimestampMs } from "@/lib/time/utcTimestamp";

const DAY_MS = 24 * 60 * 60 * 1000;

const BILLING_PERIOD_MONTHS_BY_CYCLE_DAYS = new Map<number, number>([
  [30, 1],
  [90, 3],
  [180, 6],
  [365, 12],
]);

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

function addUtcMonthsPreservingClock(baseTimestampMs: number, months: number) {
  const base = new Date(baseTimestampMs);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  const hours = base.getUTCHours();
  const minutes = base.getUTCMinutes();
  const seconds = base.getUTCSeconds();
  const milliseconds = base.getUTCMilliseconds();

  const anchor = new Date(
    Date.UTC(year, month + months, 1, hours, minutes, seconds, milliseconds),
  );
  const lastDayOfTargetMonth = new Date(
    Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + 1,
      0,
      hours,
      minutes,
      seconds,
      milliseconds,
    ),
  ).getUTCDate();

  return Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    Math.min(day, lastDayOfTargetMonth),
    hours,
    minutes,
    seconds,
    milliseconds,
  );
}

export function resolveBillingPeriodMonthsFromCycleDays(cycleDays: unknown) {
  const normalizedCycleDays = normalizePositiveInteger(cycleDays);
  if (!normalizedCycleDays) return null;
  return BILLING_PERIOD_MONTHS_BY_CYCLE_DAYS.get(normalizedCycleDays) || null;
}

export function resolveEffectivePlanBillingCycleDays(input: {
  billingCycleDays?: unknown;
  planCode?: unknown;
  fallbackPlanCode?: PlanCode;
}) {
  const normalizedCycleDays = normalizePositiveInteger(input.billingCycleDays);
  if (normalizedCycleDays) {
    return normalizedCycleDays;
  }

  const fallbackPlanCode = input.fallbackPlanCode || DEFAULT_PLAN_CODE;
  const plan = resolvePlanDefinition(input.planCode, fallbackPlanCode);
  return Math.max(plan.billingCycleDays, 1);
}

export function resolvePlanCycleExpirationMs(input: {
  baseTimestamp: string | number | Date;
  billingCycleDays?: unknown;
  billingPeriodMonths?: unknown;
  fallbackBillingCycleDays?: number;
}) {
  const baseTimestampMs =
    input.baseTimestamp instanceof Date
      ? input.baseTimestamp.getTime()
      : typeof input.baseTimestamp === "number"
        ? input.baseTimestamp
        : parseUtcTimestampMs(input.baseTimestamp);

  if (!Number.isFinite(baseTimestampMs)) return null;

  const fallbackBillingCycleDays = Math.max(input.fallbackBillingCycleDays || 30, 1);
  const billingCycleDays =
    normalizePositiveInteger(input.billingCycleDays) || fallbackBillingCycleDays;
  const billingPeriodMonths =
    normalizePositiveInteger(input.billingPeriodMonths) ||
    resolveBillingPeriodMonthsFromCycleDays(billingCycleDays);

  if (billingPeriodMonths) {
    return addUtcMonthsPreservingClock(baseTimestampMs, billingPeriodMonths);
  }

  return baseTimestampMs + billingCycleDays * DAY_MS;
}

export function resolvePlanCycleExpirationIso(input: {
  baseTimestamp: string | number | Date;
  billingCycleDays?: unknown;
  billingPeriodMonths?: unknown;
  fallbackBillingCycleDays?: number;
}) {
  const expirationMs = resolvePlanCycleExpirationMs(input);
  if (typeof expirationMs !== "number" || !Number.isFinite(expirationMs)) {
    return null;
  }
  return new Date(expirationMs).toISOString();
}

export function resolvePlanLicenseExpiresAtIso(input: {
  baseTimestamp: string | number | Date;
  billingCycleDays?: unknown;
  billingPeriodMonths?: unknown;
  planCode?: unknown;
  fallbackPlanCode?: PlanCode;
}) {
  const resolvedBillingCycleDays = resolveEffectivePlanBillingCycleDays({
    billingCycleDays: input.billingCycleDays,
    planCode: input.planCode,
    fallbackPlanCode: input.fallbackPlanCode,
  });
  const resolvedBillingPeriodMonths =
    normalizePositiveInteger(input.billingPeriodMonths) ||
    resolveBillingPeriodMonthsFromCycleDays(resolvedBillingCycleDays);

  return resolvePlanCycleExpirationIso({
    baseTimestamp: input.baseTimestamp,
    billingCycleDays: resolvedBillingCycleDays,
    billingPeriodMonths: resolvedBillingPeriodMonths,
    fallbackBillingCycleDays: resolvedBillingCycleDays,
  });
}
