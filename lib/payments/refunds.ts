import { clearPlanStateCacheForUser } from "@/lib/account/managedPlanState";
import type { MercadoPagoPaymentResponse } from "@/lib/payments/mercadoPago";
import { invalidateGuildLicenseCaches } from "@/lib/payments/licenseStatus";
import { invalidatePaymentOrderQueryCaches } from "@/lib/payments/orderQueryCache";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { normalizeUtcTimestampIso, parseUtcTimestampMs } from "@/lib/time/utcTimestamp";

export type PaymentFinancialStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "charged_back";

export type RefundSource =
  | "official_support_ticket"
  | "admin_manual"
  | "system_auto"
  | "mercado_pago_webhook"
  | "provider_reconciliation";

export type RefundKind =
  | "full_refund"
  | "partial_refund"
  | "chargeback"
  | "manual_adjustment"
  | "refund_reversal";

export type SubscriptionAccessAction =
  | "revoke_immediately"
  | "keep_until_expiration"
  | "cancel_renewal_only"
  | "block_internal"
  | "none";

export type PlanBillingFamily =
  | "trial"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "lifetime"
  | "custom";

export type RefundLedgerEntry = {
  refundId: string | null;
  refundKey: string;
  status: Exclude<PaymentFinancialStatus, "pending" | "approved" | "rejected" | "cancelled" | "expired" | "failed">;
  kind: RefundKind;
  amount: number;
  currency: string;
  reason: string;
  source: RefundSource;
  actorUserId: string | null;
  actorLabel: string | null;
  protocol: string | null;
  accessAction: SubscriptionAccessAction;
  accessUntil: string | null;
  riskScore: number | null;
  riskFlags: string[];
  createdAt: string;
  providerPaymentId: string | null;
  providerRefundPayload?: unknown;
};

export type RefundLedger = {
  version: 1;
  originalAmount: number;
  totalRefundedAmount: number;
  lastStatus: RefundLedgerEntry["status"] | null;
  lastRefundedAt: string | null;
  lastReason: string | null;
  accessAction: SubscriptionAccessAction | null;
  accessUntil: string | null;
  entries: RefundLedgerEntry[];
};

export type PaymentRefundSummary = {
  status: RefundLedgerEntry["status"] | "none";
  originalAmount: number;
  refundedAmount: number;
  currency: string;
  refundedAt: string | null;
  reason: string | null;
  actorUserId: string | null;
  actorLabel: string | null;
  method: string | null;
  providerPaymentId: string | null;
  refundId: string | null;
  refundKey: string | null;
  protocol: string | null;
  accessAction: SubscriptionAccessAction | null;
  accessLabel: string | null;
  accessUntil: string | null;
  remainingAccessSeconds: number | null;
  riskFlags: string[];
};

export type PaymentRefundOrderRecord = {
  id: number;
  order_number?: number | null;
  user_id: number;
  guild_id?: string | null;
  payment_method?: string | null;
  status?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  plan_code?: string | null;
  plan_name?: string | null;
  plan_billing_cycle_days?: number | null;
  provider_payment_id?: string | null;
  provider_status?: string | null;
  provider_status_detail?: string | null;
  provider_payload?: unknown;
  paid_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
};

export type RefundPolicyDecision = {
  status: "refunded" | "partially_refunded" | "charged_back";
  kind: RefundKind;
  billingFamily: PlanBillingFamily;
  accessAction: SubscriptionAccessAction;
  refundAmount: number;
  originalAmount: number;
  currency: string;
  purchaseAt: string | null;
  refundWindowEndsAt: string | null;
  insideRefundWindow: boolean;
  usedRatio: number;
  remainingRatio: number;
  accessUntil: string | null;
  reason: string;
  riskFlags: string[];
};

export type BuildRefundOutcomeInput = {
  order: PaymentRefundOrderRecord;
  source: RefundSource;
  reason: string;
  refundKind?: RefundKind;
  refundAmount?: number | null;
  providerRefundPayload?: unknown;
  providerPayment?: MercadoPagoPaymentResponse | null;
  actorUserId?: string | number | null;
  actorLabel?: string | null;
  protocol?: string | null;
  requestedAccessAction?: SubscriptionAccessAction | null;
  riskScore?: number | null;
  riskFlags?: string[];
  nowIso?: string;
};

export type RefundOutcome = {
  decision: RefundPolicyDecision;
  ledgerEntry: RefundLedgerEntry;
  providerPayload: Record<string, unknown>;
  update: {
    status: PaymentFinancialStatus;
    provider_status: string;
    provider_status_detail: string;
    provider_payload: Record<string, unknown>;
    expires_at?: string | null;
    provider_external_reference?: string | null;
    provider_qr_code?: string | null;
    provider_qr_base64?: string | null;
    provider_ticket_url?: string | null;
  };
};

type OptionalTableError = {
  code?: string;
  message?: string;
};

const DEFAULT_REFUND_WINDOWS_DAYS: Record<PlanBillingFamily, number> = {
  trial: 0,
  monthly: 7,
  quarterly: 7,
  semiannual: 10,
  annual: 14,
  lifetime: 14,
  custom: 7,
};

const PROVIDER_STATUS_DETAIL_BY_REFUND_STATUS: Record<
  RefundPolicyDecision["status"],
  string
> = {
  refunded: "refund_processed",
  partially_refunded: "partial_refund_processed",
  charged_back: "chargeback_processed",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteAmount(value: unknown, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeActorUserId(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return normalizeOptionalString(value);
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isMissingOptionalTableError(error: unknown, tableName: string) {
  const record = isRecord(error) ? (error as OptionalTableError) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes(tableName.toLowerCase()) ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function normalizeRiskScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

function normalizeRiskFlags(values: string[] | undefined, extra: string[] = []) {
  return Array.from(
    new Set(
      [...(values || []), ...extra]
        .map((value) => value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_"))
        .filter(Boolean)
        .slice(0, 20),
    ),
  );
}

function resolveIso(value: string | null | undefined) {
  return normalizeUtcTimestampIso(value || null);
}

function readLedgerFromPayload(providerPayload: unknown): RefundLedger | null {
  if (!isRecord(providerPayload)) return null;
  const raw = isRecord(providerPayload.flowdesk_refunds)
    ? providerPayload.flowdesk_refunds
    : null;
  if (!raw) return null;

  const entries = Array.isArray(raw.entries)
    ? raw.entries
        .filter(isRecord)
        .map((entry) => ({
          refundId: normalizeOptionalString(entry.refundId),
          refundKey: normalizeOptionalString(entry.refundKey) || "legacy",
          status: normalizeRefundTerminalStatus(entry.status) || "refunded",
          kind: normalizeRefundKind(entry.kind) || "full_refund",
          amount: roundMoney(toFiniteAmount(entry.amount, 0)),
          currency: normalizeOptionalString(entry.currency) || "BRL",
          reason: normalizeOptionalString(entry.reason) || "Reembolso processado.",
          source: normalizeRefundSource(entry.source) || "system_auto",
          actorUserId: normalizeActorUserId(entry.actorUserId as string | number | null),
          actorLabel: normalizeOptionalString(entry.actorLabel),
          protocol: normalizeOptionalString(entry.protocol),
          accessAction: normalizeAccessAction(entry.accessAction) || "revoke_immediately",
          accessUntil: resolveIso(entry.accessUntil as string | null | undefined),
          riskScore: normalizeRiskScore(entry.riskScore as number | null),
          riskFlags: Array.isArray(entry.riskFlags)
            ? normalizeRiskFlags(entry.riskFlags.filter((flag): flag is string => typeof flag === "string"))
            : [],
          createdAt: resolveIso(entry.createdAt as string | null | undefined) || new Date(0).toISOString(),
          providerPaymentId: normalizeOptionalString(entry.providerPaymentId),
          providerRefundPayload: entry.providerRefundPayload,
        }))
    : [];

  return {
    version: 1,
    originalAmount: roundMoney(toFiniteAmount(raw.originalAmount, 0)),
    totalRefundedAmount: roundMoney(toFiniteAmount(raw.totalRefundedAmount, 0)),
    lastStatus: normalizeRefundTerminalStatus(raw.lastStatus),
    lastRefundedAt: resolveIso(raw.lastRefundedAt as string | null | undefined),
    lastReason: normalizeOptionalString(raw.lastReason),
    accessAction: normalizeAccessAction(raw.accessAction),
    accessUntil: resolveIso(raw.accessUntil as string | null | undefined),
    entries,
  };
}

function normalizeRefundTerminalStatus(
  value: unknown,
): RefundLedgerEntry["status"] | null {
  if (value === "refunded" || value === "partially_refunded" || value === "charged_back") {
    return value;
  }
  if (value === "chargeback") return "charged_back";
  return null;
}

function normalizeRefundKind(value: unknown): RefundKind | null {
  if (
    value === "full_refund" ||
    value === "partial_refund" ||
    value === "chargeback" ||
    value === "manual_adjustment" ||
    value === "refund_reversal"
  ) {
    return value;
  }
  return null;
}

function normalizeRefundSource(value: unknown): RefundSource | null {
  if (
    value === "official_support_ticket" ||
    value === "admin_manual" ||
    value === "system_auto" ||
    value === "mercado_pago_webhook" ||
    value === "provider_reconciliation"
  ) {
    return value;
  }
  return null;
}

function normalizeAccessAction(value: unknown): SubscriptionAccessAction | null {
  if (
    value === "revoke_immediately" ||
    value === "keep_until_expiration" ||
    value === "cancel_renewal_only" ||
    value === "block_internal" ||
    value === "none"
  ) {
    return value;
  }
  return null;
}

function appendRefundLedger(
  providerPayload: unknown,
  entry: RefundLedgerEntry,
  originalAmount: number,
) {
  const currentPayload = isRecord(providerPayload) ? providerPayload : {};
  const currentLedger = readLedgerFromPayload(currentPayload);
  const entries = currentLedger?.entries || [];
  const withoutDuplicate = entries.filter(
    (item) => item.refundKey !== entry.refundKey,
  );
  const nextEntries = [...withoutDuplicate, entry].sort(
    (left, right) =>
      parseUtcTimestampMs(left.createdAt) - parseUtcTimestampMs(right.createdAt),
  );
  const totalRefundedAmount = roundMoney(
    nextEntries.reduce((total, item) => total + item.amount, 0),
  );
  const lastEntry = nextEntries[nextEntries.length - 1] || entry;

  const ledger: RefundLedger = {
    version: 1,
    originalAmount: roundMoney(originalAmount),
    totalRefundedAmount,
    lastStatus: lastEntry.status,
    lastRefundedAt: lastEntry.createdAt,
    lastReason: lastEntry.reason,
    accessAction: lastEntry.accessAction,
    accessUntil: lastEntry.accessUntil,
    entries: nextEntries,
  };

  return {
    ...currentPayload,
    flowdesk_refunds: ledger,
    ticket_refund: {
      status: lastEntry.status,
      refundedAt: lastEntry.createdAt,
      reason: lastEntry.reason,
      source: lastEntry.source,
      refundId: lastEntry.refundId,
      refundKey: lastEntry.refundKey,
      refundAmount: lastEntry.amount,
      protocol: lastEntry.protocol,
      actorUserId: lastEntry.actorUserId,
      actorLabel: lastEntry.actorLabel,
      accessAction: lastEntry.accessAction,
      accessUntil: lastEntry.accessUntil,
    },
  };
}

function resolveBillingFamily(input: {
  planCode?: string | null;
  paymentMethod?: string | null;
  billingCycleDays?: number | null;
}): PlanBillingFamily {
  if (input.paymentMethod === "trial" || input.planCode === "basic") {
    return "trial";
  }

  const cycleDays =
    typeof input.billingCycleDays === "number" && Number.isFinite(input.billingCycleDays)
      ? input.billingCycleDays
      : 30;

  if (cycleDays >= 3650) return "lifetime";
  if (cycleDays <= 45) return "monthly";
  if (cycleDays <= 120) return "quarterly";
  if (cycleDays <= 240) return "semiannual";
  if (cycleDays <= 400) return "annual";
  return "custom";
}

function resolveRefundWindowEndsAt(input: {
  purchaseAt: string | null;
  billingFamily: PlanBillingFamily;
}) {
  if (!input.purchaseAt) return null;
  const purchaseMs = parseUtcTimestampMs(input.purchaseAt);
  if (!Number.isFinite(purchaseMs)) return null;

  const days = DEFAULT_REFUND_WINDOWS_DAYS[input.billingFamily];
  return new Date(purchaseMs + days * 24 * 60 * 60 * 1000).toISOString();
}

function resolveUsageRatios(input: {
  purchaseAt: string | null;
  expiresAt: string | null;
  nowIso: string;
}) {
  const purchaseMs = parseUtcTimestampMs(input.purchaseAt);
  const expiresMs = parseUtcTimestampMs(input.expiresAt);
  const nowMs = parseUtcTimestampMs(input.nowIso);

  if (
    !Number.isFinite(purchaseMs) ||
    !Number.isFinite(expiresMs) ||
    !Number.isFinite(nowMs) ||
    expiresMs <= purchaseMs
  ) {
    return { usedRatio: 0, remainingRatio: 1 };
  }

  const usedRatio = clampRatio((nowMs - purchaseMs) / (expiresMs - purchaseMs));
  return {
    usedRatio,
    remainingRatio: clampRatio(1 - usedRatio),
  };
}

function resolveProviderRefundAmount(providerPayment: MercadoPagoPaymentResponse | null | undefined) {
  if (!providerPayment) return 0;

  const direct = Math.max(
    toFiniteAmount(providerPayment.transaction_amount_refunded, 0),
    toFiniteAmount(providerPayment.refunded_amount, 0),
  );
  if (direct > 0) return roundMoney(direct);

  if (Array.isArray(providerPayment.refunds)) {
    return roundMoney(
      providerPayment.refunds.reduce((total, refund) => {
        if (!isRecord(refund)) return total;
        return total + toFiniteAmount(refund.amount, 0);
      }, 0),
    );
  }

  return 0;
}

function resolveProviderRefundId(providerRefundPayload: unknown) {
  if (isRecord(providerRefundPayload)) {
    return (
      normalizeOptionalString(providerRefundPayload.id) ||
      normalizeOptionalString(providerRefundPayload.refund_id) ||
      normalizeOptionalString(providerRefundPayload.refundId)
    );
  }

  return null;
}

function buildRefundKey(input: {
  orderId: number;
  providerPaymentId: string | null;
  source: RefundSource;
  refundId: string | null;
  status: string;
  amount: number;
  protocol: string | null;
}) {
  return [
    "payment-refund",
    input.orderId,
    input.providerPaymentId || "no-provider-payment",
    input.refundId || input.protocol || input.source,
    input.status,
    input.amount.toFixed(2),
  ].join(":");
}

function resolveDefaultAccessAction(input: {
  requestedAccessAction?: SubscriptionAccessAction | null;
  status: RefundPolicyDecision["status"];
  kind: RefundKind;
  insideWindow: boolean;
  refundAmount: number;
}) {
  if (input.requestedAccessAction) {
    return input.requestedAccessAction;
  }

  if (input.status === "charged_back" || input.kind === "chargeback") {
    return "block_internal";
  }

  if (input.refundAmount <= 0) {
    return "cancel_renewal_only";
  }

  return "revoke_immediately";
}

export function resolveRefundPolicyDecision(input: {
  order: PaymentRefundOrderRecord;
  providerPayment?: MercadoPagoPaymentResponse | null;
  refundKind?: RefundKind;
  refundAmount?: number | null;
  requestedAccessAction?: SubscriptionAccessAction | null;
  reason: string;
  nowIso?: string;
  riskFlags?: string[];
}): RefundPolicyDecision {
  const nowIso = input.nowIso || new Date().toISOString();
  const originalAmount = roundMoney(toFiniteAmount(input.order.amount, 0));
  const currency = normalizeOptionalString(input.order.currency) || "BRL";
  const providerStatus = normalizeOptionalString(input.providerPayment?.status)?.toLowerCase();
  const providerRefundAmount = resolveProviderRefundAmount(input.providerPayment);
  const requestedRefundAmount =
    typeof input.refundAmount === "number" && Number.isFinite(input.refundAmount)
      ? Math.max(0, input.refundAmount)
      : providerRefundAmount > 0
        ? providerRefundAmount
        : originalAmount;
  const refundAmount = roundMoney(Math.min(Math.max(requestedRefundAmount, 0), originalAmount));
  const billingFamily = resolveBillingFamily({
    planCode: input.order.plan_code,
    paymentMethod: input.order.payment_method,
    billingCycleDays: input.order.plan_billing_cycle_days,
  });
  const purchaseAt = resolveIso(input.order.paid_at) || resolveIso(input.order.created_at);
  const refundWindowEndsAt = resolveRefundWindowEndsAt({
    purchaseAt,
    billingFamily,
  });
  const refundWindowEndsAtMs = parseUtcTimestampMs(refundWindowEndsAt);
  const nowMs = parseUtcTimestampMs(nowIso);
  const insideRefundWindow =
    Number.isFinite(refundWindowEndsAtMs) &&
    Number.isFinite(nowMs) &&
    nowMs <= refundWindowEndsAtMs;
  const ratios = resolveUsageRatios({
    purchaseAt,
    expiresAt: resolveIso(input.order.expires_at),
    nowIso,
  });
  const kind =
    input.refundKind ||
    (providerStatus === "charged_back"
      ? "chargeback"
      : refundAmount > 0 && refundAmount + 0.01 < originalAmount
        ? "partial_refund"
        : "full_refund");
  const status =
    kind === "chargeback" || providerStatus === "charged_back"
      ? "charged_back"
      : refundAmount > 0 && refundAmount + 0.01 < originalAmount
        ? "partially_refunded"
        : "refunded";
  const accessAction = resolveDefaultAccessAction({
    requestedAccessAction: input.requestedAccessAction,
    status,
    kind,
    insideWindow: insideRefundWindow,
    refundAmount,
  });
  const accessUntil =
    accessAction === "keep_until_expiration" ||
    accessAction === "cancel_renewal_only"
      ? resolveIso(input.order.expires_at)
      : nowIso;
  const riskFlags = normalizeRiskFlags(input.riskFlags, [
    insideRefundWindow ? "inside_policy_window" : "outside_policy_window",
    status,
    accessAction,
    billingFamily,
  ]);

  return {
    status,
    kind,
    billingFamily,
    accessAction,
    refundAmount,
    originalAmount,
    currency,
    purchaseAt,
    refundWindowEndsAt,
    insideRefundWindow,
    usedRatio: ratios.usedRatio,
    remainingRatio: ratios.remainingRatio,
    accessUntil,
    reason: input.reason,
    riskFlags,
  };
}

export function buildRefundOutcome(input: BuildRefundOutcomeInput): RefundOutcome {
  const nowIso = input.nowIso || new Date().toISOString();
  const decision = resolveRefundPolicyDecision({
    order: input.order,
    providerPayment: input.providerPayment,
    refundKind: input.refundKind,
    refundAmount: input.refundAmount,
    requestedAccessAction: input.requestedAccessAction,
    reason: input.reason,
    nowIso,
    riskFlags: input.riskFlags,
  });
  const refundId = resolveProviderRefundId(input.providerRefundPayload);
  const providerPaymentId =
    normalizeOptionalString(input.order.provider_payment_id) ||
    normalizeOptionalString(input.providerPayment?.id);
  const protocol = normalizeOptionalString(input.protocol);
  const refundKey = buildRefundKey({
    orderId: input.order.id,
    providerPaymentId,
    source: input.source,
    refundId,
    status: decision.status,
    amount: decision.refundAmount,
    protocol,
  });
  const ledgerEntry: RefundLedgerEntry = {
    refundId,
    refundKey,
    status: decision.status,
    kind: decision.kind,
    amount: decision.refundAmount,
    currency: decision.currency,
    reason: decision.reason,
    source: input.source,
    actorUserId: normalizeActorUserId(input.actorUserId),
    actorLabel: normalizeOptionalString(input.actorLabel),
    protocol,
    accessAction: decision.accessAction,
    accessUntil: decision.accessUntil,
    riskScore: normalizeRiskScore(input.riskScore),
    riskFlags: decision.riskFlags,
    createdAt: nowIso,
    providerPaymentId,
    providerRefundPayload: input.providerRefundPayload,
  };
  const providerPayload = appendRefundLedger(
    input.order.provider_payload,
    ledgerEntry,
    decision.originalAmount,
  );
  const providerStatusDetail =
    input.order.provider_status_detail &&
    input.order.provider_status_detail.toLowerCase().includes("refund")
      ? input.order.provider_status_detail
      : PROVIDER_STATUS_DETAIL_BY_REFUND_STATUS[decision.status];

  return {
    decision,
    ledgerEntry,
    providerPayload,
    update: {
      status: decision.status,
      provider_status: decision.status === "charged_back" ? "charged_back" : "refunded",
      provider_status_detail: providerStatusDetail,
      provider_payload: providerPayload,
      expires_at:
        decision.accessAction === "revoke_immediately" ||
        decision.accessAction === "block_internal"
          ? nowIso
          : input.order.expires_at || decision.accessUntil || undefined,
    },
  };
}

export function isRefundedPaymentStatus(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase();
  return (
    normalized === "refunded" ||
    normalized === "partially_refunded" ||
    normalized === "charged_back" ||
    normalized === "chargeback"
  );
}

export function isRefundedPaymentOrder(order: {
  status?: string | null;
  provider_status?: string | null;
  provider_status_detail?: string | null;
  provider_payload?: unknown;
}) {
  const status = String(order.status || "").toLowerCase();
  const providerStatus = String(order.provider_status || "").toLowerCase();
  const providerStatusDetail = String(order.provider_status_detail || "").toLowerCase();
  return (
    isRefundedPaymentStatus(status) ||
    isRefundedPaymentStatus(providerStatus) ||
    providerStatusDetail.includes("refund") ||
    providerStatusDetail.includes("chargeback") ||
    providerStatusDetail.includes("reembols") ||
    Boolean(readLedgerFromPayload(order.provider_payload)?.entries.length)
  );
}

function buildAccessLabel(input: {
  action: SubscriptionAccessAction | null;
  status: PaymentRefundSummary["status"];
}) {
  switch (input.action) {
    case "revoke_immediately":
      return "Acesso removido apos o reembolso.";
    case "keep_until_expiration":
      return "Acesso mantido ate o fim do ciclo ja contratado.";
    case "cancel_renewal_only":
      return "Renovacao cancelada; acesso permanece ate o vencimento.";
    case "block_internal":
      return "Acesso bloqueado internamente por risco financeiro.";
    case "none":
      return "Sem alteracao de acesso registrada.";
    default:
      return input.status === "none" ? null : "Politica de acesso registrada no estorno.";
  }
}

export function resolvePaymentRefundSummary(order: {
  amount?: string | number | null;
  currency?: string | null;
  payment_method?: string | null;
  status?: string | null;
  provider_payment_id?: string | null;
  provider_status?: string | null;
  provider_status_detail?: string | null;
  provider_payload?: unknown;
  expires_at?: string | null;
}): PaymentRefundSummary | null {
  const ledger = readLedgerFromPayload(order.provider_payload);
  const latestEntry = ledger?.entries[ledger.entries.length - 1] || null;
  const inferredStatus =
    latestEntry?.status ||
    normalizeRefundTerminalStatus(order.status) ||
    normalizeRefundTerminalStatus(order.provider_status);
  const originalAmount = ledger?.originalAmount || roundMoney(toFiniteAmount(order.amount, 0));
  const refundedAmount =
    ledger?.totalRefundedAmount ||
    (inferredStatus ? originalAmount : 0);
  const accessUntil = latestEntry?.accessUntil || ledger?.accessUntil || resolveIso(order.expires_at);
  const accessUntilMs = parseUtcTimestampMs(accessUntil);
  const remainingAccessSeconds =
    Number.isFinite(accessUntilMs) && accessUntilMs > Date.now()
      ? Math.floor((accessUntilMs - Date.now()) / 1000)
      : inferredStatus
        ? 0
        : null;
  const status = inferredStatus || "none";

  if (status === "none" && refundedAmount <= 0) {
    return null;
  }

  return {
    status,
    originalAmount,
    refundedAmount: roundMoney(refundedAmount),
    currency: normalizeOptionalString(order.currency) || "BRL",
    refundedAt: latestEntry?.createdAt || ledger?.lastRefundedAt || null,
    reason: latestEntry?.reason || ledger?.lastReason || null,
    actorUserId: latestEntry?.actorUserId || null,
    actorLabel: latestEntry?.actorLabel || null,
    method: normalizeOptionalString(order.payment_method),
    providerPaymentId: normalizeOptionalString(order.provider_payment_id),
    refundId: latestEntry?.refundId || null,
    refundKey: latestEntry?.refundKey || null,
    protocol: latestEntry?.protocol || null,
    accessAction: latestEntry?.accessAction || ledger?.accessAction || null,
    accessLabel: buildAccessLabel({
      action: latestEntry?.accessAction || ledger?.accessAction || null,
      status,
    }),
    accessUntil,
    remainingAccessSeconds,
    riskFlags: latestEntry?.riskFlags || [],
  };
}

async function createPaymentOrderEventSafe(
  paymentOrderId: number,
  eventType: string,
  eventPayload: Record<string, unknown>,
) {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase.from("payment_order_events").insert({
      payment_order_id: paymentOrderId,
      event_type: eventType,
      event_payload: eventPayload,
    });
    if (result.error) {
      return { ok: false as const, error: result.error.message };
    }
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Falha ao registrar evento.",
    };
  }
}

async function insertRefundRecordSafe(input: {
  order: PaymentRefundOrderRecord;
  outcome: RefundOutcome;
}) {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase.from("payment_refund_records").upsert(
      {
        payment_order_id: input.order.id,
        user_id: input.order.user_id,
        guild_id: input.order.guild_id || null,
        refund_key: input.outcome.ledgerEntry.refundKey,
        provider_payment_id: input.outcome.ledgerEntry.providerPaymentId,
        provider_refund_id: input.outcome.ledgerEntry.refundId,
        status: input.outcome.decision.status,
        kind: input.outcome.decision.kind,
        source: input.outcome.ledgerEntry.source,
        amount: input.outcome.decision.refundAmount,
        currency: input.outcome.decision.currency,
        reason: input.outcome.decision.reason,
        actor_user_id: input.outcome.ledgerEntry.actorUserId,
        actor_label: input.outcome.ledgerEntry.actorLabel,
        protocol: input.outcome.ledgerEntry.protocol,
        access_action: input.outcome.decision.accessAction,
        access_until: input.outcome.decision.accessUntil,
        risk_score: input.outcome.ledgerEntry.riskScore,
        risk_flags: input.outcome.ledgerEntry.riskFlags,
        provider_payload: input.outcome.ledgerEntry.providerRefundPayload || {},
        processed_at: input.outcome.ledgerEntry.createdAt,
      },
      {
        onConflict: "payment_order_id,refund_key",
      },
    );

    if (result.error) {
      if (isMissingOptionalTableError(result.error, "payment_refund_records")) {
        return { ok: true as const, skipped: true as const };
      }
      return { ok: false as const, error: result.error.message };
    }

    return { ok: true as const, skipped: false as const };
  } catch (error) {
    if (isMissingOptionalTableError(error, "payment_refund_records")) {
      return { ok: true as const, skipped: true as const };
    }
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Falha ao registrar ledger de reembolso.",
    };
  }
}

async function insertRiskFlagSafe(input: {
  order: PaymentRefundOrderRecord;
  outcome: RefundOutcome;
}) {
  if (
    input.outcome.decision.status !== "charged_back" &&
    (input.outcome.ledgerEntry.riskScore || 0) < 70
  ) {
    return { ok: true as const, skipped: true as const };
  }

  try {
    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase.from("payment_risk_flags").upsert(
      {
        user_id: input.order.user_id,
        guild_id: input.order.guild_id || null,
        payment_order_id: input.order.id,
        flag_key:
          input.outcome.decision.status === "charged_back"
            ? "chargeback"
            : "high_refund_risk",
        severity: input.outcome.decision.status === "charged_back" ? "critical" : "high",
        status: "active",
        reason: input.outcome.decision.reason,
        metadata: {
          refundKey: input.outcome.ledgerEntry.refundKey,
          riskScore: input.outcome.ledgerEntry.riskScore,
          riskFlags: input.outcome.ledgerEntry.riskFlags,
        },
      },
      {
        onConflict: "user_id,flag_key,payment_order_id",
      },
    );

    if (result.error) {
      if (isMissingOptionalTableError(result.error, "payment_risk_flags")) {
        return { ok: true as const, skipped: true as const };
      }
      return { ok: false as const, error: result.error.message };
    }

    return { ok: true as const, skipped: false as const };
  } catch (error) {
    if (isMissingOptionalTableError(error, "payment_risk_flags")) {
      return { ok: true as const, skipped: true as const };
    }
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Falha ao registrar risco financeiro.",
    };
  }
}

async function mergePlanStateMetadata(userId: number, patch: Record<string, unknown>) {
  const supabase = getSupabaseAdminClientOrThrow();
  const currentResult = await supabase
    .from("auth_user_plan_state")
    .select("metadata")
    .eq("user_id", userId)
    .maybeSingle<{ metadata: Record<string, unknown> | null }>();

  if (currentResult.error) {
    return { metadata: patch, error: currentResult.error.message };
  }

  return {
    metadata: {
      ...(isRecord(currentResult.data?.metadata) ? currentResult.data?.metadata : {}),
      ...patch,
    },
    error: null,
  };
}

export async function applySubscriptionAccessOutcome(input: {
  order: PaymentRefundOrderRecord;
  outcome: RefundOutcome;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = input.outcome.ledgerEntry.createdAt;
  const action = input.outcome.decision.accessAction;
  const metadataPatch = {
    financialEvent: {
      type: input.outcome.decision.status,
      paymentOrderId: input.order.id,
      refundKey: input.outcome.ledgerEntry.refundKey,
      reason: input.outcome.decision.reason,
      accessAction: action,
      accessUntil: input.outcome.decision.accessUntil,
      processedAt: nowIso,
    },
  };

  const { metadata } = await mergePlanStateMetadata(input.order.user_id, metadataPatch);

  if (input.order.guild_id) {
    await supabase
      .from("guild_plan_settings")
      .update({
        recurring_enabled: false,
      })
      .eq("user_id", input.order.user_id)
      .eq("guild_id", input.order.guild_id);
  }

  const shouldTouchCurrentPlan = await supabase
    .from("auth_user_plan_state")
    .select("last_payment_order_id")
    .eq("user_id", input.order.user_id)
    .maybeSingle<{ last_payment_order_id: number | null }>();

  if (
    !shouldTouchCurrentPlan.error &&
    shouldTouchCurrentPlan.data?.last_payment_order_id !== input.order.id
  ) {
    clearPlanStateCacheForUser(input.order.user_id);
    return { ok: true as const, skippedCurrentPlan: true as const };
  }

  if (action === "revoke_immediately" || action === "block_internal") {
    const planUpdate = await supabase
      .from("auth_user_plan_state")
      .update({
        status: "expired",
        expires_at: nowIso,
        metadata,
      })
      .eq("user_id", input.order.user_id);

    if (planUpdate.error) {
      return { ok: false as const, error: planUpdate.error.message };
    }

    const guildUpdate = await supabase
      .from("auth_user_plan_guilds")
      .update({
        is_active: false,
        deactivated_reason:
          action === "block_internal"
            ? "financial_chargeback_or_risk"
            : "payment_refunded",
        deactivated_at: nowIso,
      })
      .eq("user_id", input.order.user_id)
      .eq("is_active", true);

    if (
      guildUpdate.error &&
      !isMissingOptionalTableError(guildUpdate.error, "is_active")
    ) {
      return { ok: false as const, error: guildUpdate.error.message };
    }
  } else {
    const planUpdate = await supabase
      .from("auth_user_plan_state")
      .update({
        metadata: {
          ...metadata,
          subscriptionCancellation: {
            reason: input.outcome.decision.reason,
            paymentOrderId: input.order.id,
            refundKey: input.outcome.ledgerEntry.refundKey,
            accessAction: action,
            accessUntil: input.outcome.decision.accessUntil,
            renews: false,
            processedAt: nowIso,
          },
        },
      })
      .eq("user_id", input.order.user_id);

    if (planUpdate.error) {
      return { ok: false as const, error: planUpdate.error.message };
    }
  }

  clearPlanStateCacheForUser(input.order.user_id);
  invalidateGuildLicenseCaches(input.order.guild_id || undefined);
  return { ok: true as const, skippedCurrentPlan: false as const };
}

export async function finalizePaymentRefundOutcome<TOrder = unknown>(input: {
  order: PaymentRefundOrderRecord;
  outcome: RefundOutcome;
  selectColumns: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .update(input.outcome.update)
    .eq("id", input.order.id)
    .select(input.selectColumns)
    .single();

  if (result.error || !result.data) {
    throw new Error(
      result.error?.message || "Falha ao atualizar pedido apos reembolso.",
    );
  }

  const [eventResult, refundRecordResult, riskFlagResult, accessResult] =
    await Promise.all([
      createPaymentOrderEventSafe(
        input.order.id,
        input.outcome.decision.status === "charged_back"
          ? "payment_chargeback_recorded"
          : "payment_refund_recorded",
        {
          refundKey: input.outcome.ledgerEntry.refundKey,
          providerPaymentId: input.outcome.ledgerEntry.providerPaymentId,
          refundId: input.outcome.ledgerEntry.refundId,
          status: input.outcome.decision.status,
          kind: input.outcome.decision.kind,
          source: input.outcome.ledgerEntry.source,
          reason: input.outcome.decision.reason,
          refundAmount: input.outcome.decision.refundAmount,
          originalAmount: input.outcome.decision.originalAmount,
          currency: input.outcome.decision.currency,
          accessAction: input.outcome.decision.accessAction,
          accessUntil: input.outcome.decision.accessUntil,
          actorUserId: input.outcome.ledgerEntry.actorUserId,
          actorLabel: input.outcome.ledgerEntry.actorLabel,
          protocol: input.outcome.ledgerEntry.protocol,
          riskScore: input.outcome.ledgerEntry.riskScore,
          riskFlags: input.outcome.ledgerEntry.riskFlags,
        },
      ),
      insertRefundRecordSafe(input),
      insertRiskFlagSafe(input),
      applySubscriptionAccessOutcome(input),
    ]);

  invalidatePaymentOrderQueryCaches({
    userId: input.order.user_id,
    guildId: input.order.guild_id || undefined,
    orderId: input.order.id,
    orderNumber: input.order.order_number || undefined,
  });

  return {
    order: result.data as unknown as TOrder,
    eventResult,
    refundRecordResult,
    riskFlagResult,
    accessResult,
  };
}

export function resolveProviderFinancialStatus(
  providerPayment: MercadoPagoPaymentResponse | null | undefined,
) {
  const providerStatus = normalizeOptionalString(providerPayment?.status)?.toLowerCase();
  if (providerStatus === "charged_back") return "charged_back" as const;
  if (providerStatus === "refunded") return "refunded" as const;

  const transactionAmount = toFiniteAmount(providerPayment?.transaction_amount, 0);
  const refundedAmount = resolveProviderRefundAmount(providerPayment);
  if (refundedAmount > 0 && transactionAmount > 0) {
    return refundedAmount + 0.01 >= transactionAmount
      ? ("refunded" as const)
      : ("partially_refunded" as const);
  }

  if (providerStatus === "cancelled" || providerStatus === "canceled" || providerStatus === "reverted") {
    return "cancelled" as const;
  }

  if (providerStatus === "approved") return "approved" as const;
  if (providerStatus === "rejected") return "rejected" as const;
  if (providerStatus === "expired") return "expired" as const;
  return "pending" as const;
}
