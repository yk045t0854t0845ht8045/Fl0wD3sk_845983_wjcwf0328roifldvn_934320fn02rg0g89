import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { revokeFlowAiApiTokenForUser } from "@/lib/flowai/tokens";
import { applyNoStoreHeaders } from "@/lib/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authSession = await getCurrentAuthSessionFromCookie();
    if (!authSession) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Sessao invalida." }, { status: 401 }),
      );
    }

    const resolvedParams = await params;
    const tokenId = Number.parseInt(resolvedParams.id, 10);
    if (!Number.isFinite(tokenId) || tokenId <= 0) {
      return applyNoStoreHeaders(NextResponse.json(
        { ok: false, message: "ID da chave API invalido." },
        { status: 400 },
      ));
    }

    await revokeFlowAiApiTokenForUser({
      userId: authSession.user.id,
      tokenId,
    });

    return applyNoStoreHeaders(NextResponse.json({ ok: true }));
  } catch (error) {
    return applyNoStoreHeaders(NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Falha ao revogar a chave API.",
      },
      { status: 500 },
    ));
  }
}
