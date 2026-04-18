import { NextRequest, NextResponse } from "next/server";
import {
  getOAuthModeCookieName,
  getOAuthNextPathCookieName,
  getOAuthRedirectUriCookieName,
  getOAuthStateCookieName,
  isMicrosoftAuthConfigured,
  normalizeInternalNextPath,
  resolveMicrosoftRedirectUri,
} from "@/lib/auth/config";
import {
  clearSharedAuthCookie,
  setSharedAuthCookie,
} from "@/lib/auth/cookies";
import { isLikelyEmbeddedAuthBrowser } from "@/lib/auth/oauthBrowser";
import { buildLoginHref } from "@/lib/auth/paths";
import { buildMicrosoftAuthorizeUrl } from "@/lib/auth/microsoft";
import { createOAuthState } from "@/lib/auth/session";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

export async function GET(request: NextRequest) {
  const requestContext = createSecurityRequestContext(request);
  const rateLimit = await enforceRequestRateLimit({
    action: "auth_microsoft_start",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 18,
    context: requestContext,
  });

  if (!rateLimit.ok) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_microsoft_start",
      outcome: "blocked",
      metadata: {
        reason: "rate_limit",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
    });

    const response = applyNoStoreHeaders(
      NextResponse.redirect(new URL("/login?error=slow_down", request.url), 302),
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return attachRequestId(response, requestContext.requestId);
  }

  await logSecurityAuditEventSafe(requestContext, {
    action: "auth_microsoft_start",
    outcome: "started",
  });

  const requestedNextPath = normalizeInternalNextPath(
    request.nextUrl.searchParams.get("next"),
  );
  const requestedMode =
    request.nextUrl.searchParams.get("mode") === "link" ? "link" : "login";

  if (isLikelyEmbeddedAuthBrowser(request.headers.get("user-agent"))) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_microsoft_start",
      outcome: "blocked",
      metadata: {
        reason: "embedded_browser_blocked",
      },
    });

    const loginUrl = new URL(buildLoginHref(requestedNextPath, requestedMode), request.url);
    loginUrl.searchParams.set("error", "microsoft_embedded_browser");
    return attachRequestId(
      applyNoStoreHeaders(NextResponse.redirect(loginUrl, 302)),
      requestContext.requestId,
    );
  }

  if (!isMicrosoftAuthConfigured()) {
    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.redirect(new URL("/login?error=microsoft_not_configured", request.url), 302),
      ),
      requestContext.requestId,
    );
  }

  const state = createOAuthState();
  const redirectUri = resolveMicrosoftRedirectUri(request);
  const microsoftAuthUrl = buildMicrosoftAuthorizeUrl(state, redirectUri);
  const response = NextResponse.redirect(microsoftAuthUrl, 302);

  setSharedAuthCookie(request, response, getOAuthStateCookieName("microsoft"), state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
    priority: "high",
  });

  setSharedAuthCookie(
    request,
    response,
    getOAuthRedirectUriCookieName("microsoft"),
    redirectUri,
    {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 10,
      path: "/",
      priority: "high",
    },
  );

  if (requestedNextPath) {
    setSharedAuthCookie(
      request,
      response,
      getOAuthNextPathCookieName("microsoft"),
      requestedNextPath,
      {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 10,
        path: "/",
        priority: "high",
      },
    );
  } else {
    clearSharedAuthCookie(request, response, getOAuthNextPathCookieName("microsoft"), {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    });
  }

  setSharedAuthCookie(
    request,
    response,
    getOAuthModeCookieName("microsoft"),
    requestedMode,
    {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 10,
      path: "/",
      priority: "high",
    },
  );

  await logSecurityAuditEventSafe(requestContext, {
    action: "auth_microsoft_start",
    outcome: "succeeded",
    metadata: {
      redirectUri,
      requestedNextPath,
      requestedMode,
    },
  });

  return attachRequestId(applyNoStoreHeaders(response), requestContext.requestId);
}
