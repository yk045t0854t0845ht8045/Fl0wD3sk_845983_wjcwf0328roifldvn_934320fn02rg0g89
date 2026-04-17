import { getUserPlanState, repairOrphanPlanGuildLinkForUser, getBasicPlanAvailability } from "@/lib/plans/state";

import { countPlanGuildsForUser, getPlanGuildsForUser } from "@/lib/plans/planGuilds";
import { getUserPlanScheduledChange } from "@/lib/plans/change";
import { ensureDowngradeEnforcementForUser, getDowngradeEnforcementSummaryForUser } from "@/lib/plans/downgradeEnforcement";
import { buildAccountPlanUsageSnapshot } from "@/lib/plans/accountPlanUsage";
import { PLAN_ORDER, resolvePlanPricing, type PlanCode } from "@/lib/plans/catalog";

const planStateCache = new Map<number, { data: ManagedPlanState; timestamp: number }>();
const refreshingUserIds = new Set<number>();
const CACHE_TTL_MS = 600000;
const STALE_THRESHOLD_MS = 20000;

export type ManagedPlanState = {
  plan: any;
  usage: any;
  totalLinkedServersCount: number;
  isBasicAvailable: boolean;
  downgradeEnforcement: any;
  upgradeRecommendation: any;
};

function resolveUpgradeRecommendation(input: {
  currentPlanCode: PlanCode | null;
  requiredServersCount: number;
}) {
  const minimumRequiredServers = Math.max(1, input.requiredServersCount);
  const normalizedCurrentPlanCode =
    input.currentPlanCode && PLAN_ORDER.includes(input.currentPlanCode)
      ? input.currentPlanCode
      : null;
  const currentPlanIndex = normalizedCurrentPlanCode
    ? PLAN_ORDER.indexOf(normalizedCurrentPlanCode)
    : -1;
  const paidPlanOrder = PLAN_ORDER.filter((planCode) => planCode !== "basic");
  const candidates = paidPlanOrder.map((planCode) =>
    resolvePlanPricing(planCode),
  );
  const recommendedPlan =
    candidates.find(
      (plan) =>
        plan.entitlements.maxLicensedServers >= minimumRequiredServers &&
        PLAN_ORDER.indexOf(plan.code) > currentPlanIndex,
    ) ||
    candidates.find(
      (plan) => plan.entitlements.maxLicensedServers >= minimumRequiredServers,
    ) ||
    candidates[candidates.length - 1] ||
    null;

  if (!recommendedPlan) {
    return null;
  }

  return {
    planCode: recommendedPlan.code,
    planName: recommendedPlan.name,
    maxLicensedServers: recommendedPlan.entitlements.maxLicensedServers,
    billingPeriodCode: recommendedPlan.billingPeriodCode,
    totalAmount: recommendedPlan.totalAmount,
    currency: recommendedPlan.currency,
  };
}

/**
 * Força a limpeza do cache de estado do plano para um usuário específico.
 * Útil após processar pagamentos ou ativações de teste para garantir sincronização imediata.
 */
export function clearPlanStateCacheForUser(userId: number) {
  planStateCache.delete(userId);
}

export async function getManagedPlanStateForUser(userId: number): Promise<ManagedPlanState> {
  const cached = planStateCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    const isStale = Date.now() - cached.timestamp > STALE_THRESHOLD_MS;
    if (isStale && !refreshingUserIds.has(userId)) {
      refreshingUserIds.add(userId);
      void fetchPlanStateFresh(userId)
        .catch(() => null)
        .finally(() => refreshingUserIds.delete(userId));
    }
    return cached.data;
  }

  return fetchPlanStateFresh(userId);
}

async function fetchPlanStateFresh(userId: number): Promise<ManagedPlanState> {
  // 1. Concurrent fetching of base items
  const [userPlanState, basicPlanAvailability] = await Promise.all([
    getUserPlanState(userId),
    getBasicPlanAvailability(userId),
  ]);

  // Fix orphans in background
  void repairOrphanPlanGuildLinkForUser({
    userId,
    userPlanState,
    source: "managed_plan_state_fresh",
  }).catch(() => null);

  // 2. Concurrent fetching of detailed items
  const [licensedServersCount, allPlanGuilds, scheduledChange] = await Promise.all([
    countPlanGuildsForUser(userId),
    getPlanGuildsForUser(userId, { includeInactive: true }),
    getUserPlanScheduledChange(userId),
  ]);

  // Ensure enforcement in background
  void ensureDowngradeEnforcementForUser({
    userId,
    userPlanState,
    scheduledChange,
  }).catch(() => null);

  const downgradeEnforcement = await getDowngradeEnforcementSummaryForUser(userId);
  const usage = buildAccountPlanUsageSnapshot(userPlanState, licensedServersCount);
  const totalLinkedServersCount = allPlanGuilds.length;
  
  const requiredServersForRecommendation = downgradeEnforcement
    ? totalLinkedServersCount
    : usage.licensedServersCount;

  const upgradeRecommendation = resolveUpgradeRecommendation({
    currentPlanCode: userPlanState?.plan_code || null,
    requiredServersCount: requiredServersForRecommendation,
  });

  const data: ManagedPlanState = {
    plan: userPlanState
      ? {
          planCode: userPlanState.plan_code,
          planName: userPlanState.plan_name,
          status: userPlanState.status,
          amount: Number(userPlanState.amount),
          currency: userPlanState.currency,
          billingCycleDays: userPlanState.billing_cycle_days,
          maxLicensedServers: userPlanState.max_licensed_servers,
          activatedAt: userPlanState.activated_at,
          expiresAt: userPlanState.expires_at,
        }
      : null,
    usage,
    totalLinkedServersCount,
    isBasicAvailable: basicPlanAvailability.isAvailable,
    downgradeEnforcement: downgradeEnforcement
      ? {
          id: downgradeEnforcement.id,
          status: downgradeEnforcement.status,
          effectiveAt: downgradeEnforcement.effectiveAt,
          targetPlanCode: downgradeEnforcement.targetPlanCode,
          targetBillingPeriodCode: downgradeEnforcement.targetBillingPeriodCode,
          targetBillingCycleDays: downgradeEnforcement.targetBillingCycleDays,
          targetMaxLicensedServers: downgradeEnforcement.targetMaxLicensedServers,
          selectedGuildIds: downgradeEnforcement.selectedGuildIds,
          scheduledChangeId: downgradeEnforcement.scheduledChangeId,
        }
      : null,
    upgradeRecommendation,
  };

  planStateCache.set(userId, {
    data,
    timestamp: Date.now(),
  });

  return data;
}
