import type { NextRequest } from "next/server";
import {
  buildCanonicalUrlFromInternalPath,
  getRequestHostname,
  resolveAuthOrigin,
  resolveHostRuntimeContext,
} from "@/lib/routing/subdomains";

const DEFAULT_PRODUCTION_AUTH_ORIGIN = "https://account.flwdesk.com";
const DEFAULT_LOCAL_AUTH_ORIGIN = "http://account.localhost:3000";
const LEGACY_PRODUCTION_HOSTS = new Set([
  "flowdeskbot.vercel.app",
  "flwdesk.com",
  "www.flwdesk.com",
]);
const OAUTH_PROVIDER_COOKIE_PREFIX = "flowdesk_oauth";

export type OAuthProvider = "discord" | "google" | "microsoft";

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

export const authConfig = {
  discordClientId: requireEnv("DISCORD_CLIENT_ID"),
  discordClientSecret: requireEnv("DISCORD_CLIENT_SECRET"),
  discordRedirectUriLocal:
    process.env.DISCORD_REDIRECT_URI_LOCAL ||
    buildDefaultRedirectUri(
      resolveDefaultLocalAuthOrigin(),
      "/api/auth/discord/callback",
    ),
  discordRedirectUriProd:
    process.env.DISCORD_REDIRECT_URI_PROD ||
    buildDefaultRedirectUri(
      resolveDefaultProductionAuthOrigin(),
      "/api/auth/discord/callback",
    ),
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || null,
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID?.trim() || null,
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET?.trim() || null,
  googleRedirectUriLocal:
    process.env.GOOGLE_REDIRECT_URI_LOCAL ||
    buildDefaultRedirectUri(
      resolveDefaultLocalAuthOrigin(),
      "/api/auth/google/callback",
    ),
  googleRedirectUriProd:
    process.env.GOOGLE_REDIRECT_URI_PROD ||
    buildDefaultRedirectUri(
      resolveDefaultProductionAuthOrigin(),
      "/api/auth/google/callback",
    ),
  microsoftRedirectUriLocal:
    process.env.MICROSOFT_REDIRECT_URI_LOCAL ||
    buildDefaultRedirectUri(
      resolveDefaultLocalAuthOrigin(),
      "/api/auth/microsoft/callback",
    ),
  microsoftRedirectUriProd:
    process.env.MICROSOFT_REDIRECT_URI_PROD ||
    buildDefaultRedirectUri(
      resolveDefaultProductionAuthOrigin(),
      "/api/auth/microsoft/callback",
    ),
  loginSuccessBasePath: process.env.LOGIN_SUCCESS_BASE_PATH || "/dashboard",
  loginSuccessHashPath: process.env.LOGIN_SUCCESS_HASH_PATH || "",
  sessionCookieName: "flowdesk_auth_session",
  rememberedDeviceCookieName: "flowdesk_auth_trusted_device",
  sessionTtlHours: parseSessionHours(),
  rememberedDeviceDays: parseRememberDeviceDays(),
};

function resolveRequestScopedRedirectUri(
  request: NextRequest,
  callbackPathname: string,
  fallbackRedirectUri: string,
) {
  const runtime = resolveHostRuntimeContext(getRequestHostname(request));

  if (runtime.mode === "local") {
    return fallbackRedirectUri;
  }

  if (runtime.mode === "production") {
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
