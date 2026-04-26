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
import { exchangeCodeForToken, fetchDiscordUser } from "@/lib/auth/discord";
import { createLoginOtpChallenge } from "@/lib/auth/emailOtp";
import {
  clearOAuthTransactionCookies,
  validateOAuthTransactionFromRequest,
} from "@/lib/auth/oauthIdentity";
import {
  buildLoginOtpRedirectLocation,
  buildLoginRedirectResponse,
} from "@/lib/auth/loginFlash";
import { buildAuthOriginRedirectResponse } from "@/lib/auth/requestOrigin";
import {
  createSessionForUser,
  getCurrentAuthSessionFromCookie,
  markAuthUserLastLogin,
  resolveAuthUserForDiscordLogin,
  updateSessionDiscordTokens,
} from "@/lib/auth/session";
import { validateTrustedDevice } from "@/lib/auth/trustedDevice";
import {
  buildCanonicalUrlFromInternalPath,
  getRequestHostname,
  resolveHostRuntimeContext,
} from "@/lib/routing/subdomains";
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
  clearOAuthTransactionCookies(request, response, "discord");
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

function resolveDiscordAuthErrorCode(error: unknown) {
  const message =
    error instanceof Error ? error.message.toLowerCase() : "";

  if (
    message.includes("ja esta vinculada a outra conta") ||
    message.includes("ja esta vinculado a outro discord") ||
    message.includes("email desta conta ja esta vinculado")
  ) {
    return "discord_conflict";
  }

  if (message.includes("email verificado")) {
    return "discord_unverified_email";
  }

  return "discord_auth_failed";
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

function isLocalDiscordAuthRequest(request: NextRequest) {
  return resolveHostRuntimeContext(getRequestHostname(request)).mode === "local";
}

export async function handleDiscordAuthCallback(request: NextRequest) {
  const originRedirectResponse = buildAuthOriginRedirectResponse(request);
  if (originRedirectResponse) {
    return originRedirectResponse;
  }

  const initialRequestContext = createSecurityRequestContext(request);
  const state = request.nextUrl.searchParams.get("state");
  const oauthTransaction = validateOAuthTransactionFromRequest(
    request,
    "discord",
    state,
  );
  const nextPathCookie = normalizeInternalNextPath(oauthTransaction?.nextPath);
  const oauthModeCookie = oauthTransaction?.mode || "login";

  const rateLimit = await enforceRequestRateLimit({
    action: "auth_discord_callback",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 24,
    context: initialRequestContext,
  });

  if (!rateLimit.ok) {
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_discord_callback",
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
    action: "auth_discord_callback",
    outcome: "started",
  });

  const code = request.nextUrl.searchParams.get("code");

  if (!code || !oauthTransaction?.redirectUri) {
    const response = buildLoginRedirectResponse(request, {
      nextPath: nextPathCookie,
      mode: oauthModeCookie,
      error: "discord_invalid_state",
    });
    clearOAuthCookies(request, response);
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_discord_callback",
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
    const tokenPayload = await exchangeCodeForToken({
      code,
      redirectUri: oauthTransaction.redirectUri,
    });

    const discordUser = await fetchDiscordUser(tokenPayload.access_token);
    const discordTokenExpiresAt = new Date(
      Date.now() + tokenPayload.expires_in * 1000,
    ).toISOString();
    const localDiscordAuth = isLocalDiscordAuthRequest(request);
    const user = await resolveAuthUserForDiscordLogin(discordUser, {
      currentUserId: currentSession?.user.id ?? null,
      skipAccountCreatedEmail: localDiscordAuth,
    });
    const successLocation = buildCanonicalUrlFromInternalPath(
      request,
      nextPathCookie || fallbackNextPath,
    );

    if (oauthModeCookie === "link" && currentSession) {
      await updateSessionDiscordTokens(currentSession.id, {
        discordAccessToken: tokenPayload.access_token,
        discordRefreshToken: tokenPayload.refresh_token || null,
        discordTokenExpiresAt,
      });
      await markAuthUserLastLogin(user.id, "discord");

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
        action: "auth_discord_callback",
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

    if (!user.email) {
      throw new Error("Sua conta Discord precisa ter um email verificado para continuar.");
    }

    if (localDiscordAuth) {
      const session = await createSessionForUser(
        user.id,
        {
          ipAddress: extractClientIp(request),
          userAgent: request.headers.get("user-agent"),
        },
        {
          authMethod: "discord",
          discordAccessToken: tokenPayload.access_token,
          discordRefreshToken: tokenPayload.refresh_token || null,
          discordTokenExpiresAt,
        },
        {
          rememberSession: true,
          skipLoginNotification: true,
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
        action: "auth_discord_callback",
        outcome: "succeeded",
        metadata: {
          redirectTo: successLocation,
          oauthMode: oauthModeCookie,
          otpRequired: false,
          localDiscordAuth: true,
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
          authMethod: "discord",
          discordAccessToken: tokenPayload.access_token,
          discordRefreshToken: tokenPayload.refresh_token || null,
          discordTokenExpiresAt,
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
        action: "auth_discord_callback",
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

    const challenge = await createLoginOtpChallenge({
      userId: user.id,
      email: user.email,
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        provider: "discord",
        oauthMode: oauthModeCookie,
        session: {
          authMethod: "discord",
          nextPath: nextPathCookie || fallbackNextPath,
          discordAccessToken: tokenPayload.access_token,
          discordRefreshToken: tokenPayload.refresh_token || null,
          discordTokenExpiresAt,
        },
      },
    });

    const otpLocation = buildLoginOtpRedirectLocation(request, {
      challengeId: challenge.challengeId,
      maskedEmail: challenge.maskedEmail,
      expiresAt: challenge.expiresAt,
      resendAvailableAt: challenge.resendAvailableAt,
      provider: "discord",
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
      action: "auth_discord_callback",
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
      error: resolveDiscordAuthErrorCode(error),
    });
    if (shouldClearTrustedDeviceCookie) {
      clearSharedTrustedDeviceCookie(request, response);
    }
    clearOAuthCookies(request, response);
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_discord_callback",
      outcome: "failed",
      metadata: {
        reason: "oauth_exchange_failed",
        detail: error instanceof Error ? error.message : "unknown_error",
      },
    });
    return attachRequestId(response, initialRequestContext.requestId);
  }
}
