import { NextRequest, NextResponse } from "next/server";
import {
  authConfig,
  buildLoginSuccessLocation,
  isSecureRequest,
} from "@/lib/auth/config";
import {
  exchangeCodeForToken,
  fetchDiscordGuilds,
  fetchDiscordUser,
} from "@/lib/auth/discord";
import { filterAccessibleGuilds } from "@/lib/auth/discordGuildAccess";
import { createUserSessionFromDiscordUser } from "@/lib/auth/session";
import { getLockedGuildLicenseMap } from "@/lib/payments/licenseStatus";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

function buildLoginRedirect(request: NextRequest) {
  return new URL("/login", request.url);
}

function extractClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return null;
  return forwardedFor.split(",")[0]?.trim() || null;
}

function clearOAuthCookies(response: NextResponse) {
  response.cookies.delete(authConfig.oauthStateCookieName);
  response.cookies.delete(authConfig.oauthRedirectUriCookieName);
}

function redirectWithLocation(location: string) {
  return applyNoStoreHeaders(new NextResponse(null, {
    status: 302,
    headers: {
      Location: location,
    },
  }));
}

async function hasApprovedServerForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("payment_orders")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle<{ id: number }>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return Boolean(result.data?.id);
}

async function hasAccessibleLicensedServer(accessToken: string) {
  const guilds = filterAccessibleGuilds(await fetchDiscordGuilds(accessToken));
  if (!guilds.length) return false;

  const lockedGuildMap = await getLockedGuildLicenseMap(guilds.map((guild) => guild.id));
  return lockedGuildMap.size > 0;
}

export async function GET(request: NextRequest) {
  const initialRequestContext = createSecurityRequestContext(request);
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

    const response = applyNoStoreHeaders(
      NextResponse.redirect(buildLoginRedirect(request)),
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
    const response = applyNoStoreHeaders(NextResponse.redirect(buildLoginRedirect(request)));
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
    const tokenPayload = await exchangeCodeForToken({
      code,
      redirectUri: redirectUriCookie,
    });

    const discordUser = await fetchDiscordUser(tokenPayload.access_token);
    const discordTokenExpiresAt = new Date(
      Date.now() + tokenPayload.expires_in * 1000,
    ).toISOString();

    const { user, session } = await createUserSessionFromDiscordUser(discordUser, {
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
    }, {
      discordAccessToken: tokenPayload.access_token,
      discordRefreshToken: tokenPayload.refresh_token || null,
      discordTokenExpiresAt,
    });

    let hasManagedServerAccess = false;
    try {
      const [hasOwnApprovedServer, hasAccessibleLicensedGuild] = await Promise.all([
        hasApprovedServerForUser(user.id),
        hasAccessibleLicensedServer(tokenPayload.access_token),
      ]);
      hasManagedServerAccess = hasOwnApprovedServer || hasAccessibleLicensedGuild;
    } catch {
      hasManagedServerAccess = false;
    }
    const successLocation = hasManagedServerAccess
      ? `${request.nextUrl.origin}/servers`
      : buildLoginSuccessLocation(request.nextUrl.origin);
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
        hasManagedServerAccess,
      },
    });
    return attachRequestId(response, initialRequestContext.requestId);
  } catch {
    const response = applyNoStoreHeaders(NextResponse.redirect(buildLoginRedirect(request)));
    clearOAuthCookies(response);
    await logSecurityAuditEventSafe(initialRequestContext, {
      action: "auth_discord_callback",
      outcome: "failed",
      metadata: {
        reason: "oauth_exchange_failed",
      },
    });
    return attachRequestId(response, initialRequestContext.requestId);
  }
}
