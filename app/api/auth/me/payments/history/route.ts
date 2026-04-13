import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { getManagedHistoryForUser } from "@/lib/account/managedHistory";




export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      requestContext.requestId,
    );

  try {
    const sessionData = await resolveSessionAccessToken();
    if (!sessionData?.authSession) {
      return respond(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      );
    }

    const auditContext = extendSecurityRequestContext(requestContext, {
      sessionId: sessionData.authSession.id,
      userId: sessionData.authSession.user.id,
    });

    const rateLimit = await enforceRequestRateLimit({
      action: "payment_history_read",
      windowMs: 5 * 60 * 1000,
      maxAttempts: 100,
      context: auditContext,
    });

    if (!rateLimit.ok) {
      const response = respond(
        { ok: false, message: "Muitas consultas. Tente novamente em instantes." },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    const history = await getManagedHistoryForUser(sessionData.authSession.user.id);

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_history_read",
      outcome: "succeeded",
      metadata: {
        orderCount: history.orders.length,
        methodCount: history.methods.length,
      },
    });

    return respond({
      ok: true,
      orders: history.orders,
      methods: history.methods,
    });
  } catch (error) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "payment_history_read",
      outcome: "failed",
      metadata: {
        message: extractAuditErrorMessage(error),
      },
    });

    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao carregar historico de pagamentos.",
        ),
      },
      { status: 500 },
    );
  }
}

