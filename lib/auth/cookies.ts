import crypto from "node:crypto";
import type { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/config";
import {
  getRequestProtocol,
  resolveCookieDomainForRequest,
} from "@/lib/routing/subdomains";

type RequestLike = Pick<Request, "headers" | "url">;

type SharedAuthCookieOptions = {
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  priority?: "low" | "medium" | "high";
  sameSite?: "lax" | "strict" | "none";
};

export type SharedAuthCookieIntegrityStatus = "valid" | "legacy" | "invalid";

const SHARED_AUTH_COOKIE_PROOF_VERSION = "v1";

function buildSharedCookieOptionVariants(
  request: RequestLike,
  options: SharedAuthCookieOptions,
) {
  const baseOptions = {
    ...options,
    path: options.path || "/",
    secure: getRequestProtocol(request) === "https",
  };
  const domain = resolveCookieDomainForRequest(request);

  if (!domain) {
    return [baseOptions];
  }

  return [baseOptions, { ...baseOptions, domain }];
}

function resolveSharedAuthCookieSecret() {
  const candidates = [
    process.env.AUTH_COOKIE_SECRET,
    process.env.AUTH_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.DISCORD_CLIENT_SECRET,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "flowdesk-shared-auth-cookie-secret";
}

function hashCookieValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function signCookieProofPayload(payload: string) {
  return crypto
    .createHmac("sha256", resolveSharedAuthCookieSecret())
    .update(payload)
    .digest("base64url");
}

function secureTokenEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildCookieProofValue(name: string, value: string, maxAgeSeconds: number) {
  const expiresAtEpochSeconds =
    Math.floor(Date.now() / 1000) + Math.max(1, Math.ceil(maxAgeSeconds));
  const valueHash = hashCookieValue(value);
  const payload =
    `${SHARED_AUTH_COOKIE_PROOF_VERSION}.${name}.${expiresAtEpochSeconds}.${valueHash}`;
  const signature = signCookieProofPayload(payload);
  return `${payload}.${signature}`;
}

export function getSharedAuthCookieProofName(name: string) {
  return `${name}__proof`;
}

export function setSharedAuthCookie(
  request: RequestLike,
  response: NextResponse,
  name: string,
  value: string,
  options: SharedAuthCookieOptions,
) {
  for (const cookieOptions of buildSharedCookieOptionVariants(request, options)) {
    response.cookies.set(name, value, cookieOptions);
  }
}

export function clearSharedAuthCookie(
  request: RequestLike,
  response: NextResponse,
  name: string,
  options: SharedAuthCookieOptions = {},
) {
  response.cookies.delete(name);
  for (const cookieOptions of buildSharedCookieOptionVariants(request, options)) {
    response.cookies.set(name, "", {
      ...cookieOptions,
      expires: new Date(0),
      maxAge: 0,
    });
  }
}

export function validateSharedAuthCookieIntegrity(
  name: string,
  cookieValue: string | null | undefined,
  proofValue: string | null | undefined,
): SharedAuthCookieIntegrityStatus {
  if (!cookieValue) {
    return "invalid";
  }

  if (!proofValue) {
    return "legacy";
  }

  const segments = proofValue.split(".");
  if (segments.length !== 5) {
    return "invalid";
  }

  const [version, proofName, expiresAtRaw, valueHash, signature] = segments;
  if (version !== SHARED_AUTH_COOKIE_PROOF_VERSION || proofName !== name) {
    return "invalid";
  }

  const expiresAtEpochSeconds = Number(expiresAtRaw);
  if (!Number.isInteger(expiresAtEpochSeconds)) {
    return "invalid";
  }

  if (expiresAtEpochSeconds <= Math.floor(Date.now() / 1000)) {
    return "invalid";
  }

  const expectedValueHash = hashCookieValue(cookieValue);
  if (!secureTokenEquals(valueHash, expectedValueHash)) {
    return "invalid";
  }

  const payload = `${version}.${proofName}.${expiresAtRaw}.${valueHash}`;
  const expectedSignature = signCookieProofPayload(payload);
  return secureTokenEquals(signature, expectedSignature) ? "valid" : "invalid";
}

export function setSharedSessionCookie(
  request: RequestLike,
  response: NextResponse,
  sessionToken: string,
  options?: {
    maxAge?: number;
  },
) {
  const maxAge =
    typeof options?.maxAge === "number" && Number.isFinite(options.maxAge) && options.maxAge > 0
      ? Math.max(60, Math.trunc(options.maxAge))
      : authConfig.sessionTtlHours * 60 * 60;

  setSharedAuthCookie(request, response, authConfig.sessionCookieName, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    maxAge,
    path: "/",
    priority: "high",
  });
  setSharedAuthCookie(
    request,
    response,
    getSharedAuthCookieProofName(authConfig.sessionCookieName),
    buildCookieProofValue(authConfig.sessionCookieName, sessionToken, maxAge),
    {
      httpOnly: true,
      sameSite: "lax",
      maxAge,
      path: "/",
      priority: "high",
    },
  );
}

export function clearSharedSessionCookie(
  request: RequestLike,
  response: NextResponse,
) {
  clearSharedAuthCookie(request, response, authConfig.sessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    priority: "high",
  });
  clearSharedAuthCookie(
    request,
    response,
    getSharedAuthCookieProofName(authConfig.sessionCookieName),
    {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    },
  );
}

export function setSharedTrustedDeviceCookie(
  request: RequestLike,
  response: NextResponse,
  token: string,
) {
  const maxAge = authConfig.rememberedDeviceDays * 24 * 60 * 60;

  setSharedAuthCookie(
    request,
    response,
    authConfig.rememberedDeviceCookieName,
    token,
    {
      httpOnly: true,
      sameSite: "lax",
      maxAge,
      path: "/",
      priority: "high",
    },
  );
  setSharedAuthCookie(
    request,
    response,
    getSharedAuthCookieProofName(authConfig.rememberedDeviceCookieName),
    buildCookieProofValue(authConfig.rememberedDeviceCookieName, token, maxAge),
    {
      httpOnly: true,
      sameSite: "lax",
      maxAge,
      path: "/",
      priority: "high",
    },
  );
}

export function clearSharedTrustedDeviceCookie(
  request: RequestLike,
  response: NextResponse,
) {
  clearSharedAuthCookie(
    request,
    response,
    authConfig.rememberedDeviceCookieName,
    {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    },
  );
  clearSharedAuthCookie(
    request,
    response,
    getSharedAuthCookieProofName(authConfig.rememberedDeviceCookieName),
    {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    },
  );
}
