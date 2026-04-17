import flowPlansCatalog from "./flow-plans.json";

export type PlanCode = "basic" | "pro" | "ultra" | "master";
export type PlanSlug = "flow-basic" | "flow-pro" | "flow-ultra" | "flow-master";
export type PlanBillingPeriodCode =
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual";
export type PlanBillingPeriodSlug =
  | "mensal"
  | "trimestral"
  | "semestral"
  | "anual";

type RawPlanEntitlements = {
  maxLicensedServers: number;
  maxActiveTickets: number;
  maxAutomations: number;
  maxMonthlyActions: number;
};

type RawPlanDefinition = {
  code: PlanCode;
  name: string;
  badge: string;
  description: string;
  limitedOffer: string;
  price: number;
  comparePrice: number;
  currency: string;
  billingCycleDays: number;
  billingLabel: string;
  checkoutPeriodLabel: string;
  renewalLabel: string;
  isTrial: boolean;
  entitlements: RawPlanEntitlements;
  features: string[];
};

type BillingPeriodDefinition = {
  code: PlanBillingPeriodCode;
  slug: PlanBillingPeriodSlug;
  label: string;
  durationLabel: string;
  months: number;
  billingCycleDays: number;
  extraDiscountPercent: number;
};

export type PlanEntitlements = RawPlanEntitlements;
export type PlanDefinition = RawPlanDefinition;
export type PlanBillingPeriodDefinition = BillingPeriodDefinition;
export type PlanPricingDefinition = {
  code: PlanCode;
  name: string;
  badge: string;
  description: string;
  limitedOffer: string;
  currency: string;
  isTrial: boolean;
  entitlements: PlanEntitlements;
  features: string[];
  baseMonthlyAmount: number;
  monthlyAmount: number;
  compareMonthlyAmount: number;
  baseTotalAmount: number;
  totalAmount: number;
  compareTotalAmount: number;
  billingPeriodCode: PlanBillingPeriodCode;
  billingPeriodSlug: PlanBillingPeriodSlug;
  billingPeriodLabel: string;
  billingPeriodMonths: number;
  billingCycleDays: number;
  billingLabel: string;
  totalLabel: string;
  checkoutPeriodLabel: string;
  renewalLabel: string;
  cycleDiscountPercent: number;
  cycleBadge: string | null;
};

const catalog = flowPlansCatalog as Record<PlanCode, RawPlanDefinition>;

export const DEFAULT_PLAN_CODE: PlanCode = "pro";
export const DEFAULT_PLAN_BILLING_PERIOD_CODE: PlanBillingPeriodCode = "monthly";
export const PLAN_ORDER: PlanCode[] = ["basic", "pro", "ultra", "master"];
export const PLAN_BILLING_PERIOD_ORDER: PlanBillingPeriodCode[] = [
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
];
export const PLAN_SLUG_BY_CODE: Record<PlanCode, PlanSlug> = Object.freeze({
  basic: "flow-basic",
  pro: "flow-pro",
  ultra: "flow-ultra",
  master: "flow-master",
});

const PLAN_CODE_BY_SLUG: Record<PlanSlug, PlanCode> = Object.freeze({
  "flow-basic": "basic",
  "flow-pro": "pro",
  "flow-ultra": "ultra",
  "flow-master": "master",
});

const PLAN_BILLING_PERIOD_BY_CODE: Record<
  PlanBillingPeriodCode,
  BillingPeriodDefinition
> = Object.freeze({
  monthly: Object.freeze({
    code: "monthly",
    slug: "mensal",
    label: "Mensal",
    durationLabel: "1 mes",
    months: 1,
    billingCycleDays: 30,
    extraDiscountPercent: 0,
  }),
  quarterly: Object.freeze({
    code: "quarterly",
    slug: "trimestral",
    label: "Trimestral",
    durationLabel: "3 meses",
    months: 3,
    billingCycleDays: 90,
    extraDiscountPercent: 5,
  }),
  semiannual: Object.freeze({
    code: "semiannual",
    slug: "semestral",
    label: "Semestral",
    durationLabel: "6 meses",
    months: 6,
    billingCycleDays: 180,
    extraDiscountPercent: 10,
  }),
  annual: Object.freeze({
    code: "annual",
    slug: "anual",
    label: "Anual",
    durationLabel: "12 meses",
    months: 12,
    billingCycleDays: 365,
    extraDiscountPercent: 15,
  }),
});

const PLAN_BILLING_PERIOD_CODE_BY_SLUG: Record<
  PlanBillingPeriodSlug,
  PlanBillingPeriodCode
> = Object.freeze({
  mensal: "monthly",
  trimestral: "quarterly",
  semestral: "semiannual",
  anual: "annual",
});

export const FLOW_PLAN_CATALOG: Record<PlanCode, PlanDefinition> = Object.freeze({
  basic: Object.freeze(catalog.basic),
  pro: Object.freeze(catalog.pro),
  ultra: Object.freeze(catalog.ultra),
  master: Object.freeze(catalog.master),
});

function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function formatMoney(amount: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(amount));
}

export function isPlanCode(value: unknown): value is PlanCode {
  return (
    value === "basic" ||
    value === "pro" ||
    value === "ultra" ||
    value === "master"
  );
}

export function isPlanSlug(value: unknown): value is PlanSlug {
  return (
    value === "flow-basic" ||
    value === "flow-pro" ||
    value === "flow-ultra" ||
    value === "flow-master"
  );
}

export function isPlanBillingPeriodCode(
  value: unknown,
): value is PlanBillingPeriodCode {
  return (
    value === "monthly" ||
    value === "quarterly" ||
    value === "semiannual" ||
    value === "annual"
  );
}

export function isPlanBillingPeriodSlug(
  value: unknown,
): value is PlanBillingPeriodSlug {
  return (
    value === "mensal" ||
    value === "trimestral" ||
    value === "semestral" ||
    value === "anual"
  );
}

export function normalizePlanCode(value: unknown, fallback: PlanCode = DEFAULT_PLAN_CODE) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return isPlanCode(normalized) ? normalized : fallback;
}

export function normalizePlanCodeFromSlug(
  value: unknown,
  fallback: PlanCode = DEFAULT_PLAN_CODE,
) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (isPlanCode(normalized)) return normalized;
  return isPlanSlug(normalized) ? PLAN_CODE_BY_SLUG[normalized] : fallback;
}

export function resolvePlanSlug(value: unknown, fallback: PlanCode = DEFAULT_PLAN_CODE) {
  return PLAN_SLUG_BY_CODE[normalizePlanCodeFromSlug(value, fallback)];
}

export function buildConfigPlanPath(
  value: unknown,
  fallback: PlanCode = DEFAULT_PLAN_CODE,
) {
  return `/config/${resolvePlanSlug(value, fallback)}`;
}

export function normalizePlanBillingPeriodCode(
  value: unknown,
  fallback: PlanBillingPeriodCode = DEFAULT_PLAN_BILLING_PERIOD_CODE,
) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return isPlanBillingPeriodCode(normalized) ? normalized : fallback;
}

export function normalizePlanBillingPeriodCodeFromSlug(
  value: unknown,
  fallback: PlanBillingPeriodCode = DEFAULT_PLAN_BILLING_PERIOD_CODE,
) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (isPlanBillingPeriodCode(normalized)) return normalized;
  return isPlanBillingPeriodSlug(normalized)
    ? PLAN_BILLING_PERIOD_CODE_BY_SLUG[normalized]
    : fallback;
}

export function resolvePlanBillingPeriodDefinition(
  value: unknown,
  fallback: PlanBillingPeriodCode = DEFAULT_PLAN_BILLING_PERIOD_CODE,
) {
  return PLAN_BILLING_PERIOD_BY_CODE[
    normalizePlanBillingPeriodCodeFromSlug(value, fallback)
  ];
}

export function resolvePlanBillingPeriodSlug(
  value: unknown,
  fallback: PlanBillingPeriodCode = DEFAULT_PLAN_BILLING_PERIOD_CODE,
) {
  return resolvePlanBillingPeriodDefinition(value, fallback).slug;
}

export function getAvailableBillingPeriodsForPlan(value: unknown) {
  const plan = resolvePlanDefinition(value);
  if (plan.isTrial) {
    const monthly = { ...PLAN_BILLING_PERIOD_BY_CODE.monthly };
    if (plan.code === "basic") {
      monthly.label = "7 Dias";
    }
    return [monthly];
  }
  return PLAN_BILLING_PERIOD_ORDER.map(
    (periodCode) => PLAN_BILLING_PERIOD_BY_CODE[periodCode],
  );
}

export function buildConfigCheckoutPath(input: {
  planCode?: unknown;
  billingPeriodCode?: unknown;
  fallbackPlanCode?: PlanCode;
  fallbackBillingPeriodCode?: PlanBillingPeriodCode;
}) {
  const fallbackPlanCode = input.fallbackPlanCode || DEFAULT_PLAN_CODE;
  const fallbackBillingPeriodCode =
    input.fallbackBillingPeriodCode || DEFAULT_PLAN_BILLING_PERIOD_CODE;
  const planCode = normalizePlanCode(input.planCode, fallbackPlanCode);
  const plan = resolvePlanDefinition(planCode);

  if (plan.isTrial) {
    return buildConfigPlanPath(plan.code, fallbackPlanCode);
  }

  const billingPeriodCode = normalizePlanBillingPeriodCodeFromSlug(
    input.billingPeriodCode,
    fallbackBillingPeriodCode,
  );

  return `/config/${resolvePlanSlug(plan.code)}/${resolvePlanBillingPeriodSlug(
    billingPeriodCode,
    fallbackBillingPeriodCode,
  )}`;
}

export function resolvePlanDefinition(value: unknown, fallback: PlanCode = DEFAULT_PLAN_CODE) {
  return FLOW_PLAN_CATALOG[normalizePlanCode(value, fallback)];
}

export function getAllPlanDefinitions() {
  return PLAN_ORDER.map((planCode) => FLOW_PLAN_CATALOG[planCode]);
}

export function resolvePlanPricing(
  value: unknown,
  billingPeriodValue: unknown = DEFAULT_PLAN_BILLING_PERIOD_CODE,
): PlanPricingDefinition {
  const plan = resolvePlanDefinition(value);
  const availableBillingPeriods = getAvailableBillingPeriodsForPlan(plan.code);
  const fallbackBillingPeriodCode = availableBillingPeriods[0]?.code || "monthly";
  const billingPeriod = resolvePlanBillingPeriodDefinition(
    billingPeriodValue,
    fallbackBillingPeriodCode,
  );

  if (plan.isTrial) {
    return {
      code: plan.code,
      name: plan.name,
      badge: plan.badge,
      description: plan.description,
      limitedOffer: plan.limitedOffer,
      currency: plan.currency,
      isTrial: true,
      entitlements: {
        ...plan.entitlements,
      },
      features: [...plan.features],
      baseMonthlyAmount: roundMoney(plan.price),
      monthlyAmount: roundMoney(plan.price),
      compareMonthlyAmount: roundMoney(plan.comparePrice),
      baseTotalAmount: roundMoney(plan.price),
      totalAmount: roundMoney(plan.price),
      compareTotalAmount: roundMoney(plan.comparePrice),
      billingPeriodCode: "monthly",
      billingPeriodSlug: PLAN_BILLING_PERIOD_BY_CODE.monthly.slug,
      billingPeriodLabel: plan.code === "basic" ? "7 Dias" : "Teste",
      billingPeriodMonths: 1,
      billingCycleDays: Math.max(plan.billingCycleDays, 1),
      billingLabel: plan.billingLabel,
      totalLabel: plan.billingLabel,
      checkoutPeriodLabel: plan.checkoutPeriodLabel,
      renewalLabel: plan.renewalLabel,
      cycleDiscountPercent: 0,
      cycleBadge: null,
    };
  }

  const baseMonthlyAmount = roundMoney(plan.price);
  const compareMonthlyAmount = roundMoney(plan.comparePrice);
  const monthlyMultiplier = 1 - billingPeriod.extraDiscountPercent / 100;
  const monthlyAmount = roundMoney(baseMonthlyAmount * monthlyMultiplier);
  const baseTotalAmount = roundMoney(baseMonthlyAmount * billingPeriod.months);
  const totalAmount = roundMoney(monthlyAmount * billingPeriod.months);
  const compareTotalAmount = roundMoney(compareMonthlyAmount * billingPeriod.months);
  const cycleBadge =
    billingPeriod.extraDiscountPercent > 0
      ? `+${billingPeriod.extraDiscountPercent}% no ${billingPeriod.label.toLowerCase()}`
      : null;
  const renewalLabel =
    billingPeriod.months === 1
      ? `Renovacao por ${formatMoney(monthlyAmount, plan.currency)}/mes. Cancele quando quiser.`
      : `Renovacao por ${formatMoney(monthlyAmount, plan.currency)}/mes no ciclo ${billingPeriod.label.toLowerCase()}. Cancele quando quiser.`;

  return {
    code: plan.code,
    name: plan.name,
    badge: plan.badge,
    description: plan.description,
    limitedOffer: cycleBadge
      ? `${plan.limitedOffer} + ${billingPeriod.extraDiscountPercent}% no total`
      : plan.limitedOffer,
    currency: plan.currency,
    isTrial: plan.isTrial,
    entitlements: {
      ...plan.entitlements,
    },
    features: [...plan.features],
    baseMonthlyAmount,
    monthlyAmount,
    compareMonthlyAmount,
    baseTotalAmount,
    totalAmount,
    compareTotalAmount,
    billingPeriodCode: billingPeriod.code,
    billingPeriodSlug: billingPeriod.slug,
    billingPeriodLabel: billingPeriod.label,
    billingPeriodMonths: billingPeriod.months,
    billingCycleDays: billingPeriod.billingCycleDays,
    billingLabel: "/mes",
    totalLabel:
      billingPeriod.months === 1
        ? "/mes"
        : `/ciclo de ${billingPeriod.durationLabel}`,
    checkoutPeriodLabel: `Periodo de ${billingPeriod.durationLabel}`,
    renewalLabel,
    cycleDiscountPercent: billingPeriod.extraDiscountPercent,
    cycleBadge,
  };
}

export function getAllPlanPricingDefinitions(
  billingPeriodValue: unknown = DEFAULT_PLAN_BILLING_PERIOD_CODE,
) {
  return PLAN_ORDER.map((planCode) => resolvePlanPricing(planCode, billingPeriodValue));
}

export function formatPlanUsageLimit(value: number) {
  if (value >= 999999) return "Ilimitado";
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function buildPlanSnapshot(value: unknown) {
  const plan = resolvePlanDefinition(value);
  return {
    code: plan.code,
    name: plan.name,
    badge: plan.badge,
    description: plan.description,
    price: plan.price,
    comparePrice: plan.comparePrice,
    currency: plan.currency,
    billingCycleDays: plan.billingCycleDays,
    billingLabel: plan.billingLabel,
    checkoutPeriodLabel: plan.checkoutPeriodLabel,
    renewalLabel: plan.renewalLabel,
    isTrial: plan.isTrial,
    entitlements: {
      ...plan.entitlements,
    },
  };
}

export function resolvePlanDisplayPrice(plan: PlanDefinition) {
  return Number.isFinite(plan.price) ? Math.round(plan.price * 100) / 100 : 0;
}

export function resolvePlanComparePrice(plan: PlanDefinition) {
  return Number.isFinite(plan.comparePrice)
    ? Math.round(plan.comparePrice * 100) / 100
    : 0;
}

export function isUnlimitedPlanLimit(value: number) {
  return value >= 999999;
}
