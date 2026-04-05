import { NextResponse } from "next/server";

import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { getUserPlanState } from "@/lib/plans/state";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

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

    const userPlanState = await getUserPlanState(sessionData.authSession.user.id);

    await logSecurityAuditEventSafe(auditContext, {
      action: "plan_state_get",
      outcome: "succeeded",
      metadata: {
        hasPlanState: Boolean(userPlanState),
        planCode: userPlanState?.plan_code || null,
        status: userPlanState?.status || null,
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

