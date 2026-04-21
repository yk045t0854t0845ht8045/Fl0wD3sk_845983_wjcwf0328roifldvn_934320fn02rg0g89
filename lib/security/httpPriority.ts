import type { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/serverEnv";

const STATIC_PUBLIC_ASSET_PREFIXES = ["/cdn/", "/icons/"] as const;
const STATIC_PUBLIC_ROOT_FILE_PATTERN =
  /^\/[^/]+\.(?:png|jpe?g|gif|webp|svg|ico|txt|xml|json|webmanifest|woff2?|ttf|otf)$/i;
const HIGH_TRANSPORT_PRIORITY = "u=0, i";
const STYLE_TRANSPORT_PRIORITY = "u=1";
const SCRIPT_TRANSPORT_PRIORITY = "u=2";
const INTERACTIVE_API_TRANSPORT_PRIORITY = "u=3";
const IMAGE_TRANSPORT_PRIORITY = "u=4";
const BACKGROUND_API_TRANSPORT_PRIORITY = "u=5";
const LOWEST_TRANSPORT_PRIORITY = "u=7";

const CRITICAL_PUBLIC_ASSET_PATHS = new Set([
  "/cdn/logos/logo.png",
  "/cdn/logos/logotipo_.svg",
  "/cdn/hero/hero-banner.svg",
  "/cdn/hero-blocks-1.svg",
]);

function isExplicitlyEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function isFlowSecureHttpPriorityEnabled() {
  return isExplicitlyEnabled(
    getServerEnv("FLOWSECURE_HTTP_PRIORITY_ENABLED") ?? "1",
  );
}

export function isStaticPublicAssetPath(pathname: string) {
  if (pathname === "/ads.txt") {
    return true;
  }

  if (
    STATIC_PUBLIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return true;
  }

  return STATIC_PUBLIC_ROOT_FILE_PATTERN.test(pathname);
}

export function isNextInternalAssetPath(pathname: string) {
  return pathname.startsWith("/_next/static/");
}

function isCriticalPublicAssetPath(pathname: string) {
  if (CRITICAL_PUBLIC_ASSET_PATHS.has(pathname)) {
    return true;
  }

  return (
    pathname.startsWith("/cdn/logos/") ||
    pathname.startsWith("/cdn/hero/")
  );
}

function classifyNextInternalAssetPriority(request: NextRequest) {
  const pathname = request.nextUrl.pathname.toLowerCase();
  const secFetchDest =
    request.headers.get("sec-fetch-dest")?.trim().toLowerCase() || "";

  if (pathname.endsWith(".css") || secFetchDest === "style") {
    return STYLE_TRANSPORT_PRIORITY;
  }

  if (
    pathname.endsWith(".woff2") ||
    pathname.endsWith(".woff") ||
    pathname.endsWith(".ttf") ||
    pathname.endsWith(".otf") ||
    secFetchDest === "font"
  ) {
    return STYLE_TRANSPORT_PRIORITY;
  }

  if (pathname.endsWith(".js") || secFetchDest === "script") {
    return SCRIPT_TRANSPORT_PRIORITY;
  }

  if (secFetchDest === "worker") {
    return SCRIPT_TRANSPORT_PRIORITY;
  }

  if (
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".avif") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".gif") ||
    secFetchDest === "image"
  ) {
    return IMAGE_TRANSPORT_PRIORITY;
  }

  return INTERACTIVE_API_TRANSPORT_PRIORITY;
}

function classifyApiPriority(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/internal/") ||
    pathname === "/api/payments/mercadopago/webhook"
  ) {
    return LOWEST_TRANSPORT_PRIORITY;
  }

  if (
    pathname.startsWith("/api/status/") ||
    pathname === "/api/status" ||
    pathname.startsWith("/api/public/") ||
    pathname.startsWith("/api/landing/")
  ) {
    return BACKGROUND_API_TRANSPORT_PRIORITY;
  }

  if (pathname === "/api/flowsecure/polish") {
    const source = request.nextUrl.searchParams.get("src")?.trim() || "";
    return isCriticalPublicAssetPath(source)
      ? SCRIPT_TRANSPORT_PRIORITY
      : IMAGE_TRANSPORT_PRIORITY;
  }

  return INTERACTIVE_API_TRANSPORT_PRIORITY;
}

function classifyPublicAssetPriority(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isCriticalPublicAssetPath(pathname)) {
    return SCRIPT_TRANSPORT_PRIORITY;
  }

  if (
    pathname.endsWith(".woff2") ||
    pathname.endsWith(".woff") ||
    pathname.endsWith(".ttf") ||
    pathname.endsWith(".otf") ||
    pathname.endsWith(".css")
  ) {
    return STYLE_TRANSPORT_PRIORITY;
  }

  if (
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".avif") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".gif") ||
    pathname.endsWith(".ico")
  ) {
    return IMAGE_TRANSPORT_PRIORITY;
  }

  return BACKGROUND_API_TRANSPORT_PRIORITY;
}

function classifyDocumentPriority() {
  return HIGH_TRANSPORT_PRIORITY;
}

export function resolveFlowSecureTransportPriority(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isNextInternalAssetPath(pathname)) {
    return classifyNextInternalAssetPriority(request);
  }

  if (pathname.startsWith("/api/")) {
    return classifyApiPriority(request);
  }

  if (isStaticPublicAssetPath(pathname)) {
    return classifyPublicAssetPriority(request);
  }

  return classifyDocumentPriority();
}

export function applyFlowSecureTransportPriority<T extends NextResponse>(
  response: T,
  request: NextRequest,
) {
  if (!isFlowSecureHttpPriorityEnabled()) {
    return response;
  }

  response.headers.set("Priority", resolveFlowSecureTransportPriority(request));
  return response;
}
