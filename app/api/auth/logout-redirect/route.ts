import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildDiscordAuthStartHref } from "@/lib/auth/paths";
import { authConfig, getOAuthModeCookieName, getOAuthNextPathCookieName, getOAuthRedirectUriCookieName, getOAuthStateCookieName } from "@/lib/auth/config";
import { getSharedAuthCookieProofName } from "@/lib/auth/cookies";

const COOKIES_TO_DELETE = [
  "flowdesk_auth_session",
  "flowdesk_auth_session_proof",
  authConfig.sessionCookieName,
  getSharedAuthCookieProofName(authConfig.sessionCookieName),
  getOAuthStateCookieName("discord"),
  getOAuthRedirectUriCookieName("discord"),
  getOAuthNextPathCookieName("discord"),
  getOAuthModeCookieName("discord"),
] as const;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const redirectTo = searchParams.get("redirect") || "/";

  const cookieStore = await cookies();
  for (const name of COOKIES_TO_DELETE) {
    try {
      cookieStore.delete(name);
    } catch {
      // noop
    }
  }

  // Redireciona para o login seguro do Discord que depois voltara para o redirectTo
  const authStartUrl = buildDiscordAuthStartHref(redirectTo);
  
  // Garantimos redirecionamento absoluto seguro
  return NextResponse.redirect(new URL(authStartUrl, request.url));
}
