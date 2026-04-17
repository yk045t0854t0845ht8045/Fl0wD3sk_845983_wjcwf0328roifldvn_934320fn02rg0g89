import type { NextRequest } from "next/server";

const DEFAULT_PRODUCTION_APP_URL = "https://www.flwdesk.com";
const DEFAULT_PRODUCTION_REDIRECT_URI = `${DEFAULT_PRODUCTION_APP_URL}/api/auth/discord/callback`;
const LEGACY_PRODUCTION_HOSTS = new Set(["flowdeskbot.vercel.app", "flwdesk.com"]);

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

function resolveDefaultProdRedirectUri() {
  const explicitAppUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    "";

  if (explicitAppUrl) {
    try {
      return new URL("/api/auth/discord/callback", explicitAppUrl).toString();
    } catch {
      // Ignore invalid configured URLs and fall through to safe default.
    }
  }

  return DEFAULT_PRODUCTION_REDIRECT_URI;
}

function normalizeProdRedirectUri(value: string) {
  try {
    const parsed = new URL(value);
    const normalizedHostname = parsed.hostname.toLowerCase();

    if (LEGACY_PRODUCTION_HOSTS.has(normalizedHostname)) {
      parsed.hostname = "www.flwdesk.com";
      parsed.protocol = "https:";
    }

    return parsed.toString();
  } catch {
    return DEFAULT_PRODUCTION_REDIRECT_URI;
  }
}

export const authConfig = {
  discordClientId: requireEnv("DISCORD_CLIENT_ID"),
  discordClientSecret: requireEnv("DISCORD_CLIENT_SECRET"),
  discordRedirectUriLocal:
    process.env.DISCORD_REDIRECT_URI_LOCAL ||
    "http://localhost:3000/api/auth/discord/callback",
  discordRedirectUriProd: normalizeProdRedirectUri(
    process.env.DISCORD_REDIRECT_URI_PROD || resolveDefaultProdRedirectUri(),
  ),
  loginSuccessBasePath: process.env.LOGIN_SUCCESS_BASE_PATH || "/dashboard",
  loginSuccessHashPath: process.env.LOGIN_SUCCESS_HASH_PATH || "",
  oauthStateCookieName: "flowdesk_oauth_state",
  oauthRedirectUriCookieName: "flowdesk_oauth_redirect_uri",
  oauthNextPathCookieName: "flowdesk_oauth_next_path",
  oauthModeCookieName: "flowdesk_oauth_mode",
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

function normalizeBasePath(path: string) {
  if (!path) return "/dashboard";
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeHashPath(path: string) {
  if (!path) return "";
  return path.replace(/^#/, "");
}

export function normalizeInternalNextPath(path: string | null | undefined) {
  if (typeof path !== "string") return null;

  const trimmed = path.trim();
  if (!trimmed || trimmed.length > 300) return null;
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  return trimmed;
}

export function buildLoginSuccessLocation(origin: string) {
  const basePath = normalizeBasePath(authConfig.loginSuccessBasePath);
  const hashPath = normalizeHashPath(authConfig.loginSuccessHashPath);

  if (!hashPath) {
    return `${origin}${basePath}`;
  }

  const basePathWithSlash = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return `${origin}${basePathWithSlash}#${hashPath}`;
}
