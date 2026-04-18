import { NextRequest, NextResponse } from "next/server";
import { resolveEmailAuthStart } from "@/lib/auth/emailAuth";
import { maskAuthEmail } from "@/lib/auth/email";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

export async function POST(request: NextRequest) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) {
    return originGuard;
  }

  const requestContext = createSecurityRequestContext(request);
  const rateLimit = await enforceRequestRateLimit({
    action: "auth_email_start",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 30,
    context: requestContext,
  });

  if (!rateLimit.ok) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_start",
      outcome: "blocked",
      metadata: {
        reason: "rate_limit",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
    });

    const response = applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: "Muitas tentativas seguidas. Aguarde alguns segundos e tente novamente.",
        },
        { status: 429 },
      ),
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return attachRequestId(response, requestContext.requestId);
  }

  await logSecurityAuditEventSafe(requestContext, {
    action: "auth_email_start",
    outcome: "started",
  });

  try {
    const payload = await request.json().catch(() => ({}));
    const email =
      payload && typeof payload === "object" && typeof payload.email === "string"
        ? payload.email
        : "";
    const start = await resolveEmailAuthStart(email);

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_start",
      outcome: "succeeded",
      metadata: {
        nextStep: start.nextStep,
        hasExistingAccount: Boolean(start.user),
      },
    });

    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          email: start.email,
          maskedEmail: maskAuthEmail(start.email),
          nextStep: start.nextStep,
        }),
      ),
      requestContext.requestId,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nao foi possivel preparar o login por email.";

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_start",
      outcome: "failed",
      metadata: {
        reason: message,
      },
    });

    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message,
          },
          { status: 400 },
        ),
      ),
      requestContext.requestId,
    );
  }
}
