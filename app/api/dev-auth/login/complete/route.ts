import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import {
  completeDeveloperLoginAttempt,
  pollDeveloperLoginAttempt,
} from "@/lib/test-variables/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          attemptToken?: string;
          pollToken?: string;
          label?: string | null;
        }
      | null;

    if (!body || typeof body !== "object") {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Payload de login dev invalido." },
          { status: 400 },
        ),
      );
    }

    if (typeof body.pollToken === "string" && body.pollToken.trim()) {
      const polled = await pollDeveloperLoginAttempt({
        pollToken: body.pollToken.trim(),
      });
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          ...polled,
        }),
      );
    }

    if (typeof body.attemptToken === "string" && body.attemptToken.trim()) {
      const originGuard = ensureSameOriginJsonMutationRequest(request);
      if (originGuard) {
        return applyNoStoreHeaders(originGuard);
      }

      const authSession = await getCurrentAuthSessionFromCookie();
      if (!authSession) {
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Sessao Flowdesk invalida." },
            { status: 401 },
          ),
        );
      }

      const completed = await completeDeveloperLoginAttempt({
        attemptToken: body.attemptToken.trim(),
        authUserId: authSession.user.id,
        label: typeof body.label === "string" ? body.label : null,
      });

      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          ...completed,
        }),
      );
    }

    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: "Token de login dev ausente." },
        { status: 400 },
      ),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Nao foi possivel concluir o login do CLI.",
          ),
        },
        { status: 400 },
      ),
    );
  }
}
