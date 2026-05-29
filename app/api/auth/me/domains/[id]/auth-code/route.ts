/**
 * POST /api/auth/me/domains/[id]/auth-code
 * Solicita o Auth Code (EPP Code) para transferência de saída.
 *
 * Requer:
 * - Domínio ativo e pertencente ao usuário
 * - Transfer lock desativado
 *
 * SEGURANÇA: quando o provedor retorna código em texto, ele é exibido uma única vez
 * e descartado. No banco só é armazenado o hash SHA-256.
 */

import { NextResponse } from "next/server";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { requestDomainAuthCode } from "@/lib/domains/domainService";
import { NAMESILO_AUTH_CODE_SENT_BY_EMAIL } from "@/lib/domains/namesiloAdapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.confirm !== true) {
      return NextResponse.json(
        { ok: false, message: "Confirmação necessária para solicitar Auth Code." },
        { status: 409 },
      );
    }

    const { id } = await params;
    const user = await getCurrentUserFromSessionCookie();
    if (!user) {
      return NextResponse.json({ ok: false, message: "Não autenticado." }, { status: 401 });
    }

    const { authCode } = await requestDomainAuthCode({
      authUserId: user.id,
      domainId: id,
    });

    if (authCode === NAMESILO_AUTH_CODE_SENT_BY_EMAIL) {
      return NextResponse.json({
        ok: true,
        authCode: null,
        delivery: "email",
        warning:
          "O Auth Code foi enviado por e-mail pelo provedor para o contato do domínio. Confira a caixa de entrada e spam.",
      });
    }

    return NextResponse.json({
      ok: true,
      authCode,
      warning:
        "Este código será exibido apenas uma vez. Guarde-o em segurança para usar na transferência.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao solicitar Auth Code.";
    const status = message.includes("não encontrado") ? 404
      : message.includes("bloqueio") || message.includes("Apenas") ? 400
      : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
