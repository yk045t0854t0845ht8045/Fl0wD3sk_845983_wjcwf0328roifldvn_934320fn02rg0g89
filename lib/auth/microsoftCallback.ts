import { NextRequest, NextResponse } from "next/server";
import {
  authConfig,
  getOAuthModeCookieName,
  getOAuthNextPathCookieName,
  getOAuthRedirectUriCookieName,
  getOAuthStateCookieName,
  isMicrosoftAuthConfigured,
  normalizeInternalNextPath,
} from "@/lib/auth/config";
import {
  clearSharedAuthCookie,
  setSharedAuthCookie,
} from "@/lib/auth/cookies";
import { exchangeMicrosoftCodeForToken, fetchMicrosoftUser } from "@/lib/auth/microsoft";
import { buildLoginHref, type LoginIntentMode } from "@/lib/auth/paths";
import {
  createUserSessionFromMicrosoftUser,
  getCurrentAuthSessionFromCookie,
} from "@/lib/auth/session";
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
  clearSharedAuthCookie(request, response, getOAuthStateCookieName("microsoft"), {
    httpOnly: true,
    sameSite: "lax",
    priority: "high",
  });
  clearSharedAuthCookie(
    request,
    response,
    getOAuthRedirectUriCookieName("microsoft"),
    {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    },
  );
  clearSharedAuthCookie(
    request,
    response,
    getOAuthNextPathCookieName("microsoft"),
    {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    },
  );
  clearSharedAuthCookie(request, response, getOAuthModeCookieName("microsoft"), {
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

function buildLoginRedirectLocation(
  request: NextRequest,
  input: {
    nextPath?: string | null;
    mode?: LoginIntentMode;
    error?: string | null;
  } = {},
) {
  const loginPath = buildLoginHref(input.nextPath, input.mode ?? "login");
  const loginUrl = new URL(
    buildCanonicalUrlFromInternalPath(request, loginPath, {
      fallbackArea: "account",
    }),
  );

  if (input.error) {
    loginUrl.searchParams.set("error", input.error);
  }

  return loginUrl.toString();
}

function resolveMicrosoftAuthErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (
    message.includes("ja esta vinculada a outra conta flowdesk") ||
    message.includes("ja esta vinculada a outra conta microsoft") ||
    message.includes("ja esta vinculado a outra conta microsoft") ||
    message.includes("email desta conta ja esta vinculado a outra conta microsoft")
  ) {
    return "microsoft_conflict";
  }

  if (message.includes("nao retornou um email")) {
    return "microsoft_missing_email";
  }

  if (message.includes("nao esta configurado")) {
    return "microsoft_not_configured";
  }

  return "microsoft_auth_failed";
}

export async function handleMicrosoftAuthCallback(request: NextRequest) {
  const initialRequestContext = createSecurityRequestContext(request);
  const nextPathCookie = normalizeInternalNextPath(
    request.cookies.get(getOAuthNextPathCookieName("microsoft"))?.value,
  );
  const oauthModeCookie =
    request.cookies.get(getOAuthModeCookieName("microsoft"))?.value === "link"
      ? "link"
      : "login";

  const rateLimit = await enforceRequestRateLimit({
    action: "auth_microsoft_callback",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 24,
    context: initialRequestContext,
  });

  if (!rateLimit.ok) {
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_microsoft_callback",
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
    clearOAuthCookies(request, response);
    return attachRequestId(response, initialRequestContext.requestId);
  }

  await logSecurityAuditEventSafe(initialRequestContext, {
    action: "auth_microsoft_callback",
    outcome: "started",
  });

  if (!isMicrosoftAuthConfigured()) {
    const response = redirectWithLocation(
      buildLoginRedirectLocation(request, {
        nextPath: nextPathCookie,
        mode: oauthModeCookie,
        error: "microsoft_not_configured",
      }),
    );
    clearOAuthCookies(request, response);
    return attachRequestId(response, initialRequestContext.requestId);
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const stateCookie = request.cookies.get(getOAuthStateCookieName("microsoft"))?.value;
  const redirectUriCookie = request.cookies.get(
    getOAuthRedirectUriCookieName("microsoft"),
  )?.value;

  if (!code || !state || !stateCookie || !redirectUriCookie || state !== stateCookie) {
    const response = redirectWithLocation(
      buildLoginRedirectLocation(request, {
        nextPath: nextPathCookie,
        mode: oauthModeCookie,
        error: "microsoft_invalid_state",
      }),
    );
    clearOAuthCookies(request, response);
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_microsoft_callback",
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
    const tokenPayload = await exchangeMicrosoftCodeForToken({
      code,
      redirectUri: redirectUriCookie,
    });
    const microsoftUser = await fetchMicrosoftUser(tokenPayload.access_token!);
    const { user, session } = await createUserSessionFromMicrosoftUser(
      microsoftUser,
      {
        ipAddress: extractClientIp(request),
        userAgent: request.headers.get("user-agent"),
      },
      {
        currentUserId: currentSession?.user.id ?? null,
      },
    );

    const successLocation = buildCanonicalUrlFromInternalPath(
      request,
      nextPathCookie || "/dashboard",
    );
    const response = redirectWithLocation(successLocation);

    setSharedAuthCookie(request, response, authConfig.sessionCookieName, session.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: authConfig.sessionTtlHours * 60 * 60,
      path: "/",
      priority: "high",
    });

    clearOAuthCookies(request, response);
    const authenticatedContext = extendSecurityRequestContext(
      initialRequestContext,
      {
        userId: user.id,
      },
    );
    await logSecurityAuditEventSafe(authenticatedContext, {
      action: "auth_microsoft_callback",
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
        error: resolveMicrosoftAuthErrorCode(error),
      }),
    );
    clearOAuthCookies(request, response);
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_microsoft_callback",
      outcome: "failed",
      metadata: {
        reason: "oauth_exchange_failed",
        detail: error instanceof Error ? error.message : "unknown_error",
      },
    });
    return attachRequestId(response, initialRequestContext.requestId);
  }
}
