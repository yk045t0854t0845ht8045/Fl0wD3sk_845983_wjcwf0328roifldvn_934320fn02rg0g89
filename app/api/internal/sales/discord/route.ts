import { NextResponse } from "next/server";
import {
  createSalesCartPixPayment,
  syncSalesCartPayment,
} from "@/lib/sales/checkoutRuntime";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { extractAuditErrorMessage } from "@/lib/security/errors";

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

const SAFE_CHECKOUT_ERROR_FRAGMENTS = [
  "carrinho",
  "compra",
  "login",
  "flowdesk",
  "email valido",
  "produto",
  "estoque",
  "valor",
  "pix",
  "mercado pago",
  "credenciais",
  "pagamento",
  "metodo",
  "servidor",
];

function resolveCheckoutErrorMessage(error: unknown) {
  const message = extractAuditErrorMessage(error, "Erro interno no checkout de vendas.");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("schema cache") ||
    normalized.includes("column") ||
    normalized.includes("does not exist")
  ) {
    return "Checkout de vendas em atualizacao. Rode a migration 116 e tente novamente.";
  }

  if (SAFE_CHECKOUT_ERROR_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
    return message;
  }

  return "Erro interno no checkout de vendas.";
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
    console.error("[internal-sales-discord] checkout failed", error);
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: resolveCheckoutErrorMessage(error),
        },
        { status: 500 },
      ),
    );
  }
}
