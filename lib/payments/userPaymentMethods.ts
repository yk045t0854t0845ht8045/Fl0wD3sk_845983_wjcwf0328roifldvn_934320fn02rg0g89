import {
  buildSavedMethodId,
  normalizeCardBrand,
  parseSavedMethodId,
  type SavedMethod,
} from "@/lib/payments/savedMethods";

export type StoredPaymentMethodRecord = {
  method_id: string;
  nickname: string | null;
  brand: string | null;
  first_six: string | null;
  last_four: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_active: boolean;
  verification_status: string | null;
  verification_status_detail: string | null;
  verification_amount: string | number | null;
  verification_provider_payment_id?: string | null;
  provider_customer_id?: string | null;
  provider_card_id?: string | null;
  verified_at: string | null;
  last_context_guild_id: string | null;
  created_at: string;
  updated_at: string;
};

type PartialSavedMethodInput = {
  brand: string | null;
  firstSix: string | null;
  lastFour: string | null;
  expMonth: number | null;
  expYear: number | null;
};

function normalizeNullableString(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeVerificationStatus(value: unknown) {
  if (value === "verified") return "verified";
  if (value === "pending") return "pending";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  return "verified";
}

function normalizeNullableNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizePaymentMethodNickname(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (normalized.length > 42) return null;
  return normalized;
}

export function normalizeStoredMethodShape(input: PartialSavedMethodInput) {
  const normalizedBrand = normalizeCardBrand(input.brand);
  const firstSix =
    typeof input.firstSix === "string" && /^\d{6}$/.test(input.firstSix)
      ? input.firstSix
      : null;
  const lastFour =
    typeof input.lastFour === "string" && /^\d{4}$/.test(input.lastFour)
      ? input.lastFour
      : null;
  const expMonth =
    typeof input.expMonth === "number" &&
    Number.isInteger(input.expMonth) &&
    input.expMonth >= 1 &&
    input.expMonth <= 12
      ? input.expMonth
      : null;
  const expYear =
    typeof input.expYear === "number" &&
    Number.isInteger(input.expYear) &&
    input.expYear >= 0 &&
    input.expYear <= 9999
      ? input.expYear
      : null;

  return {
    brand: normalizedBrand,
    firstSix,
    lastFour,
    expMonth,
    expYear,
  };
}

export function buildMethodIdFromStoredInput(input: PartialSavedMethodInput) {
  const normalized = normalizeStoredMethodShape(input);
  if (!normalized.firstSix || !normalized.lastFour) return null;

  return buildSavedMethodId({
    brand: normalized.brand,
    firstSix: normalized.firstSix,
    lastFour: normalized.lastFour,
    expMonth: normalized.expMonth,
    expYear: normalized.expYear,
  });
}

export function toSavedMethodFromStoredRecord(
  row: StoredPaymentMethodRecord,
): SavedMethod | null {
  const parsedFromId = parseSavedMethodId(row.method_id);
  const normalized = normalizeStoredMethodShape({
    brand: row.brand ?? parsedFromId?.brand ?? null,
    firstSix: row.first_six ?? parsedFromId?.firstSix ?? null,
    lastFour: row.last_four ?? parsedFromId?.lastFour ?? null,
    expMonth: row.exp_month ?? parsedFromId?.expMonth ?? null,
    expYear: row.exp_year ?? parsedFromId?.expYear ?? null,
  });

  if (!normalized.firstSix || !normalized.lastFour) return null;

  const methodId =
    row.method_id ||
    buildSavedMethodId({
      brand: normalized.brand,
      firstSix: normalized.firstSix,
      lastFour: normalized.lastFour,
      expMonth: normalized.expMonth,
      expYear: normalized.expYear,
    });

  if (!methodId) return null;

  return {
    id: methodId,
    brand: normalized.brand,
    firstSix: normalized.firstSix,
    lastFour: normalized.lastFour,
    expMonth: normalized.expMonth,
    expYear: normalized.expYear,
    lastUsedAt: row.updated_at || row.created_at,
    timesUsed: 0,
    nickname: normalizeNullableString(row.nickname),
    verificationStatus: normalizeVerificationStatus(row.verification_status),
    verificationStatusDetail: normalizeNullableString(
      row.verification_status_detail,
    ),
    verificationAmount: normalizeNullableNumber(row.verification_amount),
    verifiedAt: normalizeNullableString(row.verified_at),
    lastContextGuildId: normalizeNullableString(row.last_context_guild_id),
  };
}

export function mergeSavedMethodsWithStored(input: {
  derivedMethods: SavedMethod[];
  storedMethods: SavedMethod[];
  hiddenMethodSet?: Set<string>;
}) {
  const merged = new Map<string, SavedMethod>();
  const hidden = input.hiddenMethodSet ?? new Set<string>();

  for (const method of input.derivedMethods) {
    if (hidden.has(method.id)) continue;
    merged.set(method.id, {
      ...method,
      nickname: normalizeNullableString(method.nickname),
    });
  }

  for (const method of input.storedMethods) {
    if (hidden.has(method.id)) continue;

    const current = merged.get(method.id);
    if (!current) {
      merged.set(method.id, method);
      continue;
    }

    const currentTimestamp = Date.parse(current.lastUsedAt);
    const incomingTimestamp = Date.parse(method.lastUsedAt);
    const useIncomingTimestamp =
      Number.isFinite(incomingTimestamp) &&
      (!Number.isFinite(currentTimestamp) || incomingTimestamp > currentTimestamp);

    merged.set(method.id, {
      ...current,
      brand: method.brand || current.brand,
      firstSix: method.firstSix || current.firstSix,
      lastFour: method.lastFour || current.lastFour,
      expMonth: method.expMonth ?? current.expMonth,
      expYear: method.expYear ?? current.expYear,
      lastUsedAt: useIncomingTimestamp ? method.lastUsedAt : current.lastUsedAt,
      timesUsed: Math.max(current.timesUsed, method.timesUsed),
      nickname:
        normalizeNullableString(method.nickname) ||
        normalizeNullableString(current.nickname),
    });
  }

  return Array.from(merged.values()).sort((a, b) => {
    const aTime = Date.parse(a.lastUsedAt);
    const bTime = Date.parse(b.lastUsedAt);
    const safeATime = Number.isFinite(aTime) ? aTime : 0;
    const safeBTime = Number.isFinite(bTime) ? bTime : 0;
    return safeBTime - safeATime;
  });
}
