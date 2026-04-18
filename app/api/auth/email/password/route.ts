import { NextRequest, NextResponse } from "next/server";
import {
  authConfig,
  normalizeInternalNextPath,
} from "@/lib/auth/config";
import {
  clearSharedAuthCookie,
  setSharedAuthCookie,
} from "@/lib/auth/cookies";
import {
  authenticateEmailPasswordAndIssueOtp,
  createEmailSession,
} from "@/lib/auth/emailAuth";
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
    const nextPath =
      payload && typeof payload === "object" && typeof payload.next === "string"
        ? normalizeInternalNextPath(payload.next)
        : null;

    const result = await authenticateEmailPasswordAndIssueOtp({
      email,
      password,
      confirmPassword,
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
      trustedDeviceToken:
        request.cookies.get(authConfig.rememberedDeviceCookieName)?.value || null,
    });

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_password",
      outcome: "succeeded",
      metadata: {
        nextStep: result.nextStep,
        passwordStep: result.passwordStep,
      },
    });

    const response = applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        nextStep: result.nextStep,
        passwordStep: result.passwordStep,
        challengeId: "challengeId" in result ? result.challengeId : undefined,
        maskedEmail: result.maskedEmail,
        expiresAt: "expiresAt" in result ? result.expiresAt : undefined,
        resendAvailableAt:
          "resendAvailableAt" in result ? result.resendAvailableAt : undefined,
        redirectTo: result.nextStep === "session" ? nextPath || "/dashboard" : undefined,
      }),
    );

    if (result.clearTrustedDeviceCookie) {
      clearSharedAuthCookie(request, response, authConfig.rememberedDeviceCookieName, {
        httpOnly: true,
        sameSite: "lax",
        priority: "high",
      });
    }

    if (result.nextStep === "session") {
      const session = await createEmailSession({
        userId: result.userId,
        ipAddress: extractClientIp(request),
        userAgent: request.headers.get("user-agent"),
      });

      setSharedAuthCookie(request, response, authConfig.sessionCookieName, session.sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: authConfig.sessionTtlHours * 60 * 60,
        path: "/",
        priority: "high",
      });
    }

    return attachRequestId(response, requestContext.requestId);
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
