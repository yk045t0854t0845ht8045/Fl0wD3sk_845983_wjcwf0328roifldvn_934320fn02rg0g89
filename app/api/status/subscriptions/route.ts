import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  disableStatusSubscription,
  getStatusSubscriptionState,
  saveStatusSubscription,
  StatusSubscriptionError,
} from "@/lib/status/subscriptions";
import type { StatusSubscriptionType } from "@/lib/status/types";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildLoginUrl(request: NextRequest, type?: string | null) {
  const currentType = (type || "discord_dm").trim() || "discord_dm";
  const nextPath = `/status?subscribe=${encodeURIComponent(currentType)}`;
  return new URL(`/api/auth/discord?next=${encodeURIComponent(nextPath)}`, request.url).toString();
}

function buildErrorResponse(
  request: NextRequest,
  error: unknown,
  type?: string | null,
) {
  if (error instanceof StatusSubscriptionError) {
    const body: Record<string, unknown> = {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.extra || {}),
    };

    if (error.code === "AUTH_REQUIRED") {
      body.loginUrl = buildLoginUrl(request, type);
    }

    return applyNoStoreHeaders(
      NextResponse.json(body, { status: error.statusCode }),
    );
  }

  return applyNoStoreHeaders(
    NextResponse.json(
      {
        ok: false,
        code: "STATUS_SUBSCRIPTION_UNKNOWN",
        message:
          error instanceof Error
            ? error.message
            : "Falha ao processar a inscricao de status.",
      },
      { status: 500 },
    ),
  );
}

export async function GET() {
  try {
    const authSession = await getCurrentAuthSessionFromCookie();
    const state = await getStatusSubscriptionState(authSession);
    return applyNoStoreHeaders(NextResponse.json({ ok: true, ...state }));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Falha ao carregar as inscricoes de status.",
        },
        { status: 500 },
      ),
    );
  }
}

export async function POST(request: NextRequest) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) {
    return applyNoStoreHeaders(originGuard);
  }

  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : null;
  const target = typeof body?.target === "string" ? body.target : null;

  if (!type) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: "Tipo de inscricao obrigatorio." },
        { status: 400 },
      ),
    );
  }

  try {
    const authSession = await getCurrentAuthSessionFromCookie();
    const result = await saveStatusSubscription(
      {
        type: type as StatusSubscriptionType,
        target,
      },
      authSession,
    );
    const state = await getStatusSubscriptionState(authSession);

    return applyNoStoreHeaders(
      NextResponse.json({
        ...result,
        ...state,
      }),
    );
  } catch (error) {
    return buildErrorResponse(request, error, type);
  }
}

export async function DELETE(request: NextRequest) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) {
    return applyNoStoreHeaders(originGuard);
  }

  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : null;

  if (!type) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: "Tipo de inscricao obrigatorio." },
        { status: 400 },
      ),
    );
  }

  try {
    const authSession = await getCurrentAuthSessionFromCookie();
    await disableStatusSubscription(type as StatusSubscriptionType, authSession);
    const state = await getStatusSubscriptionState(authSession);
    return applyNoStoreHeaders(NextResponse.json({ ok: true, ...state }));
  } catch (error) {
    return buildErrorResponse(request, error, type);
  }
}
