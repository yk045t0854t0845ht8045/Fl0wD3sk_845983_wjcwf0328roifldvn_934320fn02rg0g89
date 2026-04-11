import { NextResponse } from "next/server";

import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { buildAccountPlanUsageSnapshot } from "@/lib/plans/accountPlanUsage";
import { getUserPlanScheduledChange } from "@/lib/plans/change";
import {
  ensureDowngradeEnforcementForUser,
  getDowngradeEnforcementSummaryForUser,
} from "@/lib/plans/downgradeEnforcement";
import { countPlanGuildsForUser, getPlanGuildsForUser } from "@/lib/plans/planGuilds";
import { PLAN_ORDER, resolvePlanPricing, type PlanCode } from "@/lib/plans/catalog";
import {
  getUserPlanState,
  repairOrphanPlanGuildLinkForUser,
} from "@/lib/plans/state";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

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

export async function GET(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      baseRequestContext.requestId,
    );

  try {
    const sessionData = await resolveSessionAccessToken();
    if (!sessionData?.authSession) {
      return respond({ ok: false, message: "Nao autenticado." }, { status: 401 });
    }

    const auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: sessionData.authSession.id,
      userId: sessionData.authSession.user.id,
    });

    const rateLimit = await enforceRequestRateLimit({
      action: "plan_state_get",
      windowMs: 5 * 60 * 1000,
      maxAttempts: 80,
      context: auditContext,
    });

    if (!rateLimit.ok) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "plan_state_get",
        outcome: "blocked",
        metadata: {
          reason: "rate_limit",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
      });

      const response = respond(
        { ok: false, message: "Muitas tentativas. Tente novamente em instantes." },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    const userId = sessionData.authSession.user.id;
    const userPlanState = await getUserPlanState(sessionData.authSession.user.id);
    await repairOrphanPlanGuildLinkForUser({
      userId,
      userPlanState,
      source: "auth_me_plan_state",
    });
    const [licensedServersCount, allPlanGuilds, scheduledChange] = await Promise.all([
      countPlanGuildsForUser(userId),
      getPlanGuildsForUser(userId, { includeInactive: true }),
      getUserPlanScheduledChange(userId),
    ]);
    await ensureDowngradeEnforcementForUser({
      userId,
      userPlanState,
      scheduledChange,
    });
    const downgradeEnforcement = await getDowngradeEnforcementSummaryForUser(userId);
    const usage = buildAccountPlanUsageSnapshot(
      userPlanState,
      licensedServersCount,
    );
    const totalLinkedServersCount = allPlanGuilds.length;
    const requiredServersForRecommendation = downgradeEnforcement
      ? totalLinkedServersCount
      : usage.licensedServersCount;
    const upgradeRecommendation = resolveUpgradeRecommendation({
      currentPlanCode: userPlanState?.plan_code || null,
      requiredServersCount: requiredServersForRecommendation,
    });

    await logSecurityAuditEventSafe(auditContext, {
      action: "plan_state_get",
      outcome: "succeeded",
      metadata: {
        hasPlanState: Boolean(userPlanState),
        planCode: userPlanState?.plan_code || null,
        status: userPlanState?.status || null,
        licensedServersCount: usage.licensedServersCount,
        maxLicensedServers: usage.maxLicensedServers,
        limitReached: usage.hasReachedLicensedServersLimit,
        totalLinkedServersCount,
        hasDowngradeEnforcement: Boolean(downgradeEnforcement),
        downgradeStatus: downgradeEnforcement?.status || null,
      },
    });

    return respond({
      ok: true,
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
    });
  } catch (error) {
    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(error, "Erro ao carregar plano da conta."),
      },
      { status: 500 },
    );
  }
}
