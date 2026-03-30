import { NextResponse } from "next/server";
import {
  fetchMercadoPagoPaymentById,
  refundMercadoPagoCardPayment,
  refundMercadoPagoPixPayment,
  resolvePaymentStatus,
  type MercadoPagoPaymentResponse,
} from "@/lib/payments/mercadoPago";
import { resolvePaymentDiagnostic } from "@/lib/payments/paymentDiagnostics";
import {
  getApprovedOrdersForGuild,
  invalidateGuildLicenseCaches,
  resolveLatestLicenseCoverageFromApprovedOrders,
  resolveRenewalPaymentDecision,
} from "@/lib/payments/licenseStatus";
import {
  isLockedByUnpaidSetupTimeout,
  UNPAID_SETUP_TIMEOUT_REFUND_STATUS_DETAIL,
} from "@/lib/payments/setupCleanup";
import { syncUserPlanStateFromOrder } from "@/lib/plans/state";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type PaymentOrderRecord = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id: string;
  payment_method: "pix" | "card" | "trial";
  status: string;
  plan_code: string;
  plan_name: string;
  plan_billing_cycle_days: number;
  plan_max_licensed_servers: number;
  plan_max_active_tickets: number;
  plan_max_automations: number;
  plan_max_monthly_actions: number;
  provider_payment_id: string | null;
  provider_external_reference: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  provider_qr_code: string | null;
  provider_qr_base64: string | null;
  provider_ticket_url: string | null;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
};

const PAYMENT_ORDER_SELECT_COLUMNS =
  "id, order_number, user_id, guild_id, payment_method, status, plan_code, plan_name, plan_billing_cycle_days, plan_max_licensed_servers, plan_max_active_tickets, plan_max_automations, plan_max_monthly_actions, provider_payment_id, provider_external_reference, provider_status, provider_status_detail, provider_qr_code, provider_qr_base64, provider_ticket_url, paid_at, expires_at, created_at";

function parsePaymentId(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

function parseOrderNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d{1,12}$/.test(trimmed)) return null;
    const numeric = Number(trimmed);
    if (!Number.isInteger(numeric) || numeric <= 0) return null;
    return numeric;
  }

  return null;
}

function getMetadataOrderNumber(
  metadata: Record<string, unknown> | null | undefined,
) {
  if (!metadata || typeof metadata !== "object") return null;
  return parseOrderNumber(metadata.flowdesk_order_number);
}

function getExternalReferenceOrderNumber(externalReference: string | null | undefined) {
  if (!externalReference) return null;
  const match = /^flowdesk-order-(\d+)$/i.exec(externalReference.trim());
  if (!match) return null;
  return parseOrderNumber(match[1]);
}

function resolveProviderPaymentMethodId(
  providerPayment: MercadoPagoPaymentResponse | null | undefined,
) {
  if (!providerPayment) return null;
  if (typeof providerPayment.payment_method_id === "string") {
    const normalized = providerPayment.payment_method_id.trim().toLowerCase();
    return normalized || null;
  }
  if (
    providerPayment.point_of_interaction?.transaction_data?.qr_code ||
    providerPayment.point_of_interaction?.transaction_data?.qr_code_base64
  ) {
    return "pix";
  }
  return null;
}

async function autoRefundProviderPayment(input: {
  providerPaymentId: string;
  providerPayment: MercadoPagoPaymentResponse;
  orderPaymentMethod?: PaymentOrderRecord["payment_method"] | null;
}) {
  const providerMethodId = resolveProviderPaymentMethodId(input.providerPayment);
  const isPixPayment =
    providerMethodId === "pix" || input.orderPaymentMethod === "pix";

  if (isPixPayment) {
    return refundMercadoPagoPixPayment(input.providerPaymentId);
  }

  return refundMercadoPagoCardPayment(input.providerPaymentId);
}

function extractWebhookPaymentId(input: {
  url: URL;
  body: unknown;
}) {
  const byQuery =
    parsePaymentId(input.url.searchParams.get("data.id")) ||
    parsePaymentId(input.url.searchParams.get("id"));
  if (byQuery) return byQuery;

  if (!input.body || typeof input.body !== "object") return null;
  const payload = input.body as Record<string, unknown>;
  const data = payload.data;
  if (data && typeof data === "object") {
    const dataId = parsePaymentId((data as Record<string, unknown>).id);
    if (dataId) return dataId;
  }

  return parsePaymentId(payload.id);
}

async function createPaymentOrderEventSafe(
  paymentOrderId: number,
  eventType: string,
  eventPayload: Record<string, unknown>,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  await supabase.from("payment_order_events").insert({
    payment_order_id: paymentOrderId,
    event_type: eventType,
    event_payload: eventPayload,
  });
}

async function getOrderByProviderPaymentId(paymentId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("provider_payment_id", paymentId)
    .maybeSingle<PaymentOrderRecord>();

  if (result.error) {
    throw new Error(`Erro ao buscar pedido por provider_payment_id: ${result.error.message}`);
  }

  return result.data || null;
}

async function getOrderByOrderNumber(orderNumber: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("order_number", orderNumber)
    .maybeSingle<PaymentOrderRecord>();

  if (result.error) {
    throw new Error(`Erro ao buscar pedido por numero: ${result.error.message}`);
  }

  return result.data || null;
}

async function getLatestApprovedLicenseCoverageForGuild(
  guildId: string,
  excludedOrderId?: number,
) {
  const approvedOrders = await getApprovedOrdersForGuild<PaymentOrderRecord>(
    guildId,
    PAYMENT_ORDER_SELECT_COLUMNS,
  );

  const filteredOrders =
    typeof excludedOrderId === "number"
      ? approvedOrders.filter((order) => order.id !== excludedOrderId)
      : approvedOrders;

  return resolveLatestLicenseCoverageFromApprovedOrders(filteredOrders);
}

async function updateOrderFromProviderPayment(
  order: PaymentOrderRecord,
  providerPayment: MercadoPagoPaymentResponse,
) {
  const providerPaymentId = parsePaymentId(providerPayment.id);
  if (!providerPaymentId) return order;

  const providerStatus = providerPayment.status || null;
  const providerStatusDetail = providerPayment.status_detail || null;
  const resolvedStatus = resolvePaymentStatus(providerStatus);
  const transactionData = providerPayment.point_of_interaction?.transaction_data;
  const externalReference =
    providerPayment.external_reference || order.provider_external_reference || null;
  const paidAt =
    resolvedStatus === "approved"
      ? providerPayment.date_approved || new Date().toISOString()
      : null;
  const expiresAt = providerPayment.date_of_expiration || null;
  const diagnostic = resolvePaymentDiagnostic({
    paymentMethod: order.payment_method,
    status: resolvedStatus,
    providerStatus,
    providerStatusDetail,
  });

  if (resolvedStatus === "approved") {
    if (isLockedByUnpaidSetupTimeout(order)) {
      await autoRefundProviderPayment({
        providerPaymentId,
        providerPayment,
        orderPaymentMethod: order.payment_method,
      });

      const supabase = getSupabaseAdminClientOrThrow();
      const refundedTimeoutOrderResult = await supabase
        .from("payment_orders")
        .update({
          status: "cancelled",
          provider_status: "refunded",
          provider_status_detail: UNPAID_SETUP_TIMEOUT_REFUND_STATUS_DETAIL,
          provider_external_reference: externalReference,
          provider_qr_code: transactionData?.qr_code || order.provider_qr_code,
          provider_qr_base64:
            transactionData?.qr_code_base64 || order.provider_qr_base64,
          provider_ticket_url:
            transactionData?.ticket_url || order.provider_ticket_url,
          provider_payload: {
            source: "mercado_pago_webhook",
            auto_refunded_after_setup_timeout: true,
            flowdesk_diagnostic: diagnostic,
            mercado_pago: providerPayment,
          },
          expires_at: expiresAt,
        })
        .eq("id", order.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (refundedTimeoutOrderResult.error || !refundedTimeoutOrderResult.data) {
        throw new Error(
          refundedTimeoutOrderResult.error?.message ||
            "Falha ao atualizar pedido pago apos timeout do onboarding.",
        );
      }

      await createPaymentOrderEventSafe(
        order.id,
        "provider_payment_auto_refunded_after_setup_timeout",
        {
          source: "mercado_pago_webhook",
          providerPaymentId,
          reason: "approved_after_setup_timeout",
        },
      );

      invalidateGuildLicenseCaches(order.guild_id);
      return refundedTimeoutOrderResult.data;
    }

    const existingCoverage = await getLatestApprovedLicenseCoverageForGuild(
      order.guild_id,
      order.id,
    );
    const paymentTimestampMs = paidAt ? Date.parse(paidAt) : Date.now();
    const renewalDecision = resolveRenewalPaymentDecision(
      existingCoverage,
      Number.isFinite(paymentTimestampMs) ? paymentTimestampMs : Date.now(),
    );
    if (!renewalDecision.allowed) {
      await autoRefundProviderPayment({
        providerPaymentId,
        providerPayment,
        orderPaymentMethod: order.payment_method,
      });

      const supabase = getSupabaseAdminClientOrThrow();
      const refundedOrderResult = await supabase
        .from("payment_orders")
        .update({
          status: "cancelled",
          provider_status: "refunded",
          provider_status_detail: "auto_refund_duplicate_active_license",
          provider_external_reference: externalReference,
          provider_qr_code: transactionData?.qr_code || order.provider_qr_code,
          provider_qr_base64:
            transactionData?.qr_code_base64 || order.provider_qr_base64,
          provider_ticket_url:
            transactionData?.ticket_url || order.provider_ticket_url,
          provider_payload: {
            source: "mercado_pago_webhook",
            auto_refunded_duplicate: true,
            flowdesk_diagnostic: diagnostic,
            mercado_pago: providerPayment,
          },
          expires_at: expiresAt,
        })
        .eq("id", order.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (refundedOrderResult.error || !refundedOrderResult.data) {
        throw new Error(
          refundedOrderResult.error?.message ||
            "Falha ao atualizar estorno automatico por webhook.",
        );
      }

      await createPaymentOrderEventSafe(order.id, "provider_payment_auto_refunded", {
        source: "mercado_pago_webhook",
        providerPaymentId,
        reason: renewalDecision.reason,
        previousApprovedOrderNumber: existingCoverage?.order.order_number || null,
      });

      invalidateGuildLicenseCaches(order.guild_id);
      return refundedOrderResult.data;
    }
  }

  if (isLockedByUnpaidSetupTimeout(order)) {
    return order;
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const updatedOrderResult = await supabase
    .from("payment_orders")
    .update({
      status: resolvedStatus,
      provider_payment_id: providerPaymentId,
      provider_external_reference: externalReference,
      provider_qr_code: transactionData?.qr_code || null,
      provider_qr_base64: transactionData?.qr_code_base64 || null,
      provider_ticket_url: transactionData?.ticket_url || null,
      provider_status: providerStatus,
      provider_status_detail: providerStatusDetail,
      provider_payload: {
        source: "mercado_pago_webhook",
        flowdesk_diagnostic: diagnostic,
        mercado_pago: providerPayment,
      },
      paid_at: paidAt,
      expires_at: expiresAt,
    })
    .eq("id", order.id)
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .single<PaymentOrderRecord>();

  if (updatedOrderResult.error || !updatedOrderResult.data) {
    throw new Error(
      updatedOrderResult.error?.message ||
        "Falha ao atualizar pedido por webhook.",
    );
  }

  await createPaymentOrderEventSafe(order.id, "provider_payment_reconciled", {
    source: "mercado_pago_webhook",
    providerPaymentId,
    providerStatus,
    providerStatusDetail,
    resolvedStatus,
    diagnosticCategory: diagnostic.category,
  });

  if (updatedOrderResult.data.status === "approved") {
    await syncUserPlanStateFromOrder(updatedOrderResult.data);
  }

  invalidateGuildLicenseCaches(order.guild_id);
  return updatedOrderResult.data;
}

function validateWebhookToken(request: Request, url: URL) {
  const expectedToken = process.env.MERCADO_PAGO_WEBHOOK_TOKEN?.trim();
  if (!expectedToken) return true;

  const tokenFromQuery = url.searchParams.get("token")?.trim() || "";
  const tokenFromHeader =
    request.headers.get("x-webhook-token")?.trim() ||
    request.headers.get("x-mercadopago-signature")?.trim() ||
    "";

  return tokenFromQuery === expectedToken || tokenFromHeader === expectedToken;
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    if (!validateWebhookToken(request, url)) {
      return NextResponse.json({ ok: false, message: "Webhook nao autorizado." }, { status: 401 });
    }

    let body: unknown = null;
    try {
      body = (await request.json()) as unknown;
    } catch {
      body = null;
    }

    const paymentId = extractWebhookPaymentId({ url, body });
    if (!paymentId) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const providerPayment = await fetchMercadoPagoPaymentById(paymentId);
    const providerPaymentId = parsePaymentId(providerPayment.id);
    if (!providerPaymentId) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const resolvedStatus = resolvePaymentStatus(providerPayment.status);
    const externalReferenceOrderNumber = getExternalReferenceOrderNumber(
      providerPayment.external_reference || null,
    );
    const metadataOrderNumber = getMetadataOrderNumber(providerPayment.metadata || null);
    const hintedOrderNumber = externalReferenceOrderNumber || metadataOrderNumber;

    let order =
      (await getOrderByProviderPaymentId(providerPaymentId)) ||
      (hintedOrderNumber ? await getOrderByOrderNumber(hintedOrderNumber) : null);

    if (!order) {
      // Se pagamento aprovado pertence ao nosso fluxo mas nao foi vinculado,
      // estornamos automaticamente para evitar cobranca sem registro.
      if (resolvedStatus === "approved" && hintedOrderNumber) {
        await autoRefundProviderPayment({
          providerPaymentId,
          providerPayment,
          orderPaymentMethod: null,
        });
      }

      return NextResponse.json({
        ok: true,
        ignored: true,
        orphanPayment: true,
        paymentId: providerPaymentId,
      });
    }

    order = await updateOrderFromProviderPayment(order, providerPayment);

    return NextResponse.json({
      ok: true,
      paymentId: providerPaymentId,
      orderNumber: order.order_number,
      status: order.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro no webhook do Mercado Pago.",
      },
      { status: 500 },
    );
  }
}
