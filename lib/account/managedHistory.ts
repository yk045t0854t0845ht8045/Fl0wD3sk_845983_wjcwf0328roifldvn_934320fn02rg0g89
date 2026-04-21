import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  buildSavedMethods,
  extractCardSnapshot,
  type SavedMethod,
} from "@/lib/payments/savedMethods";
import { reconcilePaymentOrderRecord } from "@/lib/payments/reconciliation";
import { readOrderPlanTransitionPayload } from "@/lib/plans/change";
import {
  mergeSavedMethodsWithStored,
  toSavedMethodFromStoredRecord,
  type StoredPaymentMethodRecord,
} from "@/lib/payments/userPaymentMethods";

const historyCache = new Map<number, { data: ManagedHistory; timestamp: number }>();
const refreshingUserIds = new Set<number>();
const CACHE_TTL_MS = 600000; // 10 minutes
const STALE_THRESHOLD_MS = 20000; // 20 seconds

export type PaymentOrderStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";

export type PaymentMethod = "pix" | "card" | "trial";

export type PaymentOrderRecord = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id: string;
  payment_method: PaymentMethod;
  status: PaymentOrderStatus;
  amount: string | number;
  currency: string;
  provider_payment_id: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  provider_payload: unknown;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentOrderEventRecord = {
  payment_order_id: number;
  event_type: string;
  event_payload: Record<string, unknown> | null;
  created_at: string;
};

export type HistoryOrder = {
  id: number;
  orderNumber: number;
  guildId: string;
  method: PaymentMethod;
  status: PaymentOrderStatus;
  amount: number;
  currency: string;
  providerStatus: string | null;
  providerStatusDetail: string | null;
  card: unknown;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  technicalLabels: string[];
  financialSummary: {
    coveredByInternalCredits: boolean;
    currentPlanCreditAmount: number;
    creditAppliedToTargetAmount: number;
    surplusCreditGrantedAmount: number;
    flowPointsAppliedAmount: number;
    flowPointsGrantedAmount: number;
    couponDiscountAmount: number;
    giftCardDiscountAmount: number;
    targetTotalAmount: number;
    payableBeforeDiscountsAmount: number;
  } | null;
};

export type ManagedHistory = {
  orders: HistoryOrder[];
  methods: SavedMethod[];
};

const PAYMENT_HISTORY_SELECT_COLUMNS =
  "id, order_number, user_id, guild_id, payment_method, status, amount, currency, provider_payment_id, provider_status, provider_status_detail, provider_payload, paid_at, expires_at, created_at, updated_at";

const PAYMENT_HISTORY_EVENT_SELECT_COLUMNS =
  "payment_order_id, event_type, event_payload, created_at";

function toFiniteAmount(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseProviderPricingSummary(providerPayload: unknown) {
  if (!isRecord(providerPayload)) {
    return {
      couponDiscountAmount: 0,
      giftCardDiscountAmount: 0,
    };
  }

  const pricing = isRecord(providerPayload.pricing) ? providerPayload.pricing : null;
  const coupon = pricing && isRecord(pricing.coupon) ? pricing.coupon : null;
  const giftCard = pricing && isRecord(pricing.giftCard) ? pricing.giftCard : null;

  return {
    couponDiscountAmount: roundMoney(toFiniteAmount(coupon?.amount as string | number)),
    giftCardDiscountAmount: roundMoney(toFiniteAmount(giftCard?.amount as string | number)),
  };
}

function buildFinancialHistorySummary(order: PaymentOrderRecord) {
  const transition = readOrderPlanTransitionPayload(order.provider_payload);
  const pricing = parseProviderPricingSummary(order.provider_payload);
  const coveredByInternalCredits =
    order.provider_status_detail === "covered_by_internal_credits";

  if (!transition && !coveredByInternalCredits) {
    return null;
  }

  return {
    coveredByInternalCredits,
    currentPlanCreditAmount: roundMoney(transition?.currentCreditAmount || 0),
    creditAppliedToTargetAmount: roundMoney(
      transition?.creditAppliedToTargetAmount || 0,
    ),
    surplusCreditGrantedAmount: roundMoney(
      transition?.surplusCreditAmount || 0,
    ),
    flowPointsAppliedAmount: roundMoney(transition?.flowPointsApplied || 0),
    flowPointsGrantedAmount: roundMoney(transition?.flowPointsGranted || 0),
    couponDiscountAmount: pricing.couponDiscountAmount,
    giftCardDiscountAmount: pricing.giftCardDiscountAmount,
    targetTotalAmount: roundMoney(transition?.targetTotalAmount || 0),
    payableBeforeDiscountsAmount: roundMoney(
      transition?.payableBeforeDiscountsAmount || 0,
    ),
  };
}

function buildTechnicalHistoryLabels(
  order: PaymentOrderRecord,
  events: PaymentOrderEventRecord[],
) {
  const labels: string[] = [];
  const transition = readOrderPlanTransitionPayload(order.provider_payload);

  const hasApprovedReturnReconciliation = events.some(
    (event) =>
      event.event_type === "flowdesk_hosted_card_return_reconciled" &&
      (event.event_payload?.resolvedStatus === "approved" ||
        order.status === "approved"),
  );

  if (hasApprovedReturnReconciliation) {
    labels.push("Aprovado por reconciliacao de retorno");
  }

  const hasWebhookApproval = events.some(
    (event) =>
      event.event_type === "provider_payment_reconciled" &&
      event.event_payload?.source === "mercado_pago_webhook" &&
      event.event_payload?.resolvedStatus === "approved",
  );

  if (hasWebhookApproval) {
    labels.push("Aprovado por webhook");
  }

  const hasAutomaticRefund = events.some(
    (event) =>
      event.event_type === "provider_payment_auto_refunded" ||
      event.event_type === "provider_payment_auto_refunded_after_setup_timeout",
  );

  if (hasAutomaticRefund) {
    labels.push("Estorno automatico de seguranca");
  }

  if (order.provider_status_detail === "covered_by_internal_credits") {
    labels.push("Gratuidade por credito interno");
  }

  if ((transition?.currentCreditAmount || 0) > 0) {
    labels.push("Credito proporcional do plano aplicado");
  }

  if ((transition?.flowPointsApplied || 0) > 0) {
    labels.push("FlowPoints usados");
  }

  if ((transition?.flowPointsGranted || 0) > 0) {
    labels.push("FlowPoints creditados");
  }

  return labels;
}

function toHistoryOrder(
  order: PaymentOrderRecord,
  events: PaymentOrderEventRecord[],
): HistoryOrder {
  const card = order.payment_method === "card" ? extractCardSnapshot(order.provider_payload) : null;

  return {
    id: order.id,
    orderNumber: order.order_number,
    guildId: order.guild_id,
    method: order.payment_method,
    status: order.status,
    amount: toFiniteAmount(order.amount),
    currency: order.currency,
    providerStatus: order.provider_status,
    providerStatusDetail: order.provider_status_detail,
    card,
    paidAt: order.paid_at,
    expiresAt: order.expires_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    technicalLabels: buildTechnicalHistoryLabels(order, events),
    financialSummary: buildFinancialHistorySummary(order),
  };
}

export async function getManagedHistoryForUser(userId: number): Promise<ManagedHistory> {
  const cached = historyCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    const isStale = Date.now() - cached.timestamp > STALE_THRESHOLD_MS;
    if (isStale && !refreshingUserIds.has(userId)) {
      refreshingUserIds.add(userId);
      void fetchHistoryFresh(userId)
        .catch(() => null)
        .finally(() => refreshingUserIds.delete(userId));
    }
    return cached.data;
  }

  return fetchHistoryFresh(userId);
}

async function fetchHistoryFresh(userId: number): Promise<ManagedHistory> {
  const supabase = getSupabaseAdminClientOrThrow();

  // 1. Fetch main records and methods in parallel
  const [ordersResult, hiddenMethodsResult, storedMethodsResult] = await Promise.all([
    supabase
      .from("payment_orders")
      .select(PAYMENT_HISTORY_SELECT_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<PaymentOrderRecord[]>(),
    supabase
      .from("auth_user_hidden_payment_methods")
      .select("method_id")
      .eq("user_id", userId)
      .returns<Array<{ method_id: string }>>(),
    supabase
      .from("auth_user_payment_methods")
      .select(
        "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, is_active, verification_status, verification_status_detail, verification_amount, verified_at, last_context_guild_id, created_at, updated_at",
      )
      .eq("user_id", userId)
      .eq("is_active", true)
      .returns<StoredPaymentMethodRecord[]>(),
  ]);

  if (ordersResult.error) throw new Error(ordersResult.error.message);
  if (hiddenMethodsResult.error) throw new Error(hiddenMethodsResult.error.message);
  if (storedMethodsResult.error) throw new Error(storedMethodsResult.error.message);

  let rawOrders = ordersResult.data || [];

  // 2. Opportunistic reconciliation (Paralelizada)
  const candidates = rawOrders
    .filter(
      (order) =>
        !!order.provider_payment_id &&
        (order.status === "pending" ||
          order.status === "failed" ||
          order.status === "expired" ||
          order.status === "rejected"),
    )
    .slice(0, 4);

  if (candidates.length > 0) {
    const reconciliationResults = await Promise.allSettled(
      candidates.map((order) => reconcilePaymentOrderRecord(order, { source: "managed_history_fresh" })),
    );

    const changed = reconciliationResults.some(
      (r) => r.status === "fulfilled" && r.value.changed,
    );

    if (changed) {
      const refreshedResult = await supabase
        .from("payment_orders")
        .select(PAYMENT_HISTORY_SELECT_COLUMNS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(500)
        .returns<PaymentOrderRecord[]>();
      
      if (!refreshedResult.error) {
        rawOrders = refreshedResult.data || [];
      }
    }
  }

  // 3. Fetch events for all orders in parallel
  const orderIds = rawOrders.map((order) => order.id);
  let paymentEventsByOrderId = new Map<number, PaymentOrderEventRecord[]>();

  if (orderIds.length > 0) {
    const eventsResult = await supabase
      .from("payment_order_events")
      .select(PAYMENT_HISTORY_EVENT_SELECT_COLUMNS)
      .in("payment_order_id", orderIds)
      .order("created_at", { ascending: false })
      .returns<PaymentOrderEventRecord[]>();

    if (!eventsResult.error) {
      paymentEventsByOrderId = (eventsResult.data || []).reduce(
        (map, event) => {
          const current = map.get(event.payment_order_id) || [];
          current.push(event);
          map.set(event.payment_order_id, current);
          return map;
        },
        new Map<number, PaymentOrderEventRecord[]>(),
      );
    }
  }

  // 4. Build final objects
  const orders = rawOrders
      .filter((order) => {
        if (order.status !== "pending") return true;
        if (order.provider_payment_id) return true;
        const payload = isRecord(order.provider_payload)
          ? order.provider_payload
          : null;
        return !(payload && payload.precreated === true);
      })
    .map((order) =>
      toHistoryOrder(order, paymentEventsByOrderId.get(order.id) || []),
    );

  const allMethods = buildSavedMethods(
    rawOrders
      .filter(
        (
          order,
        ): order is PaymentOrderRecord & { payment_method: "pix" | "card" } =>
          order.payment_method === "pix" || order.payment_method === "card",
      )
      .map((order) => ({
        payment_method: order.payment_method,
        provider_payload: order.provider_payload,
        created_at: order.created_at,
      })),
  );

  const hiddenMethodSet = new Set(
    (hiddenMethodsResult.data || []).map((item) => item.method_id),
  );

  const storedMethods = (storedMethodsResult.data || [])
    .map((row) => toSavedMethodFromStoredRecord(row))
    .filter((method): method is NonNullable<typeof method> => Boolean(method));

  const methods = mergeSavedMethodsWithStored({
    derivedMethods: allMethods,
    storedMethods,
    hiddenMethodSet,
  });

  const data: ManagedHistory = { orders, methods };

  historyCache.set(userId, {
    data,
    timestamp: Date.now(),
  });

  return data;
}
