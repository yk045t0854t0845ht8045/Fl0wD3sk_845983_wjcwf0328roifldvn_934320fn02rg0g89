import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  authConfig,
  getOAuthModeCookieName,
  getOAuthNextPathCookieName,
  getOAuthRedirectUriCookieName,
  getOAuthStateCookieName,
} from "@/lib/auth/config";
import {
  clearSharedAuthCookie,
  clearSharedSessionCookie,
  clearSharedTrustedDeviceCookie,
  getSharedAuthCookieProofName,
} from "@/lib/auth/cookies";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { revokeCurrentSessionFromCookie } from "@/lib/auth/session";

/** Cookies de sessao/OAuth que devem ser limpos no logout. */
const AUTH_COOKIE_NAMES = [
  getOAuthStateCookieName("discord"),
  getOAuthRedirectUriCookieName("discord"),
  getOAuthNextPathCookieName("discord"),
  getOAuthModeCookieName("discord"),
  getOAuthStateCookieName("google"),
  getOAuthRedirectUriCookieName("google"),
  getOAuthNextPathCookieName("google"),
  getOAuthModeCookieName("google"),
  getOAuthStateCookieName("microsoft"),
  getOAuthRedirectUriCookieName("microsoft"),
  getOAuthNextPathCookieName("microsoft"),
  getOAuthModeCookieName("microsoft"),
] as const;

const SESSION_COOKIE_NAMES = [
  authConfig.sessionCookieName,
  getSharedAuthCookieProofName(authConfig.sessionCookieName),
] as const;

const TRUSTED_DEVICE_COOKIE_NAMES = [
  authConfig.rememberedDeviceCookieName,
  getSharedAuthCookieProofName(authConfig.rememberedDeviceCookieName),
] as const;

export async function POST(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) return attachRequestId(securityResponse, requestContext.requestId);

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_logout",
      outcome: "started",
    });

    await revokeCurrentSessionFromCookie();

    const logoutPayload = await request
      .json()
      .catch(() => ({})) as { forgetTrustedDevice?: unknown };
    const forgetTrustedDevice = logoutPayload.forgetTrustedDevice === true;

    // Apagar todos os cookies de auth da resposta e do cookie store do servidor.
    const cookieStore = await cookies();
    const response = NextResponse.json({ ok: true });
    for (const name of SESSION_COOKIE_NAMES) {
      try { cookieStore.delete(name); } catch { /* noop */ }
    }
    clearSharedSessionCookie(request, response);

    if (forgetTrustedDevice) {
      for (const name of TRUSTED_DEVICE_COOKIE_NAMES) {
        try { cookieStore.delete(name); } catch { /* noop */ }
      }
      clearSharedTrustedDeviceCookie(request, response);
    }

    for (const name of AUTH_COOKIE_NAMES) {
      // Remove do store do Next.js (server-side)
      try { cookieStore.delete(name); } catch { /* noop */ }
      // Remove do header Set-Cookie da resposta (garante expiração no browser)
      clearSharedAuthCookie(request, response, name, {
        httpOnly: true,
        sameSite: "lax",
      });
    }

    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_logout",
      outcome: "succeeded",
    });
    return attachRequestId(applyNoStoreHeaders(response), requestContext.requestId);
  } catch (error) {
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_logout",
      outcome: "failed",
      metadata: {
        message: extractAuditErrorMessage(error),
      },
    });
    return attachRequestId(applyNoStoreHeaders(
      NextResponse.json(
      {
        ok: false,
        message: sanitizeErrorMessage(error, "Erro ao encerrar sessao."),
      },
      { status: 500 },
      ),
    ), requestContext.requestId);
  }
}
