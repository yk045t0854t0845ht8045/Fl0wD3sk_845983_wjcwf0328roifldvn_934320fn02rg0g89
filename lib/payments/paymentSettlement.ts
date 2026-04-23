import {
  fetchMercadoPagoPaymentById,
  refundMercadoPagoCardPayment,
  refundMercadoPagoPixPayment,
  resolvePaymentStatus,
  type MercadoPagoPaymentResponse,
} from "@/lib/payments/mercadoPago";
import { invalidatePaymentOrderQueryCaches } from "@/lib/payments/orderQueryCache";
import { clearPlanStateCacheForUser } from "@/lib/account/managedPlanState";
import { syncUserPlanStateFromOrder } from "@/lib/plans/state";
import { invalidateGuildLicenseCaches } from "@/lib/payments/licenseStatus";
import { sendPaymentApprovedEmailForOrderSafe } from "@/lib/mail/transactional";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { parseUtcTimestampMs } from "@/lib/time/utcTimestamp";

type PaymentOrderEventPayload = Record<string, unknown>;

export type PaymentSettlementOrderRecord = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id: string | null;
  payment_method?: string | null;
  status?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  plan_code?: string | null;
  plan_name?: string | null;
  plan_billing_cycle_days?: number | null;
  plan_max_licensed_servers?: number | null;
  plan_max_active_tickets?: number | null;
  plan_max_automations?: number | null;
  plan_max_monthly_actions?: number | null;
  provider_payment_id?: string | null;
  provider_status?: string | null;
  provider_status_detail?: string | null;
  provider_payload?: unknown;
  paid_at?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type UserPlanStateSettlementRecord = {
  last_payment_order_id: number | null;
  updated_at: string | null;
  status: string | null;
};

type FinalizationPayload = {
  status?: string | null;
  failureCount?: number | null;
  firstFailedAt?: string | null;
  lastFailedAt?: string | null;
  lastError?: string | null;
  lastSource?: string | null;
  settledAt?: string | null;
  autoRefundedAt?: string | null;
  refundReason?: string | null;
  providerStatusAtRefund?: string | null;
  providerStatusDetailAtRefund?: string | null;
  lastRecoveryAttemptAt?: string | null;
};

export type PaymentSettlementResult<TOrder extends PaymentSettlementOrderRecord> = {
  order: TOrder;
  settled: boolean;
  pendingRecovery: boolean;
  autoRefunded: boolean;
};

export const AUTO_REFUND_FINALIZATION_FAILURE_STATUS_DETAIL =
  "auto_refund_finalization_failure";

const FINALIZATION_STATUS_SETTLED = "settled";
const FINALIZATION_STATUS_PENDING = "pending";
const FINALIZATION_STATUS_REFUNDED = "refunded";
const DEFAULT_FINALIZATION_REFUND_GRACE_MS = 15 * 60 * 1000;
const DEFAULT_FINALIZATION_MAX_FAILURES = 3;
const DEFAULT_SETTLEMENT_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeProviderPayload(currentPayload: unknown, patch: Record<string, unknown>) {
  const basePayload = isRecord(currentPayload) ? currentPayload : {};
  return {
    ...basePayload,
    ...patch,
  };
}

function parseFinalizationPayload(payload: unknown): FinalizationPayload {
  if (!isRecord(payload)) return {};
  const raw = isRecord(payload.flowdesk_finalization)
    ? payload.flowdesk_finalization
    : isRecord(payload.finalization)
      ? payload.finalization
      : null;
  if (!raw) return {};

  return {
    status: normalizeOptionalString(raw.status as string | null | undefined),
    failureCount:
      typeof raw.failureCount === "number" && Number.isFinite(raw.failureCount)
        ? Math.max(0, Math.trunc(raw.failureCount))
        : null,
    firstFailedAt: normalizeOptionalString(
      raw.firstFailedAt as string | null | undefined,
    ),
    lastFailedAt: normalizeOptionalString(
      raw.lastFailedAt as string | null | undefined,
    ),
    lastError: normalizeOptionalString(raw.lastError as string | null | undefined),
    lastSource: normalizeOptionalString(raw.lastSource as string | null | undefined),
    settledAt: normalizeOptionalString(raw.settledAt as string | null | undefined),
    autoRefundedAt: normalizeOptionalString(
      raw.autoRefundedAt as string | null | undefined,
    ),
    refundReason: normalizeOptionalString(
      raw.refundReason as string | null | undefined,
    ),
    providerStatusAtRefund: normalizeOptionalString(
      raw.providerStatusAtRefund as string | null | undefined,
    ),
    providerStatusDetailAtRefund: normalizeOptionalString(
      raw.providerStatusDetailAtRefund as string | null | undefined,
    ),
    lastRecoveryAttemptAt: normalizeOptionalString(
      raw.lastRecoveryAttemptAt as string | null | undefined,
    ),
  };
}

function buildFinalizationPayloadPatch(
  currentPayload: unknown,
  patch: Partial<FinalizationPayload>,
) {
  const current = parseFinalizationPayload(currentPayload);
  return mergeProviderPayload(currentPayload, {
    flowdesk_finalization: {
      ...current,
      ...patch,
    },
  });
}

function resolveFinalizationRefundGraceMs() {
  const rawValue =
    process.env.FLOWDESK_PAYMENT_FINALIZATION_REFUND_GRACE_SECONDS?.trim() || "";
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_FINALIZATION_REFUND_GRACE_MS;
  }

  return Math.max(60_000, Math.min(Math.trunc(parsed * 1000), 24 * 60 * 60 * 1000));
}

function resolveFinalizationMaxFailures() {
  const rawValue =
    process.env.FLOWDESK_PAYMENT_FINALIZATION_MAX_FAILURES?.trim() || "";
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_FINALIZATION_MAX_FAILURES;
  }

  return clampInteger(parsed, DEFAULT_FINALIZATION_MAX_FAILURES, 1, 10);
}

function resolveSettlementRecoveryWindowMs() {
  const rawValue =
    process.env.FLOWDESK_PAYMENT_SETTLEMENT_RECOVERY_WINDOW_SECONDS?.trim() || "";
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SETTLEMENT_RECOVERY_WINDOW_MS;
  }

  return Math.max(60_000, Math.min(Math.trunc(parsed * 1000), 7 * 24 * 60 * 60 * 1000));
}

function resolveSettlementReferenceMs(order: PaymentSettlementOrderRecord) {
  const candidateValues = [
    normalizeOptionalString(order.paid_at),
    normalizeOptionalString(order.updated_at),
    normalizeOptionalString(order.created_at),
  ];

  for (const value of candidateValues) {
    if (!value) continue;
    const parsed = parseUtcTimestampMs(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

function shouldAttemptSettlementRecovery(order: PaymentSettlementOrderRecord) {
  const status = normalizeOptionalString(order.status)?.toLowerCase();
  if (status !== "approved") return false;

  const finalization = parseFinalizationPayload(order.provider_payload);
  if (
    finalization.status === FINALIZATION_STATUS_SETTLED ||
    finalization.status === FINALIZATION_STATUS_REFUNDED
  ) {
    return false;
  }

  if (finalization.status === FINALIZATION_STATUS_PENDING) {
    return true;
  }

  return true;
}

function shouldTreatPlanStateAsSettled(
  planState: UserPlanStateSettlementRecord | null,
  order: PaymentSettlementOrderRecord,
) {
  return Boolean(planState && planState.last_payment_order_id === order.id);
}

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
    // telemetria nao pode quebrar o fluxo
  }
}

async function getPlanStateSnapshot(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_plan_state")
    .select("last_payment_order_id, updated_at, status")
    .eq("user_id", userId)
    .maybeSingle<UserPlanStateSettlementRecord>();

  if (result.error) {
    throw new Error(
      result.error.message || "Falha ao carregar estado do plano para finalizacao.",
    );
  }

  return result.data || null;
}

async function persistProviderPayload<TOrder extends PaymentSettlementOrderRecord>(
  input: {
    order: TOrder;
    providerPayload: Record<string, unknown>;
    selectColumns: string;
  },
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .update({
      provider_payload: input.providerPayload,
    })
    .eq("id", input.order.id)
    .select(input.selectColumns)
    .single<TOrder>();

  if (result.error || !result.data) {
    throw new Error(
      result.error?.message || "Falha ao atualizar telemetria de finalizacao do pedido.",
    );
  }

  invalidatePaymentOrderQueryCaches({
    userId: result.data.user_id,
    guildId: result.data.guild_id,
    orderId: result.data.id,
    orderNumber: result.data.order_number,
  });

  return result.data;
}

async function markSettlementAsSettled<TOrder extends PaymentSettlementOrderRecord>(
  input: {
    order: TOrder;
    selectColumns: string;
    source: string;
  },
) {
  const settledAt = new Date().toISOString();
  const providerPayload = buildFinalizationPayloadPatch(input.order.provider_payload, {
    status: FINALIZATION_STATUS_SETTLED,
    lastSource: input.source,
    lastError: null,
    settledAt,
    lastRecoveryAttemptAt: settledAt,
  });

  try {
    const updatedOrder = await persistProviderPayload({
      order: input.order,
      providerPayload,
      selectColumns: input.selectColumns,
    });
    await createPaymentOrderEventSafe(
      updatedOrder.id,
      "approved_payment_settlement_completed",
      {
        source: input.source,
        settledAt,
      },
    );
    void sendPaymentApprovedEmailForOrderSafe(updatedOrder);
    return updatedOrder;
  } catch {
    await createPaymentOrderEventSafe(
      input.order.id,
      "approved_payment_settlement_completed",
      {
        source: input.source,
        settledAt,
        payloadUpdateSkipped: true,
      },
    );
    void sendPaymentApprovedEmailForOrderSafe(input.order);
    return input.order;
  }
}

async function markSettlementAsPending<TOrder extends PaymentSettlementOrderRecord>(
  input: {
    order: TOrder;
    selectColumns: string;
    source: string;
    message: string;
  },
) {
  const nowIso = new Date().toISOString();
  const current = parseFinalizationPayload(input.order.provider_payload);
  const nextFailureCount = Math.max(0, current.failureCount || 0) + 1;
  const providerPayload = buildFinalizationPayloadPatch(input.order.provider_payload, {
    status: FINALIZATION_STATUS_PENDING,
    failureCount: nextFailureCount,
    firstFailedAt: current.firstFailedAt || nowIso,
    lastFailedAt: nowIso,
    lastError: input.message,
    lastSource: input.source,
    lastRecoveryAttemptAt: nowIso,
  });

  let updatedOrder = input.order;
  try {
    updatedOrder = await persistProviderPayload({
      order: input.order,
      providerPayload,
      selectColumns: input.selectColumns,
    });
  } catch {
    // manter o pedido aprovado mesmo sem atualizar a telemetria auxiliar
  }

  await createPaymentOrderEventSafe(
    input.order.id,
    "approved_payment_settlement_pending",
    {
      source: input.source,
      failureCount: nextFailureCount,
      message: input.message,
    },
  );

  return {
    order: updatedOrder,
    failureCount: nextFailureCount,
    firstFailedAt: current.firstFailedAt || nowIso,
  };
}

function resolveRefundProviderStatus(providerPayment: MercadoPagoPaymentResponse | null | undefined) {
  return normalizeOptionalString(providerPayment?.status) || "approved";
}

function resolveRefundProviderStatusDetail(
  providerPayment: MercadoPagoPaymentResponse | null | undefined,
) {
  return normalizeOptionalString(providerPayment?.status_detail) || null;
}

async function autoRefundProviderPayment(input: {
  providerPaymentId: string;
  providerPayment: MercadoPagoPaymentResponse;
  orderPaymentMethod: string | null | undefined;
}) {
  const method = normalizeOptionalString(input.orderPaymentMethod)?.toLowerCase();
  if (method === "pix") {
    return refundMercadoPagoPixPayment(input.providerPaymentId);
  }

  return refundMercadoPagoCardPayment(input.providerPaymentId);
}

async function applyAutomaticRefundForSettlementFailure<
  TOrder extends PaymentSettlementOrderRecord,
>(input: {
  order: TOrder;
  source: string;
  providerPayment: MercadoPagoPaymentResponse;
  providerPaymentId: string;
  selectColumns: string;
}) {
  await autoRefundProviderPayment({
    providerPaymentId: input.providerPaymentId,
    providerPayment: input.providerPayment,
    orderPaymentMethod: input.order.payment_method,
  });

  const nowIso = new Date().toISOString();
  const providerPayload = buildFinalizationPayloadPatch(input.order.provider_payload, {
    status: FINALIZATION_STATUS_REFUNDED,
    autoRefundedAt: nowIso,
    refundReason: AUTO_REFUND_FINALIZATION_FAILURE_STATUS_DETAIL,
    providerStatusAtRefund: resolveRefundProviderStatus(input.providerPayment),
    providerStatusDetailAtRefund: resolveRefundProviderStatusDetail(input.providerPayment),
    lastSource: input.source,
    lastRecoveryAttemptAt: nowIso,
  });

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .update({
      status: "cancelled",
      provider_status: "refunded",
      provider_status_detail: AUTO_REFUND_FINALIZATION_FAILURE_STATUS_DETAIL,
      provider_payload: providerPayload,
      expires_at: input.order.expires_at || nowIso,
    })
    .eq("id", input.order.id)
    .select(input.selectColumns)
    .single<TOrder>();

  if (result.error || !result.data) {
    throw new Error(
      result.error?.message ||
        "Falha ao atualizar o pedido apos estorno por falha de finalizacao.",
    );
  }

  invalidatePaymentOrderQueryCaches({
    userId: result.data.user_id,
    guildId: result.data.guild_id,
    orderId: result.data.id,
    orderNumber: result.data.order_number,
  });
  invalidateGuildLicenseCaches(result.data.guild_id || undefined);

  await createPaymentOrderEventSafe(
    result.data.id,
    "provider_payment_auto_refunded_after_finalization_failure",
    {
      source: input.source,
      providerPaymentId: input.providerPaymentId,
      reason: AUTO_REFUND_FINALIZATION_FAILURE_STATUS_DETAIL,
    },
  );

  return result.data;
}

export async function settleApprovedPaymentOrder<
  TOrder extends PaymentSettlementOrderRecord,
>(input: {
  order: TOrder;
  source: string;
  selectColumns: string;
  allowAutoRefundOnFailure?: boolean;
  providerPayment?: MercadoPagoPaymentResponse | null;
}) : Promise<PaymentSettlementResult<TOrder>> {
  if (!shouldAttemptSettlementRecovery(input.order)) {
    return {
      order: input.order,
      settled: false,
      pendingRecovery: false,
      autoRefunded: false,
    };
  }

  let planStateSnapshot: UserPlanStateSettlementRecord | null = null;
  try {
    planStateSnapshot = await getPlanStateSnapshot(input.order.user_id);
  } catch {
    planStateSnapshot = null;
  }

  if (shouldTreatPlanStateAsSettled(planStateSnapshot, input.order)) {
    const settledOrder = await markSettlementAsSettled({
      order: input.order,
      selectColumns: input.selectColumns,
      source: input.source,
    });
    return {
      order: settledOrder,
      settled: true,
      pendingRecovery: false,
      autoRefunded: false,
    };
  }

  try {
    await syncUserPlanStateFromOrder(input.order);
    clearPlanStateCacheForUser(input.order.user_id);
    invalidateGuildLicenseCaches(input.order.guild_id || undefined);
    const settledOrder = await markSettlementAsSettled({
      order: input.order,
      selectColumns: input.selectColumns,
      source: input.source,
    });
    return {
      order: settledOrder,
      settled: true,
      pendingRecovery: false,
      autoRefunded: false,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Falha ao finalizar a liberacao interna do pagamento.";

    const pendingSettlement = await markSettlementAsPending({
      order: input.order,
      selectColumns: input.selectColumns,
      source: input.source,
      message: errorMessage,
    });
    let pendingOrder = pendingSettlement.order;

    if (!input.allowAutoRefundOnFailure) {
      return {
        order: pendingOrder,
        settled: false,
        pendingRecovery: true,
        autoRefunded: false,
      };
    }

    let refreshedPlanState: UserPlanStateSettlementRecord | null = null;
    try {
      refreshedPlanState = await getPlanStateSnapshot(input.order.user_id);
    } catch {
      refreshedPlanState = null;
    }

    if (shouldTreatPlanStateAsSettled(refreshedPlanState, input.order)) {
      const settledOrder = await markSettlementAsSettled({
        order: pendingOrder,
        selectColumns: input.selectColumns,
        source: `${input.source}:recovered`,
      });
      return {
        order: settledOrder,
        settled: true,
        pendingRecovery: false,
        autoRefunded: false,
      };
    }

    const providerPaymentId = normalizeOptionalString(input.order.provider_payment_id);
    if (!providerPaymentId) {
      return {
        order: pendingOrder,
        settled: false,
        pendingRecovery: true,
        autoRefunded: false,
      };
    }

    const failureCount = pendingSettlement.failureCount;
    const firstFailedAtMs = parseUtcTimestampMs(pendingSettlement.firstFailedAt);
    const referenceMs = resolveSettlementReferenceMs(input.order);
    const refundEligibleAtMs =
      (Number.isFinite(firstFailedAtMs) ? firstFailedAtMs : referenceMs) +
      resolveFinalizationRefundGraceMs();

    if (
      failureCount < resolveFinalizationMaxFailures() ||
      Date.now() < refundEligibleAtMs
    ) {
      return {
        order: pendingOrder,
        settled: false,
        pendingRecovery: true,
        autoRefunded: false,
      };
    }

    let providerPayment = input.providerPayment || null;
    try {
      if (!providerPayment) {
        providerPayment = await fetchMercadoPagoPaymentById(providerPaymentId, {
          useCardToken:
            normalizeOptionalString(input.order.payment_method)?.toLowerCase() ===
            "card",
          forceFresh: true,
        });
      }
    } catch {
      providerPayment = null;
    }

    if (!providerPayment || resolvePaymentStatus(providerPayment.status) !== "approved") {
      return {
        order: pendingOrder,
        settled: false,
        pendingRecovery: true,
        autoRefunded: false,
      };
    }

    const refundedOrder = await applyAutomaticRefundForSettlementFailure({
      order: pendingOrder,
      source: input.source,
      providerPayment,
      providerPaymentId,
      selectColumns: input.selectColumns,
    });

    return {
      order: refundedOrder,
      settled: false,
      pendingRecovery: false,
      autoRefunded: true,
    };
  }
}

export function hasApprovedPaymentPendingSettlement(
  order: PaymentSettlementOrderRecord | null | undefined,
) {
  if (!order) return false;
  const finalization = parseFinalizationPayload(order.provider_payload);
  return (
    normalizeOptionalString(order.status)?.toLowerCase() === "approved" &&
    finalization.status === FINALIZATION_STATUS_PENDING
  );
}

export function shouldTrackApprovedPaymentSettlement(
  order: PaymentSettlementOrderRecord | null | undefined,
) {
  return Boolean(order && shouldAttemptSettlementRecovery(order));
}
