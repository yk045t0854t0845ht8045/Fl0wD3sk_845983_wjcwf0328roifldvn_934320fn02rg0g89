import { NextRequest, NextResponse } from "next/server";
import { authenticateEmailPasswordAndIssueOtp } from "@/lib/auth/emailAuth";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

function extractClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return null;
  return forwardedFor.split(",")[0]?.trim() || null;
}

export async function POST(request: NextRequest) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) {
    return originGuard;
  }

  const requestContext = createSecurityRequestContext(request);
  const rateLimit = await enforceRequestRateLimit({
    action: "auth_email_password",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 18,
    context: requestContext,
  });

  if (!rateLimit.ok) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_password",
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
    action: "auth_email_password",
    outcome: "started",
  });

  try {
    const payload = await request.json().catch(() => ({}));
    const email =
      payload && typeof payload === "object" && typeof payload.email === "string"
        ? payload.email
        : "";
    const password =
      payload && typeof payload === "object" && typeof payload.password === "string"
        ? payload.password
        : "";
    const confirmPassword =
      payload &&
      typeof payload === "object" &&
      typeof payload.confirmPassword === "string"
        ? payload.confirmPassword
        : null;

    const result = await authenticateEmailPasswordAndIssueOtp({
      email,
      password,
      confirmPassword,
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_password",
      outcome: "succeeded",
      metadata: {
        nextStep: result.nextStep,
        passwordStep: result.passwordStep,
      },
    });

    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          nextStep: result.nextStep,
          passwordStep: result.passwordStep,
          challengeId: result.challengeId,
          maskedEmail: result.maskedEmail,
          expiresAt: result.expiresAt,
          resendAvailableAt: result.resendAvailableAt,
        }),
      ),
      requestContext.requestId,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nao foi possivel validar a senha agora.";

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_password",
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
