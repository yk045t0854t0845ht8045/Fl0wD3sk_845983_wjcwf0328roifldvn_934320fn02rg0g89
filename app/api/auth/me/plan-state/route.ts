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

function isLocalDevRuntime() {
  return process.env.NODE_ENV !== "production";
}

function isLocalRecoverablePlanError(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("relation") ||
    message.includes("does not exist") ||
    message.includes("mercado pago") ||
    message.includes("provider") ||
    message.includes("checkout")
  );
}

function buildLocalPlanFallback(message: string) {
  return {
    ok: true,
    plan: null,
    usage: {
      licensedServersCount: 0,
      maxLicensedServers: 0,
      remainingLicensedServers: 0,
      hasReachedLicensedServersLimit: false,
      canAddMoreServers: true,
    },
    totalLinkedServersCount: 0,
    isBasicAvailable: true,
    downgradeEnforcement: null,
    upgradeRecommendation: null,
    localFallback: true,
    message,
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

    try {
      await ensureUserPaymentDeliveryReady({
        userId: sessionData.authSession.user.id,
        source: "plan_state_get",
      });
    } catch (error) {
      if (!isLocalDevRuntime() || !isLocalRecoverablePlanError(error)) {
        throw error;
      }
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
    if (isLocalDevRuntime() && isLocalRecoverablePlanError(error)) {
      return respond(
        buildLocalPlanFallback(
          sanitizeErrorMessage(error, "Plano local indisponivel; usando fallback de desenvolvimento."),
        ),
      );
    }

    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(error, "Erro ao carregar plano da conta."),
      },
      { status: 500 },
    );
  }
}
