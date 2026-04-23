import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  createFlowAiApiTokenForUser,
  listFlowAiApiTokensForUser,
} from "@/lib/flowai/tokens";
import { sendApiKeyCreatedEmailSafe } from "@/lib/mail/transactional";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authSession = await getCurrentAuthSessionFromCookie();
    if (!authSession) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Sessao invalida." }, { status: 401 }),
      );
    }

    const keys = await listFlowAiApiTokensForUser(
      authSession.user.id,
    );
    return applyNoStoreHeaders(NextResponse.json({ ok: true, keys }));
  } catch (error) {
    return applyNoStoreHeaders(NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Falha ao listar as chaves API.",
      },
      { status: 500 },
    ));
  }
}

export async function POST(req: Request) {
  try {
    const authSession = await getCurrentAuthSessionFromCookie();
    if (!authSession) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Sessao invalida." }, { status: 401 }),
      );
    }

    const body = await req.json().catch(() => ({}));
    const created = await createFlowAiApiTokenForUser({
      userId: authSession.user.id,
      name: body?.name,
      scopes: body?.scopes,
      allowedTasks: body?.allowedTasks,
      rateLimitPerMinute: body?.rateLimitPerMinute,
      monthlyQuota: body?.monthlyQuota,
      expiresAt: body?.expiresAt,
      metadata: {
        ...(body?.metadata && typeof body.metadata === "object" ? body.metadata : {}),
        reason: body?.reason,
      },
    });
    void sendApiKeyCreatedEmailSafe({
      user: authSession.user,
      keyName: created.record.name,
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        key: created.record,
        secret: created.secret,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Falha ao criar a chave API.",
      },
      { status: 500 },
    ));
  }
}
