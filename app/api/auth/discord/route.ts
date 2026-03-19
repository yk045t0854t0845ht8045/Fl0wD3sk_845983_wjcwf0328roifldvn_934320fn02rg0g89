import { NextRequest, NextResponse } from "next/server";
import {
  authConfig,
  isSecureRequest,
  resolveDiscordRedirectUri,
} from "@/lib/auth/config";
import { buildDiscordAuthorizeUrl } from "@/lib/auth/discord";
import { createOAuthState } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const state = createOAuthState();
  const redirectUri = resolveDiscordRedirectUri(request);
  const discordAuthUrl = buildDiscordAuthorizeUrl(state, redirectUri);

  const response = NextResponse.redirect(discordAuthUrl);

  response.cookies.set(authConfig.oauthStateCookieName, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: 60 * 10,
    path: "/",
  });

  response.cookies.set(authConfig.oauthRedirectUriCookieName, redirectUri, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: 60 * 10,
    path: "/",
  });

  return response;
}
