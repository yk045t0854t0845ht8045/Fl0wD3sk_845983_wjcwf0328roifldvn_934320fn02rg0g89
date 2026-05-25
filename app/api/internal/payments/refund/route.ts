import { NextResponse } from "next/server";
import { clearPlanStateCacheForUser } from "@/lib/account/managedPlanState";
import { invalidateGuildLicenseCaches } from "@/lib/payments/licenseStatus";
import { invalidatePaymentOrderQueryCaches } from "@/lib/payments/orderQueryCache";
import {
  refundMercadoPagoCardPayment,
  refundMercadoPagoPixPayment,
} from "@/lib/payments/mercadoPago";
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

function isAlreadyRefunded(order: {
  status?: string | null;
  provider_status?: string | null;
  provider_status_detail?: string | null;
}) {
  const status = String(order.status || "").toLowerCase();
  const providerStatus = String(order.provider_status || "").toLowerCase();
  const providerDetail = String(order.provider_status_detail || "").toLowerCase();
  return (
    status === "refunded" ||
    providerStatus === "refunded" ||
    providerStatus === "charged_back" ||
    providerDetail.includes("refund") ||
    providerDetail.includes("chargeback") ||
    providerDetail.includes("reembols")
  );
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

async function createPaymentOrderEventSafe(
  paymentOrderId: number,
  eventType: string,
  eventPayload: Record<string, unknown>,
) {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    await supabase.from("payment_order_events").insert({
      payment_order_id: paymentOrderId,
      event_type: eventType,
      event_payload: eventPayload,
    });
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Falha ao registrar evento.",
    };
  }
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Nao autorizado." }, { status: 401 }),
      );
    }

    let payload: { orderId: number; reason?: string | undefined };
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

    if (isAlreadyRefunded(order)) {
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
    if (method === "pix") {
      await refundMercadoPagoPixPayment(order.provider_payment_id);
    } else if (method === "card") {
      await refundMercadoPagoCardPayment(order.provider_payment_id);
    } else {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Metodo de pagamento nao suportado para reembolso." },
          { status: 400 },
        ),
      );
    }

    const nowIso = new Date().toISOString();
    const providerPayload =
      order.provider_payload && typeof order.provider_payload === "object"
        ? order.provider_payload
        : {};
    const refundPayload = {
      ...providerPayload,
      ticket_refund: {
        status: "refunded",
        refundedAt: nowIso,
        reason,
        source: "official_support_ticket",
      },
    };

    const updateResult = await supabase
      .from("payment_orders")
      .update({
        status: "cancelled",
        provider_status: "refunded",
        provider_status_detail: PAYMENT_REFUND_STATUS_DETAIL,
        provider_payload: refundPayload,
        expires_at: order.expires_at || nowIso,
      })
      .eq("id", order.id)
      .select("*")
      .single();

    if (updateResult.error || !updateResult.data) {
      throw new Error(
        updateResult.error?.message || "Falha ao atualizar pedido apos reembolso.",
      );
    }

    const planStateResult = await supabase
      .from("auth_user_plan_state")
      .select("last_payment_order_id")
      .eq("user_id", order.user_id)
      .maybeSingle();

    if (!planStateResult.error && planStateResult.data?.last_payment_order_id === order.id) {
      await supabase
        .from("auth_user_plan_state")
        .update({
          status: "expired",
          expires_at: nowIso,
          metadata: {
            ticketRefundedAt: nowIso,
            ticketRefundedOrderId: order.id,
          },
        })
        .eq("user_id", order.user_id);
    }

    const eventResult = await createPaymentOrderEventSafe(
      order.id,
      "ticket_refund_official_support_processed",
      {
        source: "official_support_ticket",
        providerPaymentId: order.provider_payment_id,
        reason,
        refundedAt: nowIso,
      },
    );

    invalidatePaymentOrderQueryCaches({
      userId: order.user_id,
      guildId: order.guild_id || undefined,
      orderId: order.id,
      orderNumber: order.order_number,
    });
    invalidateGuildLicenseCaches(order.guild_id || undefined);
    clearPlanStateCacheForUser(order.user_id);

    const updatedOrder = updateResult.data as typeof order;
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        alreadyRefunded: false,
        financialRefunded: true,
        eventLogged: eventResult.ok,
        eventError: eventResult.ok ? null : eventResult.error,
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
