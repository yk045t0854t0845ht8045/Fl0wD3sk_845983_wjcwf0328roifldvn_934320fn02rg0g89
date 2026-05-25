import { NextResponse } from "next/server";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
} from "@/lib/security/requestSecurity";
import { startDeveloperLoginAttempt } from "@/lib/test-variables/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      requestContext.requestId,
    );

  try {
    const originGuard = ensureSameOriginJsonMutationRequest(request);
    if (originGuard) {
      return attachRequestId(applyNoStoreHeaders(originGuard), requestContext.requestId);
    }

    const rateLimit = await enforceRequestRateLimit({
      action: "dev_auth_login_start",
      windowMs: 10 * 60 * 1000,
      maxAttempts: 20,
      context: requestContext,
    });

    if (!rateLimit.ok) {
      const response = respond(
        { ok: false, message: "Muitas tentativas de login dev. Aguarde." },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    let body: { redirectUrl?: string | null };
    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          redirectUrl: flowSecureDto.optional(
            flowSecureDto.nullable(flowSecureDto.internalPath()),
          ),
        },
        { rejectUnknown: true },
      );
    } catch (error) {
      if (!(error instanceof FlowSecureDtoError)) {
        throw error;
      }

      return respond(
        { ok: false, message: error.issues[0] || error.message },
        { status: 400 },
      );
    }

    const attempt = await startDeveloperLoginAttempt({
      redirectUrl: body.redirectUrl || null,
    });

    return respond({
      ok: true,
      verificationUrl: attempt.verificationUrl,
      attemptToken: attempt.attemptToken,
      pollToken: attempt.pollToken,
      expiresAt: attempt.expiresAt,
    });
  } catch (error) {
    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Nao foi possivel iniciar o login do CLI.",
        ),
      },
      { status: 500 },
    );
  }
}
