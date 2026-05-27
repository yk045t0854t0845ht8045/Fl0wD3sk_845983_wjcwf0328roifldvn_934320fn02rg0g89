type PaymentAmountLike = string | number | null | undefined;

export type TrustedApprovedPaymentLike = {
  status?: string | null;
  payment_method?: string | null;
  provider_payment_id?: string | null;
  provider_status_detail?: string | null;
  provider_payload?: unknown;
  paid_at?: string | null;
  expires_at?: string | null;
  amount?: PaymentAmountLike;
};

const APPROVED_PAYMENT_TRUST_SELECT_COLUMNS = [
  "status",
  "payment_method",
  "provider_payment_id",
  "provider_status_detail",
  "provider_payload",
  "paid_at",
  "expires_at",
  "amount",
] as const;

const INTERNAL_APPROVED_STATUS_DETAIL_SET = new Set([
  "covered_by_internal_credits",
  "free_trial_activated",
]);

export const CHECKOUT_AMOUNT_MISMATCH_MESSAGE =
  "O valor do checkout foi atualizado enquanto o pagamento estava sendo preparado. Revise o total e gere novamente a cobranca.";

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function parsePaymentAmount(value: PaymentAmountLike) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRefundAccessAction(providerPayload: unknown) {
  if (!isRecord(providerPayload)) return null;
  const ledger = isRecord(providerPayload.flowdesk_refunds)
    ? providerPayload.flowdesk_refunds
    : null;
  const directAction =
    typeof ledger?.accessAction === "string" ? ledger.accessAction : null;
  if (directAction) return directAction;

  const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
  const latestEntry = entries.filter(isRecord).at(-1);
  return typeof latestEntry?.accessAction === "string"
    ? latestEntry.accessAction
    : null;
}

export function roundPaymentCurrencyAmount(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function normalizeExpectedCheckoutAmount(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? roundPaymentCurrencyAmount(value)
      : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0
      ? roundPaymentCurrencyAmount(parsed)
      : null;
  }

  return null;
}

export function hasCheckoutAmountMismatch(input: {
  expectedAmount: number | null;
  actualAmount: number;
  tolerance?: number;
}) {
  if (input.expectedAmount === null) {
    return false;
  }

  const tolerance =
    typeof input.tolerance === "number" && Number.isFinite(input.tolerance)
      ? Math.max(0, input.tolerance)
      : 0.009;

  const normalizedExpected = roundPaymentCurrencyAmount(input.expectedAmount);
  const normalizedActual = roundPaymentCurrencyAmount(input.actualAmount);
  return Math.abs(normalizedExpected - normalizedActual) > tolerance;
}

export function isTrustedApprovedPaymentRecord(
  record: TrustedApprovedPaymentLike | null | undefined,
) {
  if (!record) return false;

  const status = normalizeOptionalString(record.status)?.toLowerCase();
  if (status !== "approved") return false;

  const paymentMethod = normalizeOptionalString(record.payment_method)?.toLowerCase();
  if (paymentMethod === "trial") {
    return true;
  }

  const providerStatusDetail = normalizeOptionalString(
    record.provider_status_detail,
  )?.toLowerCase();
  if (
    providerStatusDetail &&
    INTERNAL_APPROVED_STATUS_DETAIL_SET.has(providerStatusDetail)
  ) {
    return true;
  }

  const amount = roundPaymentCurrencyAmount(
    Math.max(0, parsePaymentAmount(record.amount)),
  );
  if (amount === 0 && providerStatusDetail === "covered_by_internal_credits") {
    return true;
  }

  return Boolean(
    normalizeOptionalString(record.provider_payment_id) &&
      normalizeOptionalString(record.paid_at),
  );
}

export function isRefundedPaymentStatusForAccess(status: string | null | undefined) {
  const normalized = normalizeOptionalString(status)?.toLowerCase();
  return normalized === "refunded" || normalized === "partially_refunded";
}

export function isTrustedPurchasedPaymentRecord(
  record: TrustedApprovedPaymentLike | null | undefined,
) {
  if (isTrustedApprovedPaymentRecord(record)) return true;
  if (!record) return false;

  const status = normalizeOptionalString(record.status)?.toLowerCase();
  if (!isRefundedPaymentStatusForAccess(status)) return false;

  const paymentMethod = normalizeOptionalString(record.payment_method)?.toLowerCase();
  if (paymentMethod === "trial") return true;

  return Boolean(
    normalizeOptionalString(record.provider_payment_id) &&
      normalizeOptionalString(record.paid_at),
  );
}

export function isTrustedLicenseEntitlementPaymentRecord(
  record: TrustedApprovedPaymentLike | null | undefined,
) {
  if (isTrustedApprovedPaymentRecord(record)) return true;
  if (!isTrustedPurchasedPaymentRecord(record)) return false;

  const accessAction = readRefundAccessAction(record?.provider_payload);
  if (
    accessAction !== "keep_until_expiration" &&
    accessAction !== "cancel_renewal_only" &&
    accessAction !== "none"
  ) {
    return false;
  }

  const expiresAtMs = record?.expires_at ? Date.parse(record.expires_at) : Number.NaN;
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
}

export function filterTrustedApprovedPaymentRecords<
  TRecord extends TrustedApprovedPaymentLike,
>(records: TRecord[]) {
  return records.filter((record) => isTrustedApprovedPaymentRecord(record));
}

export function filterTrustedPurchasedPaymentRecords<
  TRecord extends TrustedApprovedPaymentLike,
>(records: TRecord[]) {
  return records.filter((record) => isTrustedPurchasedPaymentRecord(record));
}

export function filterTrustedLicenseEntitlementPaymentRecords<
  TRecord extends TrustedApprovedPaymentLike,
>(records: TRecord[]) {
  return records.filter((record) => isTrustedLicenseEntitlementPaymentRecord(record));
}

export function withApprovedPaymentTrustSelectColumns(selectColumns: string) {
  const tokens = selectColumns
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const known = new Set(tokens.map((token) => token.toLowerCase()));

  for (const column of APPROVED_PAYMENT_TRUST_SELECT_COLUMNS) {
    if (!known.has(column)) {
      tokens.push(column);
      known.add(column);
    }
  }

  return tokens.join(", ");
}
