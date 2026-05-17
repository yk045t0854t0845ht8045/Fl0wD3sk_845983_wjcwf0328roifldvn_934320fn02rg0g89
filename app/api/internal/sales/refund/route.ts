import { NextResponse } from "next/server";
import { refundSalesCartPayment } from "@/lib/sales/checkoutRuntime";
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
  const flowdeskToken = request.headers.get("x-flowdesk-internal-token")?.trim();
  const salesToken = request.headers.get("x-sales-internal-token")?.trim();
  return bearer === expected || flowdeskToken === expected || salesToken === expected;
}

function getText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isGuildId(value: string) {
  return /^\d{17,20}$/.test(value);
}

function resolveRefundErrorMessage(error: unknown) {
  const message = extractAuditErrorMessage(error, "Erro interno ao processar reembolso.");
  const normalized = message.toLowerCase();
  if (
    normalized.includes("mercado pago") ||
    normalized.includes("compra") ||
    normalized.includes("pagamento") ||
    normalized.includes("credenciais") ||
    normalized.includes("reembolso") ||
    normalized.includes("provedor")
  ) {
    return message;
  }
  return "Erro interno ao processar reembolso.";
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Nao autorizado." }, { status: 401 }),
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cartId = getText(body.cartId, 80);
    const guildId = getText(body.guildId, 24);
    const reason = getText(body.reason, 500);

    if (!isUuid(cartId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Compra invalida." }, { status: 400 }),
      );
    }
    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Servidor invalido." }, { status: 400 }),
      );
    }

    const result = await refundSalesCartPayment({
      cartId,
      guildId,
      reason,
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        alreadyRefunded: result.alreadyRefunded,
        cart: {
          id: result.cart.id,
          status: result.cart.status,
          providerPaymentId: result.cart.provider_payment_id,
          providerStatus: result.cart.provider_status,
          providerStatusDetail: result.cart.provider_status_detail,
        },
      }),
    );
  } catch (error) {
    console.error("[internal-sales-refund] failed", error);
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: resolveRefundErrorMessage(error),
        },
        { status: 500 },
      ),
    );
  }
}
