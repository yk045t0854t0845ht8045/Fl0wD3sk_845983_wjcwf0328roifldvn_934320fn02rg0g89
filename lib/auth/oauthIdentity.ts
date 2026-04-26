import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import {
  getOAuthModeCookieName,
  getOAuthNextPathCookieName,
  getOAuthRedirectUriCookieName,
  getOAuthStateCookieName,
  normalizeInternalNextPath,
  type OAuthProvider,
} from "@/lib/auth/config";
import {
  clearSharedAuthCookie,
  setSharedAuthCookie,
} from "@/lib/auth/cookies";
import { getRequestOrigin } from "@/lib/routing/subdomains";
import { constantTimeEqualText } from "@/lib/security/flowSecure";

const OAUTH_COOKIE_TTL_SECONDS = 60 * 10;
const OAUTH_PKCE_METHOD = "S256";
const OAUTH_STATE_PREFIX = "fs1";

type OAuthMode = "login" | "link";

type OAuthProviderIdentityMetadata = {
  provider: OAuthProvider;
  protocol: "oauth2" | "oidc";
  pkceRequired: boolean;
  nonceRequired: boolean;
  oidcIssuers: string[];
};

type OAuthTransactionInput = {
  provider: OAuthProvider;
  state: string;
  redirectUri: string;
  requestedMode: OAuthMode;
  requestedNextPath?: string | null;
  pkceVerifier?: string | null;
  nonce?: string | null;
};

type ValidatedOAuthTransaction = {
  state: string;
  redirectUri: string;
  nextPath: string | null;
  mode: OAuthMode;
  pkceVerifier: string | null;
  nonce: string | null;
};

type SignedOAuthStatePayload = {
  v: 1;
  p: OAuthProvider;
  r: string;
  u: string;
  m: OAuthMode;
  n?: string | null;
  pk?: string | null;
  no?: string | null;
  iat: number;
  exp: number;
};

function readCookieValues(request: NextRequest, name: string) {
  const values = request.cookies
    .getAll(name)
    .map((cookie) => cookie.value)
    .filter((value) => typeof value === "string" && value.length > 0);

  if (values.length > 0) {
    return values;
  }

  const fallbackValue = request.cookies.get(name)?.value;
  return fallbackValue ? [fallbackValue] : [];
}

function readFirstCookieValue(request: NextRequest, name: string) {
  return readCookieValues(request, name)[0] || null;
}

function resolveOAuthStateSecret() {
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

  return "flowdesk-oauth-state-dev-secret";
}

function signOAuthStatePayload(payload: string) {
  return crypto
    .createHmac("sha256", resolveOAuthStateSecret())
    .update(payload)
    .digest("base64url");
}

function encodeOAuthStatePayload(payload: SignedOAuthStatePayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = signOAuthStatePayload(encodedPayload);
  return `${OAUTH_STATE_PREFIX}.${encodedPayload}.${signature}`;
}

function decodeOAuthStatePayload(
  provider: OAuthProvider,
  returnedState: string | null | undefined,
) {
  if (!returnedState?.startsWith(`${OAUTH_STATE_PREFIX}.`)) {
    return null;
  }

  const segments = returnedState.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [, encodedPayload, signature] = segments;
  const expectedSignature = signOAuthStatePayload(encodedPayload);
  if (!constantTimeEqualText(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<SignedOAuthStatePayload>;
    const now = Math.floor(Date.now() / 1000);

    if (
      payload.v !== 1 ||
      payload.p !== provider ||
      typeof payload.r !== "string" ||
      payload.r.length < 16 ||
      typeof payload.u !== "string" ||
      !payload.u.trim() ||
      (payload.m !== "login" && payload.m !== "link") ||
      typeof payload.exp !== "number" ||
      payload.exp < now ||
      typeof payload.iat !== "number" ||
      payload.iat > now + 60
    ) {
      return null;
    }

    return payload as SignedOAuthStatePayload;
  } catch {
    return null;
  }
}

function pickReturnedStateCookie(
  stateCookieValues: string[],
  returnedState: string | null | undefined,
) {
  if (!returnedState) {
    return null;
  }

  return (
    stateCookieValues.find((cookieValue) =>
      constantTimeEqualText(returnedState, cookieValue),
    ) || null
  );
}

function pickRedirectUriCookie(
  request: NextRequest,
  redirectUriCookieValues: string[],
) {
  if (redirectUriCookieValues.length <= 1) {
    return redirectUriCookieValues[0] || null;
  }

  const currentOrigin = request.nextUrl.origin;
  const sameOriginValue = redirectUriCookieValues.find((value) => {
    try {
      return new URL(value).origin === currentOrigin;
    } catch {
      return false;
    }
  });

  return sameOriginValue || redirectUriCookieValues[0] || null;
}

function validateSignedOAuthTransactionFromState(
  request: NextRequest,
  provider: OAuthProvider,
  returnedState: string | null | undefined,
): ValidatedOAuthTransaction | null {
  const payload = decodeOAuthStatePayload(provider, returnedState);
  if (!payload) {
    return null;
  }

  let redirectUri: string;
  try {
    redirectUri = new URL(payload.u).toString();
  } catch {
    redirectUri = new URL(
      `/api/auth/${provider}/callback`,
      getRequestOrigin(request),
    ).toString();
  }

  return {
    state: returnedState || payload.r,
    redirectUri,
    nextPath: normalizeInternalNextPath(payload.n),
    mode: payload.m,
    pkceVerifier: typeof payload.pk === "string" ? payload.pk : null,
    nonce: typeof payload.no === "string" ? payload.no : null,
  };
}

const OAUTH_PROVIDER_IDENTITY_REGISTRY: Record<
  OAuthProvider,
  OAuthProviderIdentityMetadata
> = {
  discord: {
    provider: "discord",
    protocol: "oauth2",
    pkceRequired: false,
    nonceRequired: false,
    oidcIssuers: [],
  },
  google: {
    provider: "google",
    protocol: "oidc",
    pkceRequired: true,
    nonceRequired: true,
    oidcIssuers: ["https://accounts.google.com", "accounts.google.com"],
  },
  microsoft: {
    provider: "microsoft",
    protocol: "oidc",
    pkceRequired: true,
    nonceRequired: true,
    oidcIssuers: ["https://login.microsoftonline.com"],
  },
};

function buildOAuthCookieName(provider: OAuthProvider, suffix: string) {
  return `flowdesk_oauth_${provider}_${suffix}`;
}

function getOAuthPkceVerifierCookieName(provider: OAuthProvider) {
  return buildOAuthCookieName(provider, "pkce_verifier");
}

function getOAuthNonceCookieName(provider: OAuthProvider) {
  return buildOAuthCookieName(provider, "nonce");
}

function decodeJwtPayload(token: string) {
  const segments = token.split(".");
  if (segments.length < 2) {
    throw new Error("ID token retornou formato invalido.");
  }

  const payload = segments[1];
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(paddingLength);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
    string,
    unknown
  >;
}

export function getOAuthProviderIdentityMetadata(provider: OAuthProvider) {
  return OAUTH_PROVIDER_IDENTITY_REGISTRY[provider];
}

export function createOAuthPkcePair() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64url");

  return {
    verifier,
    challenge,
    method: OAUTH_PKCE_METHOD,
  };
}

export function createOAuthNonce() {
  return crypto.randomBytes(24).toString("base64url");
}

export function createOAuthTransactionState(
  input: Omit<OAuthTransactionInput, "state">,
) {
  const now = Math.floor(Date.now() / 1000);
  return encodeOAuthStatePayload({
    v: 1,
    p: input.provider,
    r: crypto.randomBytes(18).toString("base64url"),
    u: input.redirectUri,
    m: input.requestedMode,
    n: normalizeInternalNextPath(input.requestedNextPath),
    pk: input.pkceVerifier || null,
    no: input.nonce || null,
    iat: now,
    exp: now + OAUTH_COOKIE_TTL_SECONDS,
  });
}

export function setOAuthTransactionCookies(
  request: NextRequest,
  response: NextResponse,
  input: OAuthTransactionInput,
) {
  setSharedAuthCookie(
    request,
    response,
    getOAuthStateCookieName(input.provider),
    input.state,
    {
      httpOnly: true,
      sameSite: "lax",
      maxAge: OAUTH_COOKIE_TTL_SECONDS,
      path: "/",
      priority: "high",
    },
  );

  setSharedAuthCookie(
    request,
    response,
    getOAuthRedirectUriCookieName(input.provider),
    input.redirectUri,
    {
      httpOnly: true,
      sameSite: "lax",
      maxAge: OAUTH_COOKIE_TTL_SECONDS,
      path: "/",
      priority: "high",
    },
  );

  setSharedAuthCookie(
    request,
    response,
    getOAuthModeCookieName(input.provider),
    input.requestedMode,
    {
      httpOnly: true,
      sameSite: "lax",
      maxAge: OAUTH_COOKIE_TTL_SECONDS,
      path: "/",
      priority: "high",
    },
  );

  if (input.requestedNextPath) {
    setSharedAuthCookie(
      request,
      response,
      getOAuthNextPathCookieName(input.provider),
      input.requestedNextPath,
      {
        httpOnly: true,
        sameSite: "lax",
        maxAge: OAUTH_COOKIE_TTL_SECONDS,
        path: "/",
        priority: "high",
      },
    );
  } else {
    clearSharedAuthCookie(request, response, getOAuthNextPathCookieName(input.provider), {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    });
  }

  if (input.pkceVerifier) {
    setSharedAuthCookie(
      request,
      response,
      getOAuthPkceVerifierCookieName(input.provider),
      input.pkceVerifier,
      {
        httpOnly: true,
        sameSite: "lax",
        maxAge: OAUTH_COOKIE_TTL_SECONDS,
        path: "/",
        priority: "high",
      },
    );
  } else {
    clearSharedAuthCookie(request, response, getOAuthPkceVerifierCookieName(input.provider), {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    });
  }

  if (input.nonce) {
    setSharedAuthCookie(
      request,
      response,
      getOAuthNonceCookieName(input.provider),
      input.nonce,
      {
        httpOnly: true,
        sameSite: "lax",
        maxAge: OAUTH_COOKIE_TTL_SECONDS,
        path: "/",
        priority: "high",
      },
    );
  } else {
    clearSharedAuthCookie(request, response, getOAuthNonceCookieName(input.provider), {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    });
  }
}

export function clearOAuthTransactionCookies(
  request: NextRequest,
  response: NextResponse,
  provider: OAuthProvider,
) {
  for (const name of [
    getOAuthStateCookieName(provider),
    getOAuthRedirectUriCookieName(provider),
    getOAuthNextPathCookieName(provider),
    getOAuthModeCookieName(provider),
    getOAuthPkceVerifierCookieName(provider),
    getOAuthNonceCookieName(provider),
  ]) {
    clearSharedAuthCookie(request, response, name, {
      httpOnly: true,
      sameSite: "lax",
      priority: "high",
    });
  }
}

export function validateOAuthTransactionFromRequest(
  request: NextRequest,
  provider: OAuthProvider,
  returnedState: string | null | undefined,
): ValidatedOAuthTransaction | null {
  const stateCookie = pickReturnedStateCookie(
    readCookieValues(request, getOAuthStateCookieName(provider)),
    returnedState,
  );
  const redirectUriCookie = pickRedirectUriCookie(
    request,
    readCookieValues(request, getOAuthRedirectUriCookieName(provider)),
  );
  const nextPathCookie = readFirstCookieValue(
    request,
    getOAuthNextPathCookieName(provider),
  );
  const modeCookie =
    readFirstCookieValue(request, getOAuthModeCookieName(provider)) === "link"
      ? "link"
      : "login";
  const pkceVerifierCookie = readFirstCookieValue(
    request,
    getOAuthPkceVerifierCookieName(provider),
  );
  const nonceCookie = readFirstCookieValue(
    request,
    getOAuthNonceCookieName(provider),
  );

  if (!returnedState || !stateCookie || !redirectUriCookie) {
    return validateSignedOAuthTransactionFromState(
      request,
      provider,
      returnedState,
    );
  }

  return {
    state: stateCookie,
    redirectUri: redirectUriCookie,
    nextPath: nextPathCookie,
    mode: modeCookie,
    pkceVerifier: pkceVerifierCookie,
    nonce: nonceCookie,
  };
}

export function validateOidcIdTokenClaims(input: {
  provider: Extract<OAuthProvider, "google" | "microsoft">;
  idToken: string | null | undefined;
  expectedAudience: string;
  expectedNonce: string | null | undefined;
}) {
  if (!input.idToken) {
    return {
      ok: false,
      reason: "missing_id_token",
    } as const;
  }

  try {
    const payload = decodeJwtPayload(input.idToken);
    const issuer = typeof payload.iss === "string" ? payload.iss.trim() : "";
    const audience = payload.aud;
    const nonce = typeof payload.nonce === "string" ? payload.nonce.trim() : "";
    const exp =
      typeof payload.exp === "number"
        ? payload.exp
        : typeof payload.exp === "string"
          ? Number(payload.exp)
          : Number.NaN;
    const metadata = getOAuthProviderIdentityMetadata(input.provider);

    const issuerOk =
      input.provider === "microsoft"
        ? metadata.oidcIssuers.some((allowedIssuer) => issuer.startsWith(allowedIssuer))
        : metadata.oidcIssuers.includes(issuer);
    const audienceOk =
      typeof audience === "string"
        ? audience === input.expectedAudience
        : Array.isArray(audience)
          ? audience.includes(input.expectedAudience)
          : false;
    const nonceOk =
      !metadata.nonceRequired ||
      Boolean(input.expectedNonce && constantTimeEqualText(nonce, input.expectedNonce));
    const expOk = Number.isFinite(exp) && exp * 1000 > Date.now() - 30_000;

    return {
      ok: issuerOk && audienceOk && nonceOk && expOk,
      reason: issuerOk
        ? audienceOk
          ? nonceOk
            ? expOk
              ? null
              : "expired_id_token"
            : "invalid_oidc_nonce"
          : "invalid_oidc_audience"
        : "invalid_oidc_issuer",
    } as const;
  } catch {
    return {
      ok: false,
      reason: "invalid_id_token_payload",
    } as const;
  }
}
