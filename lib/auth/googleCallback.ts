import { NextRequest, NextResponse } from "next/server";
import {
  authConfig,
  getOAuthModeCookieName,
  getOAuthNextPathCookieName,
  getOAuthRedirectUriCookieName,
  getOAuthStateCookieName,
  isGoogleAuthConfigured,
  normalizeInternalNextPath,
} from "@/lib/auth/config";
import {
  clearSharedAuthCookie,
  clearSharedTrustedDeviceCookie,
  getSharedAuthCookieProofName,
  setSharedSessionCookie,
} from "@/lib/auth/cookies";
import { createLoginOtpChallenge } from "@/lib/auth/emailOtp";
import { exchangeGoogleCodeForToken, fetchGoogleUser } from "@/lib/auth/google";
import {
  buildLoginOtpRedirectLocation,
  buildLoginRedirectResponse,
} from "@/lib/auth/loginFlash";
import { buildAuthOriginRedirectResponse } from "@/lib/auth/requestOrigin";
import {
  createSessionForUser,
  getCurrentAuthSessionFromCookie,
  markAuthUserLastLogin,
  resolveAuthUserForGoogleLogin,
} from "@/lib/auth/session";
import { validateTrustedDevice } from "@/lib/auth/trustedDevice";
import { buildCanonicalUrlFromInternalPath } from "@/lib/routing/subdomains";
import { applyNoStoreHeaders } from "@/lib/security/http";
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

function clearOAuthCookies(request: NextRequest, response: NextResponse) {
  clearSharedAuthCookie(request, response, getOAuthStateCookieName("google"), {
    httpOnly: true,
    sameSite: "lax",
    priority: "high",
  });
  clearSharedAuthCookie(
    request,
    response,
    getOAuthRedirectUriCookieName("google"),
    {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    },
  );
  clearSharedAuthCookie(
    request,
    response,
    getOAuthNextPathCookieName("google"),
    {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    },
  );
  clearSharedAuthCookie(request, response, getOAuthModeCookieName("google"), {
    httpOnly: true,
    sameSite: "lax",
    priority: "high",
  });
}

function redirectWithLocation(location: string) {
  return applyNoStoreHeaders(
    new NextResponse(null, {
      status: 302,
      headers: {
        Location: location,
      },
    }),
  );
}

function resolveGoogleAuthErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (
    message.includes("ja esta vinculada a outra conta flowdesk") ||
    message.includes("ja esta vinculada a outra conta google") ||
    message.includes("ja esta vinculado a outra conta google") ||
    message.includes("email desta conta ja esta vinculado a outra conta google")
  ) {
    return "google_conflict";
  }

  if (message.includes("email verificado")) {
    return "google_unverified_email";
  }

  if (message.includes("nao esta configurado")) {
    return "google_not_configured";
  }

  return "google_auth_failed";
}

function readTrustedDeviceCookies(request: NextRequest) {
  return {
    token: request.cookies.get(authConfig.rememberedDeviceCookieName)?.value || null,
    tokenProof:
      request.cookies.get(
        getSharedAuthCookieProofName(authConfig.rememberedDeviceCookieName),
      )?.value || null,
  };
}

export async function handleGoogleAuthCallback(request: NextRequest) {
  const originRedirectResponse = buildAuthOriginRedirectResponse(request);
  if (originRedirectResponse) {
    return originRedirectResponse;
  }

  const initialRequestContext = createSecurityRequestContext(request);
  const nextPathCookie = normalizeInternalNextPath(
    request.cookies.get(getOAuthNextPathCookieName("google"))?.value,
  );
  const oauthModeCookie =
    request.cookies.get(getOAuthModeCookieName("google"))?.value === "link"
      ? "link"
      : "login";

  const rateLimit = await enforceRequestRateLimit({
    action: "auth_google_callback",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 24,
    context: initialRequestContext,
  });

  if (!rateLimit.ok) {
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_google_callback",
      outcome: "blocked",
      metadata: {
        reason: "rate_limit",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
    });

    const response = buildLoginRedirectResponse(request, {
      nextPath: nextPathCookie,
      mode: oauthModeCookie,
      error: "slow_down",
    });
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    clearOAuthCookies(request, response);
    return attachRequestId(response, initialRequestContext.requestId);
  }

  await logSecurityAuditEventSafe(initialRequestContext, {
    action: "auth_google_callback",
    outcome: "started",
  });

  if (!isGoogleAuthConfigured()) {
    const response = buildLoginRedirectResponse(request, {
      nextPath: nextPathCookie,
      mode: oauthModeCookie,
      error: "google_not_configured",
    });
    clearOAuthCookies(request, response);
    return attachRequestId(response, initialRequestContext.requestId);
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const stateCookie = request.cookies.get(getOAuthStateCookieName("google"))?.value;
  const redirectUriCookie = request.cookies.get(
    getOAuthRedirectUriCookieName("google"),
  )?.value;

  if (!code || !state || !stateCookie || !redirectUriCookie || state !== stateCookie) {
    const response = buildLoginRedirectResponse(request, {
      nextPath: nextPathCookie,
      mode: oauthModeCookie,
      error: "google_invalid_state",
    });
    clearOAuthCookies(request, response);
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_google_callback",
      outcome: "failed",
      metadata: {
        reason: "invalid_oauth_state_or_code",
      },
    });
    return attachRequestId(response, initialRequestContext.requestId);
  }

  let shouldClearTrustedDeviceCookie = false;

  try {
    const fallbackNextPath = oauthModeCookie === "link" ? "/servers" : "/dashboard";
    const currentSession =
      oauthModeCookie === "link"
        ? await getCurrentAuthSessionFromCookie()
        : null;
    const tokenPayload = await exchangeGoogleCodeForToken({
      code,
      redirectUri: redirectUriCookie,
    });
    const googleUser = await fetchGoogleUser(tokenPayload.access_token);
    const user = await resolveAuthUserForGoogleLogin(googleUser, {
      currentUserId: currentSession?.user.id ?? null,
    });
    const successLocation = buildCanonicalUrlFromInternalPath(
      request,
      nextPathCookie || fallbackNextPath,
    );

    if (oauthModeCookie === "link" && currentSession) {
      await markAuthUserLastLogin(user.id, "google");

      const response = redirectWithLocation(successLocation);
      clearOAuthCookies(request, response);

      const authenticatedContext = extendSecurityRequestContext(
        initialRequestContext,
        {
          userId: user.id,
          sessionId: currentSession.id,
        },
      );

      await logSecurityAuditEventSafe(authenticatedContext, {
        action: "auth_google_callback",
        outcome: "succeeded",
        metadata: {
          redirectTo: successLocation,
          oauthMode: oauthModeCookie,
          otpRequired: false,
          reusedSession: true,
        },
      });

      return attachRequestId(response, initialRequestContext.requestId);
    }

    const rememberedDevice = await validateTrustedDevice({
      userId: user.id,
      userAgent: request.headers.get("user-agent"),
      ...readTrustedDeviceCookies(request),
    });
    shouldClearTrustedDeviceCookie = rememberedDevice.shouldClearCookie;

    if (rememberedDevice.ok) {
      const session = await createSessionForUser(
        user.id,
        {
          ipAddress: extractClientIp(request),
          userAgent: request.headers.get("user-agent"),
        },
        {
          authMethod: "google",
          discordAccessToken: null,
          discordRefreshToken: null,
          discordTokenExpiresAt: null,
        },
        {
          rememberSession: true,
        },
      );

      const response = redirectWithLocation(successLocation);
      setSharedSessionCookie(request, response, session.sessionToken, {
        maxAge: session.maxAgeSeconds,
      });
      clearOAuthCookies(request, response);

      const authenticatedContext = extendSecurityRequestContext(
        initialRequestContext,
        {
          userId: user.id,
        },
      );

      await logSecurityAuditEventSafe(authenticatedContext, {
        action: "auth_google_callback",
        outcome: "succeeded",
        metadata: {
          redirectTo: successLocation,
          oauthMode: oauthModeCookie,
          otpRequired: false,
          rememberedDevice: true,
        },
      });

      return attachRequestId(response, initialRequestContext.requestId);
    }

    if (!user.email) {
      throw new Error("Sua conta Google precisa retornar um email verificado para continuar.");
    }

    const challenge = await createLoginOtpChallenge({
      userId: user.id,
      email: user.email,
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        provider: "google",
        oauthMode: oauthModeCookie,
        session: {
          authMethod: "google",
          nextPath: nextPathCookie || fallbackNextPath,
          discordAccessToken: null,
          discordRefreshToken: null,
          discordTokenExpiresAt: null,
        },
      },
    });

    const otpLocation = buildLoginOtpRedirectLocation(request, {
      challengeId: challenge.challengeId,
      maskedEmail: challenge.maskedEmail,
      expiresAt: challenge.expiresAt,
      resendAvailableAt: challenge.resendAvailableAt,
      provider: "google",
      nextPath: nextPathCookie || fallbackNextPath,
    });
    const response = redirectWithLocation(otpLocation);

    if (shouldClearTrustedDeviceCookie) {
      clearSharedTrustedDeviceCookie(request, response);
    }

    clearOAuthCookies(request, response);

    const authenticatedContext = extendSecurityRequestContext(
      initialRequestContext,
      {
        userId: user.id,
      },
    );

    await logSecurityAuditEventSafe(authenticatedContext, {
      action: "auth_google_callback",
      outcome: "succeeded",
      metadata: {
        redirectTo: otpLocation,
        oauthMode: oauthModeCookie,
        otpRequired: true,
        rememberedDevice: false,
      },
    });

    return attachRequestId(response, initialRequestContext.requestId);
  } catch (error) {
    const response = buildLoginRedirectResponse(request, {
      nextPath: nextPathCookie,
      mode: oauthModeCookie,
      error: resolveGoogleAuthErrorCode(error),
    });
    if (shouldClearTrustedDeviceCookie) {
      clearSharedTrustedDeviceCookie(request, response);
    }
    clearOAuthCookies(request, response);
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_google_callback",
      outcome: "failed",
      metadata: {
        reason: "oauth_exchange_failed",
        detail: error instanceof Error ? error.message : "unknown_error",
      },
    });
    return attachRequestId(response, initialRequestContext.requestId);
  }
}
