import { NextRequest, NextResponse } from "next/server";
import {
  LOGIN_ERROR_FLASH_COOKIE_NAME,
  LOGIN_ERROR_FLASH_HEADER_NAME,
  decodeLoginErrorFlashPayload,
  encodeLoginErrorFlashPayload,
  type LoginErrorFlashPayload,
} from "@/lib/auth/loginFlash";
import {
  applyStandardSecurityHeaders,
  buildContentSecurityPolicy,
  isSameOriginRequest,
} from "@/lib/security/http";
import {
  buildCanonicalUrlFromInternalPath,
  buildCanonicalPaymentUrl,
  buildCanonicalWorkspaceUrl,
  detectCanonicalHostFromRequest,
  detectWorkspaceAreaFromPath,
  detectWorkspaceAreaFromRequestHost,
  getRequestOrigin,
  getWorkspaceAreaExternalPath,
  getWorkspaceAreaInternalPath,
  isCanonicalPublicPath,
  resolveCanonicalHostOrigin,
  resolveAuthOrigin,
} from "@/lib/routing/subdomains";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const STATIC_PUBLIC_ASSET_PREFIXES = ["/cdn/", "/icons/"] as const;
const STATIC_PUBLIC_ROOT_FILE_PATTERN =
  /^\/[^/]+\.(?:png|jpe?g|gif|webp|svg|ico|txt|xml|json|webmanifest|woff2?|ttf|otf)$/i;
const DEFAULT_PAYMENT_CHECKOUT_PATH = "/payment/pro/monthly";

function isStaticPublicAssetPath(pathname: string) {
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

function isSensitiveApiPath(pathname: string) {
  return (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/internal/") ||
    pathname.startsWith("/api/payments/") ||
    pathname.startsWith("/api/transcripts/") ||
    pathname.startsWith("/api/tickets/")
  );
}

function isOAuthHandshakePath(pathname: string) {
  return (
    pathname === "/api/auth/google" ||
    pathname === "/api/auth/google/" ||
    pathname === "/api/auth/discord" ||
    pathname === "/api/auth/discord/" ||
    pathname === "/api/auth/microsoft" ||
    pathname === "/api/auth/microsoft/" ||
    pathname === "/api/auth/google/callback" ||
    pathname === "/api/auth/google/callback/" ||
    pathname === "/api/auth/discord/callback" ||
    pathname === "/api/auth/discord/callback/" ||
    pathname === "/api/auth/discord-callback" ||
    pathname === "/api/auth/discord-callback/" ||
    pathname === "/api/auth/microsoft/callback" ||
    pathname === "/api/auth/microsoft/callback/"
  );
}

function requiresSameOriginProtection(pathname: string, method: string) {
  if (!MUTATION_METHODS.has(method.toUpperCase())) {
    return false;
  }

  if (pathname === "/api/payments/mercadopago/webhook") {
    return false;
  }

  if (pathname.startsWith("/api/internal/")) {
    return false;
  }

  return (
    pathname.startsWith("/api/auth/") || pathname.startsWith("/api/transcripts/")
  );
}

function applySensitiveApiHeaders<T extends NextResponse>(response: T) {
  response.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Vary", "Origin, Cookie, Authorization");
  return response;
}

function buildProtectedErrorResponse(
  request: NextRequest,
  requestId: string,
  csp: string,
) {
  const response = NextResponse.json(
    { ok: false, message: "Origem da requisicao invalida." },
    { status: 403 },
  );

  applyStandardSecurityHeaders(response, {
    contentSecurityPolicy: csp,
    requestId,
    noIndex: request.nextUrl.pathname.startsWith("/api/"),
  });

  if (isSensitiveApiPath(request.nextUrl.pathname)) {
    applySensitiveApiHeaders(response);
  }

  return response;
}

function buildRewriteResponse(
  request: NextRequest,
  requestHeaders: Headers,
  requestId: string,
  csp: string,
  pathname: string,
) {
  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = pathname;

  const response = NextResponse.rewrite(rewriteUrl, {
    request: {
      headers: requestHeaders,
    },
  });

  applyStandardSecurityHeaders(response, {
    contentSecurityPolicy: csp,
    requestId,
    noIndex: rewriteUrl.pathname.startsWith("/api/"),
  });

  if (isSensitiveApiPath(rewriteUrl.pathname)) {
    applySensitiveApiHeaders(response);
  }

  return response;
}

function buildRedirectResponse(
  request: NextRequest,
  requestId: string,
  csp: string,
  location: string,
  status = 307,
) {
  const response = new NextResponse(null, {
    status,
    headers: {
      Location: location,
    },
  });

  applyStandardSecurityHeaders(response, {
    contentSecurityPolicy: csp,
    requestId,
    noIndex: request.nextUrl.pathname.startsWith("/api/"),
  });

  if (isSensitiveApiPath(request.nextUrl.pathname)) {
    applySensitiveApiHeaders(response);
  }

  return response;
}

function getCurrentRequestLocation(request: NextRequest) {
  return `${getRequestOrigin(request)}${request.nextUrl.pathname}${request.nextUrl.search}`;
}

function maybeBuildCanonicalHostRedirect(
  request: NextRequest,
  requestId: string,
  csp: string,
) {
  const canonicalHost = detectCanonicalHostFromRequest(request);
  if (!canonicalHost) {
    return null;
  }

  const targetOrigin = resolveCanonicalHostOrigin(request, canonicalHost);
  const currentOrigin = getRequestOrigin(request);

  if (!targetOrigin || targetOrigin === currentOrigin) {
    return null;
  }

  return buildRedirectResponse(
    request,
    requestId,
    csp,
    `${targetOrigin}${request.nextUrl.pathname}${request.nextUrl.search}`,
    308,
  );
}

function maybeBuildCanonicalAuthRedirect(
  request: NextRequest,
  requestId: string,
  csp: string,
) {
  const pathname = request.nextUrl.pathname;
  const currentLocation = getCurrentRequestLocation(request);

  if (pathname === "/login" || pathname === "/login/") {
    const targetLocation = buildCanonicalUrlFromInternalPath(
      request,
      `${pathname}${request.nextUrl.search}`,
      {
        fallbackArea: "account",
      },
    );

    if (targetLocation !== currentLocation) {
      return buildRedirectResponse(request, requestId, csp, targetLocation);
    }
  }

  if (
    pathname === "/api/auth/discord/callback" ||
    pathname === "/api/auth/discord/callback/" ||
    pathname === "/api/auth/google/callback" ||
    pathname === "/api/auth/google/callback/" ||
    pathname === "/api/auth/microsoft/callback" ||
    pathname === "/api/auth/microsoft/callback/"
  ) {
    const targetLocation = new URL(
      `${pathname}${request.nextUrl.search}`,
      resolveAuthOrigin(request),
    ).toString();

    if (targetLocation !== currentLocation) {
      return buildRedirectResponse(request, requestId, csp, targetLocation);
    }
  }

  return null;
}

function maybeBuildCanonicalPaymentRedirect(
  request: NextRequest,
  requestId: string,
  csp: string,
) {
  const pathname = request.nextUrl.pathname;
  const canonicalHost = detectCanonicalHostFromRequest(request);

  if (
    canonicalHost === "pay" &&
    (pathname === "/" || pathname === "")
  ) {
    const targetLocation = buildCanonicalPaymentUrl(
      request,
      DEFAULT_PAYMENT_CHECKOUT_PATH,
      request.nextUrl.search,
    );

    if (targetLocation && targetLocation !== getCurrentRequestLocation(request)) {
      return buildRedirectResponse(request, requestId, csp, targetLocation, 308);
    }

    return null;
  }

  if (pathname !== "/payment" && !pathname.startsWith("/payment/")) {
    return null;
  }

  const currentLocation = getCurrentRequestLocation(request);
  const targetPathname =
    pathname === "/payment" || pathname === "/payment/"
      ? DEFAULT_PAYMENT_CHECKOUT_PATH
      : pathname;
  const targetLocation = buildCanonicalPaymentUrl(
    request,
    targetPathname,
    request.nextUrl.search,
  );

  if (targetLocation && targetLocation !== currentLocation) {
    return buildRedirectResponse(request, requestId, csp, targetLocation, 308);
  }

  return null;
}

function maybeBuildLoginErrorFlashRedirect(
  request: NextRequest,
  requestId: string,
  csp: string,
) {
  const pathname = request.nextUrl.pathname;
  if (pathname !== "/login" && pathname !== "/login/") {
    return null;
  }

  const errorCode = request.nextUrl.searchParams.get("error")?.trim();
  if (!errorCode) {
    return null;
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.searchParams.delete("error");

  const response = buildRedirectResponse(
    request,
    requestId,
    csp,
    redirectUrl.toString(),
  );

  const payload: LoginErrorFlashPayload = {
    id: crypto.randomUUID(),
    code: errorCode,
    createdAt: Date.now(),
  };

  response.cookies.set(
    LOGIN_ERROR_FLASH_COOKIE_NAME,
    encodeLoginErrorFlashPayload(payload),
    {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60,
    },
  );

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function maybeBuildCanonicalWorkspaceRedirect(
  request: NextRequest,
  requestHeaders: Headers,
  requestId: string,
  csp: string,
) {
  const pathname = request.nextUrl.pathname;
  const currentLocation = getCurrentRequestLocation(request);
  const hostArea = detectWorkspaceAreaFromRequestHost(request);
  const pathArea = detectWorkspaceAreaFromPath(pathname);

  if (pathArea) {
    const externalPath = getWorkspaceAreaExternalPath(pathArea, pathname);
    const targetLocation = buildCanonicalWorkspaceUrl(
      request,
      pathArea,
      externalPath,
      request.nextUrl.search,
    );

    if (targetLocation && targetLocation !== currentLocation) {
      return buildRedirectResponse(request, requestId, csp, targetLocation, 308);
    }

    return null;
  }

  if (!hostArea) {
    return null;
  }

  if (isStaticPublicAssetPath(pathname)) {
    return null;
  }

  if (isCanonicalPublicPath(pathname)) {
    const fallbackArea = pathname.startsWith("/login") ? "account" : "public";
    const targetLocation = buildCanonicalUrlFromInternalPath(
      request,
      `${pathname}${request.nextUrl.search}`,
      {
        fallbackArea,
      },
    );

    if (targetLocation !== currentLocation) {
      return buildRedirectResponse(request, requestId, csp, targetLocation);
    }

    return null;
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return null;
  }

  const rewritePath = getWorkspaceAreaInternalPath(hostArea, pathname);
  if (rewritePath !== pathname) {
    return buildRewriteResponse(
      request,
      requestHeaders,
      requestId,
      csp,
      rewritePath,
    );
  }

  return null;
}

export function proxy(request: NextRequest) {
  const requestId =
    request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const isOAuthHandshakeRequest = isOAuthHandshakePath(request.nextUrl.pathname);
  const loginErrorFlash = decodeLoginErrorFlashPayload(
    request.cookies.get(LOGIN_ERROR_FLASH_COOKIE_NAME)?.value,
  );

  if (loginErrorFlash) {
    requestHeaders.set(
      LOGIN_ERROR_FLASH_HEADER_NAME,
      encodeLoginErrorFlashPayload(loginErrorFlash),
    );
  }

  const csp = buildContentSecurityPolicy({
    isDevelopment: process.env.NODE_ENV !== "production",
  });

  if (!isOAuthHandshakeRequest) {
    const canonicalHostRedirectResponse = maybeBuildCanonicalHostRedirect(
      request,
      requestId,
      csp,
    );
    if (canonicalHostRedirectResponse) {
      return canonicalHostRedirectResponse;
    }

  const authRedirectResponse = maybeBuildCanonicalAuthRedirect(
    request,
    requestId,
    csp,
  );
  if (authRedirectResponse) {
    return authRedirectResponse;
  }

  const paymentRedirectResponse = maybeBuildCanonicalPaymentRedirect(
    request,
    requestId,
    csp,
  );
  if (paymentRedirectResponse) {
    return paymentRedirectResponse;
  }
  }

  const loginErrorFlashRedirectResponse = maybeBuildLoginErrorFlashRedirect(
    request,
    requestId,
    csp,
  );
  if (loginErrorFlashRedirectResponse) {
    return loginErrorFlashRedirectResponse;
  }

  if (!isOAuthHandshakeRequest) {
    const workspaceRedirectResponse = maybeBuildCanonicalWorkspaceRedirect(
      request,
      requestHeaders,
      requestId,
      csp,
    );
    if (workspaceRedirectResponse) {
      return workspaceRedirectResponse;
    }
  }

  if (
    request.nextUrl.pathname === "/api/auth/discord/callback" ||
    request.nextUrl.pathname === "/api/auth/discord/callback/"
  ) {
    return buildRewriteResponse(
      request,
      requestHeaders,
      requestId,
      csp,
      "/api/auth/discord-callback",
    );
  }

  if (
    requiresSameOriginProtection(request.nextUrl.pathname, request.method) &&
    !isSameOriginRequest(request)
  ) {
    return buildProtectedErrorResponse(request, requestId, csp);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  applyStandardSecurityHeaders(response, {
    contentSecurityPolicy: csp,
    requestId,
    noIndex: request.nextUrl.pathname.startsWith("/api/"),
  });

  if (isSensitiveApiPath(request.nextUrl.pathname)) {
    applySensitiveApiHeaders(response);
  }

  if (loginErrorFlash) {
    response.cookies.delete(LOGIN_ERROR_FLASH_COOKIE_NAME);
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
