import { NextRequest, NextResponse } from "next/server";
import {
  authConfig,
  isSecureRequest,
  normalizeInternalNextPath,
} from "@/lib/auth/config";
import { createEmailSession, verifyEmailLoginOtp } from "@/lib/auth/emailAuth";
import { EmailOtpError } from "@/lib/auth/emailOtp";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
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
    action: "auth_email_otp_verify",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 30,
    context: requestContext,
  });

  if (!rateLimit.ok) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_otp_verify",
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
          message: "Muitas tentativas de verificacao. Aguarde alguns segundos.",
        },
        { status: 429 },
      ),
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return attachRequestId(response, requestContext.requestId);
  }

  await logSecurityAuditEventSafe(requestContext, {
    action: "auth_email_otp_verify",
    outcome: "started",
  });

  try {
    const payload = await request.json().catch(() => ({}));
    const challengeId =
      payload && typeof payload === "object" && typeof payload.challengeId === "string"
        ? payload.challengeId.trim()
        : "";
    const code =
      payload && typeof payload === "object" && typeof payload.code === "string"
        ? payload.code
        : "";
    const nextPath =
      payload && typeof payload === "object" && typeof payload.next === "string"
        ? normalizeInternalNextPath(payload.next)
        : null;

    const verification = await verifyEmailLoginOtp(challengeId, code);
    const authenticatedContext = extendSecurityRequestContext(requestContext, {
      userId: verification.userId,
    });
    const session = await createEmailSession({
      userId: verification.userId,
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    const redirectTo = nextPath || "/dashboard";
    const response = applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        redirectTo,
      }),
    );

    response.cookies.set(authConfig.sessionCookieName, session.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      maxAge: authConfig.sessionTtlHours * 60 * 60,
      path: "/",
      priority: "high",
    });

    await logSecurityAuditEventSafe(authenticatedContext, {
      action: "auth_email_otp_verify",
      outcome: "succeeded",
      metadata: {
        redirectTo,
      },
    });

    return attachRequestId(response, authenticatedContext.requestId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nao foi possivel validar o codigo.";
    const statusCode = error instanceof EmailOtpError ? error.statusCode : 400;
    const retryAfterSeconds =
      error instanceof EmailOtpError ? error.retryAfterSeconds : null;

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_otp_verify",
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
