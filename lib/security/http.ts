import { NextResponse } from "next/server";
import {
  areHostsWithinSameFirstPartySite,
  detectCanonicalHostFromHostname,
} from "@/lib/routing/subdomains";

const FIRST_PARTY_CONNECT_SOURCES = [
  "https://www.flwdesk.com",
  "https://pay.flwdesk.com",
  "https://account.flwdesk.com",
  "https://config.flwdesk.com",
  "https://status.flwdesk.com",
  "https://fdesk.flwdesk.com",
  "https://servers.flwdesk.com",
  "https://*.flwdesk.com",
  "wss://*.flwdesk.com",
] as const;

function isExplicitlyEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isLoopbackHost(host: string) {
  const hostname = host.split(":")[0]?.trim().toLowerCase() || "";
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1"
  );
}

function isTrustedFirstPartyMutationHost(host: string) {
  return isLoopbackHost(host) || Boolean(detectCanonicalHostFromHostname(host));
}

export function isSameOriginRequest(request: Request) {
  const requestUrl = new URL(request.url);
  const originHeader = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site");

  if (
    secFetchSite &&
    secFetchSite !== "same-origin" &&
    secFetchSite !== "same-site" &&
    secFetchSite !== "none"
  ) {
    return false;
  }

  if (originHeader) {
    try {
      const originUrl = new URL(originHeader);
      if (originUrl.origin === requestUrl.origin) {
        return true;
      }

      if (originUrl.protocol !== requestUrl.protocol) {
        return false;
      }

      if (!areHostsWithinSameFirstPartySite(originUrl.host, requestUrl.host)) {
        return false;
      }

      // Bloqueia subdominios arbitrarios mesmo dentro do mesmo eTLD+1.
      if (
        !isTrustedFirstPartyMutationHost(originUrl.host) ||
        !isTrustedFirstPartyMutationHost(requestUrl.host)
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export function buildContentSecurityPolicy(input?: { isDevelopment?: boolean }) {
  const isDevelopment = input?.isDevelopment === true;
  const adsenseEnabled = isExplicitlyEnabled(
    process.env.NEXT_PUBLIC_ENABLE_ADSENSE,
  );
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    "https://sdk.mercadopago.com",
    "https://www.mercadopago.com",
    ...(adsenseEnabled
      ? [
          "https://pagead2.googlesyndication.com",
          "https://www.googletagmanager.com",
          "https://googleads.g.doubleclick.net",
        ]
      : []),
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ];
  const connectSources = [
    "'self'",
    ...FIRST_PARTY_CONNECT_SOURCES,
    "https://discord.com",
    "https://api.discord.com",
    "https://api.mercadopago.com",
    "https://*.mercadopago.com",
    "https://*.mercadolibre.com",
    ...(adsenseEnabled
      ? [
          "https://pagead2.googlesyndication.com",
          "https://googleads.g.doubleclick.net",
          "https://www.google.com",
          "https://www.googletagmanager.com",
        ]
      : []),
  ];
  const frameSources = [
    "'self'",
    "https://*.mercadopago.com",
    "https://*.mercadolibre.com",
    ...(adsenseEnabled
      ? [
          "https://googleads.g.doubleclick.net",
          "https://tpc.googlesyndication.com",
        ]
      : []),
  ];
  const imgSources = [
    "'self'",
    "data:",
    "blob:",
    "https:",
    ...(adsenseEnabled
      ? [
          "https://pagead2.googlesyndication.com",
          "https://*.doubleclick.net",
          "https://*.googlesyndication.com",
          "https://*.googleusercontent.com",
        ]
      : []),
  ];
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `img-src ${imgSources.join(" ")}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `script-src ${scriptSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    `frame-src ${frameSources.join(" ")}`,
    "worker-src 'self' blob:",
    "media-src 'self' data: blob:",
    "manifest-src 'self'",
  ];

  if (!isDevelopment) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export function applyStandardSecurityHeaders<T extends NextResponse>(
  response: T,
  input?: {
    contentSecurityPolicy?: string | null;
    requestId?: string | null;
    noIndex?: boolean;
  },
) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Origin-Agent-Cluster", "?1");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  response.headers.set("X-Download-Options", "noopen");

  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  if (input?.contentSecurityPolicy) {
    response.headers.set(
      "Content-Security-Policy",
      input.contentSecurityPolicy,
    );
  }

  if (input?.requestId) {
    response.headers.set("X-Request-Id", input.requestId);
  }

  if (input?.noIndex) {
    response.headers.set(
      "X-Robots-Tag",
      "noindex, nofollow, noarchive, nosnippet",
    );
  }

  return response;
}

export function ensureSameOriginJsonMutationRequest(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { ok: false, message: "Origem da requisicao invalida." },
      { status: 403 },
    );
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { ok: false, message: "Content-Type invalido." },
      { status: 415 },
    );
  }

  return null;
}

export function applyNoStoreHeaders<T extends NextResponse>(response: T) {
  applyStandardSecurityHeaders(response);
  response.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}
