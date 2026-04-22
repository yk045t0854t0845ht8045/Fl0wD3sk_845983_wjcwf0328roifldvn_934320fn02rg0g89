import crypto from "node:crypto";

import { invalidatePaymentOrderQueryCaches } from "@/lib/payments/orderQueryCache";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { parseUtcTimestampMs } from "@/lib/time/utcTimestamp";

export type PaymentOrderCheckoutLinkRecord = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id: string | null;
  checkout_link_nonce: string | null;
  checkout_link_expires_at: string | null;
  checkout_link_invalidated_at: string | null;
};

type CheckoutLinkTokenPayload = {
  v: 1;
  oid: number;
  on: number;
  uid: number;
  gid: string | null;
  nonce: string;
  exp: string;
};

type CheckoutLinkFailureReason =
  | "missing"
  | "invalid"
  | "expired"
  | "invalidated"
  | "not_ready";

type CheckoutLinkVerifyResult =
  | { ok: true }
  | { ok: false; reason: CheckoutLinkFailureReason };

export const PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS =
  "user_id, checkout_link_nonce, checkout_link_expires_at, checkout_link_invalidated_at";

const CHECKOUT_LINK_TOKEN_PREFIX = "fdpay_v1";
const DEFAULT_CHECKOUT_LINK_TTL_MS = 30 * 60 * 1000;
const MIN_CHECKOUT_LINK_TTL_MS = 5 * 60 * 1000;
const MAX_CHECKOUT_LINK_TTL_MS = 3 * 60 * 60 * 1000;

function resolveCheckoutLinkSecret() {
  const candidates = [
    process.env.PAYMENT_LINK_SECRET,
    process.env.AUTH_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.DISCORD_CLIENT_SECRET,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return candidates[0] || null;
}

function getCheckoutLinkSecretOrThrow() {
  const secret = resolveCheckoutLinkSecret();
  if (!secret) {
    throw new Error(
      "PAYMENT_LINK_SECRET/AUTH_SECRET/NEXTAUTH_SECRET nao configurado no ambiente.",
    );
  }

  return secret;
}

function resolveCheckoutLinkTtlMs() {
  const rawValue = process.env.PAYMENT_LINK_TTL_MINUTES;
  if (!rawValue) return DEFAULT_CHECKOUT_LINK_TTL_MS;

  const parsedMinutes = Number(rawValue);
  if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
    return DEFAULT_CHECKOUT_LINK_TTL_MS;
  }

  const ttlMs = Math.round(parsedMinutes * 60 * 1000);
  return Math.min(MAX_CHECKOUT_LINK_TTL_MS, Math.max(MIN_CHECKOUT_LINK_TTL_MS, ttlMs));
}

function createCheckoutLinkNonce() {
  return crypto.randomBytes(18).toString("base64url");
}

function signCheckoutLinkPayload(payloadBase64: string) {
  return crypto
    .createHmac("sha256", getCheckoutLinkSecretOrThrow())
    .update(payloadBase64)
    .digest("base64url");
}

function safeTimingEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isCheckoutLinkExpired(value: string | null | undefined) {
  if (!value) return true;
  const timestamp = parseUtcTimestampMs(value);
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() > timestamp;
}

function isCheckoutLinkActive(record: PaymentOrderCheckoutLinkRecord) {
  return Boolean(
    record.checkout_link_nonce &&
      record.checkout_link_expires_at &&
      !record.checkout_link_invalidated_at &&
      !isCheckoutLinkExpired(record.checkout_link_expires_at),
  );
}

function buildCheckoutLinkPayload(record: PaymentOrderCheckoutLinkRecord) {
  if (!record.checkout_link_nonce || !record.checkout_link_expires_at) return null;

  return {
    v: 1,
    oid: record.id,
    on: record.order_number,
    uid: record.user_id,
    gid: record.guild_id,
    nonce: record.checkout_link_nonce,
    exp: record.checkout_link_expires_at,
  } satisfies CheckoutLinkTokenPayload;
}

function decodeCheckoutLinkToken(token: string) {
  const normalized = token.trim();
  if (!normalized) return null;

  const [prefix, payloadBase64, signature] = normalized.split(".");
  if (
    prefix !== CHECKOUT_LINK_TOKEN_PREFIX ||
    !payloadBase64 ||
    !signature
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadBase64, "base64url").toString("utf8"),
    ) as Partial<CheckoutLinkTokenPayload>;

    if (
      parsed?.v !== 1 ||
      typeof parsed.oid !== "number" ||
      typeof parsed.on !== "number" ||
      typeof parsed.uid !== "number" ||
      (typeof parsed.gid !== "string" && parsed.gid !== null) ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.exp !== "string"
    ) {
      return null;
    }

    return {
      payload: parsed as CheckoutLinkTokenPayload,
      payloadBase64,
      signature,
    };
  } catch {
    return null;
  }
}

export function buildCheckoutAccessToken(record: PaymentOrderCheckoutLinkRecord) {
  if (!isCheckoutLinkActive(record)) return null;

  const payload = buildCheckoutLinkPayload(record);
  if (!payload) return null;

  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signCheckoutLinkPayload(payloadBase64);
  return `${CHECKOUT_LINK_TOKEN_PREFIX}.${payloadBase64}.${signature}`;
}

export function verifyCheckoutAccessToken(
  record: PaymentOrderCheckoutLinkRecord,
  token: string | null | undefined,
): CheckoutLinkVerifyResult {
  if (!token) {
    return { ok: false, reason: "missing" };
  }

  if (!record.checkout_link_nonce || !record.checkout_link_expires_at) {
    return { ok: false, reason: "not_ready" };
  }

  if (record.checkout_link_invalidated_at) {
    return { ok: false, reason: "invalidated" };
  }

  if (isCheckoutLinkExpired(record.checkout_link_expires_at)) {
    return { ok: false, reason: "expired" };
  }

  const decoded = decodeCheckoutLinkToken(token);
  if (!decoded) {
    return { ok: false, reason: "invalid" };
  }

  const expectedSignature = signCheckoutLinkPayload(decoded.payloadBase64);
  if (!safeTimingEqual(expectedSignature, decoded.signature)) {
    return { ok: false, reason: "invalid" };
  }

  const { payload } = decoded;
  if (
    payload.oid !== record.id ||
    payload.on !== record.order_number ||
    payload.uid !== record.user_id ||
    payload.gid !== record.guild_id ||
    payload.nonce !== record.checkout_link_nonce ||
    payload.exp !== record.checkout_link_expires_at
  ) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true };
}

export function resolveCheckoutLinkFailureMessage(
  reason: CheckoutLinkFailureReason,
) {
  switch (reason) {
    case "missing":
      return "Este link de pagamento esta incompleto ou nao pertence a esta sessao autenticada.";
    case "expired":
      return "Este link de pagamento expirou. Gere uma nova tentativa segura para continuar.";
    case "invalidated":
      return "Este link de pagamento foi invalidado por uma tentativa mais recente.";
    case "not_ready":
      return "Este link de pagamento nao esta mais disponivel.";
    default:
      return "Este link de pagamento nao e valido para esta conta autenticada.";
  }
}

export async function ensureCheckoutAccessTokenForOrder<
  TOrder extends PaymentOrderCheckoutLinkRecord,
>(input: {
  order: TOrder;
  forceRotate?: boolean;
  invalidateOtherOrders?: boolean;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  let currentOrder = input.order;
  const shouldRotate = Boolean(input.forceRotate) || !isCheckoutLinkActive(input.order);

  if (shouldRotate) {
    const checkoutLinkExpiresAt = new Date(
      Date.now() + resolveCheckoutLinkTtlMs(),
    ).toISOString();
    const updateResult = await supabase
      .from("payment_orders")
      .update({
        checkout_link_nonce: createCheckoutLinkNonce(),
        checkout_link_expires_at: checkoutLinkExpiresAt,
        checkout_link_invalidated_at: null,
      })
      .eq("id", input.order.id)
      .select(
        `id, order_number, guild_id, ${PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS}`,
      )
      .single<PaymentOrderCheckoutLinkRecord>();

    if (updateResult.error || !updateResult.data) {
      throw new Error(
        updateResult.error?.message ||
          "Falha ao preparar token seguro do pagamento.",
      );
    }

    currentOrder = {
      ...input.order,
      checkout_link_nonce: updateResult.data.checkout_link_nonce,
      checkout_link_expires_at: updateResult.data.checkout_link_expires_at,
      checkout_link_invalidated_at: updateResult.data.checkout_link_invalidated_at,
    };
  }

  if (input.invalidateOtherOrders) {
    await supabase
      .from("payment_orders")
      .update({
        checkout_link_invalidated_at: new Date().toISOString(),
      })
      .eq("user_id", input.order.user_id)
      .eq("guild_id", input.order.guild_id)
      .neq("id", input.order.id)
      .is("checkout_link_invalidated_at", null)
      .not("checkout_link_nonce", "is", null);
  }

  invalidatePaymentOrderQueryCaches({
    userId: currentOrder.user_id,
    guildId: currentOrder.guild_id,
    orderId: currentOrder.id,
    orderNumber: currentOrder.order_number,
  });

  return {
    order: currentOrder,
    checkoutAccessToken: buildCheckoutAccessToken(currentOrder),
  };
}
