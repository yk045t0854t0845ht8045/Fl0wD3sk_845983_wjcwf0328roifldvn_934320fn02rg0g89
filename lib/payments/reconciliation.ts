import {
  fetchMercadoPagoPaymentById,
  refundMercadoPagoCardPayment,
  refundMercadoPagoPixPayment,
  resolvePaymentStatus,
  type MercadoPagoPaymentResponse,
} from "@/lib/payments/mercadoPago";
import { resolvePaymentDiagnostic } from "@/lib/payments/paymentDiagnostics";
import {
  isLockedByUnpaidSetupTimeout,
  UNPAID_SETUP_TIMEOUT_REFUND_STATUS_DETAIL,
} from "@/lib/payments/setupCleanup";
import {
  getApprovedOrdersForGuild,
  resolveLatestLicenseCoverageFromApprovedOrders,
  resolveRenewalPaymentDecision,
} from "@/lib/payments/licenseStatus";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type ReconcilablePaymentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";

export type ReconcilablePaymentMethod = "pix" | "card";

export type PaymentOrderReconciliationRecord = {
  id: number;
  order_number: number;
  guild_id: string;
  payment_method: ReconcilablePaymentMethod;
  status: ReconcilablePaymentStatus;
  provider_payment_id?: string | null;
  provider_external_reference?: string | null;
  provider_status?: string | null;
  provider_status_detail?: string | null;
  provider_qr_code?: string | null;
  provider_qr_base64?: string | null;
  provider_ticket_url?: string | null;
  provider_payload?: unknown;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentOrderEventPayload = Record<string, unknown>;

type ReconcileResult = {
  order: PaymentOrderReconciliationRecord;
  changed: boolean;
  action:
    | "unchanged"
    | "updated"
    | "refunded_duplicate"
    | "refunded_timeout"
    | "provider_unreachable";
  providerStatus: string | null;
  providerStatusDetail: string | null;
};

type ReconcileBatchOptions = {
  limit?: number;
  source?: string;
  guildId?: string | null;
  userId?: number | null;
  statuses?: ReconcilablePaymentStatus[];
};

type ReconcileBatchSummary = {
  scanned: number;
  changed: number;
  unchanged: number;
  refunded: number;
  failed: number;
  providerUnavailable: number;
  orders: Array<{
    orderId: number;
    orderNumber: number;
    status: ReconcilablePaymentStatus;
    action: ReconcileResult["action"];
    providerStatus: string | null;
    providerStatusDetail: string | null;
  }>;
  errors: Array<{
    orderId: number;
    orderNumber: number;
    message: string;
  }>;
};

const DEFAULT_RECONCILE_LIMIT = 25;
const DEFAULT_RECONCILE_STATUSES: ReconcilablePaymentStatus[] = [
  "pending",
  "failed",
  "expired",
  "rejected",
];

export const PAYMENT_ORDER_RECONCILIATION_SELECT_COLUMNS =
  "id, order_number, guild_id, payment_method, status, provider_payment_id, provider_external_reference, provider_status, provider_status_detail, provider_qr_code, provider_qr_base64, provider_ticket_url, paid_at, expires_at, created_at, updated_at";

async function createPaymentOrderEventSafe(
  paymentOrderId: number,
  eventType: string,
  eventPayload: PaymentOrderEventPayload,
) {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    await supabase.from("payment_order_events").insert({
      payment_order_id: paymentOrderId,
      event_type: eventType,
      event_payload: eventPayload,
    });
  } catch {
    // telemetria nao deve quebrar reconciliacao
  }
}

async function getLatestApprovedLicenseCoverageForGuild(
  guildId: string,
  excludedOrderId?: number,
) {
  const approvedOrders = await getApprovedOrdersForGuild<PaymentOrderReconciliationRecord>(
    guildId,
    PAYMENT_ORDER_RECONCILIATION_SELECT_COLUMNS,
  );

  const filteredOrders =
    typeof excludedOrderId === "number"
      ? approvedOrders.filter((order) => order.id !== excludedOrderId)
      : approvedOrders;

  return resolveLatestLicenseCoverageFromApprovedOrders(filteredOrders);
}

function resolveProviderPaymentMethodId(
  providerPayment: MercadoPagoPaymentResponse | null | undefined,
) {
  if (!providerPayment) return null;
  if (typeof providerPayment.payment_method_id === "string") {
    const normalized = providerPayment.payment_method_id.trim().toLowerCase();
    if (normalized) return normalized;
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
  orderPaymentMethod: ReconcilablePaymentMethod;
}) {
  const providerMethodId = resolveProviderPaymentMethodId(input.providerPayment);
  const isPixPayment =
    providerMethodId === "pix" || input.orderPaymentMethod === "pix";

  if (isPixPayment) {
    return refundMercadoPagoPixPayment(input.providerPaymentId);
  }

  return refundMercadoPagoCardPayment(input.providerPaymentId);
}

function normalizeNullableString(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function hasOrderCoreChanges(
  current: PaymentOrderReconciliationRecord,
  next: {
    status: ReconcilablePaymentStatus;
    providerPaymentId: string;
    externalReference: string | null;
    providerStatus: string | null;
    providerStatusDetail: string | null;
    providerQrCode: string | null;
    providerQrBase64: string | null;
    providerTicketUrl: string | null;
    paidAt: string | null;
    expiresAt: string | null;
  },
) {
  return (
    current.status !== next.status ||
    normalizeNullableString(current.provider_payment_id) !==
      normalizeNullableString(next.providerPaymentId) ||
    normalizeNullableString(current.provider_external_reference) !==
      normalizeNullableString(next.externalReference) ||
    normalizeNullableString(current.provider_status) !==
      normalizeNullableString(next.providerStatus) ||
    normalizeNullableString(current.provider_status_detail) !==
      normalizeNullableString(next.providerStatusDetail) ||
    normalizeNullableString(current.provider_qr_code) !==
      normalizeNullableString(next.providerQrCode) ||
    normalizeNullableString(current.provider_qr_base64) !==
      normalizeNullableString(next.providerQrBase64) ||
    normalizeNullableString(current.provider_ticket_url) !==
      normalizeNullableString(next.providerTicketUrl) ||
    normalizeNullableString(current.paid_at) !==
      normalizeNullableString(next.paidAt) ||
    normalizeNullableString(current.expires_at) !==
      normalizeNullableString(next.expiresAt)
  );
}

export async function getPaymentOrderByOrderNumber(orderNumber: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_RECONCILIATION_SELECT_COLUMNS)
    .eq("order_number", orderNumber)
    .maybeSingle<PaymentOrderReconciliationRecord>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar pedido por numero para reconciliacao: ${result.error.message}`,
    );
  }

  return result.data || null;
}

export async function getPaymentOrderByProviderPaymentId(providerPaymentId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_RECONCILIATION_SELECT_COLUMNS)
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle<PaymentOrderReconciliationRecord>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar pedido por provider_payment_id para reconciliacao: ${result.error.message}`,
    );
  }

  return result.data || null;
}

async function reconcilePaymentOrderWithFetchedProviderPayment(
  order: PaymentOrderReconciliationRecord,
  providerPayment: MercadoPagoPaymentResponse,
  options?: { source?: string },
): Promise<ReconcileResult> {
  const source = options?.source || "background_reconcile";
  const providerPaymentId = String(providerPayment.id);

  const providerStatus = providerPayment.status || null;
  const providerStatusDetail = providerPayment.status_detail || null;
  const resolvedStatus = resolvePaymentStatus(providerStatus) as ReconcilablePaymentStatus;
  const transactionData = providerPayment.point_of_interaction?.transaction_data;
  const externalReference =
    providerPayment.external_reference || order.provider_external_reference || null;
  const paidAt =
    resolvedStatus === "approved"
      ? providerPayment.date_approved || order.paid_at || new Date().toISOString()
      : null;
  const expiresAt = providerPayment.date_of_expiration || null;

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
            source,
            reconciled_by: source,
            auto_refunded_after_setup_timeout: true,
            mercado_pago: providerPayment,
          },
          expires_at: expiresAt,
        })
        .eq("id", order.id)
        .select(PAYMENT_ORDER_RECONCILIATION_SELECT_COLUMNS)
        .single<PaymentOrderReconciliationRecord>();

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
          source,
          providerPaymentId,
          reason: "approved_after_setup_timeout",
        },
      );

      return {
        order: refundedTimeoutOrderResult.data,
        changed: true,
        action: "refunded_timeout",
        providerStatus: "refunded",
        providerStatusDetail: UNPAID_SETUP_TIMEOUT_REFUND_STATUS_DETAIL,
      };
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
            source,
            reconciled_by: source,
            auto_refunded_duplicate: true,
            mercado_pago: providerPayment,
          },
          expires_at: expiresAt,
        })
        .eq("id", order.id)
        .select(PAYMENT_ORDER_RECONCILIATION_SELECT_COLUMNS)
        .single<PaymentOrderReconciliationRecord>();

      if (refundedOrderResult.error || !refundedOrderResult.data) {
        throw new Error(
          refundedOrderResult.error?.message ||
            "Falha ao atualizar pedido estornado automaticamente.",
        );
      }

      await createPaymentOrderEventSafe(order.id, "provider_payment_auto_refunded", {
        source,
        providerPaymentId,
        reason: renewalDecision.reason,
        previousApprovedOrderNumber: existingCoverage?.order.order_number || null,
      });

      return {
        order: refundedOrderResult.data,
        changed: true,
        action: "refunded_duplicate",
        providerStatus: "refunded",
        providerStatusDetail: "auto_refund_duplicate_active_license",
      };
    }
  }

  if (isLockedByUnpaidSetupTimeout(order) && resolvedStatus === "pending") {
    return {
      order,
      changed: false,
      action: "unchanged",
      providerStatus,
      providerStatusDetail,
    };
  }

  const nextSnapshot = {
    status: resolvedStatus,
    providerPaymentId,
    externalReference,
    providerStatus,
    providerStatusDetail,
    providerQrCode: transactionData?.qr_code || null,
    providerQrBase64: transactionData?.qr_code_base64 || null,
    providerTicketUrl: transactionData?.ticket_url || null,
    paidAt,
    expiresAt,
  };
  const diagnostic = resolvePaymentDiagnostic({
    paymentMethod: order.payment_method,
    status: resolvedStatus,
    providerStatus,
    providerStatusDetail,
  });

  if (!hasOrderCoreChanges(order, nextSnapshot)) {
    return {
      order,
      changed: false,
      action: "unchanged",
      providerStatus,
      providerStatusDetail,
    };
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const updatedOrderResult = await supabase
    .from("payment_orders")
    .update({
      status: resolvedStatus,
      provider_payment_id: providerPaymentId,
      provider_external_reference: externalReference,
      provider_qr_code: nextSnapshot.providerQrCode,
      provider_qr_base64: nextSnapshot.providerQrBase64,
      provider_ticket_url: nextSnapshot.providerTicketUrl,
      provider_status: providerStatus,
      provider_status_detail: providerStatusDetail,
      provider_payload: {
        source,
        reconciled_by: source,
        flowdesk_diagnostic: diagnostic,
        mercado_pago: providerPayment,
      },
      paid_at: paidAt,
      expires_at: expiresAt,
    })
    .eq("id", order.id)
    .select(PAYMENT_ORDER_RECONCILIATION_SELECT_COLUMNS)
    .single<PaymentOrderReconciliationRecord>();

  if (updatedOrderResult.error || !updatedOrderResult.data) {
    throw new Error(
      updatedOrderResult.error?.message ||
        "Falha ao atualizar pedido durante reconciliacao.",
    );
  }

  await createPaymentOrderEventSafe(order.id, "provider_payment_reconciled", {
    source,
    providerPaymentId,
    providerStatus,
    providerStatusDetail,
    resolvedStatus,
    diagnosticCategory: diagnostic.category,
  });

  return {
    order: updatedOrderResult.data,
    changed: true,
    action: "updated",
    providerStatus,
    providerStatusDetail,
  };
}

export async function reconcilePaymentOrderWithProviderPayment(
  order: PaymentOrderReconciliationRecord,
  providerPayment: MercadoPagoPaymentResponse,
  options?: { source?: string },
) {
  return reconcilePaymentOrderWithFetchedProviderPayment(
    order,
    providerPayment,
    options,
  );
}

export async function reconcilePaymentOrderRecord(
  order: PaymentOrderReconciliationRecord,
  options?: { source?: string },
): Promise<ReconcileResult> {
  const source = options?.source || "background_reconcile";
  const providerPaymentId = normalizeNullableString(order.provider_payment_id);
  if (!providerPaymentId) {
    return {
      order,
      changed: false,
      action: "unchanged",
      providerStatus: order.provider_status ?? null,
      providerStatusDetail: order.provider_status_detail ?? null,
    };
  }

  let providerPayment: MercadoPagoPaymentResponse;
  try {
    providerPayment = await fetchMercadoPagoPaymentById(providerPaymentId, {
      useCardToken: order.payment_method === "card",
    });
  } catch (error) {
    await createPaymentOrderEventSafe(order.id, "provider_payment_reconcile_failed", {
      source,
      providerPaymentId,
      message: error instanceof Error ? error.message : "provider_unreachable",
    });

    return {
      order,
      changed: false,
      action: "provider_unreachable",
      providerStatus: order.provider_status ?? null,
      providerStatusDetail:
        error instanceof Error
          ? error.message
          : order.provider_status_detail ?? null,
    };
  }

  return reconcilePaymentOrderWithFetchedProviderPayment(order, providerPayment, {
    source,
  });
}

export async function reconcileRecentPaymentOrders(
  options?: ReconcileBatchOptions,
): Promise<ReconcileBatchSummary> {
  const supabase = getSupabaseAdminClientOrThrow();
  const source = options?.source || "background_reconcile";
  const limit = Math.max(1, Math.min(options?.limit || DEFAULT_RECONCILE_LIMIT, 100));
  const statuses =
    options?.statuses && options.statuses.length
      ? options.statuses
      : DEFAULT_RECONCILE_STATUSES;

  let query = supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_RECONCILIATION_SELECT_COLUMNS)
    .not("provider_payment_id", "is", null)
    .in("status", statuses)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (options?.guildId) {
    query = query.eq("guild_id", options.guildId);
  }

  if (typeof options?.userId === "number") {
    query = query.eq("user_id", options.userId);
  }

  const result = await query.returns<PaymentOrderReconciliationRecord[]>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar pedidos para reconciliacao: ${result.error.message}`,
    );
  }

  const orders = result.data || [];
  const summary: ReconcileBatchSummary = {
    scanned: orders.length,
    changed: 0,
    unchanged: 0,
    refunded: 0,
    failed: 0,
    providerUnavailable: 0,
    orders: [],
    errors: [],
  };

  for (const order of orders) {
    try {
      const reconciled = await reconcilePaymentOrderRecord(order, { source });
      summary.orders.push({
        orderId: reconciled.order.id,
        orderNumber: reconciled.order.order_number,
        status: reconciled.order.status,
        action: reconciled.action,
        providerStatus: reconciled.providerStatus,
        providerStatusDetail: reconciled.providerStatusDetail,
      });

      if (
        reconciled.action === "refunded_duplicate" ||
        reconciled.action === "refunded_timeout"
      ) {
        summary.changed += 1;
        summary.refunded += 1;
      } else if (reconciled.action === "updated") {
        summary.changed += 1;
      } else if (reconciled.action === "provider_unreachable") {
        summary.providerUnavailable += 1;
        summary.unchanged += 1;
      } else {
        summary.unchanged += 1;
      }
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        orderId: order.id,
        orderNumber: order.order_number,
        message: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  return summary;
}
