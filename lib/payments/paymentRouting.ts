import {
  DEFAULT_PLAN_BILLING_PERIOD_CODE,
  DEFAULT_PLAN_CODE,
  normalizePlanBillingPeriodCode,
  normalizePlanBillingPeriodCodeFromSlug,
  normalizePlanCodeFromSlug,
  resolvePlanBillingPeriodSlug,
  resolvePlanSlug,
  type PlanBillingPeriodCode,
  type PlanCode,
} from "@/lib/plans/catalog";
import { buildConfigCheckoutSearchParams } from "@/lib/plans/configRouting";
import { buildBrowserRoutingTargetFromInternalPath } from "@/lib/routing/subdomains";

type PaymentCheckoutQueryValue = string | number | boolean | null | undefined;
type PaymentCheckoutQueryValueInput =
  | PaymentCheckoutQueryValue
  | PaymentCheckoutQueryValue[];

const PAYMENT_ORDER_SLUG_PREFIX = "flw_";
const PAYMENT_CART_SLUG_PREFIX = "crt_";

function normalizePositiveInteger(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function decodeBase36Identifier(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9]+$/.test(normalized)) return null;

  const parsed = Number.parseInt(normalized, 36);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function encodePaymentOrderSlug(orderNumber: unknown) {
  const normalizedOrderNumber = normalizePositiveInteger(orderNumber);
  if (!normalizedOrderNumber) return null;
  return `${PAYMENT_ORDER_SLUG_PREFIX}${normalizedOrderNumber.toString(36)}`;
}

export function decodePaymentOrderSlug(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.startsWith(PAYMENT_ORDER_SLUG_PREFIX)) {
    return decodeBase36Identifier(
      normalized.slice(PAYMENT_ORDER_SLUG_PREFIX.length),
    );
  }

  return normalizePositiveInteger(normalized);
}

export function encodePaymentCartSlug(orderId: unknown) {
  const normalizedOrderId = normalizePositiveInteger(orderId);
  if (!normalizedOrderId) return null;
  return `${PAYMENT_CART_SLUG_PREFIX}${normalizedOrderId.toString(36)}`;
}

export function decodePaymentCartSlug(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.startsWith(PAYMENT_CART_SLUG_PREFIX)) {
    return decodeBase36Identifier(
      normalized.slice(PAYMENT_CART_SLUG_PREFIX.length),
    );
  }

  return normalizePositiveInteger(normalized);
}

export function resolvePaymentBillingPeriodCodeFromCycleDays(
  billingCycleDays: unknown,
  fallback: PlanBillingPeriodCode = DEFAULT_PLAN_BILLING_PERIOD_CODE,
) {
  const normalizedBillingCycleDays = normalizePositiveInteger(billingCycleDays);

  switch (normalizedBillingCycleDays) {
    case 90:
      return "quarterly" as const;
    case 180:
      return "semiannual" as const;
    case 365:
      return "annual" as const;
    case 30:
      return "monthly" as const;
    default:
      return normalizePlanBillingPeriodCode(fallback, DEFAULT_PLAN_BILLING_PERIOD_CODE);
  }
}

export function isPaymentCheckoutPathname(pathname: string) {
  return pathname === "/payment" || pathname.startsWith("/payment/");
}

export function readPaymentCheckoutPathDetails(input: {
  pathname: string;
  fallbackPlanCode?: PlanCode;
  fallbackBillingPeriodCode?: PlanBillingPeriodCode;
}) {
  const fallbackPlanCode = input.fallbackPlanCode || DEFAULT_PLAN_CODE;
  const fallbackBillingPeriodCode =
    input.fallbackBillingPeriodCode || DEFAULT_PLAN_BILLING_PERIOD_CODE;
  const segments = input.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments[0] !== "payment") {
    return null;
  }

  const planSlug = segments[1] || null;
  const billingSlug = segments[2] || null;
  const orderSlug = segments[3] || null;
  const cartSlug = segments[4] || null;

  return {
    planSlug,
    billingSlug,
    orderSlug,
    cartSlug,
    planCode: normalizePlanCodeFromSlug(planSlug, fallbackPlanCode),
    billingPeriodCode: normalizePlanBillingPeriodCodeFromSlug(
      billingSlug,
      fallbackBillingPeriodCode,
    ),
    orderNumber: decodePaymentOrderSlug(orderSlug),
    orderId: decodePaymentCartSlug(cartSlug),
  };
}

export function buildPaymentCheckoutPath(input: {
  planCode?: unknown;
  billingPeriodCode?: unknown;
  fallbackPlanCode?: PlanCode;
  fallbackBillingPeriodCode?: PlanBillingPeriodCode;
  orderNumber?: unknown;
  orderId?: unknown;
}) {
  const fallbackPlanCode = input.fallbackPlanCode || DEFAULT_PLAN_CODE;
  const fallbackBillingPeriodCode =
    input.fallbackBillingPeriodCode || DEFAULT_PLAN_BILLING_PERIOD_CODE;
  const planCode = normalizePlanCodeFromSlug(input.planCode, fallbackPlanCode);
  const billingPeriodCode = normalizePlanBillingPeriodCodeFromSlug(
    input.billingPeriodCode,
    fallbackBillingPeriodCode,
  );
  const basePath = `/payment/${resolvePlanSlug(planCode)}/${resolvePlanBillingPeriodSlug(
    billingPeriodCode,
    fallbackBillingPeriodCode,
  )}`;

  const normalizedOrderNumber =
    normalizePositiveInteger(input.orderNumber) ||
    decodePaymentOrderSlug(
      typeof input.orderNumber === "string" ? input.orderNumber : null,
    );
  const normalizedOrderId =
    normalizePositiveInteger(input.orderId) ||
    decodePaymentCartSlug(typeof input.orderId === "string" ? input.orderId : null);
  const orderSlug = encodePaymentOrderSlug(normalizedOrderNumber);
  const cartSlug = encodePaymentCartSlug(normalizedOrderId);

  if (!orderSlug || !cartSlug) {
    return basePath;
  }

  return `${basePath}/${orderSlug}/${cartSlug}`;
}

export function buildPaymentCheckoutEntryHref(input: {
  planCode?: unknown;
  billingPeriodCode?: unknown;
  fallbackPlanCode?: PlanCode;
  fallbackBillingPeriodCode?: PlanBillingPeriodCode;
  orderNumber?: unknown;
  orderId?: unknown;
  searchParams?: URLSearchParams | Record<string, PaymentCheckoutQueryValueInput>;
  omitSearchParamKeys?: string[];
}) {
  const pathname = buildPaymentCheckoutPath({
    planCode: input.planCode,
    billingPeriodCode: input.billingPeriodCode,
    fallbackPlanCode: input.fallbackPlanCode,
    fallbackBillingPeriodCode: input.fallbackBillingPeriodCode,
    orderNumber: input.orderNumber,
    orderId: input.orderId,
  });
  const params = buildConfigCheckoutSearchParams({
    searchParams: input.searchParams,
    omitKeys: input.omitSearchParamKeys,
  });
  const search = params.toString();
  const href = search ? `${pathname}?${search}` : pathname;

  if (typeof window === "undefined") {
    return href;
  }

  return buildBrowserRoutingTargetFromInternalPath(href, {
    fallbackHost: "pay",
  }).href;
}

export function buildPaymentBasePathFromCurrentPathname(pathname: string) {
  const details = readPaymentCheckoutPathDetails({ pathname });
  if (!details?.planSlug || !details.billingSlug) {
    return pathname;
  }

  return buildPaymentCheckoutPath({
    planCode: details.planCode,
    billingPeriodCode: details.billingPeriodCode,
  });
}

export function buildPaymentPathForOrder(input: {
  pathname: string;
  orderNumber: unknown;
  orderId: unknown;
  fallbackPlanCode?: PlanCode;
  fallbackBillingPeriodCode?: PlanBillingPeriodCode;
}) {
  const details = readPaymentCheckoutPathDetails({
    pathname: input.pathname,
    fallbackPlanCode: input.fallbackPlanCode,
    fallbackBillingPeriodCode: input.fallbackBillingPeriodCode,
  });

  return buildPaymentCheckoutPath({
    planCode: details?.planCode || input.fallbackPlanCode || DEFAULT_PLAN_CODE,
    billingPeriodCode:
      details?.billingPeriodCode ||
      input.fallbackBillingPeriodCode ||
      DEFAULT_PLAN_BILLING_PERIOD_CODE,
    fallbackPlanCode: input.fallbackPlanCode,
    fallbackBillingPeriodCode: input.fallbackBillingPeriodCode,
    orderNumber: input.orderNumber,
    orderId: input.orderId,
  });
}

export function buildPaymentCanonicalPathFromSlugs(input: {
  planSlug: string;
  billingSlug: string;
  orderSlug?: string | null;
  cartSlug?: string | null;
  fallbackPlanCode?: PlanCode;
  fallbackBillingPeriodCode?: PlanBillingPeriodCode;
}) {
  const fallbackPlanCode = input.fallbackPlanCode || DEFAULT_PLAN_CODE;
  const fallbackBillingPeriodCode =
    input.fallbackBillingPeriodCode || DEFAULT_PLAN_BILLING_PERIOD_CODE;
  const planCode = normalizePlanCodeFromSlug(input.planSlug, fallbackPlanCode);
  const billingPeriodCode = normalizePlanBillingPeriodCodeFromSlug(
    input.billingSlug,
    fallbackBillingPeriodCode,
  );
  const orderNumber = decodePaymentOrderSlug(input.orderSlug || null);
  const orderId = decodePaymentCartSlug(input.cartSlug || null);

  return buildPaymentCheckoutPath({
    planCode,
    billingPeriodCode,
    fallbackPlanCode,
    fallbackBillingPeriodCode,
    orderNumber,
    orderId,
  });
}
