import { NextRequest, NextResponse } from "next/server";
import {
  authConfig,
  normalizeInternalNextPath,
} from "@/lib/auth/config";
import {
  clearSharedTrustedDeviceCookie,
  getSharedAuthCookieProofName,
  setSharedSessionCookie,
} from "@/lib/auth/cookies";
import { normalizeAuthEmail } from "@/lib/auth/email";
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

const LOCAL_PASSWORD_COOLDOWN_MAX_KEYS = 2000;
const LOCAL_PASSWORD_COOLDOWN_BASE_MS = 1500;
const LOCAL_PASSWORD_COOLDOWN_MAX_MS = 15000;
const LOCAL_PASSWORD_FAILURE_RESET_WINDOW_MS = 45_000;

type LocalPasswordCooldownEntry = {
  cooldownUntilMs: number;
  failureCount: number;
  lastFailureAtMs: number;
};

const localPasswordCooldownByKey = new Map<string, LocalPasswordCooldownEntry>();

function extractClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return null;
  return forwardedFor.split(",")[0]?.trim() || null;
}

function resolveLocalPasswordCooldownKey(
  requestContext: ReturnType<typeof createSecurityRequestContext>,
  email: string,
) {
  const actorKey = requestContext.sessionId
    ? `session:${requestContext.sessionId}`
    : requestContext.ipFingerprint
      ? `ip:${requestContext.ipFingerprint}`
      : typeof requestContext.userId === "number"
        ? `user:${requestContext.userId}`
        : "anonymous";

  return `${actorKey}:email:${email || "unknown"}`;
}

function pruneLocalPasswordCooldownMapIfNeeded() {
  if (localPasswordCooldownByKey.size > LOCAL_PASSWORD_COOLDOWN_MAX_KEYS) {
    localPasswordCooldownByKey.clear();
  }
}

function resolveActiveLocalPasswordCooldownSeconds(key: string | null) {
  if (!key) return 0;

  const entry = localPasswordCooldownByKey.get(key);
  if (!entry) return 0;

  const remainingMs = entry.cooldownUntilMs - Date.now();
  if (remainingMs <= 0) {
    localPasswordCooldownByKey.delete(key);
    return 0;
  }

  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function recordLocalPasswordFailure(key: string | null, retryAfterSeconds?: number) {
  if (!key) return;

  const now = Date.now();
  const current = localPasswordCooldownByKey.get(key);
  const shouldReset =
    !current ||
    now - current.lastFailureAtMs > LOCAL_PASSWORD_FAILURE_RESET_WINDOW_MS;
  const failureCount = shouldReset ? 1 : current.failureCount + 1;
  const cooldownMs = retryAfterSeconds
    ? retryAfterSeconds * 1000
    : Math.min(
        LOCAL_PASSWORD_COOLDOWN_MAX_MS,
        LOCAL_PASSWORD_COOLDOWN_BASE_MS * 2 ** Math.max(0, failureCount - 1),
      );

  localPasswordCooldownByKey.set(key, {
    cooldownUntilMs: now + cooldownMs,
    failureCount,
    lastFailureAtMs: now,
  });
}

function clearLocalPasswordFailure(key: string | null) {
  if (!key) return;
  localPasswordCooldownByKey.delete(key);
}

export async function POST(request: NextRequest) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) {
    return originGuard;
  }

  const requestContext = createSecurityRequestContext(request);
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
  const normalizedEmail = normalizeAuthEmail(email) || email.trim().toLowerCase();

  pruneLocalPasswordCooldownMapIfNeeded();
  const localCooldownKey = resolveLocalPasswordCooldownKey(
    requestContext,
    normalizedEmail,
  );
  const localRetryAfterSeconds =
    resolveActiveLocalPasswordCooldownSeconds(localCooldownKey);

  if (localRetryAfterSeconds > 0) {
    const response = applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: "Aguarde alguns segundos antes de tentar a senha novamente.",
        },
        { status: 429 },
      ),
    );
    response.headers.set("Retry-After", String(localRetryAfterSeconds));
    return attachRequestId(response, requestContext.requestId);
  }

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
    recordLocalPasswordFailure(localCooldownKey, rateLimit.retryAfterSeconds);
    return attachRequestId(response, requestContext.requestId);
  }

  await logSecurityAuditEventSafe(requestContext, {
    action: "auth_email_password",
    outcome: "started",
  });

  try {
    const result = await authenticateEmailPasswordAndIssueOtp({
      email,
      password,
      confirmPassword,
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
      trustedDeviceToken:
        request.cookies.get(authConfig.rememberedDeviceCookieName)?.value || null,
      trustedDeviceProof:
        request.cookies.get(
          getSharedAuthCookieProofName(authConfig.rememberedDeviceCookieName),
        )?.value || null,
    });

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_email_password",
      outcome: "succeeded",
      metadata: {
        nextStep: result.nextStep,
        passwordStep: result.passwordStep,
      },
    });
    clearLocalPasswordFailure(localCooldownKey);

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
      clearSharedTrustedDeviceCookie(request, response);
    }

    if (result.nextStep === "session") {
      const session = await createEmailSession({
        userId: result.userId,
        ipAddress: extractClientIp(request),
        userAgent: request.headers.get("user-agent"),
        rememberSession: result.rememberSession,
      });

      setSharedSessionCookie(request, response, session.sessionToken, {
        maxAge: session.maxAgeSeconds,
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

    recordLocalPasswordFailure(localCooldownKey);

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
