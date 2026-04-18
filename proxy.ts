import { NextRequest, NextResponse } from "next/server";
import {
  applyStandardSecurityHeaders,
  buildContentSecurityPolicy,
  isSameOriginRequest,
} from "@/lib/security/http";
import {
  buildCanonicalUrlFromInternalPath,
  buildCanonicalWorkspaceUrl,
  detectWorkspaceAreaFromPath,
  detectWorkspaceAreaFromRequestHost,
  getRequestOrigin,
  getWorkspaceAreaExternalPath,
  getWorkspaceAreaInternalPath,
  isCanonicalPublicPath,
  resolveAuthOrigin,
} from "@/lib/routing/subdomains";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isSensitiveApiPath(pathname: string) {
  return (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/internal/") ||
    pathname.startsWith("/api/payments/") ||
    pathname.startsWith("/api/transcripts/") ||
    pathname.startsWith("/api/tickets/")
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

  const csp = buildContentSecurityPolicy({
    isDevelopment: process.env.NODE_ENV !== "production",
  });

  const authRedirectResponse = maybeBuildCanonicalAuthRedirect(
    request,
    requestId,
    csp,
  );
  if (authRedirectResponse) {
    return authRedirectResponse;
  }

  const workspaceRedirectResponse = maybeBuildCanonicalWorkspaceRedirect(
    request,
    requestHeaders,
    requestId,
    csp,
  );
  if (workspaceRedirectResponse) {
    return workspaceRedirectResponse;
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

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
