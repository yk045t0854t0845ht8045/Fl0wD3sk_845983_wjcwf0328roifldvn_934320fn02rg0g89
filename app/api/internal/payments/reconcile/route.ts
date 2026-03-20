import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  getPaymentOrderByOrderNumber,
  getPaymentOrderByProviderPaymentId,
  reconcilePaymentOrderRecord,
  reconcileRecentPaymentOrders,
} from "@/lib/payments/reconciliation";

function resolveAllowedReconcileTokens() {
  return [
    process.env.PAYMENT_RECONCILE_TOKEN,
    process.env.CRON_SECRET,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

function secureTokenEquals(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isAuthorized(request: Request) {
  const expectedTokens = resolveAllowedReconcileTokens();
  if (expectedTokens.length === 0) return false;

  const authorization = request.headers.get("authorization") || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  const bearerToken = bearerMatch?.[1]?.trim() || "";

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token")?.trim() || "";
  const headerToken =
    request.headers.get("x-reconcile-token")?.trim() || "";

  for (const candidate of [bearerToken, headerToken, queryToken]) {
    if (
      candidate &&
      expectedTokens.some((expectedToken) =>
        secureTokenEquals(expectedToken, candidate),
      )
    ) {
      return true;
    }
  }

  return false;
}

function parsePositiveInt(value: string | null) {
  if (!value) return null;
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

async function handleReconcile(request: Request) {
  const expectedTokens = resolveAllowedReconcileTokens();
  if (expectedTokens.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "PAYMENT_RECONCILE_TOKEN/CRON_SECRET nao configurado no ambiente para reconciliacao protegida.",
      },
      { status: 503 },
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, message: "Reconciliacao nao autorizada." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const orderNumber = parsePositiveInt(url.searchParams.get("orderNumber"));
  const limit = parsePositiveInt(url.searchParams.get("limit")) || 25;
  const providerPaymentId = url.searchParams.get("providerPaymentId")?.trim() || null;
  const guildId = url.searchParams.get("guildId")?.trim() || null;

  if (orderNumber) {
    const order = await getPaymentOrderByOrderNumber(orderNumber);
    if (!order) {
      return NextResponse.json(
        { ok: false, message: "Pedido nao encontrado para reconciliacao." },
        { status: 404 },
      );
    }

    const result = await reconcilePaymentOrderRecord(order, {
      source: "internal_reconcile_order_number",
    });

    return NextResponse.json({
      ok: true,
      mode: "single",
      by: "order_number",
      result,
    });
  }

  if (providerPaymentId) {
    const order = await getPaymentOrderByProviderPaymentId(providerPaymentId);
    if (!order) {
      return NextResponse.json(
        { ok: false, message: "Pedido nao encontrado para provider_payment_id." },
        { status: 404 },
      );
    }

    const result = await reconcilePaymentOrderRecord(order, {
      source: "internal_reconcile_provider_payment",
    });

    return NextResponse.json({
      ok: true,
      mode: "single",
      by: "provider_payment_id",
      result,
    });
  }

  const summary = await reconcileRecentPaymentOrders({
    limit,
    guildId,
    source: "internal_reconcile_batch",
  });

  return NextResponse.json({
    ok: true,
    mode: "batch",
    summary,
  });
}

export async function GET(request: Request) {
  try {
    return await handleReconcile(request);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao executar reconciliacao de pagamentos.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    return await handleReconcile(request);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao executar reconciliacao de pagamentos.",
      },
      { status: 500 },
    );
  }
}
