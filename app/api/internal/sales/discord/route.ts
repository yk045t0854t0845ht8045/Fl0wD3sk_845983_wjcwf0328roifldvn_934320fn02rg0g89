import { NextResponse } from "next/server";
import {
  createSalesCartPixPayment,
  syncSalesCartPayment,
} from "@/lib/sales/checkoutRuntime";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { sanitizeErrorMessage } from "@/lib/security/errors";

function resolveInternalSalesToken() {
  return (
    process.env.SALES_INTERNAL_API_TOKEN ||
    process.env.FLOWAI_INTERNAL_API_TOKEN ||
    process.env.CRON_SECRET ||
    ""
  ).trim();
}

function isAuthorized(request: Request) {
  const expected = resolveInternalSalesToken();
  if (!expected) return process.env.NODE_ENV !== "production";

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerToken = request.headers.get("x-flowdesk-internal-token")?.trim();
  return bearer === expected || headerToken === expected;
}

function getTrimmedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Nao autorizado." }, { status: 401 }),
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = getTrimmedText(body.action, 40);
    const cartId = getTrimmedText(body.cartId, 64);
    if (!isUuid(cartId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Carrinho invalido." }, { status: 400 }),
      );
    }

    if (action === "create_pix_payment") {
      const result = await createSalesCartPixPayment(cartId);
      return applyNoStoreHeaders(NextResponse.json({ ok: true, ...result }));
    }

    if (action === "sync_payment") {
      const result = await syncSalesCartPayment(cartId);
      return applyNoStoreHeaders(NextResponse.json({ ok: true, ...result }));
    }

    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "Acao invalida." }, { status: 400 }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Erro interno no checkout de vendas."),
        },
        { status: 500 },
      ),
    );
  }
}
