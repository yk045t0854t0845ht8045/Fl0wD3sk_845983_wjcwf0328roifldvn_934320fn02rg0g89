import type { NextRequest } from "next/server";

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }

  return value;
}

function parseSessionHours() {
  const value = Number(process.env.AUTH_SESSION_TTL_HOURS || "168");
  return Number.isFinite(value) && value > 0 ? value : 168;
}

export const authConfig = {
  discordClientId: requireEnv("DISCORD_CLIENT_ID"),
  discordClientSecret: requireEnv("DISCORD_CLIENT_SECRET"),
  discordRedirectUriLocal:
    process.env.DISCORD_REDIRECT_URI_LOCAL ||
    "http://localhost:3000/api/auth/discord/callback",
  discordRedirectUriProd:
    process.env.DISCORD_REDIRECT_URI_PROD ||
    "https://flowdeskbot.vercel.app/api/auth/discord/callback",
  loginSuccessPath: process.env.LOGIN_SUCCESS_PATH || "/config/#/step/1",
  oauthStateCookieName: "flowdesk_oauth_state",
  oauthRedirectUriCookieName: "flowdesk_oauth_redirect_uri",
  sessionCookieName: "flowdesk_auth_session",
  sessionTtlHours: parseSessionHours(),
};

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function resolveDiscordRedirectUri(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  return isLocalHostname(hostname)
    ? authConfig.discordRedirectUriLocal
    : authConfig.discordRedirectUriProd;
}

export function isSecureRequest(request: NextRequest) {
  return request.nextUrl.protocol === "https:";
}
