import { NextRequest, NextResponse } from "next/server";
import { authConfig, isSecureRequest } from "@/lib/auth/config";
import { exchangeCodeForToken, fetchDiscordUser } from "@/lib/auth/discord";
import { createUserSessionFromDiscordUser } from "@/lib/auth/session";

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

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const stateCookie = request.cookies.get(authConfig.oauthStateCookieName)?.value;
  const redirectUriCookie = request.cookies.get(
    authConfig.oauthRedirectUriCookieName,
  )?.value;

  if (!code || !state || !stateCookie || !redirectUriCookie || state !== stateCookie) {
    const response = NextResponse.redirect(buildLoginRedirect(request));
    clearOAuthCookies(response);
    return response;
  }

  try {
    const accessToken = await exchangeCodeForToken({
      code,
      redirectUri: redirectUriCookie,
    });

    const discordUser = await fetchDiscordUser(accessToken);

    const { session } = await createUserSessionFromDiscordUser(discordUser, {
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    const successUrl = new URL(authConfig.loginSuccessPath, request.nextUrl.origin);
    const response = NextResponse.redirect(successUrl);

    response.cookies.set(authConfig.sessionCookieName, session.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      maxAge: authConfig.sessionTtlHours * 60 * 60,
      path: "/",
    });

    clearOAuthCookies(response);
    return response;
  } catch {
    const response = NextResponse.redirect(buildLoginRedirect(request));
    clearOAuthCookies(response);
    return response;
  }
}
