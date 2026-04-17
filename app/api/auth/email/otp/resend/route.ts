import { NextRequest, NextResponse } from "next/server";
import { resendEmailLoginOtp } from "@/lib/auth/emailAuth";
import { EmailOtpError } from "@/lib/auth/emailOtp";
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
    action: "auth_email_otp_resend",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 12,
    context: requestContext,
  });

  if (!rateLimit.ok) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_otp_resend",
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
          message: "Muitos reenvios seguidos. Aguarde alguns segundos.",
        },
        { status: 429 },
      ),
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return attachRequestId(response, requestContext.requestId);
  }

  await logSecurityAuditEventSafe(requestContext, {
    action: "auth_email_otp_resend",
    outcome: "started",
  });

  try {
    const payload = await request.json().catch(() => ({}));
    const challengeId =
      payload && typeof payload === "object" && typeof payload.challengeId === "string"
        ? payload.challengeId.trim()
        : "";

    const result = await resendEmailLoginOtp(challengeId);

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_otp_resend",
      outcome: "succeeded",
    });

    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
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
      error instanceof Error ? error.message : "Nao foi possivel reenviar o codigo.";
    const statusCode = error instanceof EmailOtpError ? error.statusCode : 400;
    const retryAfterSeconds =
      error instanceof EmailOtpError ? error.retryAfterSeconds : null;

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_otp_resend",
      outcome: statusCode === 429 ? "blocked" : "failed",
      metadata: {
        reason: message,
      },
    });

    const response = applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message,
        },
        { status: statusCode },
      ),
    );

    if (retryAfterSeconds) {
      response.headers.set("Retry-After", String(retryAfterSeconds));
    }

    return attachRequestId(response, requestContext.requestId);
  }
}
