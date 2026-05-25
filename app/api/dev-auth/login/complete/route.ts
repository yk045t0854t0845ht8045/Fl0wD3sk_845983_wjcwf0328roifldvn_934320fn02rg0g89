import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
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
import {
  completeDeveloperLoginAttempt,
  pollDeveloperLoginAttempt,
} from "@/lib/test-variables/auth";

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
    const rateLimit = await enforceRequestRateLimit({
      action: "dev_auth_login_complete",
      windowMs: 10 * 60 * 1000,
      maxAttempts: 60,
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

    let body:
      | {
          attemptToken?: string;
          pollToken?: string;
          label?: string | null;
        }
      | null;

    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => null),
        {
          attemptToken: flowSecureDto.optional(
            flowSecureDto.base64UrlToken({
              minLength: 24,
              maxLength: 96,
            }),
          ),
          pollToken: flowSecureDto.optional(
            flowSecureDto.base64UrlToken({
              minLength: 24,
              maxLength: 96,
            }),
          ),
          label: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.string({
                maxLength: 120,
                normalizeWhitespace: true,
                disallowAngleBrackets: true,
              }),
            ),
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

    if (!body || typeof body !== "object") {
      return respond(
        { ok: false, message: "Payload de login dev invalido." },
        { status: 400 },
      );
    }

    if (typeof body.pollToken === "string" && body.pollToken.trim()) {
      const polled = await pollDeveloperLoginAttempt({
        pollToken: body.pollToken.trim(),
      });
      return respond({
        ok: true,
        ...polled,
      });
    }

    if (typeof body.attemptToken === "string" && body.attemptToken.trim()) {
      const originGuard = ensureSameOriginJsonMutationRequest(request);
      if (originGuard) {
        return attachRequestId(applyNoStoreHeaders(originGuard), requestContext.requestId);
      }

      const authSession = await getCurrentAuthSessionFromCookie();
      if (!authSession) {
        return respond(
          { ok: false, message: "Sessao Flowdesk invalida." },
          { status: 401 },
        );
      }

      const completed = await completeDeveloperLoginAttempt({
        attemptToken: body.attemptToken.trim(),
        authUserId: authSession.user.id,
        label: typeof body.label === "string" ? body.label : null,
      });

      return respond({
        ok: true,
        ...completed,
      });
    }

    return respond(
      { ok: false, message: "Token de login dev ausente." },
      { status: 400 },
    );
  } catch (error) {
    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Nao foi possivel concluir o login do CLI.",
        ),
      },
      { status: 400 },
    );
  }
}
