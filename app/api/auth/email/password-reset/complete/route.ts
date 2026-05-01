import { NextResponse } from "next/server";
import {
  consumePasswordResetToken,
  resolvePasswordResetToken,
} from "@/lib/auth/passwordReset";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";

const TOKEN_DTO = flowSecureDto.string({
  minLength: 50,
  maxLength: 50,
  pattern: /^\d{50}$/,
  rejectThreatPatterns: false,
});

export async function POST(request: Request) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) return originGuard;

  const requestContext = createSecurityRequestContext(request);
  let payload: {
    token: string;
    password: string;
    confirmPassword: string;
  };

  try {
    payload = parseFlowSecureDto(
      await request.json().catch(() => ({})),
      {
        token: TOKEN_DTO,
        password: flowSecureDto.string({
          minLength: 1,
          maxLength: 512,
          rejectThreatPatterns: false,
          disallowAngleBrackets: false,
        }),
        confirmPassword: flowSecureDto.string({
          minLength: 1,
          maxLength: 512,
          rejectThreatPatterns: false,
          disallowAngleBrackets: false,
        }),
      },
      { rejectUnknown: true },
    );
  } catch (error) {
    const message =
      error instanceof FlowSecureDtoError
        ? error.issues[0] || error.message
        : "Payload invalido.";
    return attachRequestId(
      applyNoStoreHeaders(NextResponse.json({ ok: false, message }, { status: 400 })),
      requestContext.requestId,
    );
  }

  const rateLimit = await enforceRequestRateLimit({
    action: "auth_password_reset_complete",
    windowMs: 10 * 60 * 1000,
    maxAttempts: 12,
    context: requestContext,
  });

  if (!rateLimit.ok) {
    const response = applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: "Muitas tentativas seguidas. Aguarde alguns segundos." },
        { status: 429 },
      ),
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return attachRequestId(response, requestContext.requestId);
  }

  try {
    const result = await consumePasswordResetToken(payload);
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_password_reset_complete",
      outcome: "succeeded",
    });

    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          email: result.email,
          redirectTo: `/login?email=${encodeURIComponent(result.email)}`,
        }),
      ),
      requestContext.requestId,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nao foi possivel redefinir sua senha.";
    await logSecurityAuditEventSafe(requestContext, {
      action: "auth_password_reset_complete",
      outcome: "failed",
      metadata: { reason: message },
    });

    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json({ ok: false, message }, { status: 400 }),
      ),
      requestContext.requestId,
    );
  }
}

export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";

  try {
    const resolved = await resolvePasswordResetToken(token);
    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json({
          ok: resolved.ok,
          reason: resolved.ok ? null : resolved.reason,
          email: resolved.ok ? resolved.email : null,
        }),
      ),
      requestContext.requestId,
    );
  } catch {
    return attachRequestId(
      applyNoStoreHeaders(
        NextResponse.json({ ok: false, reason: "invalid", email: null }),
      ),
      requestContext.requestId,
    );
  }
}
