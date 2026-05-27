import { NextResponse } from "next/server";
import { clearManagedHistoryCacheForUser } from "@/lib/account/managedHistory";
import { invalidatePaymentOrderQueryCaches } from "@/lib/payments/orderQueryCache";
import {
  refundMercadoPagoCardPayment,
  refundMercadoPagoPixPayment,
} from "@/lib/payments/mercadoPago";
import {
  buildRefundOutcome,
  finalizePaymentRefundOutcome,
  isRefundedPaymentOrder,
  type SubscriptionAccessAction,
} from "@/lib/payments/refunds";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { extractAuditErrorMessage } from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import { hasSecureInternalTokenAuth } from "@/lib/security/internalTokens";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const PAYMENT_REFUND_STATUS_DETAIL = "ticket_refund_official_support";
const PAYMENT_REFUND_SELECT_COLUMNS = "*";

function resolveInternalPaymentsToken() {
  return (
    process.env.PAYMENTS_INTERNAL_API_TOKEN ||
    process.env.SALES_INTERNAL_API_TOKEN ||
    process.env.FLOWAI_INTERNAL_API_TOKEN ||
    process.env.CRON_SECRET ||
    ""
  ).trim();
}

function isAuthorized(request: Request) {
  return hasSecureInternalTokenAuth({
    request,
    expectedTokens: [resolveInternalPaymentsToken()],
    headerNames: ["x-flowdesk-internal-token", "x-payments-internal-token"],
    allowDevWithoutToken: true,
  });
}

function resolveRefundErrorMessage(error: unknown) {
  const message = extractAuditErrorMessage(error, "Erro interno ao processar reembolso.");
  const normalized = message.toLowerCase();
  if (
    normalized.includes("mercado pago") ||
    normalized.includes("pedido") ||
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

    let payload: {
      orderId: number;
      reason?: string | undefined;
      refundAmount?: number | undefined;
      protocol?: string | undefined;
      actorUserId?: string | undefined;
      actorLabel?: string | undefined;
      accessAction?: SubscriptionAccessAction | undefined;
      riskScore?: number | undefined;
      riskFlags?: string[] | undefined;
    };
    try {
      payload = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          orderId: flowSecureDto.number({
            integer: true,
            min: 1,
          }),
          reason: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 500,
              normalizeWhitespace: true,
            }),
          ),
          refundAmount: flowSecureDto.optional(
            flowSecureDto.number({
              min: 0,
            }),
          ),
          protocol: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 120,
              normalizeWhitespace: true,
            }),
          ),
          actorUserId: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 64,
              normalizeWhitespace: true,
            }),
          ),
          actorLabel: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 160,
              normalizeWhitespace: true,
            }),
          ),
          accessAction: flowSecureDto.optional(
            flowSecureDto.enum([
              "revoke_immediately",
              "keep_until_expiration",
              "cancel_renewal_only",
              "block_internal",
              "none",
            ]),
          ),
          riskScore: flowSecureDto.optional(
            flowSecureDto.number({
              integer: true,
              min: 0,
              max: 100,
            }),
          ),
          riskFlags: flowSecureDto.optional(
            flowSecureDto.array(
              flowSecureDto.string({
                maxLength: 80,
                normalizeWhitespace: true,
              }),
              {
                maxLength: 20,
              },
            ),
          ),
        },
        { rejectUnknown: true },
      );
    } catch (error) {
      if (!(error instanceof FlowSecureDtoError)) {
        throw error;
      }

      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: error.issues[0] || error.message },
          { status: 400 },
        ),
      );
    }

    const orderId = payload.orderId;
    const reason = payload.reason || "Reembolso aprovado pelo suporte oficial.";

    if (!orderId) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Pedido invalido." }, { status: 400 }),
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const orderResult = await supabase
      .from("payment_orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (orderResult.error || !orderResult.data) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Pedido nao encontrado." }, { status: 404 }),
      );
    }

    const order = orderResult.data as Record<string, unknown> & {
      id: number;
      order_number: number;
      user_id: number;
      guild_id: string | null;
      payment_method: string | null;
      status: string | null;
      provider_payment_id: string | null;
      provider_status: string | null;
      provider_status_detail: string | null;
      provider_payload: Record<string, unknown> | null;
      expires_at: string | null;
    };

    if (isRefundedPaymentOrder(order)) {
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          alreadyRefunded: true,
          financialRefunded: true,
          order: {
            id: order.id,
            status: order.status,
            providerPaymentId: order.provider_payment_id,
            providerStatus: order.provider_status,
            providerStatusDetail: order.provider_status_detail,
          },
        }),
      );
    }

    if (!order.provider_payment_id) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Pedido sem pagamento externo para estornar." },
          { status: 400 },
        ),
      );
    }

    const method = String(order.payment_method || "").toLowerCase();
    const refundOptions = {
      amount: payload.refundAmount,
      idempotencyKeySuffix: String(order.id),
    };
    let providerRefundPayload: unknown = null;
    if (method === "pix") {
      providerRefundPayload = await refundMercadoPagoPixPayment(
        order.provider_payment_id,
        refundOptions,
      );
    } else if (method === "card") {
      providerRefundPayload = await refundMercadoPagoCardPayment(
        order.provider_payment_id,
        refundOptions,
      );
    } else {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Metodo de pagamento nao suportado para reembolso." },
          { status: 400 },
        ),
      );
    }

    const nowIso = new Date().toISOString();
    const refundOutcome = buildRefundOutcome({
      order,
      source: "official_support_ticket",
      reason,
      refundAmount: payload.refundAmount,
      refundKind:
        typeof payload.refundAmount === "number" &&
        Number.isFinite(payload.refundAmount) &&
        Number(order.amount || 0) > 0 &&
        payload.refundAmount + 0.01 < Number(order.amount || 0)
          ? "partial_refund"
          : "full_refund",
      providerRefundPayload,
      actorUserId: payload.actorUserId || null,
      actorLabel: payload.actorLabel || null,
      protocol: payload.protocol || null,
      requestedAccessAction: payload.accessAction || "revoke_immediately",
      riskScore: payload.riskScore,
      riskFlags: payload.riskFlags,
      nowIso,
    });
    refundOutcome.update.provider_status_detail = PAYMENT_REFUND_STATUS_DETAIL;

    const finalized = await finalizePaymentRefundOutcome({
      order,
      outcome: refundOutcome,
      selectColumns: PAYMENT_REFUND_SELECT_COLUMNS,
    });

    invalidatePaymentOrderQueryCaches({
      userId: order.user_id,
      guildId: order.guild_id || undefined,
      orderId: order.id,
      orderNumber: order.order_number,
    });
    clearManagedHistoryCacheForUser(order.user_id);

    const updatedOrder = finalized.order as typeof order;
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        alreadyRefunded: false,
        financialRefunded: true,
        eventLogged: finalized.eventResult.ok,
        eventError: finalized.eventResult.ok ? null : finalized.eventResult.error,
        refundRecordLogged: finalized.refundRecordResult.ok,
        refundRecordError: finalized.refundRecordResult.ok
          ? null
          : finalized.refundRecordResult.error,
        accessUpdated: finalized.accessResult.ok,
        accessError: finalized.accessResult.ok ? null : finalized.accessResult.error,
        refund: {
          status: refundOutcome.decision.status,
          kind: refundOutcome.decision.kind,
          amount: refundOutcome.decision.refundAmount,
          currency: refundOutcome.decision.currency,
          accessAction: refundOutcome.decision.accessAction,
          accessUntil: refundOutcome.decision.accessUntil,
          refundKey: refundOutcome.ledgerEntry.refundKey,
          refundId: refundOutcome.ledgerEntry.refundId,
        },
        order: {
          id: updatedOrder.id,
          status: updatedOrder.status,
          providerPaymentId: updatedOrder.provider_payment_id,
          providerStatus: updatedOrder.provider_status,
          providerStatusDetail: updatedOrder.provider_status_detail,
        },
      }),
    );
  } catch (error) {
    console.error("[internal-payments-refund] failed", error);
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
