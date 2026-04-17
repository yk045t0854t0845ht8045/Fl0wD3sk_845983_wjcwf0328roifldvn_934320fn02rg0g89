import { NextRequest, NextResponse } from "next/server";
import {
  applyStandardSecurityHeaders,
  buildContentSecurityPolicy,
  isSameOriginRequest,
} from "@/lib/security/http";

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

export function proxy(request: NextRequest) {
  const requestId =
    request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const csp = buildContentSecurityPolicy({
    isDevelopment: process.env.NODE_ENV !== "production",
  });

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
