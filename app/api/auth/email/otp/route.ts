import { NextRequest, NextResponse } from "next/server";
import {
  normalizeInternalNextPath,
} from "@/lib/auth/config";
import {
  setSharedSessionCookie,
  setSharedTrustedDeviceCookie,
} from "@/lib/auth/cookies";
import { verifyEmailLoginOtp } from "@/lib/auth/emailAuth";
import { EmailOtpError } from "@/lib/auth/emailOtp";
import { createSessionForUser } from "@/lib/auth/session";
import { issueTrustedDevice } from "@/lib/auth/trustedDevice";
import {
  flowSecureDto,
  FlowSecureDtoError,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
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
    const payload = parseFlowSecureDto(
      await request.json().catch(() => ({})),
      {
        challengeId: flowSecureDto.string({
          maxLength: 120,
        }),
        code: flowSecureDto.string({
          maxLength: 16,
        }),
        next: flowSecureDto.optional(
          flowSecureDto.string({
            maxLength: 2048,
          }),
        ),
        rememberSession: flowSecureDto.optional(
          flowSecureDto.boolean({
            defaultValue: false,
          }),
        ),
      },
      {
        rejectUnknown: true,
      },
    );
    const challengeId = payload.challengeId;
    const code = payload.code;
    const nextPath = payload.next ? normalizeInternalNextPath(payload.next) : null;
    const rememberSession = payload.rememberSession ?? false;

    const verification = await verifyEmailLoginOtp(challengeId, code);
    const authenticatedContext = extendSecurityRequestContext(requestContext, {
      userId: verification.userId,
    });
    const sessionContext = verification.sessionContext;
    const redirectTo =
      nextPath || sessionContext?.nextPath || "/dashboard";
    const session = await createSessionForUser(
      verification.userId,
      {
        ipAddress: extractClientIp(request),
        userAgent: request.headers.get("user-agent"),
      },
      {
        authMethod: sessionContext?.authMethod || "email",
        discordAccessToken: sessionContext?.discordAccessToken ?? null,
        discordRefreshToken: sessionContext?.discordRefreshToken ?? null,
        discordTokenExpiresAt: sessionContext?.discordTokenExpiresAt ?? null,
      },
      {
        rememberSession,
      },
    );
    const response = applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        redirectTo,
      }),
    );

    setSharedSessionCookie(request, response, session.sessionToken, {
      maxAge: session.maxAgeSeconds,
    });

    if (rememberSession) {
      const trustedDevice = await issueTrustedDevice({
        userId: verification.userId,
        userAgent: request.headers.get("user-agent"),
      });

      setSharedTrustedDeviceCookie(request, response, trustedDevice.token);
    }

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
      error instanceof FlowSecureDtoError
        ? error.issues[0] || error.message
        : error instanceof Error
          ? error.message
          : "Nao foi possivel validar o codigo.";
    const statusCode =
      error instanceof FlowSecureDtoError
        ? error.statusCode
        : error instanceof EmailOtpError
          ? error.statusCode
          : 400;
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
