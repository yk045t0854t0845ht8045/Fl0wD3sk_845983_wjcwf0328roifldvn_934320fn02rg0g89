import type { PlanCode } from "@/lib/plans/catalog";
import { resolveEffectivePlanBillingCycleDays } from "@/lib/plans/cycle";
import { parseUtcTimestampMs } from "@/lib/time/utcTimestamp";

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export type PlanCycleMetrics = {
  totalCycleMs: number;
  elapsedMs: number;
  remainingMs: number;
  totalDaysExact: number;
  elapsedDaysExact: number;
  remainingDaysExact: number;
  usesExactCycleWindow: boolean;
};

export function resolvePlanCycleMetrics(input: {
  activatedAt?: unknown;
  expiresAt?: unknown;
  nowMs?: number;
  billingCycleDays?: unknown;
  planCode?: unknown;
  fallbackPlanCode?: PlanCode;
}) {
  const nowMs = typeof input.nowMs === "number" ? input.nowMs : Date.now();
  const activatedAtMs = parseUtcTimestampMs(input.activatedAt);
  const expiresAtMs = parseUtcTimestampMs(input.expiresAt);
  const billingCycleDays = resolveEffectivePlanBillingCycleDays({
    billingCycleDays: input.billingCycleDays,
    planCode: input.planCode,
    fallbackPlanCode: input.fallbackPlanCode,
  });
  const fallbackCycleMs = Math.max(billingCycleDays, 1) * DAY_MS;

  let totalCycleMs = fallbackCycleMs;
  let elapsedMs = 0;
  let remainingMs = 0;
  let usesExactCycleWindow = false;

  if (Number.isFinite(activatedAtMs) && Number.isFinite(expiresAtMs) && expiresAtMs > activatedAtMs) {
    totalCycleMs = Math.max(expiresAtMs - activatedAtMs, 1);
    elapsedMs = clamp(nowMs - activatedAtMs, 0, totalCycleMs);
    remainingMs = clamp(expiresAtMs - nowMs, 0, totalCycleMs);
    usesExactCycleWindow = true;
  } else if (Number.isFinite(expiresAtMs)) {
    remainingMs = clamp(expiresAtMs - nowMs, 0, totalCycleMs);
    elapsedMs = clamp(totalCycleMs - remainingMs, 0, totalCycleMs);
  } else if (Number.isFinite(activatedAtMs)) {
    elapsedMs = clamp(nowMs - activatedAtMs, 0, totalCycleMs);
    remainingMs = clamp(totalCycleMs - elapsedMs, 0, totalCycleMs);
  } else {
    return null;
  }

  return {
    totalCycleMs,
    elapsedMs,
    remainingMs,
    totalDaysExact: totalCycleMs / DAY_MS,
    elapsedDaysExact: elapsedMs / DAY_MS,
    remainingDaysExact: remainingMs / DAY_MS,
    usesExactCycleWindow,
  } satisfies PlanCycleMetrics;
}
