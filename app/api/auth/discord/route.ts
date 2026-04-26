import { NextRequest, NextResponse } from "next/server";
import {
  normalizeInternalNextPath,
  resolveDiscordRedirectUri,
} from "@/lib/auth/config";
import { buildLoginRedirectResponse } from "@/lib/auth/loginFlash";
import { buildAuthOriginRedirectResponse } from "@/lib/auth/requestOrigin";
import { isLikelyEmbeddedAuthBrowser } from "@/lib/auth/oauthBrowser";
import {
  createOAuthTransactionState,
  setOAuthTransactionCookies,
} from "@/lib/auth/oauthIdentity";
import { buildDiscordAuthorizeUrl } from "@/lib/auth/discord";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

export async function GET(request: NextRequest) {
  const originRedirectResponse = buildAuthOriginRedirectResponse(request);
  if (originRedirectResponse) {
    return originRedirectResponse;
  }

  const requestContext = createSecurityRequestContext(request);
  const requestedNextPath = normalizeInternalNextPath(
    request.nextUrl.searchParams.get("next"),
  );
  const requestedMode =
    request.nextUrl.searchParams.get("mode") === "link" ? "link" : "login";
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

    const response = buildLoginRedirectResponse(request, {
      nextPath: requestedNextPath,
      mode: requestedMode,
      error: "slow_down",
    });
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return attachRequestId(response, requestContext.requestId);
  }

  await logSecurityAuditEventSafe(requestContext, {
    action: "auth_discord_start",
    outcome: "started",
  });

  if (isLikelyEmbeddedAuthBrowser(request.headers.get("user-agent"))) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_discord_start",
      outcome: "blocked",
      metadata: {
        reason: "embedded_browser_blocked",
      },
    });

    return attachRequestId(
      buildLoginRedirectResponse(request, {
        nextPath: requestedNextPath,
        mode: requestedMode,
        error: "discord_embedded_browser",
      }),
      requestContext.requestId,
    );
  }

  const redirectUri = resolveDiscordRedirectUri(request);
  const state = createOAuthTransactionState({
    provider: "discord",
    redirectUri,
    requestedMode,
    requestedNextPath,
  });
  const discordAuthUrl = buildDiscordAuthorizeUrl(state, redirectUri);

  const response = NextResponse.redirect(discordAuthUrl, 302);
  setOAuthTransactionCookies(request, response, {
    provider: "discord",
    state,
    redirectUri,
    requestedMode,
    requestedNextPath,
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
