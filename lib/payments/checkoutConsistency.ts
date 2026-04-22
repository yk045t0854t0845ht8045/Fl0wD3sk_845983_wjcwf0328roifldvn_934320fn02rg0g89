type PaymentAmountLike = string | number | null | undefined;

export type TrustedApprovedPaymentLike = {
  status?: string | null;
  payment_method?: string | null;
  provider_payment_id?: string | null;
  provider_status_detail?: string | null;
  paid_at?: string | null;
  amount?: PaymentAmountLike;
};

const APPROVED_PAYMENT_TRUST_SELECT_COLUMNS = [
  "payment_method",
  "provider_payment_id",
  "provider_status_detail",
  "paid_at",
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

export function filterTrustedApprovedPaymentRecords<
  TRecord extends TrustedApprovedPaymentLike,
>(records: TRecord[]) {
  return records.filter((record) => isTrustedApprovedPaymentRecord(record));
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
