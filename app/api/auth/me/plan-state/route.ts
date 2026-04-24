import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;


import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { getManagedPlanStateForUser } from "@/lib/account/managedPlanState";
import { ensureUserPaymentDeliveryReady } from "@/lib/payments/paymentReadiness";
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

    await ensureUserPaymentDeliveryReady({
      userId: sessionData.authSession.user.id,
      source: "plan_state_get",
    });

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
