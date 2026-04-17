import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authConfig } from "@/lib/auth/config";
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

/** Nomes de todos os cookies criados pelo sistema de auth. */
const AUTH_COOKIE_NAMES = [
  authConfig.sessionCookieName,
  authConfig.oauthStateCookieName,
  authConfig.oauthRedirectUriCookieName,
  authConfig.oauthNextPathCookieName,
  authConfig.oauthModeCookieName,
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

    // Apagar todos os cookies de auth da resposta e do cookie store do servidor.
    const cookieStore = await cookies();
    const response = NextResponse.json({ ok: true });
    for (const name of AUTH_COOKIE_NAMES) {
      // Remove do store do Next.js (server-side)
      try { cookieStore.delete(name); } catch { /* noop */ }
      // Remove do header Set-Cookie da resposta (garante expiração no browser)
      response.cookies.set(name, "", {
        maxAge: 0,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
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
