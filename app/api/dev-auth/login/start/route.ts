import { NextResponse } from "next/server";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { startDeveloperLoginAttempt } from "@/lib/test-variables/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      redirectUrl?: string | null;
    };

    const attempt = await startDeveloperLoginAttempt({
      redirectUrl:
        typeof body.redirectUrl === "string" ? body.redirectUrl : null,
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        verificationUrl: attempt.verificationUrl,
        attemptToken: attempt.attemptToken,
        pollToken: attempt.pollToken,
        expiresAt: attempt.expiresAt,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Nao foi possivel iniciar o login do CLI.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
