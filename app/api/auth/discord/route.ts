import { NextRequest, NextResponse } from "next/server";
import {
  authConfig,
  isSecureRequest,
  normalizeInternalNextPath,
  resolveDiscordRedirectUri,
} from "@/lib/auth/config";
import { buildDiscordAuthorizeUrl } from "@/lib/auth/discord";
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
    action: "auth_discord_start",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 18,
    context: requestContext,
  });

  if (!rateLimit.ok) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_discord_start",
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
    action: "auth_discord_start",
    outcome: "started",
  });

  const state = createOAuthState();
  const redirectUri = resolveDiscordRedirectUri(request);
  const requestedNextPath = normalizeInternalNextPath(
    request.nextUrl.searchParams.get("next"),
  );
  const requestedMode =
    request.nextUrl.searchParams.get("mode") === "link" ? "link" : "login";
  const discordAuthUrl = buildDiscordAuthorizeUrl(state, redirectUri);

  const response = NextResponse.redirect(discordAuthUrl, 302);

  response.cookies.set(authConfig.oauthStateCookieName, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: 60 * 10,
    path: "/",
    priority: "high",
  });

  response.cookies.set(authConfig.oauthRedirectUriCookieName, redirectUri, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: 60 * 10,
    path: "/",
    priority: "high",
  });

  if (requestedNextPath) {
    response.cookies.set(authConfig.oauthNextPathCookieName, requestedNextPath, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      maxAge: 60 * 10,
      path: "/",
      priority: "high",
    });
  } else {
    response.cookies.delete(authConfig.oauthNextPathCookieName);
  }

  response.cookies.set(authConfig.oauthModeCookieName, requestedMode, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: 60 * 10,
    path: "/",
    priority: "high",
  });

  await logSecurityAuditEventSafe(requestContext, {
    action: "auth_discord_start",
    outcome: "succeeded",
    metadata: {
      redirectUri,
      requestedNextPath,
      requestedMode,
    },
  });

  return attachRequestId(applyNoStoreHeaders(response), requestContext.requestId);
}
