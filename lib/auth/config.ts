import type { NextRequest } from "next/server";
import {
  buildCanonicalUrlFromInternalPath,
  getRequestHostname,
  resolveAuthOrigin,
  resolveHostRuntimeContext,
} from "@/lib/routing/subdomains";
import { containsFlowSecureThreatPattern } from "@/lib/security/flowSecure";

const DEFAULT_PRODUCTION_AUTH_ORIGIN = "https://account.flwdesk.com";
const DEFAULT_LOCAL_AUTH_ORIGIN = "http://account.localhost:3000";
const LEGACY_PRODUCTION_HOSTS = new Set([
  "flowdeskbot.vercel.app",
  "flwdesk.com",
  "www.flwdesk.com",
]);
const OAUTH_PROVIDER_COOKIE_PREFIX = "flowdesk_oauth";

export type OAuthProvider = "discord" | "google" | "microsoft";
type AuthConfig = {
  readonly discordClientId: string;
  readonly discordClientSecret: string;
  readonly discordRedirectUriLocal: string;
  readonly discordRedirectUriProd: string;
  readonly googleClientId: string | null;
  readonly googleClientSecret: string | null;
  readonly microsoftClientId: string | null;
  readonly microsoftClientSecret: string | null;
  readonly googleRedirectUriLocal: string;
  readonly googleRedirectUriProd: string;
  readonly microsoftRedirectUriLocal: string;
  readonly microsoftRedirectUriProd: string;
  readonly loginSuccessBasePath: string;
  readonly loginSuccessHashPath: string;
  readonly sessionCookieName: string;
  readonly rememberedDeviceCookieName: string;
  readonly sessionTtlHours: number;
  readonly rememberedDeviceDays: number;
};

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }

  return value;
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function parseSessionHours() {
  const value = Number(process.env.AUTH_SESSION_TTL_HOURS || "168");
  return Number.isFinite(value) && value > 0 ? value : 168;
}

function parseRememberDeviceDays() {
  const value = Number(process.env.AUTH_EMAIL_REMEMBER_DEVICE_DAYS || "30");
  return Number.isFinite(value) && value >= 1 && value <= 90 ? Math.trunc(value) : 30;
}

function normalizeConfiguredOrigin(value: string, fallback: string) {
  try {
    const parsed = new URL(value);
    const normalizedHostname = parsed.hostname.toLowerCase();

    if (LEGACY_PRODUCTION_HOSTS.has(normalizedHostname)) {
      parsed.hostname = new URL(fallback).hostname;
      parsed.protocol = "https:";
    }

    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function resolveDefaultProductionAuthOrigin() {
  const explicitOrigin =
    process.env.AUTH_APP_URL?.trim() ||
    process.env.APP_ACCOUNT_URL?.trim() ||
    process.env.NEXT_PUBLIC_ACCOUNT_URL?.trim() ||
    "";

  if (explicitOrigin) {
    return normalizeConfiguredOrigin(explicitOrigin, DEFAULT_PRODUCTION_AUTH_ORIGIN);
  }

  return normalizeConfiguredOrigin(
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.APP_URL?.trim() ||
      process.env.SITE_URL?.trim() ||
      DEFAULT_PRODUCTION_AUTH_ORIGIN,
    DEFAULT_PRODUCTION_AUTH_ORIGIN,
  ).replace("https://www.flwdesk.com", DEFAULT_PRODUCTION_AUTH_ORIGIN);
}

function resolveDefaultLocalAuthOrigin() {
  const explicitOrigin =
    process.env.AUTH_APP_URL_LOCAL?.trim() ||
    process.env.APP_ACCOUNT_URL_LOCAL?.trim() ||
    process.env.NEXT_PUBLIC_ACCOUNT_URL_LOCAL?.trim() ||
    "";

  if (explicitOrigin) {
    return normalizeConfiguredOrigin(explicitOrigin, DEFAULT_LOCAL_AUTH_ORIGIN);
  }

  return normalizeConfiguredOrigin(DEFAULT_LOCAL_AUTH_ORIGIN, DEFAULT_LOCAL_AUTH_ORIGIN);
}

function buildDefaultRedirectUri(origin: string, pathname: string) {
  return new URL(pathname, origin).toString();
}

export const authConfig: AuthConfig = {
  get discordClientId() {
    return requireEnv("DISCORD_CLIENT_ID");
  },
  get discordClientSecret() {
    return requireEnv("DISCORD_CLIENT_SECRET");
  },
  get discordRedirectUriLocal() {
    return (
      optionalEnv("DISCORD_REDIRECT_URI_LOCAL") ||
      buildDefaultRedirectUri(
        resolveDefaultLocalAuthOrigin(),
        "/api/auth/discord/callback",
      )
    );
  },
  get discordRedirectUriProd() {
    return (
      optionalEnv("DISCORD_REDIRECT_URI_PROD") ||
      buildDefaultRedirectUri(
        resolveDefaultProductionAuthOrigin(),
        "/api/auth/discord/callback",
      )
    );
  },
  get googleClientId() {
    return optionalEnv("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return optionalEnv("GOOGLE_CLIENT_SECRET");
  },
  get microsoftClientId() {
    return optionalEnv("MICROSOFT_CLIENT_ID");
  },
  get microsoftClientSecret() {
    return optionalEnv("MICROSOFT_CLIENT_SECRET");
  },
  get googleRedirectUriLocal() {
    return (
      optionalEnv("GOOGLE_REDIRECT_URI_LOCAL") ||
      buildDefaultRedirectUri(
        resolveDefaultLocalAuthOrigin(),
        "/api/auth/google/callback",
      )
    );
  },
  get googleRedirectUriProd() {
    return (
      optionalEnv("GOOGLE_REDIRECT_URI_PROD") ||
      buildDefaultRedirectUri(
        resolveDefaultProductionAuthOrigin(),
        "/api/auth/google/callback",
      )
    );
  },
  get microsoftRedirectUriLocal() {
    return (
      optionalEnv("MICROSOFT_REDIRECT_URI_LOCAL") ||
      buildDefaultRedirectUri(
        resolveDefaultLocalAuthOrigin(),
        "/api/auth/microsoft/callback",
      )
    );
  },
  get microsoftRedirectUriProd() {
    return (
      optionalEnv("MICROSOFT_REDIRECT_URI_PROD") ||
      buildDefaultRedirectUri(
        resolveDefaultProductionAuthOrigin(),
        "/api/auth/microsoft/callback",
      )
    );
  },
  get loginSuccessBasePath() {
    return process.env.LOGIN_SUCCESS_BASE_PATH || "/dashboard";
  },
  get loginSuccessHashPath() {
    return process.env.LOGIN_SUCCESS_HASH_PATH || "";
  },
  get sessionCookieName() {
    return "flowdesk_auth_session";
  },
  get rememberedDeviceCookieName() {
    return "flowdesk_auth_trusted_device";
  },
  get sessionTtlHours() {
    return parseSessionHours();
  },
  get rememberedDeviceDays() {
    return parseRememberDeviceDays();
  },
};

function resolveRequestScopedRedirectUri(
  request: NextRequest,
  callbackPathname: string,
  fallbackRedirectUri: string,
) {
  const runtime = resolveHostRuntimeContext(getRequestHostname(request));

  if (runtime.mode === "isolated") {
    return fallbackRedirectUri;
  }

  return new URL(callbackPathname, resolveAuthOrigin(request)).toString();
}

export function resolveDiscordRedirectUri(request: NextRequest) {
  return resolveRequestScopedRedirectUri(
    request,
    "/api/auth/discord/callback",
    authConfig.discordRedirectUriLocal &&
      resolveHostRuntimeContext(getRequestHostname(request)).mode === "local"
      ? authConfig.discordRedirectUriLocal
      : authConfig.discordRedirectUriProd,
  );
}

export function resolveGoogleRedirectUri(request: NextRequest) {
  return resolveRequestScopedRedirectUri(
    request,
    "/api/auth/google/callback",
    authConfig.googleRedirectUriLocal &&
      resolveHostRuntimeContext(getRequestHostname(request)).mode === "local"
      ? authConfig.googleRedirectUriLocal
      : authConfig.googleRedirectUriProd,
  );
}

export function resolveMicrosoftRedirectUri(request: NextRequest) {
  return resolveRequestScopedRedirectUri(
    request,
    "/api/auth/microsoft/callback",
    authConfig.microsoftRedirectUriLocal &&
      resolveHostRuntimeContext(getRequestHostname(request)).mode === "local"
      ? authConfig.microsoftRedirectUriLocal
      : authConfig.microsoftRedirectUriProd,
  );
}

export function isSecureRequest(request: NextRequest) {
  return request.nextUrl.protocol === "https:";
}

export function isGoogleAuthConfigured() {
  return Boolean(authConfig.googleClientId && authConfig.googleClientSecret);
}

export function isMicrosoftAuthConfigured() {
  return Boolean(authConfig.microsoftClientId && authConfig.microsoftClientSecret);
}

function buildOAuthCookieName(provider: OAuthProvider, suffix: string) {
  return `${OAUTH_PROVIDER_COOKIE_PREFIX}_${provider}_${suffix}`;
}

export function getOAuthStateCookieName(provider: OAuthProvider) {
  return buildOAuthCookieName(provider, "state");
}

export function getOAuthRedirectUriCookieName(provider: OAuthProvider) {
  return buildOAuthCookieName(provider, "redirect_uri");
}

export function getOAuthNextPathCookieName(provider: OAuthProvider) {
  return buildOAuthCookieName(provider, "next_path");
}

export function getOAuthModeCookieName(provider: OAuthProvider) {
  return buildOAuthCookieName(provider, "mode");
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
  if (trimmed.includes("\\")) return null;
  if (trimmed.includes("/../") || trimmed.endsWith("/..")) return null;
  if (/[<>]/.test(trimmed)) return null;
  if (containsFlowSecureThreatPattern(trimmed)) return null;
  return trimmed;
}

export function getConfiguredEmailOtpLength() {
  const value = Number(process.env.AUTH_EMAIL_OTP_LENGTH || "6");
  return Number.isInteger(value) && value >= 6 && value <= 8 ? value : 6;
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

export function buildCanonicalLoginSuccessLocation(request: NextRequest) {
  return buildCanonicalUrlFromInternalPath(request, authConfig.loginSuccessBasePath, {
    fallbackArea: "public",
  });
}
