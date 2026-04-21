const DISCOUNT_CODE_MAX_LENGTH = 64;
const DISCOUNT_CODE_ALLOWED_CHARACTERS = /[^A-Za-z0-9._-]+/g;
const DISCOUNT_CODE_WHITESPACE = /\s+/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sanitizeDiscountCodeInput(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .toUpperCase()
    .replace(DISCOUNT_CODE_WHITESPACE, "")
    .replace(DISCOUNT_CODE_ALLOWED_CHARACTERS, "")
    .slice(0, DISCOUNT_CODE_MAX_LENGTH);
}

export function normalizeDiscountCodeValue(value: unknown) {
  const normalized = sanitizeDiscountCodeInput(value);
  return normalized || null;
}

export function normalizeDiscountCodeRequestBody(body: unknown) {
  if (!isRecord(body)) {
    return {};
  }

  return {
    ...body,
    couponCode: normalizeDiscountCodeValue(body.couponCode),
    giftCardCode: normalizeDiscountCodeValue(body.giftCardCode),
  };
}

export function buildUnifiedDiscountCodePayload(value: unknown) {
  return {
    couponCode: normalizeDiscountCodeValue(value),
    giftCardCode: null as string | null,
  };
}

export function resolveDiscountCodeValidationMessage(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("couponcode") ||
    normalized.includes("giftcardcode")
  ) {
    return "Codigo de cupom ou vale-presente invalido. Revise e tente novamente.";
  }

  return message;
}
