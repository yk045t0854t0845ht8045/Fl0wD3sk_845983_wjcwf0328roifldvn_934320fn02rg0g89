export type CardSnapshot = {
  brand: string | null;
  firstSix: string | null;
  lastFour: string | null;
  expMonth: number | null;
  expYear: number | null;
};

export type SavedMethod = {
  id: string;
  brand: string | null;
  firstSix: string;
  lastFour: string;
  expMonth: number | null;
  expYear: number | null;
  lastUsedAt: string;
  timesUsed: number;
  nickname?: string | null;
};

export type OrderForSavedMethods = {
  payment_method: "pix" | "card";
  provider_payload: unknown;
  created_at: string;
};

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumericString(value: unknown, maxLength = 20) {
  const text = asString(value);
  if (!text) return null;
  if (!new RegExp(`^\\d{1,${maxLength}}$`).test(text)) return null;
  return text;
}

function asNumberOrNull(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeCardBrand(rawBrand: string | null) {
  if (!rawBrand) return null;
  const normalized = rawBrand.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes("visa")) return "visa";
  if (normalized.includes("master")) return "mastercard";
  if (normalized.includes("amex") || normalized.includes("american")) return "amex";
  if (normalized.includes("elo")) return "elo";
  return normalized;
}

export function extractCardSnapshot(providerPayload: unknown): CardSnapshot {
  const root = asRecord(providerPayload);
  const mercadoPago = asRecord(root?.mercado_pago);
  const card = asRecord(mercadoPago?.card);

  const rawBrand =
    asString(mercadoPago?.payment_method_id) ||
    asString(card?.payment_method_id) ||
    asString(card?.brand);

  const firstSix = asNumericString(card?.first_six_digits, 6);
  const lastFour = asNumericString(card?.last_four_digits, 4);
  const expMonth = asNumberOrNull(card?.expiration_month);
  const expYear = asNumberOrNull(card?.expiration_year);

  return {
    brand: normalizeCardBrand(rawBrand),
    firstSix,
    lastFour,
    expMonth,
    expYear,
  };
}

export function buildSavedMethodId(snapshot: CardSnapshot) {
  if (!snapshot.firstSix || !snapshot.lastFour) return null;

  return [
    snapshot.brand || "card",
    snapshot.firstSix,
    snapshot.lastFour,
    snapshot.expMonth ?? "",
    snapshot.expYear ?? "",
  ].join(":");
}

export function parseSavedMethodId(methodId: string) {
  const normalized = methodId.trim();
  if (!normalized) return null;

  const [rawBrand = "", firstSix = "", lastFour = "", rawExpMonth = "", rawExpYear = ""] =
    normalized.split(":");

  if (!firstSix || !/^\d{6}$/.test(firstSix)) return null;
  if (!lastFour || !/^\d{4}$/.test(lastFour)) return null;

  const expMonth =
    rawExpMonth && /^\d{1,2}$/.test(rawExpMonth) ? Number(rawExpMonth) : null;
  const expYear =
    rawExpYear && /^\d{2,4}$/.test(rawExpYear) ? Number(rawExpYear) : null;

  return {
    brand: normalizeCardBrand(rawBrand || null),
    firstSix,
    lastFour,
    expMonth:
      typeof expMonth === "number" &&
      Number.isFinite(expMonth) &&
      expMonth >= 1 &&
      expMonth <= 12
        ? expMonth
        : null,
    expYear:
      typeof expYear === "number" &&
      Number.isFinite(expYear) &&
      expYear >= 0 &&
      expYear <= 9999
        ? expYear
        : null,
  };
}

export function isValidSavedMethodId(value: unknown) {
  if (typeof value !== "string") return false;
  const methodId = value.trim();
  if (!methodId) return false;
  if (methodId.length > 120) return false;
  return /^[a-z0-9:_-]+$/i.test(methodId);
}

export function buildSavedMethods(orders: OrderForSavedMethods[]) {
  const methodMap = new Map<string, SavedMethod>();

  for (const order of orders) {
    if (order.payment_method !== "card") continue;

    const snapshot = extractCardSnapshot(order.provider_payload);
    const key = buildSavedMethodId(snapshot);
    if (!key || !snapshot.firstSix || !snapshot.lastFour) continue;

    const current = methodMap.get(key);
    if (!current) {
      methodMap.set(key, {
        id: key,
        brand: snapshot.brand,
        firstSix: snapshot.firstSix,
        lastFour: snapshot.lastFour,
        expMonth: snapshot.expMonth,
        expYear: snapshot.expYear,
        lastUsedAt: order.created_at,
        timesUsed: 1,
      });
      continue;
    }

    const nextLastUsedAt =
      Date.parse(order.created_at) > Date.parse(current.lastUsedAt)
        ? order.created_at
        : current.lastUsedAt;

    methodMap.set(key, {
      ...current,
      lastUsedAt: nextLastUsedAt,
      timesUsed: current.timesUsed + 1,
    });
  }

  return Array.from(methodMap.values()).sort(
    (a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt),
  );
}
