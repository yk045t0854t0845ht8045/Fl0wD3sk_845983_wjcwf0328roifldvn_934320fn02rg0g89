import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;


import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { getManagedPlanStateForUser } from "@/lib/account/managedPlanState";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import {
  PLAN_ORDER,
  resolvePlanPricing,
  type PlanCode,
} from "@/lib/plans/catalog";


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

    const data = await getManagedPlanStateForUser(sessionData.authSession.user.id);

    await logSecurityAuditEventSafe(auditContext, {
      action: "plan_state_get",
      outcome: "succeeded",
      metadata: {
        hasPlanState: Boolean(data.plan),
        planCode: data.plan?.planCode || null,
        status: data.plan?.status || null,
        licensedServersCount: data.usage.licensedServersCount,
        maxLicensedServers: data.usage.maxLicensedServers,
        hasDowngradeEnforcement: Boolean(data.downgradeEnforcement),
      },
    });

    return respond({
      ok: true,
      ...data,
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
