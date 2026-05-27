/**
 * POST /api/auth/me/domains/quote
 * Gera uma cotação com preço final em BRL (custo do provedor + câmbio + markup).
 *
 * Body: { fqdn, operation?, period_years? }
 *
 * Retorna:
 * - providerCostUsd: custo bruto em USD (transparência para admin)
 * - exchangeRateUsdBrl: câmbio do momento
 * - markupPercent: margem FlowDesk
 * - totalBrl: valor que será cobrado do usuário
 * - expiresAt: cotação válida por 15 minutos
 */

import { NextResponse } from "next/server";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { quoteDomain } from "@/lib/domains/domainService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUserFromSessionCookie();
    if (!user) {
      return NextResponse.json({ ok: false, message: "Não autenticado." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const fqdn = String(body?.fqdn || "").trim().toLowerCase();

    if (!fqdn || fqdn.length < 4) {
      return NextResponse.json(
        { ok: false, message: "Informe um domínio válido." },
        { status: 400 },
      );
    }

    const operation = ["register", "renew", "transfer", "restore"].includes(String(body?.operation))
      ? (body.operation as "register" | "renew" | "transfer" | "restore")
      : "register";

    const periodYears = Number.isInteger(Number(body?.period_years)) && Number(body?.period_years) > 0
      ? Math.min(Number(body.period_years), 10)
      : 1;

    const quote = await quoteDomain({
      authUserId: user.id,
      fqdn,
      operation,
      periodYears,
    });

    return NextResponse.json({ ok: true, quote });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao gerar cotação.";
    const status = message.includes("não está disponível") ? 409 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
