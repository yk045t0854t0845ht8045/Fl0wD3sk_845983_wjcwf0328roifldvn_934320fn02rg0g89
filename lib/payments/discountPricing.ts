import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type PaymentCouponRecord = {
  id: number;
  code: string;
  label: string;
  status: "draft" | "active" | "inactive" | "expired";
  discount_type: "fixed" | "percent";
  discount_value: number | string;
  max_redemptions: number | null;
  starts_at: string | null;
  expires_at: string | null;
};

type PaymentGiftCardRecord = {
  id: number;
  code: string;
  label: string;
  status: "draft" | "active" | "inactive" | "exhausted" | "expired";
  remaining_amount: number | string;
  currency: string;
  expires_at: string | null;
};

export type DiscountPricingPreview = {
  baseAmount: number;
  currency: string;
  coupon: {
    code: string;
    label: string;
    amount: number;
    valid: boolean;
    message: string | null;
  } | null;
  giftCard: {
    code: string;
    label: string;
    amount: number;
    valid: boolean;
    message: string | null;
  } | null;
  subtotalAmount: number;
  totalAmount: number;
  message: string | null;
};

const MINIMUM_PAYABLE_AMOUNT = 0.01;

function parseNumeric(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isDateActive(startsAt: string | null, expiresAt: string | null) {
  const now = Date.now();

  if (startsAt) {
    const startsAtMs = Date.parse(startsAt);
    if (Number.isFinite(startsAtMs) && startsAtMs > now) {
      return false;
    }
  }

  if (expiresAt) {
    const expiresAtMs = Date.parse(expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= now) {
      return false;
    }
  }

  return true;
}

function normalizeCode(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().slice(0, 64);
}

export async function resolveDiscountPricing(input: {
  baseAmount: number;
  currency: string;
  couponCode?: string | null;
  giftCardCode?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const baseAmount = Math.max(0, Math.round(input.baseAmount * 100) / 100);
  const currency = (input.currency || "BRL").trim().toUpperCase() || "BRL";
  const couponCode = normalizeCode(input.couponCode);
  const giftCardCode = normalizeCode(input.giftCardCode);

  let couponAmount = 0;
  let giftCardAmount = 0;
  let message: string | null = null;
  let coupon: DiscountPricingPreview["coupon"] = null;
  let giftCard: DiscountPricingPreview["giftCard"] = null;
  const shouldResolveCouponCodeAsGeneric = Boolean(couponCode && !giftCardCode);

  if (couponCode) {
    const couponResult = await supabase
      .from("payment_coupons")
      .select(
        "id, code, label, status, discount_type, discount_value, max_redemptions, starts_at, expires_at",
      )
      .eq("code", couponCode)
      .maybeSingle<PaymentCouponRecord>();

    if (couponResult.error) {
      throw new Error(couponResult.error.message);
    }

    const couponRecord = couponResult.data;
    if (!couponRecord) {
      if (shouldResolveCouponCodeAsGeneric) {
        const giftCardResult = await supabase
          .from("payment_gift_cards")
          .select("id, code, label, status, remaining_amount, currency, expires_at")
          .eq("code", couponCode)
          .maybeSingle<PaymentGiftCardRecord>();

        if (giftCardResult.error) {
          throw new Error(giftCardResult.error.message);
        }

        const giftCardRecord = giftCardResult.data;
        if (!giftCardRecord) {
          coupon = {
            code: couponCode,
            label: couponCode,
            amount: 0,
            valid: false,
            message: "Codigo nao encontrado.",
          };
          message = coupon.message;
        } else if (
          giftCardRecord.status !== "active" ||
          !isDateActive(null, giftCardRecord.expires_at) ||
          parseNumeric(giftCardRecord.remaining_amount) <= 0
        ) {
          giftCard = {
            code: giftCardRecord.code,
            label: giftCardRecord.label,
            amount: 0,
            valid: false,
            message: "Gift card indisponivel ou sem saldo.",
          };
          message = giftCard.message;
        } else {
          giftCardAmount = Math.min(
            baseAmount,
            parseNumeric(giftCardRecord.remaining_amount),
          );
          giftCardAmount = Math.round(giftCardAmount * 100) / 100;

          giftCard = {
            code: giftCardRecord.code,
            label: giftCardRecord.label,
            amount: giftCardAmount,
            valid: true,
            message: "Gift card validado no carrinho.",
          };
          message = giftCard.message;
        }
      } else {
        coupon = {
          code: couponCode,
          label: couponCode,
          amount: 0,
          valid: false,
          message: "Cupom nao encontrado.",
        };
        message = coupon.message;
      }
    } else if (
      couponRecord.status !== "active" ||
      !isDateActive(couponRecord.starts_at, couponRecord.expires_at)
    ) {
      coupon = {
        code: couponRecord.code,
        label: couponRecord.label,
        amount: 0,
        valid: false,
        message: "Cupom indisponivel no momento.",
      };
      message = coupon.message;
    } else {
      if (couponRecord.max_redemptions) {
        const redemptionCountResult = await supabase
          .from("payment_coupon_redemptions")
          .select("id", { count: "exact", head: true })
          .eq("coupon_id", couponRecord.id);

        if (redemptionCountResult.error) {
          throw new Error(redemptionCountResult.error.message);
        }

        const redemptionCount = redemptionCountResult.count || 0;
        if (redemptionCount >= couponRecord.max_redemptions) {
          coupon = {
            code: couponRecord.code,
            label: couponRecord.label,
            amount: 0,
            valid: false,
            message: "Cupom esgotado.",
          };
          message = coupon.message;
        }
      }

      if (!coupon) {
        couponAmount =
          couponRecord.discount_type === "percent"
            ? Math.min(
                baseAmount,
                Math.round(baseAmount * parseNumeric(couponRecord.discount_value)) /
                  100,
              )
            : Math.min(baseAmount, parseNumeric(couponRecord.discount_value));

        couponAmount = Math.round(couponAmount * 100) / 100;
        coupon = {
          code: couponRecord.code,
          label: couponRecord.label,
          amount: couponAmount,
          valid: true,
          message: "Cupom validado no carrinho.",
        };
        message = coupon.message;
      }
    }
  }

  if (giftCardCode) {
    const giftCardResult = await supabase
      .from("payment_gift_cards")
      .select("id, code, label, status, remaining_amount, currency, expires_at")
      .eq("code", giftCardCode)
      .maybeSingle<PaymentGiftCardRecord>();

    if (giftCardResult.error) {
      throw new Error(giftCardResult.error.message);
    }

    const giftCardRecord = giftCardResult.data;
    if (!giftCardRecord) {
      giftCard = {
        code: giftCardCode,
        label: giftCardCode,
        amount: 0,
        valid: false,
        message: "Gift card nao encontrado.",
      };
      message = giftCard.message;
    } else if (
      giftCardRecord.status !== "active" ||
      !isDateActive(null, giftCardRecord.expires_at) ||
      parseNumeric(giftCardRecord.remaining_amount) <= 0
    ) {
      giftCard = {
        code: giftCardRecord.code,
        label: giftCardRecord.label,
        amount: 0,
        valid: false,
        message: "Gift card indisponivel ou sem saldo.",
      };
      message = giftCard.message;
    } else {
      const availableAfterCoupon = Math.max(0, baseAmount - couponAmount);
      giftCardAmount = Math.min(
        availableAfterCoupon,
        parseNumeric(giftCardRecord.remaining_amount),
      );
      giftCardAmount = Math.round(giftCardAmount * 100) / 100;

      giftCard = {
        code: giftCardRecord.code,
        label: giftCardRecord.label,
        amount: giftCardAmount,
        valid: true,
        message: "Gift card validado no carrinho.",
      };
      message = giftCard.message;
    }
  }

  const rawTotal = Math.max(0, baseAmount - couponAmount - giftCardAmount);
  const totalAmount =
    rawTotal > 0 ? Math.max(MINIMUM_PAYABLE_AMOUNT, rawTotal) : MINIMUM_PAYABLE_AMOUNT;

  return {
    baseAmount,
    currency,
    coupon,
    giftCard,
    subtotalAmount: baseAmount,
    totalAmount: Math.round(totalAmount * 100) / 100,
    message,
  } satisfies DiscountPricingPreview;
}
