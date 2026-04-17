import { NextRequest, NextResponse } from "next/server";
import {
  authConfig,
  isSecureRequest,
  normalizeInternalNextPath,
} from "@/lib/auth/config";
import { exchangeCodeForToken, fetchDiscordUser } from "@/lib/auth/discord";
import { buildLoginHref, type LoginIntentMode } from "@/lib/auth/paths";
import {
  createUserSessionFromDiscordUser,
  getCurrentAuthSessionFromCookie,
} from "@/lib/auth/session";
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

function clearOAuthCookies(response: NextResponse) {
  response.cookies.delete(authConfig.oauthStateCookieName);
  response.cookies.delete(authConfig.oauthRedirectUriCookieName);
  response.cookies.delete(authConfig.oauthNextPathCookieName);
  response.cookies.delete(authConfig.oauthModeCookieName);
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

function buildLoginRedirectLocation(
  request: NextRequest,
  input: {
    nextPath?: string | null;
    mode?: LoginIntentMode;
    error?: string | null;
  } = {},
) {
  const loginUrl = new URL(
    buildLoginHref(input.nextPath, input.mode ?? "login"),
    request.url,
  );

  if (input.error) {
    loginUrl.searchParams.set("error", input.error);
  }

  return loginUrl.toString();
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

  return "discord_auth_failed";
}

export async function handleDiscordAuthCallback(request: NextRequest) {
  const initialRequestContext = createSecurityRequestContext(request);
  const nextPathCookie = normalizeInternalNextPath(
    request.cookies.get(authConfig.oauthNextPathCookieName)?.value,
  );
  const oauthModeCookie =
    request.cookies.get(authConfig.oauthModeCookieName)?.value === "link"
      ? "link"
      : "login";

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

    const response = redirectWithLocation(
      buildLoginRedirectLocation(request, {
        nextPath: nextPathCookie,
        mode: oauthModeCookie,
        error: "slow_down",
      }),
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    clearOAuthCookies(response);
    return attachRequestId(response, initialRequestContext.requestId);
  }

  await logSecurityAuditEventSafe(initialRequestContext, {
    action: "auth_discord_callback",
    outcome: "started",
  });

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const stateCookie = request.cookies.get(authConfig.oauthStateCookieName)?.value;
  const redirectUriCookie = request.cookies.get(
    authConfig.oauthRedirectUriCookieName,
  )?.value;

  if (!code || !state || !stateCookie || !redirectUriCookie || state !== stateCookie) {
    const response = redirectWithLocation(
      buildLoginRedirectLocation(request, {
        nextPath: nextPathCookie,
        mode: oauthModeCookie,
        error: "discord_invalid_state",
      }),
    );
    clearOAuthCookies(response);
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_discord_callback",
      outcome: "failed",
      metadata: {
        reason: "invalid_oauth_state_or_code",
      },
    });
    return attachRequestId(response, initialRequestContext.requestId);
  }

  try {
    const currentSession =
      oauthModeCookie === "link"
        ? await getCurrentAuthSessionFromCookie()
        : null;
    const tokenPayload = await exchangeCodeForToken({
      code,
      redirectUri: redirectUriCookie,
    });

    const discordUser = await fetchDiscordUser(tokenPayload.access_token);
    const discordTokenExpiresAt = new Date(
      Date.now() + tokenPayload.expires_in * 1000,
    ).toISOString();

    const { user, session } = await createUserSessionFromDiscordUser(
      discordUser,
      {
        ipAddress: extractClientIp(request),
        userAgent: request.headers.get("user-agent"),
      },
      {
        discordAccessToken: tokenPayload.access_token,
        discordRefreshToken: tokenPayload.refresh_token || null,
        discordTokenExpiresAt,
      },
      {
        currentUserId: currentSession?.user.id ?? null,
      },
    );

    const successLocation = nextPathCookie
      ? `${request.nextUrl.origin}${nextPathCookie}`
      : `${request.nextUrl.origin}/dashboard`;
    const response = redirectWithLocation(successLocation);

    response.cookies.set(authConfig.sessionCookieName, session.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      maxAge: authConfig.sessionTtlHours * 60 * 60,
      path: "/",
      priority: "high",
    });

    clearOAuthCookies(response);
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
      },
    });
    return attachRequestId(response, initialRequestContext.requestId);
  } catch (error) {
    const response = redirectWithLocation(
      buildLoginRedirectLocation(request, {
        nextPath: nextPathCookie,
        mode: oauthModeCookie,
        error: resolveDiscordAuthErrorCode(error),
      }),
    );
    clearOAuthCookies(response);
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
