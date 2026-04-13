
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ConfigStepSelect } from "@/components/config/ConfigStepSelect";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  hasStepFourDraftValues,
  type StepFourDraft,
  type StepFourPaymentRail,
  type StepFourPhase,
  type StepFourView,
} from "@/lib/auth/configContext";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal/content";
import {
  isValidBrazilDocument,
  normalizeBrazilDocumentDigits,
  resolveBrazilDocumentType,
} from "@/lib/payments/brazilDocument";
import {
  resolvePaymentDiagnostic,
  type PaymentDiagnosticCategory,
} from "@/lib/payments/paymentDiagnostics";
import {
  areCardPaymentsEnabled,
  CARD_PAYMENTS_COMING_SOON_BADGE,
  CARD_PAYMENTS_DISABLED_MESSAGE,
} from "@/lib/payments/cardAvailability";
import {
  buildConfigCheckoutPath,
  DEFAULT_PLAN_BILLING_PERIOD_CODE,
  DEFAULT_PLAN_CODE,
  getAllPlanPricingDefinitions,
  getAvailableBillingPeriodsForPlan,
  isPlanCode,
  normalizePlanBillingPeriodCode,
  normalizePlanCode,
  resolvePlanPricing,
  type PlanBillingPeriodCode,
  type PlanBillingPeriodDefinition,
  type PlanCode,
  type PlanPricingDefinition,
} from "@/lib/plans/catalog";

type ConfigStepFourProps = {
  displayName: string;
  guildId: string | null;
  initialPlanCode: PlanCode;
  initialBillingPeriodCode?: PlanBillingPeriodCode;
  hasExplicitInitialPlan?: boolean;
  forceFreshCheckout?: boolean;
  initialDraft?: StepFourDraft | null;
  onDraftChange?: (guildId: string, draft: StepFourDraft) => void;
  onApproved?: (order: PixOrder) => void;
};

type PaymentMethod = "pix" | "card";
type CheckoutRail = StepFourPaymentRail;
type ValidationStatus = "idle" | "validating" | "valid" | "invalid";
type CardBrand = "visa" | "mastercard" | "amex" | "elo" | null;

type PixOrder = {
  id: number;
  orderNumber: number;
  guildId: string | null;
  method: "pix" | "card" | "trial";
  status: string;
  amount: number;
  currency: string;
  planCode?: string | null;
  planName?: string | null;
  planBillingCycleDays?: number | null;
  payerName: string | null;
  payerDocumentMasked: string | null;
  payerDocumentType: "CPF" | "CNPJ" | null;
  providerPaymentId: string | null;
  providerExternalReference: string | null;
  providerStatus: string | null;
  providerStatusDetail: string | null;
  qrCodeText: string | null;
  qrCodeBase64: string | null;
  qrCodeDataUri: string | null;
  ticketUrl: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  checkoutAccessToken?: string | null;
  checkoutAccessTokenExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type PixPaymentApiResponse = {
  ok: boolean;
  message?: string;
  reused?: boolean;
  alreadyProcessing?: boolean;
  requiresScheduledChange?: boolean;
  coveredByCreditsPreview?: boolean;
  retryAfterSeconds?: number;
  blockedByActiveLicense?: boolean;
  licenseActive?: boolean;
  licenseExpiresAt?: string | null;
  fromOrderCode?: boolean;
  order?: PixOrder | null;
};

type CardRedirectApiResponse = {
  ok: boolean;
  message?: string;
  reused?: boolean;
  alreadyProcessing?: boolean;
  blockedByActiveLicense?: boolean;
  licenseActive?: boolean;
  licenseExpiresAt?: string | null;
  orderNumber?: number | null;
  redirectUrl?: string | null;
};

type CardCancelApiResponse = {
  ok: boolean;
  message?: string;
  order?: PixOrder | null;
};

type MercadoPagoCardTokenPayload = {
  id?: string;
  payment_method_id?: string;
  issuer_id?: string | number | null;
  message?: string;
  cause?: Array<{ description?: string }>;
};

type UnknownErrorObject = Record<string, unknown>;

type MercadoPagoInstance = {
  createCardToken: (input: {
    cardNumber: string;
    cardholderName: string;
    identificationType: "CPF" | "CNPJ";
    identificationNumber: string;
    securityCode: string;
    cardExpirationMonth: string;
    cardExpirationYear: string;
    device?: {
      id: string;
    };
  }) => Promise<MercadoPagoCardTokenPayload>;
};

declare global {
  interface Window {
    MercadoPago?: new (
      publicKey: string,
      options?: { locale?: string },
    ) => MercadoPagoInstance;
    MP_DEVICE_SESSION_ID?: string;
    flowdeskDeviceSessionId?: string;
  }
}

type MethodSelectorPanelProps = {
  className: string;
  onChoosePix: () => void;
  onStartPixFlow: () => void;
  onTogglePixTerms: (checked: boolean) => void;
  onSelectHostedRail: (rail: Exclude<CheckoutRail, "pix">) => void;
  methodMessage: string | null;
  canInteract: boolean;
  cardEnabled: boolean;
  selectedRail: CheckoutRail | null;
  pixTermsAccepted: boolean;
  view: StepFourView;
};

type PixFormPanelProps = {
  className: string;
  payerDocument: string;
  payerName: string;
  payerDocumentStatus: ValidationStatus;
  payerNameStatus: ValidationStatus;
  onPayerDocumentChange: (value: string) => void;
  onPayerNameChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
  canSubmit: boolean;
  errorMessage: string | null;
  hasInputError: boolean;
  errorAnimationTick: number;
};

type CardFormPanelProps = {
  className: string;
  cardNumber: string;
  cardHolderName: string;
  cardExpiry: string;
  cardCvv: string;
  cardDocument: string;
  cardBillingZipCode: string;
  cardBrand: CardBrand;
  cardNumberStatus: ValidationStatus;
  cardHolderStatus: ValidationStatus;
  cardExpiryStatus: ValidationStatus;
  cardCvvStatus: ValidationStatus;
  cardDocumentStatus: ValidationStatus;
  cardBillingZipCodeStatus: ValidationStatus;
  onCardNumberChange: (value: string) => void;
  onCardHolderNameChange: (value: string) => void;
  onCardExpiryChange: (value: string) => void;
  onCardCvvChange: (value: string) => void;
  onCardDocumentChange: (value: string) => void;
  onCardBillingZipCodeChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
  canSubmit: boolean;
  cooldownMessage: string | null;
  errorMessage: string | null;
  hasInputError: boolean;
  errorAnimationTick: number;
};

type PixCheckoutPanelProps = {
  className: string;
  order: PixOrder | null;
  copied: boolean;
  onCopy: () => void;
  onBackToMethods: () => void;
};

type DiscountPreviewApiResponse = {
  ok: boolean;
  message?: string;
  preview?: {
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
    flowPoints?: {
      appliedAmount: number;
      balanceBefore: number;
      balanceAfter: number;
    } | null;
  };
};

type PlanSummary = PlanPricingDefinition & {
  isAvailable: boolean;
  unavailableReason?: string | null;
};
type BillingPeriodOption = PlanBillingPeriodDefinition;

type PlanChangeSummary = {
  kind: "new" | "current" | "upgrade" | "downgrade";
  execution: "pay_now" | "schedule_for_renewal" | "already_active" | "trial_activation";
  currentPlanCode: PlanCode | null;
  currentBillingCycleDays: number | null;
  currentExpiresAt: string | null;
  currentStatus: string | null;
  currentCreditAmount: number;
  remainingDaysExact: number;
  immediateSubtotalAmount: number;
  targetTotalAmount: number;
  flowPointsBalance: number;
  flowPointsGrantPreview: number;
  effectiveAt: string | null;
  scheduledChangeMatchesTarget: boolean;
};

type ScheduledPlanChangeSummary = {
  id: number;
  guildId: string | null;
  currentPlanCode: PlanCode;
  currentBillingCycleDays: number;
  targetPlanCode: PlanCode;
  targetBillingPeriodCode: PlanBillingPeriodCode;
  targetBillingCycleDays: number;
  status: "scheduled" | "applied" | "cancelled";
  effectiveAt: string;
};

type PlanApiResponse = {
  ok: boolean;
  message?: string;
  plan?: {
    planCode: PlanCode;
    planName: string;
    billingPeriodCode: PlanBillingPeriodCode;
    billingPeriodLabel: string;
    billingPeriodMonths: number;
    monthlyAmount: number;
    compareMonthlyAmount: number;
    baseTotalAmount: number;
    totalAmount: number;
    compareTotalAmount: number;
    checkoutAmount: number;
    checkoutMode: PlanChangeSummary["kind"];
    checkoutExecution: PlanChangeSummary["execution"];
    planChange: PlanChangeSummary;
    scheduledChange: ScheduledPlanChangeSummary | null;
    currency: string;
    billingCycleDays: number;
    billingLabel: string;
    totalLabel: string;
    checkoutPeriodLabel: string;
    renewalLabel: string;
    cycleDiscountPercent: number;
    cycleBadge: string | null;
    isTrial: boolean;
    isAvailable: boolean;
    unavailableReason?: string | null;
    entitlements: PlanSummary["entitlements"];
    description: string;
    features: string[];
    recurringEnabled: boolean;
    recurringMethodId: string | null;
    availablePlans: PlanSummary[];
    accountPlan: {
      planCode: PlanCode;
      planName: string;
      status: string;
      amount: number;
      currency: string;
      billingCycleDays: number;
      maxLicensedServers: number;
      maxActiveTickets: number;
      maxAutomations: number;
      maxMonthlyActions: number;
      activatedAt: string | null;
      expiresAt: string | null;
      lastPaymentGuildId: string | null;
    } | null;
    availableBillingPeriods?: BillingPeriodOption[];
  };
};

type AccountPlanSnapshot = NonNullable<
  NonNullable<PlanApiResponse["plan"]>["accountPlan"]
>;

function resolvePlanSummary(
  planCode: PlanCode,
  billingPeriodCode: PlanBillingPeriodCode,
  availablePlans: PlanSummary[],
) {
  return (
    availablePlans.find(
      (plan) =>
        plan.code === planCode && plan.billingPeriodCode === billingPeriodCode,
    ) || {
      ...resolvePlanPricing(planCode, billingPeriodCode),
      isAvailable: true,
      unavailableReason: null,
    }
  );
}

function decoratePlanSummaries(plans: PlanPricingDefinition[]): PlanSummary[] {
  return plans.map((plan) => ({
    ...plan,
    isAvailable: true,
    unavailableReason: null,
  }));
}

function buildFallbackPlanChangeSummary(
  plan: PlanSummary,
  flowPointsBalance = 0,
): PlanChangeSummary {
  const normalizedFlowPointsBalance = roundMoney(Math.max(0, flowPointsBalance));
  return {
    kind: "new",
    execution: plan.isTrial ? "trial_activation" : "pay_now",
    currentPlanCode: null,
    currentBillingCycleDays: null,
    currentExpiresAt: null,
    currentStatus: null,
    currentCreditAmount: 0,
    remainingDaysExact: 0,
    immediateSubtotalAmount: plan.totalAmount,
    targetTotalAmount: plan.totalAmount,
    flowPointsBalance: normalizedFlowPointsBalance,
    flowPointsGrantPreview: 0,
    effectiveAt: null,
    scheduledChangeMatchesTarget: false,
  };
}

function resolveFlowPointsGrantFromSubtotal(input: {
  planChange: Pick<PlanChangeSummary, "kind" | "currentCreditAmount" | "targetTotalAmount">;
  subtotalAmount: number;
}) {
  if (input.planChange.kind !== "upgrade") return 0;
  const normalizedCredit = roundMoney(Math.max(0, input.planChange.currentCreditAmount));
  // Usar preço ORIGINAL do novo plano — cupons/gift cards não devem aumentar o grant.
  const targetTotalAmount = roundMoney(Math.max(0, input.planChange.targetTotalAmount));
  return roundMoney(Math.max(0, normalizedCredit - targetTotalAmount));
}

function toPlanSummaryFromApi(
  plan: NonNullable<PlanApiResponse["plan"]>,
): PlanSummary {
  const basePlan = resolvePlanPricing(plan.planCode, plan.billingPeriodCode);
  return {
    ...basePlan,
    code: plan.planCode,
    name: plan.planName,
    description: plan.description,
    billingPeriodCode: plan.billingPeriodCode,
    billingPeriodLabel: plan.billingPeriodLabel,
    billingPeriodMonths: plan.billingPeriodMonths,
    monthlyAmount: plan.monthlyAmount,
    compareMonthlyAmount: plan.compareMonthlyAmount,
    baseTotalAmount: plan.baseTotalAmount,
    totalAmount: plan.totalAmount,
    compareTotalAmount: plan.compareTotalAmount,
    currency: plan.currency,
    billingCycleDays: plan.billingCycleDays,
    billingLabel: plan.billingLabel,
    totalLabel: plan.totalLabel,
    checkoutPeriodLabel: plan.checkoutPeriodLabel,
    renewalLabel: plan.renewalLabel,
    cycleDiscountPercent: plan.cycleDiscountPercent,
    cycleBadge: plan.cycleBadge,
    isTrial: plan.isTrial,
    isAvailable: plan.isAvailable,
    unavailableReason: plan.unavailableReason ?? null,
    entitlements: {
      ...plan.entitlements,
    },
    features: [...plan.features],
  };
}

function CompactPlanSelect({
  plans,
  selectedPlanCode,
  onSelectPlan,
  disabled,
}: {
  plans: PlanSummary[];
  selectedPlanCode: PlanCode;
  onSelectPlan: (planCode: PlanCode) => void;
  disabled: boolean;
}) {
  const selectedPlan =
    plans.find((plan) => plan.code === selectedPlanCode) || null;
  const selectWidth = `${Math.max((selectedPlan?.name.length || 12) + 9, 20)}ch`;

  return (
    <div className="inline-flex" style={{ width: selectWidth }}>
      <ConfigStepSelect
        label=""
        placeholder="Selecionar plano"
        options={plans.map((plan) => ({
          id: plan.code,
          name: plan.name,
        }))}
        value={selectedPlanCode}
        onChange={(value) => onSelectPlan(value as PlanCode)}
        disabled={disabled}
        loading={false}
        controlHeightPx={56}
        variant="immersive"
      />
    </div>
  );
}

function BillingPeriodSwitcher({
  periods,
  selectedBillingPeriodCode,
  onSelectBillingPeriod,
  disabled,
  className,
}: {
  periods: BillingPeriodOption[];
  selectedBillingPeriodCode: PlanBillingPeriodCode;
  onSelectBillingPeriod: (billingPeriodCode: PlanBillingPeriodCode) => void;
  disabled: boolean;
  className?: string;
}) {
  const selectedPeriod =
    periods.find((period) => period.code === selectedBillingPeriodCode) || null;
  const selectWidth = `${Math.max((selectedPeriod?.label.length || 9) + 7, 16)}ch`;

  return (
    <div
      className={`inline-flex max-w-full ${className || ""}`}
      style={{ width: selectWidth }}
    >
      <ConfigStepSelect
        label=""
        placeholder="Selecionar periodo"
        options={periods.map((period) => ({
          id: period.code,
          name: period.label,
        }))}
        value={selectedBillingPeriodCode}
        onChange={(value) =>
          onSelectBillingPeriod(value as PlanBillingPeriodCode)
        }
        disabled={disabled || periods.length <= 1}
        loading={false}
        controlHeightPx={56}
        variant="immersive"
      />
    </div>
  );
}

const ELO_PREFIXES = [
  "401178",
  "401179",
  "438935",
  "457631",
  "457632",
  "431274",
  "451416",
  "457393",
  "504175",
  "506699",
  "506770",
  "506771",
  "506772",
  "506773",
  "506774",
  "506775",
  "506776",
  "506777",
  "506778",
  "509000",
  "509999",
  "627780",
  "636297",
  "636368",
  "650031",
  "650033",
  "650035",
  "650051",
  "650405",
  "650439",
  "650485",
  "650538",
  "650541",
  "650598",
  "650700",
  "650718",
  "650720",
  "650727",
  "650901",
  "650920",
  "651652",
  "651679",
  "655000",
  "655019",
];

const BRAND_ICON_BY_TYPE: Record<Exclude<CardBrand, null>, string> = {
  visa: "/cdn/icons/card_visa.svg",
  mastercard: "/cdn/icons/card_mastercard.svg",
  amex: "/cdn/icons/card_amex.svg",
  elo: "/cdn/icons/card_elo.svg",
};

const MERCADO_PAGO_SDK_URL = "https://sdk.mercadopago.com/js/v2";
const MERCADO_PAGO_SECURITY_SDK_URL = "https://www.mercadopago.com/v2/security.js";
const MERCADO_PAGO_DEVICE_SESSION_STORAGE_KEY =
  "flowdesk_mp_device_session_v1";
let mercadoPagoSdkPromise: Promise<void> | null = null;
let mercadoPagoSecuritySdkPromise: Promise<void> | null = null;
const PAYMENT_ORDER_CACHE_STORAGE_KEY = "flowdesk_payment_order_cache_v1";
const APPROVED_REDIRECTED_ORDERS_STORAGE_KEY =
  "flowdesk_approved_redirected_orders_v1";
const PENDING_CARD_REDIRECT_STORAGE_KEY =
  "flowdesk_pending_card_redirect_v1";
const CHECKOUT_STATUS_QUERY_KEYS = [
  "status",
  "code",
  "guild",
  "method",
  "checkoutToken",
  "payment_id",
  "paymentId",
  "paymentRef",
  "collection_id",
] as const;

const EMPTY_STEP_FOUR_DRAFT: StepFourDraft = {
  visited: false,
  phase: "cart",
  view: "methods",
  selectedRail: null,
  selectedPlanCode: DEFAULT_PLAN_CODE,
  selectedBillingPeriodCode: DEFAULT_PLAN_BILLING_PERIOD_CODE,
  lastKnownOrderNumber: null,
  couponCode: "",
  giftCardCode: "",
  payerDocument: "",
  payerName: "",
  billingFullName: "",
  billingEmail: "",
  billingCountry: "Brasil",
  billingPostalCode: "",
  billingRegion: "",
  billingCity: "",
  billingAddressLine1: "",
  billingAddressLine2: "",
  cardNumber: "",
  cardHolderName: "",
  cardExpiry: "",
  cardCvv: "",
  cardDocument: "",
  cardBillingZipCode: "",
};

function normalizeDraftText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.slice(0, maxLength);
}

function buildStepFourDraft(
  input: Partial<StepFourDraft> | null | undefined,
  fallbackPlanCode: PlanCode = DEFAULT_PLAN_CODE,
  fallbackBillingPeriodCode: PlanBillingPeriodCode = DEFAULT_PLAN_BILLING_PERIOD_CODE,
): StepFourDraft {
  if (!input) {
    return {
      ...EMPTY_STEP_FOUR_DRAFT,
      selectedPlanCode: fallbackPlanCode,
      selectedBillingPeriodCode: fallbackBillingPeriodCode,
    };
  }

  const view: StepFourView =
    input.view === "pix_form" ||
    input.view === "card_form" ||
    input.view === "pix_checkout"
      ? input.view
      : "methods";

  return {
    visited: Boolean(input.visited),
    phase: input.phase === "checkout" ? "checkout" : "cart",
    view,
    selectedRail:
      input.selectedRail === "pix" ||
      input.selectedRail === "google_pay" ||
      input.selectedRail === "nupay" ||
      input.selectedRail === "paypal"
        ? input.selectedRail
        : null,
    selectedPlanCode: normalizePlanCode(input.selectedPlanCode, fallbackPlanCode),
    selectedBillingPeriodCode: normalizePlanBillingPeriodCode(
      input.selectedBillingPeriodCode,
      fallbackBillingPeriodCode,
    ),
    lastKnownOrderNumber:
      typeof input.lastKnownOrderNumber === "number" &&
      Number.isInteger(input.lastKnownOrderNumber) &&
      input.lastKnownOrderNumber > 0
        ? input.lastKnownOrderNumber
        : null,
    couponCode: normalizeDraftText(input.couponCode, 64),
    giftCardCode: normalizeDraftText(input.giftCardCode, 64),
    payerDocument: normalizeDraftText(input.payerDocument, 24),
    payerName: normalizeDraftText(input.payerName, 120),
    billingFullName: normalizeDraftText(input.billingFullName, 120),
    billingEmail: normalizeDraftText(input.billingEmail, 160),
    billingCountry: normalizeDraftText(input.billingCountry, 80) || "Brasil",
    billingPostalCode: normalizeDraftText(input.billingPostalCode, 16),
    billingRegion: normalizeDraftText(input.billingRegion, 80),
    billingCity: normalizeDraftText(input.billingCity, 80),
    billingAddressLine1: normalizeDraftText(input.billingAddressLine1, 160),
    billingAddressLine2: normalizeDraftText(input.billingAddressLine2, 160),
    cardNumber: normalizeDraftText(input.cardNumber, 32),
    cardHolderName: normalizeDraftText(input.cardHolderName, 120),
    cardExpiry: normalizeDraftText(input.cardExpiry, 8),
    cardCvv: normalizeDraftText(input.cardCvv, 4),
    cardDocument: normalizeDraftText(input.cardDocument, 24),
    cardBillingZipCode: normalizeDraftText(input.cardBillingZipCode, 10),
  };
}

function resolveRestoredView(input: {
  hasStoredDraft: boolean;
  preferredView: StepFourView;
  order: PixOrder | null;
}): StepFourView {
  const hasPendingCardOrder = Boolean(
    input.order && input.order.method === "card" && input.order.status === "pending",
  );
  const hasPixCheckoutOrder = Boolean(
    input.order && input.order.method === "pix" && input.order.qrCodeText,
  );

  if (hasPendingCardOrder) {
    return "methods";
  }

  if (!input.hasStoredDraft) {
    return hasPixCheckoutOrder ? "pix_checkout" : "methods";
  }

  if (input.preferredView === "pix_checkout") {
    return hasPixCheckoutOrder ? "pix_checkout" : "methods";
  }

  return input.preferredView;
}

function isCachedPixOrder(value: unknown): value is PixOrder {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;

  return (
    typeof data.id === "number" &&
    typeof data.orderNumber === "number" &&
    typeof data.guildId === "string" &&
    (data.method === "pix" || data.method === "card" || data.method === "trial") &&
    typeof data.status === "string" &&
    typeof data.amount === "number" &&
    typeof data.currency === "string"
  );
}

function replaceCurrentPlanPath(
  planCode: PlanCode,
  billingPeriodCode: PlanBillingPeriodCode,
) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const nextPathname = buildConfigCheckoutPath({
    planCode,
    billingPeriodCode,
  });
  if (url.pathname === nextPathname) return;

  window.history.replaceState(
    null,
    "",
    buildConfigUrlWithHashRoute(nextPathname, url.search, url.hash),
  );
}

function buildConfigUrlWithHashRoute(
  pathname: string,
  search: string,
  hash: string,
) {
  const normalizedPathname =
    hash.startsWith("#/") && pathname !== "/" && !pathname.endsWith("/")
      ? `${pathname}/`
      : pathname;

  return `${normalizedPathname}${search}${hash}`;
}

function readCachedOrderByGuild(guildId: string | null): PixOrder | null {
  if (typeof window === "undefined") return null;
  const activeKey = guildId || "__global__";

  try {
    const raw = window.sessionStorage.getItem(PAYMENT_ORDER_CACHE_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const item = (parsed as Record<string, unknown>)[activeKey];
    return isCachedPixOrder(item) ? item : null;
  } catch {
    return null;
  }
}

function writeCachedOrderByGuild(guildId: string | null, order: PixOrder) {
  if (typeof window === "undefined") return;
  const activeKey = guildId || "__global__";

  try {
    const raw = window.sessionStorage.getItem(PAYMENT_ORDER_CACHE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const next = {
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      [activeKey]: order,
    };

    window.sessionStorage.setItem(
      PAYMENT_ORDER_CACHE_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // ignorar erro de cache local
  }
}

function removeCachedOrderByGuild(guildId: string | null) {
  if (typeof window === "undefined") return;
  const activeKey = guildId || "__global__";

  try {
    const raw = window.sessionStorage.getItem(PAYMENT_ORDER_CACHE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return;

    const next = { ...(parsed as Record<string, unknown>) };
    delete next[activeKey];

    window.sessionStorage.setItem(
      PAYMENT_ORDER_CACHE_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // ignorar erro de cache local
  }
}

type PendingCardRedirectState = {
  guildId: string;
  orderNumber: number | null;
  startedAt: number;
};

function readPendingCardRedirectState(guildId: string) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(PENDING_CARD_REDIRECT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const data = parsed as Record<string, unknown>;
    const storedGuildId =
      typeof data.guildId === "string" ? data.guildId.trim() : "";
    const orderNumber =
      typeof data.orderNumber === "number" && Number.isInteger(data.orderNumber)
        ? data.orderNumber
        : null;
    const startedAt =
      typeof data.startedAt === "number" && Number.isFinite(data.startedAt)
        ? data.startedAt
        : Number.NaN;

    if (!storedGuildId || storedGuildId !== guildId || !Number.isFinite(startedAt)) {
      return null;
    }

    return {
      guildId: storedGuildId,
      orderNumber,
      startedAt,
    } satisfies PendingCardRedirectState;
  } catch {
    return null;
  }
}

function writePendingCardRedirectState(input: {
  guildId: string;
  orderNumber: number | null;
}) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      PENDING_CARD_REDIRECT_STORAGE_KEY,
      JSON.stringify({
        guildId: input.guildId,
        orderNumber: input.orderNumber,
        startedAt: Date.now(),
      } satisfies PendingCardRedirectState),
    );
  } catch {
    // ignorar falha de storage local
  }
}

function clearPendingCardRedirectState(guildId?: string | null) {
  if (typeof window === "undefined") return;

  try {
    if (!guildId) {
      window.sessionStorage.removeItem(PENDING_CARD_REDIRECT_STORAGE_KEY);
      return;
    }

    const current = readPendingCardRedirectState(guildId);
    if (!current) return;

    window.sessionStorage.removeItem(PENDING_CARD_REDIRECT_STORAGE_KEY);
  } catch {
    // ignorar falha de storage local
  }
}

function readApprovedRedirectedOrderNumbers() {
  if (typeof window === "undefined") return new Set<number>();

  try {
    const raw = window.sessionStorage.getItem(
      APPROVED_REDIRECTED_ORDERS_STORAGE_KEY,
    );
    if (!raw) return new Set<number>();

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set<number>();

    const normalized = parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);

    return new Set<number>(normalized);
  } catch {
    return new Set<number>();
  }
}

function hasApprovedOrderBeenAutoRedirected(orderNumber: number) {
  return readApprovedRedirectedOrderNumbers().has(orderNumber);
}

function markApprovedOrderAutoRedirected(orderNumber: number) {
  if (typeof window === "undefined") return;

  try {
    const set = readApprovedRedirectedOrderNumbers();
    set.add(orderNumber);
    window.sessionStorage.setItem(
      APPROVED_REDIRECTED_ORDERS_STORAGE_KEY,
      JSON.stringify(Array.from(set.values())),
    );
  } catch {
    // ignorar falha de storage local
  }
}

function formatLicenseExpiresAt(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function buildActiveLicenseMessage(licenseExpiresAt: string | null | undefined) {
  const formattedExpiresAt = formatLicenseExpiresAt(licenseExpiresAt);
  if (formattedExpiresAt) {
    return `Assinatura da conta ativa ate ${formattedExpiresAt}.`;
  }

  return "Assinatura da conta ativa. Novos pagamentos ficam bloqueados ate o fim do periodo.";
}

function roundMoney(amount: number) {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function formatMoney(amount: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(roundMoney(amount));
}

function buildFallbackDiscountPreview(input: {
  baseAmount: number;
  currency: string;
  flowPointsBalance?: number;
}): NonNullable<DiscountPreviewApiResponse["preview"]> {
  const normalizedBaseAmount = roundMoney(Math.max(0, input.baseAmount));
  const normalizedFlowPointsBalance = roundMoney(
    Math.max(0, input.flowPointsBalance || 0),
  );
  const flowPointsAppliedAmount = roundMoney(
    Math.min(normalizedBaseAmount, normalizedFlowPointsBalance),
  );
  const flowPointsNextBalance = roundMoney(
    Math.max(0, normalizedFlowPointsBalance - flowPointsAppliedAmount),
  );

  return {
    baseAmount: normalizedBaseAmount,
    currency: input.currency,
    coupon: null,
    giftCard: null,
    subtotalAmount: normalizedBaseAmount,
    totalAmount: roundMoney(normalizedBaseAmount - flowPointsAppliedAmount),
    flowPoints: {
      appliedAmount: flowPointsAppliedAmount,
      balanceBefore: normalizedFlowPointsBalance,
      balanceAfter: flowPointsNextBalance,
    },
  };
}

function resolveCheckoutRailLabel(rail: CheckoutRail | null) {
  switch (rail) {
    case "pix":
      return "PIX";
    case "google_pay":
      return "Google Pay";
    case "nupay":
      return "NuPay";
    case "paypal":
      return "PayPal";
    default:
      return "Selecione um metodo";
  }
}

function resolveCompletedPaymentMethodLabel(
  method: PixOrder["method"] | null | undefined,
) {
  switch (method) {
    case "pix":
      return "PIX";
    case "card":
      return "Cartao";
    case "trial":
      return "Plano gratuito";
    default:
      return "Pagamento";
  }
}

function formatPromoCountdown(targetTimestamp: number) {
  const remainingMs = Math.max(0, targetTimestamp - Date.now());
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    days: String(days).padStart(2, "0"),
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0"),
  };
}

function readCheckoutStatusQuery() {
  if (typeof window === "undefined") {
    return {
      code: null as number | null,
      status: null as string | null,
      guild: null as string | null,
      checkoutToken: null as string | null,
      paymentId: null as string | null,
      paymentRef: null as string | null,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const rawCode = params.get("code");
  const code =
    rawCode && /^\d{1,12}$/.test(rawCode.trim()) ? Number(rawCode.trim()) : null;
  const status = params.get("status")?.trim().toLowerCase() || null;
  const guild = params.get("guild")?.trim() || null;
  const checkoutToken = params.get("checkoutToken")?.trim() || null;
  const paymentId =
    params.get("payment_id")?.trim() ||
    params.get("paymentId")?.trim() ||
    params.get("collection_id")?.trim() ||
    null;
  const paymentRef = params.get("paymentRef")?.trim() || null;

  return { code, status, guild, checkoutToken, paymentId, paymentRef };
}

function readRequestedPaymentMethodFromQuery() {
  if (typeof window === "undefined") return null;

  const method = new URLSearchParams(window.location.search)
    .get("method")
    ?.trim()
    .toLowerCase();

  if (method === "pix") return "pix" as const;
  if (method === "card") return "card" as const;
  return null;
}

function normalizeGuildIdFromQuery(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

function normalizeServersTabFromQuery(value: string | null) {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "payments") return "payments";
  if (normalized === "methods") return "methods";
  if (normalized === "plans") return "plans";
  return "settings";
}

function resolveApprovedRedirectConfig(fallbackGuildId: string | null) {
  if (typeof window === "undefined") {
    return {
      targetUrl: "/servers",
      delayMs: 10_000,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const isRenewFlow = params.get("renew")?.trim() === "1";
  const returnTarget = params.get("return")?.trim().toLowerCase() || null;
  const shouldReturnToServers = isRenewFlow || returnTarget === "servers";

  if (!shouldReturnToServers) {
    return {
      targetUrl: "/servers",
      delayMs: 10_000,
    };
  }

  const returnGuildId =
    normalizeGuildIdFromQuery(params.get("returnGuild")) || fallbackGuildId;
  const returnTab = normalizeServersTabFromQuery(params.get("returnTab"));

  const targetUrl = returnGuildId
    ? returnTab === "settings"
      ? `/servers/${encodeURIComponent(returnGuildId)}`
      : `/servers/${encodeURIComponent(returnGuildId)}?tab=${encodeURIComponent(returnTab)}`
    : "/servers";

  return {
    targetUrl,
    delayMs: isRenewFlow ? 5_000 : 10_000,
  };
}

function setCheckoutStatusQuery(input: {
  order: PixOrder;
  guildId: string | null;
}) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("status", input.order.status);
  url.searchParams.set("code", String(input.order.orderNumber));

  if (input.guildId) {
    url.searchParams.set("guild", input.guildId);
  } else {
    url.searchParams.delete("guild");
  }

  if (input.order.checkoutAccessToken) {
    url.searchParams.set("checkoutToken", input.order.checkoutAccessToken);
  } else {
    url.searchParams.delete("checkoutToken");
  }

  url.searchParams.set("method", input.order.method);
  if (input.order.providerPaymentId) {
    url.searchParams.set("paymentId", input.order.providerPaymentId);
  } else {
    url.searchParams.delete("paymentId");
  }
  if (input.order.providerExternalReference) {
    url.searchParams.set("paymentRef", input.order.providerExternalReference);
  } else {
    url.searchParams.delete("paymentRef");
  }
  url.searchParams.delete("payment_id");
  url.searchParams.delete("collection_id");

  window.history.replaceState(
    null,
    "",
    buildConfigUrlWithHashRoute(url.pathname, url.search, url.hash),
  );
}

function buildPaymentOrderLookupUrl(input: {
  guildId: string;
  orderCode?: number | null;
  checkoutToken?: string | null;
  paymentId?: string | null;
  paymentRef?: string | null;
  status?: string | null;
}) {
  const params = new URLSearchParams({ guildId: input.guildId });

  if (input.orderCode) {
    params.set("code", String(input.orderCode));
  }

  if (input.checkoutToken) {
    params.set("checkoutToken", input.checkoutToken);
  }

  if (input.paymentId) {
    params.set("paymentId", input.paymentId);
  }

  if (input.paymentRef) {
    params.set("paymentRef", input.paymentRef);
  }

  if (input.status) {
    params.set("status", input.status);
  }

  return `/api/auth/me/payments/order?${params.toString()}`;
}

function clearCheckoutStatusQuery() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const hadAnyKey = CHECKOUT_STATUS_QUERY_KEYS.some((key) =>
    url.searchParams.has(key),
  );
  if (!hadAnyKey) return;

  for (const key of CHECKOUT_STATUS_QUERY_KEYS) {
    url.searchParams.delete(key);
  }

  window.history.replaceState(
    null,
    "",
    buildConfigUrlWithHashRoute(url.pathname, url.search, url.hash),
  );
}

function resolveRetryAfterSeconds(
  response: Response | null | undefined,
  payload?: { retryAfterSeconds?: number | null } | null,
) {
  const payloadValue =
    typeof payload?.retryAfterSeconds === "number" &&
    Number.isFinite(payload.retryAfterSeconds) &&
    payload.retryAfterSeconds > 0
      ? Math.ceil(payload.retryAfterSeconds)
      : null;

  if (payloadValue) return payloadValue;

  const headerValue = response?.headers.get("Retry-After");
  if (!headerValue) return null;

  const parsed = Number(headerValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.ceil(parsed);
}

function resolveResponseRequestId(response: Response | null | undefined) {
  const headerValue = response?.headers.get("X-Request-Id");
  if (typeof headerValue !== "string") return null;
  const normalized = headerValue.trim();
  return normalized || null;
}

function withSupportRequestId(
  message: string,
  requestId: string | null | undefined,
) {
  const normalizedMessage = message.trim();
  if (!requestId) return normalizedMessage;
  return `${normalizedMessage} Protocolo: ${requestId}.`;
}

function formatCooldownMessage(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `Aguarde ${seconds}s para tentar novamente.`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (!remainingSeconds) {
    return `Aguarde ${minutes}min para tentar novamente.`;
  }

  return `Aguarde ${minutes}min ${remainingSeconds}s para tentar novamente.`;
}

function resolveCardPublicKey() {
  const candidates = [
    process.env.NEXT_PUBLIC_MERCADO_PAGO_CARD_PUBLIC_KEY ||
      null,
    process.env.NEXT_PUBLIC_MERCADO_PAGO_CARD_PRODUCTION_PUBLIC_KEY || null,
    process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY || null,
    process.env.NEXT_PUBLIC_MERCADO_PAGO_CARD_TEST_PUBLIC_KEY || null,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  const key =
    candidates.find((value) => !value.startsWith("TEST-")) ||
    candidates[0] ||
    null;
  if (!key) return null;
  if (!key.startsWith("APP_USR-") && !key.startsWith("TEST-")) {
    return null;
  }
  return key;
}

function resolveCardPaymentMethodIdFromBrand(brand: CardBrand) {
  switch (brand) {
    case "visa":
      return "visa";
    case "mastercard":
      return "master";
    case "amex":
      return "amex";
    case "elo":
      return "elo";
    default:
      return null;
  }
}

function parseMercadoPagoCardTokenError(payload: MercadoPagoCardTokenPayload) {
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  if (Array.isArray(payload.cause) && payload.cause.length > 0) {
    const description = payload.cause[0]?.description;
    if (typeof description === "string" && description.trim()) {
      return description.trim();
    }
  }

  return null;
}

function isAbortLikeErrorMessage(message: string | null | undefined) {
  if (!message) return false;

  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized === "signal is aborted without reason" ||
    normalized === "the operation was aborted" ||
    normalized === "this operation was aborted" ||
    normalized === "aborted" ||
    normalized.includes("aborterror")
  );
}

function isAbortLikeError(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  if (error instanceof Error) {
    return error.name === "AbortError" || isAbortLikeErrorMessage(error.message);
  }

  if (typeof error === "string") {
    return isAbortLikeErrorMessage(error);
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const data = error as UnknownErrorObject;
  return (
    isAbortLikeErrorMessage(
      typeof data.message === "string" ? data.message : null,
    ) ||
    isAbortLikeErrorMessage(
      typeof data.errorMessage === "string" ? data.errorMessage : null,
    )
  );
}

function normalizePaymentUiMessage(message: string | null | undefined) {
  if (!message) return null;

  const normalized = message.trim().replace(/^Mercado Pago:\s*/i, "");
  if (!normalized) return null;
  if (isAbortLikeErrorMessage(normalized)) return null;

  const lowercaseMessage = normalized.toLowerCase();
  if (
    lowercaseMessage.includes("date_of_expiration") ||
    lowercaseMessage.includes("date of expiration") ||
    lowercaseMessage.includes("expiration") ||
    lowercaseMessage.includes("expired")
  ) {
    return "A tentativa anterior expirou. O sistema vai preparar uma nova cobranca segura.";
  }

  if (
    lowercaseMessage.includes("provider_payment_id") ||
    lowercaseMessage.includes("checkout link") ||
    lowercaseMessage.includes("secure token")
  ) {
    return "Estamos atualizando esta tentativa de pagamento com seguranca. Tente novamente em instantes.";
  }

  return normalized;
}

function parseUnknownErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return normalizePaymentUiMessage(error.message);
  }

  if (typeof error === "string") {
    return normalizePaymentUiMessage(error);
  }

  if (!error || typeof error !== "object") {
    return null;
  }

  const data = error as UnknownErrorObject;

  const directMessage = data.message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return normalizePaymentUiMessage(directMessage);
  }

  const errorMessage = data.errorMessage;
  if (typeof errorMessage === "string" && errorMessage.trim()) {
    return normalizePaymentUiMessage(errorMessage);
  }

  const cause = data.cause;
  if (Array.isArray(cause) && cause.length > 0) {
    const firstCause = cause[0];
    if (firstCause && typeof firstCause === "object") {
      const description = (firstCause as UnknownErrorObject).description;
      if (typeof description === "string" && description.trim()) {
        return normalizePaymentUiMessage(description);
      }
    }
  }

  return null;
}

function parseTimestampMs(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isPixOrderExpiredOrUnavailable(order: PixOrder | null | undefined) {
  if (!order || order.method !== "pix") return false;

  const providerStatus = (order.providerStatus || "").trim().toLowerCase();
  if (order.status === "expired" || providerStatus === "expired") {
    return true;
  }

  const expiresAtMs = parseTimestampMs(order.expiresAt);
  if (expiresAtMs === null) return false;
  return expiresAtMs <= Date.now();
}

async function loadMercadoPagoSdk() {
  if (typeof window === "undefined") {
    throw new Error("SDK de cartao indisponivel no servidor.");
  }

  if (window.MercadoPago) {
    return;
  }

  if (!mercadoPagoSdkPromise) {
    mercadoPagoSdkPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        "script[data-mp-sdk='v2']",
      );

      if (existingScript) {
        if (
          window.MercadoPago ||
          existingScript.dataset.loaded === "true"
        ) {
          resolve();
          return;
        }

        existingScript.addEventListener(
          "load",
          () => {
            existingScript.dataset.loaded = "true";
            resolve();
          },
          {
            once: true,
          },
        );
        existingScript.addEventListener(
          "error",
          () => reject(new Error("Falha ao carregar SDK do Mercado Pago.")),
          { once: true },
        );
        return;
      }

      const script = document.createElement("script");
      script.src = MERCADO_PAGO_SDK_URL;
      script.async = true;
      script.defer = true;
      script.dataset.mpSdk = "v2";
      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = () =>
        reject(new Error("Falha ao carregar SDK do Mercado Pago."));

      document.head.appendChild(script);
    });
  }

  try {
    await mercadoPagoSdkPromise;
  } catch (error) {
    mercadoPagoSdkPromise = null;
    document
      .querySelector<HTMLScriptElement>("script[data-mp-sdk='v2']")
      ?.remove();
    throw error;
  }

  if (!window.MercadoPago) {
    throw new Error("SDK do Mercado Pago nao carregou corretamente.");
  }
}

async function loadMercadoPagoSecuritySdk(retryAttempt = 0) {
  if (typeof window === "undefined") return;

  if (resolveMercadoPagoDeviceSessionId()) {
    return;
  }

  if (!mercadoPagoSecuritySdkPromise) {
    mercadoPagoSecuritySdkPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        "script[data-mp-sdk='security-v2']",
      );

      if (existingScript) {
        if (
          resolveMercadoPagoDeviceSessionId() ||
          existingScript.dataset.loaded === "true"
        ) {
          resolve();
          return;
        }

        existingScript.addEventListener(
          "load",
          () => {
            existingScript.dataset.loaded = "true";
            resolve();
          },
          {
            once: true,
          },
        );
        existingScript.addEventListener(
          "error",
          () => reject(new Error("Falha ao carregar modulo de seguranca do Mercado Pago.")),
          { once: true },
        );
        return;
      }

      const script = document.createElement("script");
      const separator = MERCADO_PAGO_SECURITY_SDK_URL.includes("?")
        ? "&"
        : "?";
      script.src = `${MERCADO_PAGO_SECURITY_SDK_URL}${separator}flowdesk_device_retry=${Date.now()}_${retryAttempt}`;
      script.async = true;
      script.defer = true;
      script.dataset.mpSdk = "security-v2";
      script.setAttribute("view", "checkout");
      script.setAttribute("output", "flowdeskDeviceSessionId");
      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = () =>
        reject(new Error("Falha ao carregar modulo de seguranca do Mercado Pago."));
      document.head.appendChild(script);
    });
  }

  try {
    await mercadoPagoSecuritySdkPromise;
    await waitForMercadoPagoDeviceSessionId(12000);
  } catch (error) {
    mercadoPagoSecuritySdkPromise = null;

    if (resolveMercadoPagoDeviceSessionId()) {
      return;
    }

    document
      .querySelector<HTMLScriptElement>("script[data-mp-sdk='security-v2']")
      ?.remove();

    window.MP_DEVICE_SESSION_ID = undefined;
    window.flowdeskDeviceSessionId = undefined;

    if (retryAttempt >= 1) {
      throw error;
    }

    await loadMercadoPagoSecuritySdk(retryAttempt + 1);
  }
}

function resolveMercadoPagoDeviceSessionId() {
  if (typeof window === "undefined") return null;

  try {
    const storedSessionId = window.sessionStorage.getItem(
      MERCADO_PAGO_DEVICE_SESSION_STORAGE_KEY,
    );
    if (
      storedSessionId &&
      /^[a-zA-Z0-9:_-]{8,200}$/.test(storedSessionId.trim())
    ) {
      return storedSessionId.trim();
    }
  } catch {
    // ignorar falha de storage local
  }

  const candidates = [
    window.MP_DEVICE_SESSION_ID,
    window.flowdeskDeviceSessionId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim();
    if (!normalized) continue;
    if (!/^[a-zA-Z0-9:_-]{8,200}$/.test(normalized)) continue;

    try {
      window.sessionStorage.setItem(
        MERCADO_PAGO_DEVICE_SESSION_STORAGE_KEY,
        normalized,
      );
    } catch {
      // ignorar falha de storage local
    }

    return normalized;
  }

  return null;
}

async function waitForMercadoPagoDeviceSessionId(timeoutMs = 12000) {
  if (typeof window === "undefined") return null;

  const startedAt = Date.now();

  return new Promise<string>((resolve, reject) => {
    const tick = () => {
      const sessionId = resolveMercadoPagoDeviceSessionId();
      if (sessionId) {
        resolve(sessionId);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            "Nao foi possivel validar a identificacao segura do dispositivo.",
          ),
        );
        return;
      }

      window.setTimeout(tick, 120);
    };

    tick();
  });
}

function formatDocumentInput(value: string) {
  const digits = normalizeBrazilDocumentDigits(value);

  if (digits.length <= 11) {
    const p1 = digits.slice(0, 3);
    const p2 = digits.slice(3, 6);
    const p3 = digits.slice(6, 9);
    const p4 = digits.slice(9, 11);

    if (digits.length <= 3) return p1;
    if (digits.length <= 6) return `${p1}.${p2}`;
    if (digits.length <= 9) return `${p1}.${p2}.${p3}`;
    return `${p1}.${p2}.${p3}-${p4}`;
  }

  const c1 = digits.slice(0, 2);
  const c2 = digits.slice(2, 5);
  const c3 = digits.slice(5, 8);
  const c4 = digits.slice(8, 12);
  const c5 = digits.slice(12, 14);

  if (digits.length <= 2) return c1;
  if (digits.length <= 5) return `${c1}.${c2}`;
  if (digits.length <= 8) return `${c1}.${c2}.${c3}`;
  if (digits.length <= 12) return `${c1}.${c2}.${c3}/${c4}`;
  return `${c1}.${c2}.${c3}/${c4}-${c5}`;
}

function normalizePersonName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isValidPersonName(value: string) {
  const normalized = normalizePersonName(value);
  if (normalized.length < 2) return false;
  const words = normalized.split(" ").filter(Boolean);
  return words.length >= 1 && words.every((word) => word.length >= 2);
}

function normalizeCardDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 19);
}

function detectCardBrand(cardDigits: string): CardBrand {
  if (!cardDigits) return null;

  if (ELO_PREFIXES.some((prefix) => cardDigits.startsWith(prefix))) {
    return "elo";
  }

  if (/^3[47]/.test(cardDigits)) return "amex";
  if (/^(50|5[1-5]|2[2-7])/.test(cardDigits)) return "mastercard";
  if (/^4/.test(cardDigits)) return "visa";
  return null;
}

function cardNumberLengthsForBrand(brand: CardBrand) {
  switch (brand) {
    case "amex":
      return [15];
    case "mastercard":
    case "elo":
      return [16];
    case "visa":
      return [13, 16, 19];
    default:
      return [13, 14, 15, 16, 17, 18, 19];
  }
}

function isCardNumberComplete(cardDigits: string, brand: CardBrand) {
  if (!cardDigits) return false;
  const lengths = cardNumberLengthsForBrand(brand);
  return lengths.includes(cardDigits.length);
}

function isLuhnValid(cardDigits: string) {
  let sum = 0;
  let shouldDouble = false;

  for (let index = cardDigits.length - 1; index >= 0; index -= 1) {
    let digit = Number(cardDigits[index]);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function isCardNumberValid(cardDigits: string, brand: CardBrand) {
  if (!brand) return false;
  if (!isCardNumberComplete(cardDigits, brand)) return false;
  return isLuhnValid(cardDigits);
}

function formatCardNumberInput(value: string) {
  const digits = normalizeCardDigits(value);
  const brand = detectCardBrand(digits);

  if (brand === "amex") {
    const g1 = digits.slice(0, 4);
    const g2 = digits.slice(4, 10);
    const g3 = digits.slice(10, 15);
    return [g1, g2, g3].filter(Boolean).join(" ");
  }

  const groups = digits.match(/.{1,4}/g) || [];
  return groups.join(" ");
}

function normalizeCardExpiryDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

function formatCardExpiryInput(value: string) {
  const digits = normalizeCardExpiryDigits(value);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
}

function isValidCardExpiry(value: string) {
  const digits = normalizeCardExpiryDigits(value);
  if (digits.length !== 4) return false;

  const month = Number(digits.slice(0, 2));
  const year = Number(digits.slice(2, 4)) + 2000;
  if (month < 1 || month > 12) return false;

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  if (year < currentYear) return false;
  if (year === currentYear && month < currentMonth) return false;
  return true;
}

function normalizeCardCvv(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

function normalizeBrazilZipDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

function formatBrazilZipCode(value: string) {
  const digits = normalizeBrazilZipDigits(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
}

function isValidBrazilZipCode(value: string) {
  return /^\d{8}$/.test(normalizeBrazilZipDigits(value));
}

function summarizeMercadoPagoStatusDetail(
  statusDetail: string | null | undefined,
  providerStatus: string | null | undefined,
) {
  const detail = statusDetail?.trim().toLowerCase() || "";
  const status = providerStatus?.trim().toLowerCase() || "";
  const key = detail || status;

  if (!key) return null;

  switch (key) {
    case "cc_rejected_insufficient_amount":
      return "saldo insuficiente";
    case "cc_rejected_bad_filled_card_number":
      return "numero do cartao invalido";
    case "cc_rejected_bad_filled_date":
      return "data de validade invalida";
    case "cc_rejected_bad_filled_security_code":
      return "codigo de seguranca invalido";
    case "cc_rejected_bad_filled_other":
      return "dados do cartao invalidos";
    case "cc_rejected_call_for_authorize":
      return "autorizacao necessaria no banco";
    case "cc_rejected_card_disabled":
      return "cartao desabilitado";
    case "cc_rejected_duplicated_payment":
      return "pagamento duplicado";
    case "cc_rejected_high_risk":
      return "recusado na analise antifraude do emissor";
    case "cc_rejected_invalid_installments":
      return "parcelamento invalido";
    case "cc_rejected_max_attempts":
      return "limite de tentativas excedido";
    case "cc_rejected_blacklist":
      return "pagamento bloqueado na analise de risco";
    case "cc_rejected_other_reason":
      return "recusado pelo banco emissor";
    case "pending_contingency":
      return "em analise de seguranca";
    case "pending_review_manual":
      return "em revisao manual";
    case "pending_waiting_payment":
      return "aguardando pagamento";
    case "pending_waiting_transfer":
      return "aguardando compensacao";
    case "cancelled":
    case "canceled":
      return "cancelado no provedor";
    case "expired":
      return "prazo expirado";
    default: {
      const compact = key.replace(/[_\s]+/g, " ").trim();
      if (!compact) return null;
      if (compact.length <= 46) return compact;
      return `${compact.slice(0, 43)}...`;
    }
  }
}

function resolveOrderDiagnostic(order: PixOrder | null | undefined) {
  if (!order) return null;

  return resolvePaymentDiagnostic({
    paymentMethod: order.method,
    status: order.status,
    providerStatus: order.providerStatus,
    providerStatusDetail: order.providerStatusDetail,
  });
}

function resolveDiagnosticOriginLabel(category: PaymentDiagnosticCategory | null) {
  switch (category) {
    case "issuer":
      return "Origem: banco emissor";
    case "antifraud":
      return "Origem: analise antifraude";
    case "checkout_closed":
      return "Origem: checkout encerrado";
    case "checkout_failed":
      return "Origem: checkout interrompido";
    case "validation":
      return "Origem: validacao dos dados";
    case "duplicate":
      return "Origem: tentativa duplicada";
    case "timeout":
      return "Origem: prazo expirado";
    case "processing":
      return "Origem: confirmacao em andamento";
    case "provider":
      return "Origem: provedor de pagamento";
    default:
      return "Origem: analise do pagamento";
  }
}

function resolveDiagnosticToneClass(category: PaymentDiagnosticCategory | null) {
  switch (category) {
    case "issuer":
    case "antifraud":
    case "checkout_closed":
    case "checkout_failed":
    case "validation":
      return "border-[#DB4646] bg-[rgba(219,70,70,0.08)] text-[#F0A1A1]";
    case "timeout":
    case "duplicate":
      return "border-[#F2C823] bg-[rgba(242,200,35,0.08)] text-[#F3DD7A]";
    case "processing":
      return "border-[#3C3C3C] bg-[rgba(216,216,216,0.05)] text-[#D8D8D8]";
    default:
      return "border-[#2E2E2E] bg-[rgba(216,216,216,0.04)] text-[#C9C9C9]";
  }
}

function paymentStatusLabel(order: PixOrder | null | undefined) {
  const status = order?.status || "pending";
  const method = order?.method || "pix";
  const reason = summarizeMercadoPagoStatusDetail(
    order?.providerStatusDetail || null,
    order?.providerStatus || null,
  );

  switch (status) {
    case "approved":
      return method === "trial" ? "Plano gratuito ativado" : "Pagamento aprovado";
    case "pending":
      if (method === "trial") {
        return "Ativacao gratuita em andamento";
      }
      if (method === "card") {
        return reason
          ? `Pagamento em analise: ${reason}`
          : "Pagamento em analise: aguardando confirmacao do emissor";
      }
      return reason ? `Pagamento pendente: ${reason}` : "Pagamento pendente";
    case "cancelled":
      return reason
        ? method === "card"
          ? `Checkout cancelado: ${reason}`
          : `Pagamento cancelado: ${reason}`
        : method === "card"
          ? "Checkout cancelado"
          : "Pagamento cancelado";
    case "rejected":
      return reason
        ? `Pagamento nao aprovado: ${reason}`
        : "Pagamento nao aprovado";
    case "expired":
      return reason ? `Pagamento expirado: ${reason}` : "Pagamento expirado";
    case "failed":
      return reason
        ? method === "card"
          ? `Falha ao concluir checkout: ${reason}`
          : `Falha no pagamento: ${reason}`
        : method === "card"
          ? "Falha ao concluir checkout"
          : "Falha no pagamento";
    default:
      return reason ? `Pagamento pendente: ${reason}` : "Pagamento pendente";
  }
}

function resolveHostedCardReturnFallbackOrder(input: {
  order: PixOrder | null;
  returnStatus: string | null;
}) {
  const { order, returnStatus } = input;
  if (!order) return null;
  if (order.method !== "card") return null;
  if (order.status !== "pending") return null;
  if (order.providerPaymentId) return null;
  if (
    returnStatus !== "pending" &&
    returnStatus !== "cancelled" &&
    returnStatus !== "rejected" &&
    returnStatus !== "failed"
  ) {
    return null;
  }

  const nextStatus =
    returnStatus === "pending" ? "cancelled" : returnStatus;
  const providerStatusDetail =
    returnStatus === "pending"
      ? "checkout_returned_without_payment_confirmation"
      : returnStatus === "cancelled"
        ? "checkout_cancelled_by_user"
        : returnStatus === "rejected"
          ? "checkout_rejected_before_provider_confirmation"
          : "checkout_failed_before_provider_confirmation";

  return {
    ...order,
    status: nextStatus,
    providerStatus: nextStatus,
    providerStatusDetail,
    updatedAt: new Date().toISOString(),
  } satisfies PixOrder;
}

function resolveDocumentStatus(digits: string): ValidationStatus {
  if (!digits) return "idle";
  const type = resolveBrazilDocumentType(digits);

  if (!type) {
    if (digits.length < 11 || (digits.length > 11 && digits.length < 14)) {
      return "idle";
    }
    return "invalid";
  }

  return isValidBrazilDocument(digits) ? "valid" : "invalid";
}

function resolveInputBorderClass(hasInputError: boolean, status: ValidationStatus) {
  if (hasInputError || status === "invalid") return "border-[#DB4646]";
  return "border-[#2E2E2E]";
}

function ValidationIndicator({
  status,
  brand = null,
}: {
  status: ValidationStatus;
  brand?: CardBrand;
}) {
  if (status === "validating") {
    return (
      <span className="inline-flex h-[20px] w-[20px] items-center justify-center">
        <ButtonLoader size={14} colorClassName="text-[#D8D8D8]" />
      </span>
    );
  }

  if (status === "invalid") {
    return (
      <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] text-[#DB4646]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    );
  }

  if (brand) {
    return (
      <span className="relative block h-[24px] w-[42px]">
        <Image src={BRAND_ICON_BY_TYPE[brand]} alt={brand.toUpperCase()} fill sizes="42px" className="object-contain" />
      </span>
    );
  }

  if (status === "valid") {
    return (
      <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] text-[#D8D8D8]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 12 4 4 10-10" />
      </svg>
    );
  }

  return null;
}

function CheckoutLegalText({ className }: { className: string }) {
  return (
    <p className={className}>
      PIX continua interno no Flowdesk. Cartao, Google Pay, NuPay e PayPal usam
      a camada segura do Mercado Pago, com tokenizacao, antifraude e retorno
      protegido do checkout.
      <br />
      Ao continuar com a confirmacao do pagamento, voce declara que concorda com nossos{" "}
      <Link
        href={TERMS_PATH}
        className="underline decoration-[#2E2E2E] underline-offset-4 hover:text-white"
      >
        termos
      </Link>{" "}
      e a{" "}
      <Link
        href={PRIVACY_PATH}
        className="underline decoration-[#2E2E2E] underline-offset-4 hover:text-white"
      >
        politica de privacidade
      </Link>
      .
    </p>
  );
}

function PaymentMethodChevron({
  disabled = false,
  expanded = false,
}: {
  disabled?: boolean;
  expanded?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={`h-[18px] w-[18px] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        expanded ? "rotate-180" : "rotate-0"
      } ${disabled ? "text-[#4E4E4E]" : "text-[#AFAFAF]"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 7.5 5 5 5-5" />
    </svg>
  );
}

function PixRailWordmark() {
  return (
    <span className="inline-flex items-center gap-[8px]">
      <span className="relative h-[22px] w-[22px] shrink-0">
        <Image
          src="/cdn/icons/pix_.png"
          alt="PIX"
          fill
          sizes="22px"
          className="object-contain"
        />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.03em] text-[#DDFCF4]">
        PIX
      </span>
    </span>
  );
}

function CardBrandCluster() {
  return (
    <div className="flex items-center gap-[8px] opacity-80">
      <Image
        src="/cdn/icons/card_visa.svg"
        alt="Visa"
        width={36}
        height={12}
        className="h-[12px] w-auto object-contain"
      />
      <Image
        src="/cdn/icons/card_mastercard.svg"
        alt="Mastercard"
        width={24}
        height={18}
        className="h-[18px] w-auto object-contain"
      />
      <Image
        src="/cdn/icons/card_amex.svg"
        alt="American Express"
        width={42}
        height={14}
        className="h-[14px] w-auto object-contain"
      />
      <Image
        src="/cdn/icons/card_elo.svg"
        alt="Elo"
        width={24}
        height={16}
        className="h-[16px] w-auto object-contain"
      />
    </div>
  );
}

function HostedPaymentWordmark({
  rail,
}: {
  rail: Exclude<CheckoutRail, "pix">;
}) {
  if (rail === "google_pay") {
    return (
      <span className="inline-flex items-center gap-[2px] text-[15px] font-semibold tracking-[-0.03em]">
        <span className="text-[#4285F4]">G</span>
        <span className="text-[#DB4437]">o</span>
        <span className="text-[#F4B400]">o</span>
        <span className="text-[#4285F4]">g</span>
        <span className="text-[#0F9D58]">l</span>
        <span className="text-[#DB4437]">e</span>
        <span className="ml-[4px] text-[#E8E8E8]">Pay</span>
      </span>
    );
  }

  if (rail === "nupay") {
    return (
      <span className="inline-flex items-center gap-[4px] text-[15px] font-semibold tracking-[-0.03em] text-[#B987FF]">
        <span>Nu</span>
        <span className="text-[#F1E7FF]">Pay</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-[4px] text-[15px] font-semibold tracking-[-0.03em]">
      <span className="text-[#0070E0]">Pay</span>
      <span className="text-[#62B0FF]">Pal</span>
    </span>
  );
}

function PaymentMethodRow({
  label,
  description,
  active = false,
  expanded = false,
  disabled = false,
  onClick,
  leading,
  trailing,
}: {
  label: string;
  description: string;
  active?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  leading?: ReactNode;
  trailing: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[78px] w-full items-center justify-between gap-[16px] border px-[22px] py-[16px] text-left transition-[border-color,background-color,opacity,transform] ${
        expanded
          ? "rounded-t-[22px] rounded-b-none border-b-transparent"
          : "rounded-[22px]"
      } ${
        active
          ? expanded
            ? "border-[#323232] bg-[#101010]"
            : "border-[#323232] bg-[#101010] shadow-[0_22px_60px_rgba(0,0,0,0.16)]"
          : "border-[#1C1C1C] bg-[#0B0B0B] hover:border-[#2B2B2B] hover:bg-[#101010]"
      } disabled:cursor-not-allowed disabled:opacity-45`}
    >
      <span className="flex min-w-0 items-center gap-[14px]">
        {leading ? (
          <span className="relative flex h-[24px] w-[24px] shrink-0 items-center justify-center">
            {leading}
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="block text-[18px] font-medium tracking-[-0.03em] text-[#F1F1F1]">
            {label}
          </span>
          <span className="mt-[4px] block text-[12px] leading-[1.55] text-[#8A8A8A]">
            {description}
          </span>
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-[12px]">{trailing}</span>
    </button>
  );
}

function MethodSelectorPanel({
  className,
  onChoosePix,
  onStartPixFlow,
  onTogglePixTerms,
  onSelectHostedRail,
  methodMessage,
  canInteract,
  cardEnabled,
  selectedRail,
  pixTermsAccepted,
  view,
}: MethodSelectorPanelProps) {
  const isPixExpanded = selectedRail === "pix";
  const isPixDetailsStage = view === "methods";
  const isPixIdentityStage = view === "pix_form";
  const canStartPixFlow = canInteract && pixTermsAccepted && !isPixIdentityStage;

  return (
    <div className={`${className} flowdesk-stage-fade`}>
      <div className="space-y-[12px]">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#7A7A7A]">
          Metodos de pagamento
        </p>

        <div className={isPixExpanded ? "overflow-hidden rounded-[22px] shadow-[0_22px_60px_rgba(0,0,0,0.16)]" : undefined}>
          <PaymentMethodRow
            label="PIX via QR Code"
            description="Gere o QR Code dentro da Flowdesk e pague em segundos."
            active={selectedRail === "pix"}
            expanded={isPixExpanded}
            disabled={!canInteract}
            onClick={onChoosePix}
            trailing={
              <>
                <PixRailWordmark />
                <PaymentMethodChevron
                  disabled={!canInteract}
                  expanded={selectedRail === "pix"}
                />
              </>
            }
          />

          <div
            className={`grid overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isPixExpanded
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div
              className={`min-h-0 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                isPixExpanded ? "translate-y-0" : "-translate-y-[10px]"
              }`}
            >
              <div className="-mt-px rounded-b-[22px] border-x border-b border-[#323232] bg-[#101010] px-[22px] pb-[20px] pt-[6px]">
              <label className="flex items-start gap-[12px] border-t border-[#191919] pt-[16px]">
                <input
                  type="checkbox"
                  checked={pixTermsAccepted}
                  onChange={(event) => onTogglePixTerms(event.currentTarget.checked)}
                  className="mt-[4px] h-[18px] w-[18px] shrink-0 rounded-[5px] border border-[#353535] bg-transparent accent-[#D8D8D8]"
                />
                <span className="text-[14px] leading-[1.7] text-[#CFCFCF]">
                  Ao continuar com o PIX, voce concorda com nossos{" "}
                  <Link
                    href={TERMS_PATH}
                    className="underline decoration-[#5A5A5A] underline-offset-4 hover:text-white"
                  >
                    Termos
                  </Link>{" "}
                  e a nossa{" "}
                  <Link
                    href={PRIVACY_PATH}
                    className="underline decoration-[#5A5A5A] underline-offset-4 hover:text-white"
                  >
                    Politica de Privacidade
                  </Link>
                  .
                </span>
              </label>

              {isPixDetailsStage ? (
                <button
                  type="button"
                  onClick={onStartPixFlow}
                  disabled={!canStartPixFlow}
                  className="mt-[18px] inline-flex h-[56px] items-center justify-center rounded-[16px] bg-[linear-gradient(180deg,#0062FF_0%,#0153D5_100%)] px-[18px] text-[16px] font-semibold text-white transition-transform duration-150 ease-out hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Enviar pagamento
                </button>
              ) : (
                <div className="mt-[18px] border-t border-[#191919] pt-[16px] text-[14px] leading-[1.65] text-[#BEBEBE]">
                  Continue neste mesmo card para confirmar nome completo e CPF antes
                  de gerar o QR Code PIX.
                </div>
              )}

              <div className="mt-[16px] grid gap-[10px] border-t border-[#191919] pt-[16px] text-[14px] text-[#D5D5D5]">
                <div className="flex items-center gap-[10px]">
                  <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#171717] text-[#D8D8D8]">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      className="h-[12px] w-[12px]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m4.5 10 2.7 2.7L15.5 4.5" />
                    </svg>
                  </span>
                  <span>Pagamento instantaneo e liberacao automatica apos confirmacao.</span>
                </div>
                <div className="flex items-center gap-[10px]">
                  <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#171717] text-[#D8D8D8]">
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      className="h-[12px] w-[12px]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M10 3.8 5.4 5.9v3.8c0 2.9 1.8 5.5 4.6 6.6 2.8-1.1 4.6-3.7 4.6-6.6V5.9L10 3.8Z" />
                      <path d="m8.3 9.8 1.2 1.2 2.3-2.5" />
                    </svg>
                  </span>
                  <span>Transacao criptografada e protegida dentro do ambiente Flowdesk.</span>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>

        <PaymentMethodRow
          label="Cartao"
          description="Checkout dedicado com cartao sera liberado em seguida."
          disabled
          trailing={
            <>
              <CardBrandCluster />
              <span className="rounded-full border border-[#252525] bg-[#111111] px-[10px] py-[6px] text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8D8D8D]">
                {CARD_PAYMENTS_COMING_SOON_BADGE}
              </span>
            </>
          }
        />

        <PaymentMethodRow
          label="Google Pay"
          description="Pagamento seguro pela camada hospedada."
          active={selectedRail === "google_pay"}
          disabled={!canInteract || !cardEnabled}
          onClick={() => onSelectHostedRail("google_pay")}
          trailing={
            <>
              <HostedPaymentWordmark rail="google_pay" />
              <PaymentMethodChevron
                disabled={!canInteract || !cardEnabled}
                expanded={selectedRail === "google_pay"}
              />
            </>
          }
        />

        <PaymentMethodRow
          label="Nubank"
          description="Continue com NuPay pelo checkout protegido."
          active={selectedRail === "nupay"}
          disabled={!canInteract || !cardEnabled}
          onClick={() => onSelectHostedRail("nupay")}
          trailing={
            <>
              <HostedPaymentWordmark rail="nupay" />
              <PaymentMethodChevron
                disabled={!canInteract || !cardEnabled}
                expanded={selectedRail === "nupay"}
              />
            </>
          }
        />

        <PaymentMethodRow
          label="PayPal"
          description="Pagamento externo com retorno automatico."
          active={selectedRail === "paypal"}
          disabled={!canInteract || !cardEnabled}
          onClick={() => onSelectHostedRail("paypal")}
          trailing={
            <>
              <HostedPaymentWordmark rail="paypal" />
              <PaymentMethodChevron
                disabled={!canInteract || !cardEnabled}
                expanded={selectedRail === "paypal"}
              />
            </>
          }
        />
      </div>

      {!canInteract ? (
        <div className="mt-[14px] flex items-center justify-center gap-2 text-[12px] text-[#C2C2C2]">
          <ButtonLoader size={14} colorClassName="text-[#C2C2C2]" />
          <span>Aguardando carregamento do pedido</span>
        </div>
      ) : null}

      {methodMessage ? (
        <p className="mt-[14px] text-center text-[12px] leading-[1.7] text-[#C2C2C2]">
          {methodMessage}
        </p>
      ) : null}
    </div>
  );
}

function PixFormPanel({
  className,
  payerDocument,
  payerName,
  payerDocumentStatus,
  payerNameStatus,
  onPayerDocumentChange,
  onPayerNameChange,
  onSubmit,
  onBack,
  isSubmitting,
  canSubmit,
  errorMessage,
  hasInputError,
  errorAnimationTick,
}: PixFormPanelProps) {
  return (
    <div className={`${className} flowdesk-stage-fade`}>
      <div className="inline-flex items-center gap-[10px] rounded-full border border-[#252525] bg-[#111111] px-[12px] py-[7px] text-[11px] font-semibold uppercase tracking-[0.16em] text-[#D9D9D9]">
        <span className="relative h-[16px] w-[16px] shrink-0">
          <Image src="/cdn/icons/pix_.png" alt="PIX" fill sizes="16px" className="object-contain" />
        </span>
        Dados do pagador
      </div>

      <h2 className="mt-[16px] text-[26px] font-semibold tracking-[-0.05em] text-[#F4F4F4]">
        Confirme os dados para gerar seu QR Code
      </h2>
      <p className="mt-[8px] text-[14px] leading-[1.7] text-[#9C9C9C]">
        Vamos usar essas informacoes para emitir o PIX e liberar o QR Code aqui
        no mesmo card do carrinho.
      </p>

      <div className="mt-[20px] flex flex-col gap-[14px]">
        <div key={`payer-name-${errorAnimationTick}`} className={hasInputError ? "flowdesk-input-shake" : undefined}>
          <label className="mb-[8px] block text-[13px] font-medium text-[#CFCFCF]">
            Nome completo
          </label>
          <div className="relative">
            <input type="text" value={payerName} onChange={(event) => onPayerNameChange(event.currentTarget.value)} placeholder="Digite o nome do titular" className={`h-[58px] w-full rounded-[18px] border bg-[#090909] px-[18px] pr-[62px] text-[16px] text-[#F0F0F0] outline-none placeholder:text-[#525252] ${resolveInputBorderClass(hasInputError, payerNameStatus)}`} aria-invalid={hasInputError} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"><ValidationIndicator status={payerNameStatus} /></span>
          </div>
        </div>

        <div key={`payer-document-${errorAnimationTick}`} className={hasInputError ? "flowdesk-input-shake" : undefined}>
          <label className="mb-[8px] block text-[13px] font-medium text-[#CFCFCF]">
            CPF
          </label>
          <div className="relative">
            <input type="text" value={payerDocument} onChange={(event) => onPayerDocumentChange(event.currentTarget.value)} placeholder="000.000.000-00" className={`h-[58px] w-full rounded-[18px] border bg-[#090909] px-[18px] pr-[62px] text-[16px] text-[#F0F0F0] outline-none placeholder:text-[#525252] ${resolveInputBorderClass(hasInputError, payerDocumentStatus)}`} inputMode="numeric" aria-invalid={hasInputError} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"><ValidationIndicator status={payerDocumentStatus} /></span>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <p key={`pix-form-error-${errorAnimationTick}-${errorMessage}`} className="mt-[12px] flowdesk-slide-down text-left text-[12px] leading-[1.6] text-[#DB4646]">
          {errorMessage}
        </p>
      ) : null}

      <button type="button" onClick={onSubmit} disabled={!canSubmit || isSubmitting} className="mt-[18px] flex h-[58px] w-full items-center justify-center rounded-[18px] bg-[linear-gradient(180deg,#0062FF_0%,#0153D5_100%)] text-[16px] font-semibold text-white transition-transform duration-150 ease-out hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45">
        {isSubmitting ? <ButtonLoader size={22} colorClassName="text-white" /> : "Gerar QR Code PIX"}
      </button>

      <button type="button" onClick={onBack} disabled={isSubmitting} className="mt-[12px] w-full text-center text-[12px] text-[#8E8E8E] transition-colors hover:text-[#B5B5B5] disabled:cursor-not-allowed disabled:opacity-50">
        Voltar para formas de pagamento
      </button>

      <div className="mt-[18px] rounded-[18px] border border-[#202020] bg-[#101010] px-[16px] py-[14px] text-[13px] leading-[1.65] text-[#B8B8B8]">
        O QR Code sera gerado imediatamente apos a validacao dos dados. Se quiser
        trocar de metodo, voce pode voltar sem perder o pedido.
      </div>
    </div>
  );
}

function CardFormPanel(props: CardFormPanelProps) {
  const { className, onBack, isSubmitting, errorMessage } = props;
  return (
    <div className={`${className} flowdesk-stage-fade rounded-[30px] border border-[#171717] bg-[linear-gradient(180deg,rgba(12,12,12,0.98)_0%,rgba(8,8,8,0.98)_100%)] p-[22px] shadow-[0_28px_90px_rgba(0,0,0,0.32)] sm:p-[24px]`}>
      <div className="mx-auto mb-[14px] flex h-[64px] w-[64px] items-center justify-center">
        <span className="relative h-[64px] w-[64px]">
          <Image
            src="/cdn/icons/card_.png"
            alt="Cartao"
            fill
            sizes="64px"
            className="object-contain"
          />
        </span>
      </div>

      <h2 className="text-center text-[33px] font-medium text-[#D8D8D8]">
        Checkout seguro com Cartao
      </h2>

      <div className="mt-[25px] h-[2px] w-full bg-[#242424]" />

      <div
        className={`mt-[34px] flex flex-col items-center justify-center rounded-[5px] border border-[#2E2E2E] bg-[#0A0A0A] px-6 py-9 text-center transition-[transform,opacity] duration-300 ${
          isSubmitting ? "flowdesk-panel-glow" : "flowdesk-scale-in-soft"
        }`}
      >
        {isSubmitting ? (
          <ButtonLoader size={30} />
        ) : (
          <span className="text-[14px] font-medium uppercase tracking-[0.18em] text-[#D8D8D8]">
            Checkout seguro
          </span>
        )}
        <p className="mt-[18px] text-[18px] font-medium text-[#D8D8D8]">
          {isSubmitting ? "Redirecionando" : "Preparacao do checkout"}
        </p>
        <p className="mt-[10px] max-w-[410px] text-[13px] leading-[1.65] text-[#9B9B9B]">
          {isSubmitting
            ? "Voce sera levado ao checkout seguro do Mercado Pago para concluir o pagamento com cartao."
            : "Se algo falhar ao abrir o checkout, voce pode voltar para os metodos e tentar novamente em poucos segundos."}
        </p>
      </div>

      {errorMessage ? (
        <p className="mt-[12px] flowdesk-slide-down text-left text-[12px] text-[#DB4646]">
          {errorMessage}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onBack}
        disabled={isSubmitting}
        className="mt-[14px] w-full text-center text-[12px] text-[#8E8E8E] transition-colors hover:text-[#B5B5B5] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Voltar para metodos
      </button>

      <div className="mt-[25px] h-[2px] w-full bg-[#242424]" />

      <CheckoutLegalText className="mt-[25px] hidden text-center text-[12px] leading-[1.6] text-[#949494] min-[1530px]:block" />
    </div>
  );
}

function PixCheckoutPanel({
  className,
  order,
  copied,
  onCopy,
  onBackToMethods,
}: PixCheckoutPanelProps) {
  const [loadedQrImageKey, setLoadedQrImageKey] = useState<string | null>(null);
  const [qrImageErrorKey, setQrImageErrorKey] = useState<string | null>(null);
  const qrCodeDataUri = order?.qrCodeDataUri || null;
  const qrCodeText = order?.qrCodeText || "";
  const hasQrImageError = Boolean(
    qrCodeDataUri && qrImageErrorKey === qrCodeDataUri,
  );
  const isQrImageLoading = Boolean(
    qrCodeDataUri &&
      loadedQrImageKey !== qrCodeDataUri &&
      !hasQrImageError,
  );

  return (
    <div className={`${className} flowdesk-stage-fade`}>
      <div className="flex flex-col gap-[14px] sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-[10px] rounded-full border border-[rgba(14,207,156,0.18)] bg-[rgba(14,207,156,0.08)] px-[12px] py-[7px] text-[11px] font-semibold uppercase tracking-[0.16em] text-[#83E5C7]">
            <span className="relative h-[16px] w-[16px] shrink-0">
              <Image src="/cdn/icons/pix_.png" alt="PIX" fill sizes="16px" className="object-contain" />
            </span>
            QR Code gerado
          </div>
          <h2 className="mt-[16px] text-[26px] font-semibold tracking-[-0.05em] text-[#F4F4F4]">
            Pague com o QR Code ou copie o codigo PIX
          </h2>
          <p className="mt-[8px] max-w-[680px] text-[14px] leading-[1.7] text-[#9C9C9C]">
            Abra o app do seu banco, escaneie o QR Code abaixo ou use o copia e
            cola. A confirmacao aparece automaticamente assim que o pagamento for
            aprovado.
          </p>
        </div>

        <button
          type="button"
          onClick={onBackToMethods}
          className="inline-flex h-[44px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0B0B0B] px-[16px] text-[13px] font-medium text-[#DADADA] transition-colors hover:border-[#2B2B2B] hover:bg-[#111111]"
        >
          Trocar metodo
        </button>
      </div>

      <div className="mt-[22px] rounded-[26px] border border-[#171717] bg-[linear-gradient(180deg,rgba(13,13,13,0.98)_0%,rgba(8,8,8,0.98)_100%)] p-[18px] shadow-[0_20px_70px_rgba(0,0,0,0.22)] sm:p-[22px]">
        <div className="relative mx-auto aspect-square w-full max-w-[360px] overflow-hidden rounded-[24px] border border-[#2E2E2E] bg-[#0A0A0A] p-[18px]">
        {isQrImageLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <ButtonLoader size={34} />
          </div>
        ) : null}

        {!qrCodeDataUri || hasQrImageError ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-[12px] text-[#9A9A9A]">
            QR Code indisponivel no momento. Tente regerar o pagamento se isso continuar.
          </div>
        ) : null}

        {qrCodeDataUri ? (
          <Image
            key={qrCodeDataUri}
            src={qrCodeDataUri}
            alt="QR Code PIX"
            fill
            sizes="(max-width: 1280px) 100vw, 360px"
            onLoad={() => {
              setLoadedQrImageKey(qrCodeDataUri);
              setQrImageErrorKey((current) =>
                current === qrCodeDataUri ? null : current,
              );
            }}
            onError={() => {
              setQrImageErrorKey(qrCodeDataUri);
            }}
            className={`object-cover transition-opacity duration-200 ${
              isQrImageLoading || hasQrImageError ? "opacity-0" : "opacity-100"
            }`}
            unoptimized
          />
        ) : null}
        </div>

        <button type="button" onClick={onCopy} disabled={!qrCodeText} className="mt-[18px] flex h-[58px] w-full items-center rounded-[18px] border border-[#171717] bg-[#0B0B0B] px-5 text-left disabled:cursor-not-allowed disabled:opacity-45" aria-label="Copiar codigo PIX">
          <span className={`truncate pr-2 text-[15px] ${qrCodeText ? "text-[#D8D8D8]" : "text-[#242424]"}`} title={qrCodeText || "Codigo copia e cola indisponivel"}>
            {qrCodeText || "Codigo PIX indisponivel no momento"}
          </span>
          <span className="ml-auto inline-flex items-center justify-center text-[#D8D8D8]">
            <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="10" height="10" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
          </span>
        </button>

        {copied ? <p className="mt-[11px] text-center text-[14px] text-[#D8D8D8]">Codigo copiado</p> : null}

        <div className="mt-[16px] rounded-[18px] border border-[#171717] bg-[#090909] px-[16px] py-[15px]">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#7E7E7E]">
            Copia e cola
          </p>
          <p className="mt-[10px] break-all text-[14px] leading-[1.75] text-[#DEDEDE]">
            {qrCodeText || "Codigo PIX indisponivel no momento"}
          </p>
        </div>

        <div className="mt-[16px] rounded-[18px] border border-[#171C25] bg-[#0E1219] px-[16px] py-[14px] text-[13px] leading-[1.65] text-[#AEB6C3]">
          Se o pagamento nao confirmar na hora, aguarde alguns instantes. A
          Flowdesk atualiza o status automaticamente sem voce precisar sair desta
          pagina.
        </div>
      </div>
    </div>
  );
}

function ApprovedPaymentPanel({
  className,
  order,
  statusMessage,
  redirectDelayMs,
  redirectTargetUrl,
  onContinueNow,
}: {
  className: string;
  order: PixOrder | null;
  statusMessage: string | null;
  redirectDelayMs: number;
  redirectTargetUrl: string;
  onContinueNow: () => void;
}) {
  const initialSeconds = Math.max(1, Math.ceil(redirectDelayMs / 1000));
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(1, Math.ceil(redirectDelayMs / 1000)),
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRemainingSeconds((current) => (current > 1 ? current - 1 : 1));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [initialSeconds]);

  const methodLabel = resolveCompletedPaymentMethodLabel(order?.method);
  const successHeadline =
    order?.method === "trial"
      ? "Sistema ativado com sucesso"
      : "Pagamento efetuado com sucesso";

  return (
    <div className={`${className} flowdesk-stage-fade`}>
      <div className="inline-flex items-center gap-[10px] rounded-full border border-[rgba(14,207,156,0.22)] bg-[rgba(14,207,156,0.1)] px-[12px] py-[7px] text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8EF0D1]">
        <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[rgba(14,207,156,0.18)] text-[#D8FFF1]">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-[11px] w-[11px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m4.5 10 3 3 8-8" />
          </svg>
        </span>
        Confirmado
      </div>

      <h2 className="mt-[16px] text-[28px] font-semibold tracking-[-0.05em] text-[#F4F4F4]">
        {successHeadline}
      </h2>
      <p className="mt-[8px] max-w-[720px] text-[14px] leading-[1.75] text-[#A1A1A1] sm:text-[15px]">
        Sua confirmacao ja foi recebida. Aguarde nesta pagina enquanto a Flowdesk
        finaliza a liberacao do sistema, sincroniza a conta e libera este servidor automaticamente.
      </p>

      <div className="mt-[22px] grid gap-[12px] sm:grid-cols-3">
        <div className="rounded-[20px] border border-[#1E1E1E] bg-[#101010] px-[18px] py-[16px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#727272]">
            Metodo
          </p>
          <p className="mt-[8px] text-[17px] font-semibold text-[#F1F1F1]">
            {methodLabel}
          </p>
        </div>

        <div className="rounded-[20px] border border-[#1E1E1E] bg-[#101010] px-[18px] py-[16px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#727272]">
            Protocolo
          </p>
          <p className="mt-[8px] text-[17px] font-semibold text-[#F1F1F1]">
            #{order?.orderNumber || "-"}
          </p>
        </div>

        <div className="rounded-[20px] border border-[#1E1E1E] bg-[#101010] px-[18px] py-[16px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#727272]">
            Redirecionamento
          </p>
          <p className="mt-[8px] text-[17px] font-semibold text-[#F1F1F1]">
            {remainingSeconds}s
          </p>
        </div>
      </div>

      <div className="mt-[16px] rounded-[22px] border border-[#1C3128] bg-[linear-gradient(180deg,rgba(13,34,24,0.9)_0%,rgba(8,22,16,0.88)_100%)] px-[18px] py-[18px]">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#7FDDBF]">
          Proxima etapa
        </p>
        <p className="mt-[10px] text-[15px] leading-[1.7] text-[#E3F6EF]">
          {statusMessage ||
            "Estamos validando o pagamento e liberando o sistema da conta agora. Nao feche esta tela ate a sincronizacao terminar."}
        </p>
      </div>

      <div className="mt-[18px] flex flex-col gap-[12px] sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onContinueNow}
          className="inline-flex h-[54px] items-center justify-center rounded-[16px] bg-[linear-gradient(180deg,#0062FF_0%,#0153D5_100%)] px-[22px] text-[15px] font-semibold text-white transition-transform duration-150 ease-out hover:scale-[1.01] active:scale-[0.99]"
        >
          Continuar agora
        </button>
        <p className="text-[13px] leading-[1.65] text-[#9B9B9B]">
          Destino: {redirectTargetUrl}
        </p>
      </div>
    </div>
  );
}

export function ConfigStepFour({
  displayName,
  guildId,
  initialPlanCode,
  initialBillingPeriodCode = DEFAULT_PLAN_BILLING_PERIOD_CODE,
  hasExplicitInitialPlan = false,
  forceFreshCheckout = false,
  initialDraft = null,
  onDraftChange,
  onApproved,
}: ConfigStepFourProps) {
  const cardPaymentsEnabled = areCardPaymentsEnabled();
  const initialStepFourDraft = useMemo(
    () =>
      buildStepFourDraft(
        initialDraft,
        initialPlanCode,
        initialBillingPeriodCode,
      ),
    [initialBillingPeriodCode, initialDraft, initialPlanCode],
  );
  const hasInitialStepFourDraft = useMemo(
    () => hasStepFourDraftValues(initialDraft),
    [initialDraft],
  );
  const latestInitialStepFourDraftRef = useRef(initialStepFourDraft);
  const hasInitialStepFourDraftRef = useRef(hasInitialStepFourDraft);
  const paymentPollingInFlightRef = useRef(false);
  const orderBootstrapInFlightRef = useRef(false);
  const trialActivationRedirectTimeoutRef = useRef<number | null>(null);
  const lastHandledCardRedirectKeyRef = useRef(0);
  const lastAutoResolvedPendingCardOrderRef = useRef<number | null>(null);
  const pixAutoRefreshInFlightRef = useRef(false);
  const lastAutoRefreshedPixOrderRef = useRef<number | null>(null);
  const hydratedGuildIdRef = useRef<string | null>(null);
  const forceNewCheckoutRef = useRef(Boolean(forceFreshCheckout));
  const planFinancialStateRef = useRef<{
    recurringEnabled: boolean;
    recurringMethodId: string | null;
  }>({
    recurringEnabled: false,
    recurringMethodId: null,
  });
  const [phase, setPhase] = useState<StepFourPhase>(initialStepFourDraft.phase);
  const [view, setView] = useState<StepFourView>(initialStepFourDraft.view);
  const [selectedRail, setSelectedRail] = useState<CheckoutRail | null>(
    initialStepFourDraft.selectedRail,
  );
  const initialSelectedPlanCode = hasExplicitInitialPlan
    ? initialPlanCode
    : initialStepFourDraft.selectedPlanCode;
  const initialSelectedBillingPeriodCode = hasExplicitInitialPlan
    ? initialBillingPeriodCode
    : initialStepFourDraft.selectedBillingPeriodCode;
  const initialResolvedPlan = useMemo(
    () => ({
      ...resolvePlanPricing(initialSelectedPlanCode, initialSelectedBillingPeriodCode),
      isAvailable: true,
      unavailableReason: null,
    }),
    [initialSelectedBillingPeriodCode, initialSelectedPlanCode],
  );
  const [selectedPlanCode, setSelectedPlanCode] = useState<PlanCode>(
    initialResolvedPlan.code,
  );
  const [selectedBillingPeriodCode, setSelectedBillingPeriodCode] =
    useState<PlanBillingPeriodCode>(initialResolvedPlan.billingPeriodCode);
  const [availablePlans, setAvailablePlans] = useState<PlanSummary[]>([]);
  const [accountPlan, setAccountPlan] = useState<AccountPlanSnapshot | null>(null);
  const [resolvedPlan, setResolvedPlan] = useState<PlanSummary>(
    initialResolvedPlan,
  );
  const [selectedPlanChange, setSelectedPlanChange] = useState<PlanChangeSummary>(
    () => buildFallbackPlanChangeSummary(initialResolvedPlan),
  );
  const [knownFlowPointsBalance, setKnownFlowPointsBalance] = useState(0);
  const [scheduledPlanChange, setScheduledPlanChange] =
    useState<ScheduledPlanChangeSummary | null>(null);
  const [isPlanLoading, setIsPlanLoading] = useState(false);
  const [methodMessage, setMethodMessage] = useState<string | null>(null);
  const [cardRedirectRequestKey, setCardRedirectRequestKey] = useState(0);
  const [pixTermsAccepted, setPixTermsAccepted] = useState(false);
  const [couponCode, setCouponCode] = useState(
    initialStepFourDraft.couponCode || initialStepFourDraft.giftCardCode,
  );
  const [giftCardCode, setGiftCardCode] = useState("");
  const [billingFullName, setBillingFullName] = useState(
    initialStepFourDraft.billingFullName,
  );
  const [billingEmail, setBillingEmail] = useState(initialStepFourDraft.billingEmail);
  const [billingCountry, setBillingCountry] = useState(
    initialStepFourDraft.billingCountry,
  );
  const [billingPostalCode, setBillingPostalCode] = useState(
    initialStepFourDraft.billingPostalCode,
  );
  const [billingRegion, setBillingRegion] = useState(
    initialStepFourDraft.billingRegion,
  );
  const [billingCity, setBillingCity] = useState(initialStepFourDraft.billingCity);
  const [billingAddressLine1, setBillingAddressLine1] = useState(
    initialStepFourDraft.billingAddressLine1,
  );
  const [billingAddressLine2, setBillingAddressLine2] = useState(
    initialStepFourDraft.billingAddressLine2,
  );
  const [discountPreview, setDiscountPreview] =
    useState<DiscountPreviewApiResponse["preview"] | null>(null);
  const [discountMessage, setDiscountMessage] = useState<string | null>(null);
  const [isDiscountLoading, setIsDiscountLoading] = useState(false);
  const [discountRefreshTick, setDiscountRefreshTick] = useState(0);
  const [isCartNoticeDismissed, setIsCartNoticeDismissed] = useState(false);
  const [isDiscountEditorOpen, setIsDiscountEditorOpen] = useState(
    Boolean(initialStepFourDraft.couponCode || initialStepFourDraft.giftCardCode),
  );

  const [payerDocument, setPayerDocument] = useState(initialStepFourDraft.payerDocument);
  const [payerName, setPayerName] = useState(initialStepFourDraft.payerName);
  const [pixDocumentStatus, setPixDocumentStatus] = useState<ValidationStatus>("idle");
  const [pixNameStatus, setPixNameStatus] = useState<ValidationStatus>("idle");
  const [isSubmittingPix, setIsSubmittingPix] = useState(false);
  const [pixFormError, setPixFormError] = useState<string | null>(null);
  const [pixFormHasInputError, setPixFormHasInputError] = useState(false);
  const [pixFormErrorAnimationTick, setPixFormErrorAnimationTick] = useState(0);
  const [isSubmittingTrial, setIsSubmittingTrial] = useState(false);

  const [cardNumber, setCardNumber] = useState(initialStepFourDraft.cardNumber);
  const [cardHolderName, setCardHolderName] = useState(initialStepFourDraft.cardHolderName);
  const [cardExpiry, setCardExpiry] = useState(initialStepFourDraft.cardExpiry);
  const [cardCvv, setCardCvv] = useState(initialStepFourDraft.cardCvv);
  const [cardDocument, setCardDocument] = useState(initialStepFourDraft.cardDocument);
  const [cardBillingZipCode, setCardBillingZipCode] = useState(
    initialStepFourDraft.cardBillingZipCode,
  );
  const [cardNumberStatus, setCardNumberStatus] = useState<ValidationStatus>("idle");
  const [cardHolderStatus, setCardHolderStatus] = useState<ValidationStatus>("idle");
  const [cardExpiryStatus, setCardExpiryStatus] = useState<ValidationStatus>("idle");
  const [cardCvvStatus, setCardCvvStatus] = useState<ValidationStatus>("idle");
  const [cardDocumentStatus, setCardDocumentStatus] = useState<ValidationStatus>("idle");
  const [cardBillingZipCodeStatus, setCardBillingZipCodeStatus] =
    useState<ValidationStatus>("idle");
  const [cardFormError, setCardFormError] = useState<string | null>(null);
  const [cardFormHasInputError, setCardFormHasInputError] = useState(false);
  const [cardFormErrorAnimationTick, setCardFormErrorAnimationTick] = useState(0);
  const [isSubmittingCard, setIsSubmittingCard] = useState(false);
  const [cardClientCooldownUntil, setCardClientCooldownUntil] = useState<number | null>(null);
  const [cardClientCooldownRemainingSeconds, setCardClientCooldownRemainingSeconds] =
    useState<number | null>(null);

  const [pixOrder, setPixOrder] = useState<PixOrder | null>(null);
  const [lastKnownOrderNumber, setLastKnownOrderNumber] = useState<number | null>(
    initialStepFourDraft.lastKnownOrderNumber,
  );
  const [copied, setCopied] = useState(false);
  const [isLoadingOrder, setIsLoadingOrder] = useState(true);
  const [isPreparingBaseOrder, setIsPreparingBaseOrder] = useState(false);
  const [isCancellingPendingCard, setIsCancellingPendingCard] = useState(false);

  useEffect(() => {
    if (forceFreshCheckout) {
      forceNewCheckoutRef.current = true;
    }
  }, [forceFreshCheckout]);

  const documentDigits = useMemo(() => normalizeBrazilDocumentDigits(payerDocument), [payerDocument]);
  const cardDocumentDigits = useMemo(() => normalizeBrazilDocumentDigits(cardDocument), [cardDocument]);
  const cardNumberDigits = useMemo(() => normalizeCardDigits(cardNumber), [cardNumber]);
  const cardBrand = useMemo(() => detectCardBrand(cardNumberDigits), [cardNumberDigits]);
  const cardExpiryDigits = useMemo(() => normalizeCardExpiryDigits(cardExpiry), [cardExpiry]);
  const cardCvvDigits = useMemo(() => normalizeCardCvv(cardCvv), [cardCvv]);
  const cardBillingZipCodeDigits = useMemo(
    () => normalizeBrazilZipDigits(cardBillingZipCode),
    [cardBillingZipCode],
  );
  const pendingPixOrderId = pixOrder?.status === "pending" ? pixOrder.id : null;
  const pendingPixOrderNumber =
    pixOrder?.status === "pending" ? pixOrder.orderNumber : null;
  const fallbackPlanOptions = useMemo(
    () => decoratePlanSummaries(getAllPlanPricingDefinitions(selectedBillingPeriodCode)),
    [selectedBillingPeriodCode],
  );
  const availablePlanOptions = useMemo(
    () =>
      (availablePlans.length ? availablePlans : fallbackPlanOptions)
        .map((plan) => {
          const isCurrentFallbackSelectionBlocked =
            !availablePlans.length &&
            !!accountPlan &&
            (accountPlan.status === "active" || accountPlan.status === "trial") &&
            accountPlan.planCode === plan.code &&
            accountPlan.billingCycleDays === plan.billingCycleDays &&
            !plan.isTrial;

          return isCurrentFallbackSelectionBlocked
            ? {
                ...plan,
                isAvailable: false,
                unavailableReason:
                  "Seu plano atual ja esta ativo nesta conta. Escolha outro plano para mudar agora.",
              }
            : plan;
        })
        .filter((plan) => plan.isAvailable),
    [accountPlan, availablePlans, fallbackPlanOptions],
  );
  const availableBillingPeriodOptions = useMemo(
    () => getAvailableBillingPeriodsForPlan(selectedPlanCode),
    [selectedPlanCode],
  );
  const activeOrderPlanCode =
    pixOrder?.planCode && isPlanCode(pixOrder.planCode) ? pixOrder.planCode : null;
  const activeOrderBillingCycleDays =
    typeof pixOrder?.planBillingCycleDays === "number" &&
    Number.isFinite(pixOrder.planBillingCycleDays)
      ? pixOrder.planBillingCycleDays
      : null;
  const doesActiveOrderMatchSelectedPlan =
    activeOrderPlanCode !== null &&
    activeOrderPlanCode === selectedPlanCode &&
    activeOrderBillingCycleDays === resolvedPlan.billingCycleDays;
  const cardCooldownMessage = useMemo(
    () => formatCooldownMessage(cardClientCooldownRemainingSeconds),
    [cardClientCooldownRemainingSeconds],
  );
  const baseCheckoutAmount = useMemo(
    () =>
      doesActiveOrderMatchSelectedPlan && typeof pixOrder?.amount === "number"
        ? pixOrder.amount
        : selectedPlanChange.immediateSubtotalAmount,
    [
      doesActiveOrderMatchSelectedPlan,
      pixOrder?.amount,
      selectedPlanChange.immediateSubtotalAmount,
    ],
  );
  const checkoutCurrency = useMemo(
    () =>
      doesActiveOrderMatchSelectedPlan && pixOrder?.currency
        ? pixOrder.currency
        : resolvedPlan.currency || "BRL",
    [doesActiveOrderMatchSelectedPlan, pixOrder?.currency, resolvedPlan.currency],
  );
  const activeDiscountPreview =
    discountPreview ||
    buildFallbackDiscountPreview({
      baseAmount: baseCheckoutAmount,
      currency: checkoutCurrency,
      flowPointsBalance: knownFlowPointsBalance,
    });
  const promoTargetTimestamp = useMemo(
    () => Date.now() + 3 * 24 * 60 * 60 * 1000,
    [],
  );
  const [promoCountdown, setPromoCountdown] = useState(() =>
    formatPromoCountdown(Date.now() + 3 * 24 * 60 * 60 * 1000),
  );

  useEffect(() => {
    setPromoCountdown(formatPromoCountdown(promoTargetTimestamp));
    const intervalId = window.setInterval(() => {
      setPromoCountdown(formatPromoCountdown(promoTargetTimestamp));
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [promoTargetTimestamp]);

  useEffect(() => {
    return () => {
      if (trialActivationRedirectTimeoutRef.current !== null) {
        window.clearTimeout(trialActivationRedirectTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!guildId) {
      setAvailablePlans([]);
      setAccountPlan(null);
      setResolvedPlan(
        resolvePlanSummary(selectedPlanCode, selectedBillingPeriodCode, []),
      );
      setSelectedPlanChange(
        buildFallbackPlanChangeSummary(
          resolvePlanSummary(selectedPlanCode, selectedBillingPeriodCode, []),
        ),
      );
      setScheduledPlanChange(null);
      setKnownFlowPointsBalance(0);
      setIsPlanLoading(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    setIsPlanLoading(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/auth/me/servers/plans?${new URLSearchParams({
            guildId,
            planCode: selectedPlanCode,
            billingPeriodCode: selectedBillingPeriodCode,
            includePaymentMethods: "0",
          }).toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as PlanApiResponse;
        if (!response.ok || !payload.ok || !payload.plan) {
          throw new Error(payload.message || "Nao foi possivel carregar os planos.");
        }

        if (!isMounted) return;

        const nextAvailablePlans = payload.plan.availablePlans || [];
        const nextPlanCode = normalizePlanCode(payload.plan.planCode, selectedPlanCode);
        const nextBillingPeriodCode = normalizePlanBillingPeriodCode(
          payload.plan.billingPeriodCode,
          selectedBillingPeriodCode,
        );
        const nextResolvedPlan = toPlanSummaryFromApi(payload.plan);
        const requestedBasicBecameUnavailable =
          selectedPlanCode === "basic" && nextPlanCode !== "basic";
        planFinancialStateRef.current = {
          recurringEnabled: payload.plan.recurringEnabled,
          recurringMethodId: payload.plan.recurringMethodId,
        };
        setAvailablePlans(nextAvailablePlans);
        setAccountPlan(payload.plan.accountPlan || null);
        setSelectedPlanCode(nextPlanCode);
        setSelectedBillingPeriodCode(nextBillingPeriodCode);
        setResolvedPlan(nextResolvedPlan);
        setSelectedPlanChange(payload.plan.planChange);
        setKnownFlowPointsBalance(
          roundMoney(Math.max(0, payload.plan.planChange.flowPointsBalance)),
        );
        setScheduledPlanChange(payload.plan.scheduledChange);
        if (requestedBasicBecameUnavailable) {
          setMethodMessage(null);
        }
      } catch (error) {
        if (!isMounted) return;
        if (isAbortLikeError(error)) return;
        setAvailablePlans([]);
        setAccountPlan(null);
        const fallbackPlan = resolvePlanSummary(
          selectedPlanCode,
          selectedBillingPeriodCode,
          [],
        );
        setResolvedPlan(fallbackPlan);
        setSelectedPlanChange(
          (current) =>
            buildFallbackPlanChangeSummary(
              fallbackPlan,
              current.flowPointsBalance,
            ),
        );
        setScheduledPlanChange(null);
        setMethodMessage(
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar os planos.",
        );
      } finally {
        if (!isMounted) return;
        setIsPlanLoading(false);
      }
    })();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [guildId, selectedBillingPeriodCode, selectedPlanCode]);

  useEffect(() => {
    if (!guildId || phase !== "cart") return;
    const intervalId = window.setInterval(() => {
      setDiscountRefreshTick((current) => current + 1);
    }, 12_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [guildId, phase]);

  useEffect(() => {
    const localFallbackPreview = buildFallbackDiscountPreview({
      baseAmount: baseCheckoutAmount,
      currency: checkoutCurrency,
      flowPointsBalance: knownFlowPointsBalance,
    });

    if (!guildId) {
      setDiscountPreview(localFallbackPreview);
      setDiscountMessage(null);
      setIsDiscountLoading(false);
      return;
    }

    const trimmedCouponCode = couponCode.trim();
    const trimmedGiftCardCode = giftCardCode.trim();
    const hasManualDiscountCode = Boolean(
      trimmedCouponCode || trimmedGiftCardCode,
    );

    setDiscountPreview((current) =>
      hasManualDiscountCode ? current || localFallbackPreview : localFallbackPreview,
    );
    if (!hasManualDiscountCode) {
      setDiscountMessage(null);
    } else {
      setDiscountMessage(null);
    }
    setIsDiscountLoading(hasManualDiscountCode);

    const controller = new AbortController();
    let abortedByTimeout = false;
    let isActive = true;
    let timeoutId: number | null = null;

    const requestDelayMs = hasManualDiscountCode ? 220 : 0;
    const requestDelayId = window.setTimeout(() => {
      timeoutId = window.setTimeout(() => {
        abortedByTimeout = true;
        controller.abort();
      }, 8000);

      void (async () => {
        try {
          const response = await fetch("/api/auth/me/payments/discount-preview", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              guildId,
              couponCode: trimmedCouponCode,
              giftCardCode: trimmedGiftCardCode,
              baseAmount: baseCheckoutAmount,
              currency: checkoutCurrency,
              planCode: selectedPlanCode,
              billingPeriodCode: selectedBillingPeriodCode,
            }),
            signal: controller.signal,
          });
          const payload = (await response.json()) as DiscountPreviewApiResponse;
          if (!response.ok || !payload.ok || !payload.preview) {
            throw new Error(payload.message || "Nao foi possivel validar os codigos.");
          }

          if (!isActive) return;
          setDiscountPreview(payload.preview);
          setKnownFlowPointsBalance(
            roundMoney(
              Math.max(0, payload.preview.flowPoints?.balanceBefore || 0),
            ),
          );
          setDiscountMessage(
            hasManualDiscountCode ? payload.message || null : null,
          );
        } catch (error) {
          if (!isActive) {
            return;
          }

          if (isAbortLikeError(error)) {
            if (!abortedByTimeout) {
              return;
            }

            if (hasManualDiscountCode) {
              setDiscountMessage("Tempo esgotado ao validar o codigo.");
            }
          } else if (hasManualDiscountCode) {
            setDiscountMessage(
              error instanceof Error
                ? error.message
                : "Nao foi possivel validar o codigo.",
            );
          }

          setDiscountPreview(localFallbackPreview);
        } finally {
          if (!isActive) {
            return;
          }

          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
          }
          setIsDiscountLoading(false);
        }
      })();
    }, requestDelayMs);

    return () => {
      isActive = false;
      controller.abort();
      window.clearTimeout(requestDelayId);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    baseCheckoutAmount,
    checkoutCurrency,
    couponCode,
    giftCardCode,
    guildId,
    discountRefreshTick,
    selectedBillingPeriodCode,
    selectedPlanCode,
  ]);

  useEffect(() => {
    latestInitialStepFourDraftRef.current = initialStepFourDraft;
    hasInitialStepFourDraftRef.current = hasInitialStepFourDraft;
  }, [hasInitialStepFourDraft, initialStepFourDraft]);

  useEffect(() => {
    if (!cardClientCooldownUntil) {
      setCardClientCooldownRemainingSeconds(null);
      return;
    }

    const syncRemaining = () => {
      const nextSeconds = Math.max(
        0,
        Math.ceil((cardClientCooldownUntil - Date.now()) / 1000),
      );
      if (nextSeconds <= 0) {
        setCardClientCooldownUntil(null);
        setCardClientCooldownRemainingSeconds(null);
        return;
      }

      setCardClientCooldownRemainingSeconds(nextSeconds);
    };

    syncRemaining();
    const intervalId = window.setInterval(syncRemaining, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [cardClientCooldownUntil]);

  useEffect(() => {
    if (!guildId) {
      // Se houver mudanca real de contexto de guild para nulo, apenas garantimos a hidratacao do ref
      hydratedGuildIdRef.current = null;
      
      // Nao limpamos os dados do formulario (payerName, etc) se estivermos em um fluxo de 'Pagamento Primeiro'.
      // Mas limpamos se houver um status query de outra guild.
      const checkoutQuery = readCheckoutStatusQuery();
      if (checkoutQuery.guild) {
         clearCheckoutStatusQuery();
      }

      // Se for o render inicial e nao houver guildId, configuramos o modo global mas mantemos os dados do formulário/draft
      if (!isPlanLoading) {
        setView("methods");
        setResolvedPlan(resolvePlanSummary(initialPlanCode, initialBillingPeriodCode, []));
        setIsLoadingOrder(false);
      }
      return;
    }

    if (isPlanLoading) {
      setIsLoadingOrder(true);
      return;
    }

    const activeGuildId = guildId;
    const isNewGuildContext = hydratedGuildIdRef.current !== activeGuildId;
    hydratedGuildIdRef.current = activeGuildId;
    const guildDraft = latestInitialStepFourDraftRef.current;
    const hasStoredDraft = hasInitialStepFourDraftRef.current;
    const activePlanCode = isNewGuildContext
      ? hasExplicitInitialPlan
        ? initialPlanCode
        : guildDraft.selectedPlanCode
      : selectedPlanCode;
    const requestedBillingPeriodCode = isNewGuildContext
      ? hasExplicitInitialPlan
        ? initialBillingPeriodCode
        : guildDraft.selectedBillingPeriodCode
      : selectedBillingPeriodCode;
    const activePlanSummary = resolvePlanPricing(
      activePlanCode,
      requestedBillingPeriodCode,
    );
    const activeBillingPeriodCode = activePlanSummary.billingPeriodCode;
    const requestedPaymentMethod = readRequestedPaymentMethodFromQuery();
    const checkoutQuery = readCheckoutStatusQuery();
    const shouldLoadOrderByCode =
      checkoutQuery.code !== null &&
      (!checkoutQuery.guild || checkoutQuery.guild === activeGuildId);
    if (
      checkoutQuery.code !== null &&
      checkoutQuery.guild &&
      checkoutQuery.guild !== activeGuildId
    ) {
      clearCheckoutStatusQuery();
    }

    const cachedOrder = readCachedOrderByGuild(activeGuildId);
    const cachedOrderPlanCode =
      cachedOrder?.planCode && isPlanCode(cachedOrder.planCode)
        ? cachedOrder.planCode
        : null;
    const cachedOrderPlanBillingCycleDays =
      typeof cachedOrder?.planBillingCycleDays === "number" &&
      Number.isFinite(cachedOrder.planBillingCycleDays)
        ? cachedOrder.planBillingCycleDays
        : null;
    const cachedPendingOrder =
      cachedOrder &&
      cachedOrder.status === "pending" &&
      cachedOrderPlanCode === activePlanCode &&
      cachedOrderPlanBillingCycleDays === activePlanSummary.billingCycleDays
        ? cachedOrder
        : null;

    if (cachedOrder && cachedOrder.status !== "pending") {
      removeCachedOrderByGuild(activeGuildId);
    } else if (
      cachedOrder &&
      (cachedOrderPlanCode !== activePlanCode ||
        cachedOrderPlanBillingCycleDays !== activePlanSummary.billingCycleDays)
    ) {
      removeCachedOrderByGuild(activeGuildId);
    }

    if (isNewGuildContext) {
      setPhase(guildDraft.phase);
      setView(guildDraft.view);
      setSelectedRail(guildDraft.selectedRail);
      setSelectedPlanCode(activePlanCode);
      setSelectedBillingPeriodCode(activeBillingPeriodCode);
      setMethodMessage(null);
      setCouponCode(guildDraft.couponCode || guildDraft.giftCardCode);
      setGiftCardCode("");
      setIsDiscountEditorOpen(Boolean(guildDraft.couponCode || guildDraft.giftCardCode));
      setBillingFullName(guildDraft.billingFullName);
      setBillingEmail(guildDraft.billingEmail);
      setBillingCountry(guildDraft.billingCountry || "Brasil");
      setBillingPostalCode(guildDraft.billingPostalCode);
      setBillingRegion(guildDraft.billingRegion);
      setBillingCity(guildDraft.billingCity);
      setBillingAddressLine1(guildDraft.billingAddressLine1);
      setBillingAddressLine2(guildDraft.billingAddressLine2);
      setDiscountPreview(null);
      setDiscountMessage(null);
      setPayerDocument(guildDraft.payerDocument);
      setPayerName(guildDraft.payerName);
      setCardNumber(guildDraft.cardNumber);
      setCardHolderName(guildDraft.cardHolderName);
      setCardExpiry(guildDraft.cardExpiry);
      setCardCvv(guildDraft.cardCvv);
      setCardDocument(guildDraft.cardDocument);
      setCardBillingZipCode(guildDraft.cardBillingZipCode);
      setCardClientCooldownUntil(null);
      setLastKnownOrderNumber(guildDraft.lastKnownOrderNumber);
      setCopied(false);
      if (cachedPendingOrder) {
        setPixOrder(cachedPendingOrder);
        setLastKnownOrderNumber(cachedPendingOrder.orderNumber);
        setView(
          resolveRestoredView({
            hasStoredDraft,
            preferredView: guildDraft.view,
            order: cachedPendingOrder,
          }),
        );
      } else if (cachedOrder) {
        setPixOrder(null);
        setLastKnownOrderNumber(cachedOrder.orderNumber);
        setView("methods");
        setMethodMessage("Pagamento anterior finalizado. Escolha um novo metodo.");
      }
    }

    let isMounted = true;
    const controller = new AbortController();
    let abortedByTimeout = false;
    const timeoutId = window.setTimeout(() => {
      abortedByTimeout = true;
      controller.abort();
    }, 9000);
    setIsLoadingOrder(true);

    async function loadLatestPixOrder() {
      if (!activeGuildId) {
        setPhase("cart");
        setSelectedRail(null);
        setPixOrder(null);
        setLastKnownOrderNumber(null);
        setView("methods");
        setMethodMessage(null);
        setIsLoadingOrder(false);
        return;
      }

      if (activePlanSummary.isTrial && !shouldLoadOrderByCode) {
        setPhase("cart");
        setSelectedRail(null);
        setPixOrder(null);
        setLastKnownOrderNumber(null);
        setView("methods");
        setMethodMessage(null);
        setIsLoadingOrder(false);
        return;
      }

      if (
        selectedPlanChange.execution === "schedule_for_renewal" &&
        !shouldLoadOrderByCode
      ) {
        setPhase("cart");
        setSelectedRail(null);
        setPixOrder(null);
        setLastKnownOrderNumber(null);
        setView("methods");
        setIsLoadingOrder(false);
        return;
      }

      if (
        selectedPlanChange.execution === "pay_now" &&
        selectedPlanChange.immediateSubtotalAmount <= 0 &&
        !shouldLoadOrderByCode
      ) {
        setPhase("cart");
        setSelectedRail(null);
        setPixOrder(null);
        setLastKnownOrderNumber(null);
        setView("methods");
        setIsLoadingOrder(false);
        return;
      }

      try {
        const shouldForceNewOrder =
          forceNewCheckoutRef.current && !shouldLoadOrderByCode;
        const lookupUrl =
          shouldLoadOrderByCode && checkoutQuery.code !== null
            ? buildPaymentOrderLookupUrl({
                guildId: activeGuildId,
                orderCode: checkoutQuery.code,
                checkoutToken: checkoutQuery.checkoutToken,
                paymentId: checkoutQuery.paymentId,
                paymentRef: checkoutQuery.paymentRef,
                status: checkoutQuery.status,
              })
            : (() => {
                const params = new URLSearchParams({
                  guildId: activeGuildId,
                  planCode: activePlanCode,
                  billingPeriodCode: activeBillingPeriodCode,
                });

                if (shouldForceNewOrder) {
                  params.set("forceNew", "1");
                }

                return `/api/auth/me/payments/pix?${params.toString()}`;
              })();

        const response = await fetch(lookupUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as PixPaymentApiResponse;
        if (!isMounted) return;

        if (
          shouldForceNewOrder &&
          response.ok &&
          payload.ok &&
          payload.order
        ) {
          forceNewCheckoutRef.current = false;
        }

        const remoteOrder =
          response.ok && payload.ok && payload.order ? payload.order : null;
        if (shouldLoadOrderByCode && !remoteOrder) {
          removeCachedOrderByGuild(activeGuildId);
          setPixOrder(null);
          setLastKnownOrderNumber(null);
          setView("methods");
          setMethodMessage(
            response.status === 403
              ? payload.message ||
                  "Este link de pagamento pertence a outra conta autenticada."
              : payload.message ||
                  "Este link de pagamento nao esta mais disponivel.",
          );
          clearCheckoutStatusQuery();
          return;
        }

        if (remoteOrder && remoteOrder.status === "approved") {
          const hasTrackedApprovalContext =
            shouldLoadOrderByCode ||
            (cachedPendingOrder
              ? cachedPendingOrder.orderNumber === remoteOrder.orderNumber
              : false) ||
            (guildDraft.lastKnownOrderNumber
              ? guildDraft.lastKnownOrderNumber === remoteOrder.orderNumber
              : false) ||
            (lastKnownOrderNumber
              ? lastKnownOrderNumber === remoteOrder.orderNumber
              : false);

          if (!hasTrackedApprovalContext) {
            removeCachedOrderByGuild(activeGuildId);
            setPixOrder(null);
            setLastKnownOrderNumber(null);
            setPhase("cart");
            setView("methods");
            setMethodMessage(
              payload.licenseActive
                ? buildActiveLicenseMessage(payload.licenseExpiresAt)
                : "Ja existe um pagamento confirmado nesta conta. Revise o checkout antes de continuar.",
            );
            clearCheckoutStatusQuery();
            return;
          }

          setPixOrder(remoteOrder);
          setLastKnownOrderNumber(remoteOrder.orderNumber);
          setPhase("checkout");
          setView("methods");
          setMethodMessage(
            payload.licenseActive
              ? buildActiveLicenseMessage(payload.licenseExpiresAt)
              : "Pagamento aprovado para a conta.",
          );
          setCheckoutStatusQuery({ order: remoteOrder, guildId: activeGuildId });
          removeCachedOrderByGuild(activeGuildId);
          return;
        }

        if (remoteOrder && remoteOrder.status !== "pending") {
          removeCachedOrderByGuild(activeGuildId);
          setLastKnownOrderNumber(remoteOrder.orderNumber);
          setView("methods");

          if (shouldLoadOrderByCode) {
            setPixOrder(remoteOrder);
            setMethodMessage(null);
            setCheckoutStatusQuery({ order: remoteOrder, guildId: activeGuildId });
          } else {
            setPixOrder(null);
            setMethodMessage("Pagamento anterior finalizado. Escolha um novo metodo.");
            clearCheckoutStatusQuery();
          }
          return;
        }

        const order = remoteOrder || cachedPendingOrder || null;

        const shouldResetCancelledCardReturn =
          shouldLoadOrderByCode &&
          checkoutQuery.status === "cancelled" &&
          order?.method === "card" &&
          order.status === "pending" &&
          !order.providerPaymentId;

        if (shouldResetCancelledCardReturn) {
          removeCachedOrderByGuild(activeGuildId);
          setPixOrder(null);
          setView("methods");
          setMethodMessage("Checkout com cartao cancelado. Escolha outro metodo para continuar.");
          clearCheckoutStatusQuery();
          return;
        }

        if (remoteOrder) {
          writeCachedOrderByGuild(activeGuildId, remoteOrder);
          setLastKnownOrderNumber(remoteOrder.orderNumber);
          clearCheckoutStatusQuery();
        }

        setPixOrder(order);

        if (order?.method === "card" && order.status === "pending") {
          setMethodMessage(
            checkoutQuery.status === "approved"
              ? "Confirmando pagamento aprovado com o Mercado Pago..."
              : "Pagamento com cartao em analise.",
          );
        }

        if (order?.status === "pending") {
          setCheckoutStatusQuery({ order, guildId: activeGuildId });
        }

        const restoredView = resolveRestoredView({
          hasStoredDraft,
          preferredView: guildDraft.view,
          order,
        });

        if (!order && requestedPaymentMethod) {
          if (requestedPaymentMethod === "pix") {
            setView("pix_form");
          } else {
            setView("methods");
            setMethodMessage(
              cardPaymentsEnabled
                ? "Preparando checkout seguro do cartao."
                : CARD_PAYMENTS_DISABLED_MESSAGE,
            );
            if (cardPaymentsEnabled) {
              setCardRedirectRequestKey((current) => current + 1);
            }
          }
        } else {
          setView(restoredView);
        }
      } catch (error) {
        if (!isMounted) return;
        if (isAbortLikeError(error) && !abortedByTimeout) {
          return;
        }

        const fallbackCheckoutOrder = resolveHostedCardReturnFallbackOrder({
          order: cachedPendingOrder,
          returnStatus: shouldLoadOrderByCode ? checkoutQuery.status : null,
        });

        if (fallbackCheckoutOrder) {
          removeCachedOrderByGuild(activeGuildId);
          setPixOrder(fallbackCheckoutOrder);
          setLastKnownOrderNumber(fallbackCheckoutOrder.orderNumber);
          setView("methods");
          setMethodMessage(null);
          setCheckoutStatusQuery({
            order: fallbackCheckoutOrder,
            guildId: activeGuildId,
          });
          return;
        }

        if (shouldLoadOrderByCode && !cachedPendingOrder && !cachedOrder) {
          setPixOrder(null);
          setLastKnownOrderNumber(null);
          setView("methods");
          setMethodMessage(
            "Nao foi possivel validar este link de pagamento nesta conta. Fa�a login na conta que iniciou o pagamento e tente novamente.",
          );
          clearCheckoutStatusQuery();
          return;
        }

        setPixOrder(cachedPendingOrder || null);
        if (cachedPendingOrder) {
          setLastKnownOrderNumber(cachedPendingOrder.orderNumber);
          if (cachedPendingOrder.method === "card") {
            setMethodMessage(
              checkoutQuery.status === "approved"
                ? "Confirmando pagamento aprovado com o Mercado Pago..."
                : "Pagamento com cartao em analise.",
            );
          }
          setView(
            resolveRestoredView({
              hasStoredDraft,
              preferredView: guildDraft.view,
              order: cachedPendingOrder,
            }),
          );
        } else if (cachedOrder) {
          setLastKnownOrderNumber(cachedOrder.orderNumber);
          setView("methods");
          setMethodMessage("Pagamento anterior finalizado. Escolha um novo metodo.");
        } else {
          if (requestedPaymentMethod === "pix") {
            setView("pix_form");
          } else if (requestedPaymentMethod === "card") {
            setView("methods");
            setMethodMessage(
              cardPaymentsEnabled
                ? "Preparando checkout seguro do cartao."
                : CARD_PAYMENTS_DISABLED_MESSAGE,
            );
            if (cardPaymentsEnabled) {
              setCardRedirectRequestKey((current) => current + 1);
            }
          } else {
            setView("methods");
          }
        }
      } finally {
        if (!isMounted) return;
        window.clearTimeout(timeoutId);
        setIsLoadingOrder(false);
      }
    }

    void loadLatestPixOrder();

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    cardPaymentsEnabled,
    guildId,
    hasExplicitInitialPlan,
    initialBillingPeriodCode,
    initialPlanCode,
    isPlanLoading,
    lastKnownOrderNumber,
    selectedPlanChange.execution,
    selectedPlanChange.immediateSubtotalAmount,
    selectedBillingPeriodCode,
    selectedPlanCode,
  ]);

  useEffect(() => {
    if (!guildId || isLoadingOrder) return;

    onDraftChange?.(guildId, {
      visited: true,
      phase,
      view,
      selectedRail,
      selectedPlanCode,
      selectedBillingPeriodCode,
      lastKnownOrderNumber,
      couponCode,
      giftCardCode: "",
      payerDocument,
      payerName,
      billingFullName,
      billingEmail,
      billingCountry,
      billingPostalCode,
      billingRegion,
      billingCity,
      billingAddressLine1,
      billingAddressLine2,
      cardNumber,
      cardHolderName,
      cardExpiry,
      cardCvv,
      cardDocument,
      cardBillingZipCode,
    });
  }, [
    cardBillingZipCode,
    cardCvv,
    cardDocument,
    cardExpiry,
    cardHolderName,
    cardNumber,
    couponCode,
    giftCardCode,
    guildId,
    isLoadingOrder,
    lastKnownOrderNumber,
    onDraftChange,
    payerDocument,
    payerName,
    phase,
    selectedRail,
    selectedBillingPeriodCode,
    selectedPlanCode,
    billingAddressLine1,
    billingAddressLine2,
    billingCity,
    billingCountry,
    billingEmail,
    billingFullName,
    billingPostalCode,
    billingRegion,
    view,
  ]);

  useEffect(() => {
    if (!guildId) return;
    if (isLoadingOrder || isPreparingBaseOrder || isPlanLoading) return;
    if (resolvedPlan.isTrial) return;
    if (!resolvedPlan.isAvailable) return;
    if (selectedPlanChange.execution === "schedule_for_renewal") return;
    if (
      selectedPlanChange.execution === "pay_now" &&
      activeDiscountPreview.totalAmount <= 0
    ) {
      return;
    }
    if (pixOrder?.orderNumber || lastKnownOrderNumber) return;
    if (pixOrder) return;
    if (view !== "methods" && view !== "pix_form") return;
    if (isSubmittingPix || isSubmittingCard || isCancellingPendingCard) return;
    if (orderBootstrapInFlightRef.current) return;

    orderBootstrapInFlightRef.current = true;
    setIsPreparingBaseOrder(true);

    const controller = new AbortController();
    let abortedByTimeout = false;
    const timeoutId = window.setTimeout(() => {
      abortedByTimeout = true;
      controller.abort();
    }, 7000);

    void (async () => {
      try {
        const shouldForceNewOrder = forceNewCheckoutRef.current;
        const params = new URLSearchParams({
          guildId,
          planCode: selectedPlanCode,
          billingPeriodCode: selectedBillingPeriodCode,
        });
        if (shouldForceNewOrder) {
          params.set("forceNew", "1");
        }

        const response = await fetch(
          `/api/auth/me/payments/pix?${params.toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as PixPaymentApiResponse;
        if (!response.ok || !payload.ok || !payload.order) {
          throw new Error(
            payload.message ||
              "Nao foi possivel preparar o pedido inicial de pagamento.",
          );
        }

        setPixOrder(payload.order);
        setLastKnownOrderNumber(payload.order.orderNumber);
        writeCachedOrderByGuild(guildId, payload.order);
        if (shouldForceNewOrder) {
          forceNewCheckoutRef.current = false;
        }
      } catch (error) {
        if (isAbortLikeError(error) && !abortedByTimeout) {
          return;
        }

        const message =
          parseUnknownErrorMessage(error) ||
          "Nao foi possivel preparar o pedido inicial de pagamento.";

        if (view === "pix_form") {
          setPixFormHasInputError(false);
          setPixFormError(message);
          setPixFormErrorAnimationTick((current) => current + 1);
        } else {
          setMethodMessage(message);
        }
      } finally {
        window.clearTimeout(timeoutId);
        orderBootstrapInFlightRef.current = false;
        setIsPreparingBaseOrder(false);
      }
    })();

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
      orderBootstrapInFlightRef.current = false;
    };
  }, [
    guildId,
    isCancellingPendingCard,
    isPlanLoading,
    isLoadingOrder,
    isPreparingBaseOrder,
    isSubmittingCard,
    isSubmittingPix,
    lastKnownOrderNumber,
    pixOrder,
    pixOrder?.orderNumber,
    resolvedPlan.isAvailable,
    resolvedPlan.isTrial,
    activeDiscountPreview.totalAmount,
    selectedPlanChange.execution,
    selectedBillingPeriodCode,
    selectedPlanCode,
    view,
    onApproved,
  ]);

  useEffect(() => {
    if (!pendingPixOrderId || !pendingPixOrderNumber) return;
    if (!guildId) return;
    const activeGuildId = guildId;
    const activeOrderCode = pendingPixOrderNumber;
    const checkoutQuery = readCheckoutStatusQuery();
    const checkoutReturnStatus = checkoutQuery.status;
    const shouldUseFastCardPolling =
      pixOrder?.method === "card" && checkoutReturnStatus === "approved";
    const pollingIntervalMs = shouldUseFastCardPolling ? 2500 : 8000;
    let isMounted = true;
    let activeController: AbortController | null = null;

    const pollLatestOrder = async () => {
      if (paymentPollingInFlightRef.current) return;

      paymentPollingInFlightRef.current = true;
      activeController = new AbortController();
      const timeoutId = window.setTimeout(() => {
        activeController?.abort();
      }, 7000);

      try {
        const queryParams = new URLSearchParams({
          guildId: activeGuildId,
          code: String(activeOrderCode),
        });
        if (pixOrder?.checkoutAccessToken) {
          queryParams.set("checkoutToken", pixOrder.checkoutAccessToken);
        }
        const lookupUrl =
          pixOrder?.method === "card"
            ? buildPaymentOrderLookupUrl({
                guildId: activeGuildId,
                orderCode: activeOrderCode,
                checkoutToken: pixOrder?.checkoutAccessToken || null,
                paymentId: checkoutQuery.paymentId,
                paymentRef: checkoutQuery.paymentRef,
                status: checkoutReturnStatus,
              })
            : `/api/auth/me/payments/pix?${queryParams.toString()}`;
        const response = await fetch(
          lookupUrl,
          {
            cache: "no-store",
            signal: activeController.signal,
          },
        );
        const payload = (await response.json()) as PixPaymentApiResponse;
        if (!isMounted || !response.ok || !payload.ok || !payload.order) return;

        setPixOrder(payload.order);
        setLastKnownOrderNumber(payload.order.orderNumber);
        writeCachedOrderByGuild(activeGuildId, payload.order);

        if (payload.order.status && payload.order.status !== "pending") {
          removeCachedOrderByGuild(activeGuildId);
          if (payload.order.method === "pix" && payload.order.status === "expired") {
            setView("pix_checkout");
            setMethodMessage("O PIX anterior venceu. Atualizando a cobranca...");
            clearCheckoutStatusQuery();
          } else {
            setView("methods");
          }

          if (payload.order.status === "approved") {
            setMethodMessage(
              payload.licenseActive
                ? buildActiveLicenseMessage(payload.licenseExpiresAt)
                : "Pagamento aprovado para a conta.",
            );
            setCheckoutStatusQuery({ order: payload.order, guildId: activeGuildId });
            if (onApproved) {
              onApproved(payload.order);
            }
          } else if (payload.order.method === "card") {
            setMethodMessage(null);
            setCheckoutStatusQuery({ order: payload.order, guildId: activeGuildId });
          } else if (payload.order.status !== "expired") {
            clearCheckoutStatusQuery();
          }
        } else if (payload.order.method === "card") {
          setMethodMessage(
            shouldUseFastCardPolling
              ? "Confirmando pagamento aprovado com o Mercado Pago..."
              : "Pagamento com cartao em analise.",
          );
        }
      } catch {
        // polling silencioso
      } finally {
        window.clearTimeout(timeoutId);
        paymentPollingInFlightRef.current = false;
      }
    };

    void pollLatestOrder();

    const intervalId = window.setInterval(() => {
      void pollLatestOrder();
    }, pollingIntervalMs);

    return () => {
      isMounted = false;
      activeController?.abort();
      paymentPollingInFlightRef.current = false;
      window.clearInterval(intervalId);
    };
  }, [
    guildId,
    pendingPixOrderId,
    pendingPixOrderNumber,
    pixOrder?.checkoutAccessToken,
    pixOrder?.method,
    pixOrder?.status,
    onApproved,
  ]);

  useEffect(() => {
    if (!documentDigits) {
      setPixDocumentStatus("idle");
      return;
    }

    setPixDocumentStatus("validating");
    const timeoutId = window.setTimeout(() => {
      setPixDocumentStatus(resolveDocumentStatus(documentDigits));
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [documentDigits]);

  useEffect(() => {
    const normalized = normalizePersonName(payerName);
    if (!normalized) {
      setPixNameStatus("idle");
      return;
    }

    setPixNameStatus("validating");
    const timeoutId = window.setTimeout(() => {
      setPixNameStatus(isValidPersonName(normalized) ? "valid" : "invalid");
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [payerName]);

  useEffect(() => {
    if (!cardNumberDigits) {
      setCardNumberStatus("idle");
      return;
    }

    setCardNumberStatus("validating");
    const timeoutId = window.setTimeout(() => {
      if (!cardBrand) {
        setCardNumberStatus(cardNumberDigits.length >= 13 ? "invalid" : "idle");
        return;
      }

      if (!isCardNumberComplete(cardNumberDigits, cardBrand)) {
        setCardNumberStatus("idle");
        return;
      }

      setCardNumberStatus(isCardNumberValid(cardNumberDigits, cardBrand) ? "valid" : "invalid");
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cardBrand, cardNumberDigits]);

  useEffect(() => {
    const normalized = normalizePersonName(cardHolderName);
    if (!normalized) {
      setCardHolderStatus("idle");
      return;
    }

    setCardHolderStatus("validating");
    const timeoutId = window.setTimeout(() => {
      setCardHolderStatus(isValidPersonName(normalized) ? "valid" : "invalid");
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cardHolderName]);

  useEffect(() => {
    if (!cardExpiryDigits) {
      setCardExpiryStatus("idle");
      return;
    }

    setCardExpiryStatus("validating");
    const timeoutId = window.setTimeout(() => {
      if (cardExpiryDigits.length < 4) {
        setCardExpiryStatus("idle");
        return;
      }
      setCardExpiryStatus(isValidCardExpiry(cardExpiry) ? "valid" : "invalid");
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cardExpiry, cardExpiryDigits]);

  useEffect(() => {
    if (!cardCvvDigits) {
      setCardCvvStatus("idle");
      return;
    }

    setCardCvvStatus("validating");
    const timeoutId = window.setTimeout(() => {
      const requiredLength = cardBrand === "amex" ? 4 : 3;
      if (cardCvvDigits.length < requiredLength) {
        setCardCvvStatus("idle");
        return;
      }

      if (cardCvvDigits.length !== requiredLength) {
        setCardCvvStatus("invalid");
        return;
      }

      setCardCvvStatus(/^\d+$/.test(cardCvvDigits) ? "valid" : "invalid");
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cardBrand, cardCvvDigits]);

  useEffect(() => {
    if (!cardDocumentDigits) {
      setCardDocumentStatus("idle");
      return;
    }

    setCardDocumentStatus("validating");
    const timeoutId = window.setTimeout(() => {
      setCardDocumentStatus(resolveDocumentStatus(cardDocumentDigits));
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cardDocumentDigits]);

  useEffect(() => {
    if (!cardBillingZipCodeDigits) {
      setCardBillingZipCodeStatus("idle");
      return;
    }

    setCardBillingZipCodeStatus("validating");
    const timeoutId = window.setTimeout(() => {
      if (cardBillingZipCodeDigits.length < 8) {
        setCardBillingZipCodeStatus("idle");
        return;
      }

      setCardBillingZipCodeStatus(
        isValidBrazilZipCode(cardBillingZipCodeDigits) ? "valid" : "invalid",
      );
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cardBillingZipCodeDigits]);

  const canSubmitPix = useMemo(() => {
    return Boolean(
      guildId &&
        (pixOrder?.orderNumber || lastKnownOrderNumber) &&
        !isLoadingOrder &&
        !isPreparingBaseOrder &&
        pixDocumentStatus === "valid" &&
        pixNameStatus === "valid" &&
        !isSubmittingPix,
    );
  }, [
    guildId,
    isLoadingOrder,
    isPreparingBaseOrder,
    isSubmittingPix,
    lastKnownOrderNumber,
    pixDocumentStatus,
    pixNameStatus,
    pixOrder?.orderNumber,
  ]);

  const canSubmitCard = useMemo(() => {
    return Boolean(
      cardPaymentsEnabled &&
        guildId &&
        (pixOrder?.orderNumber || lastKnownOrderNumber) &&
        !isLoadingOrder &&
        !isPreparingBaseOrder &&
        cardBrand &&
        cardNumberStatus === "valid" &&
        cardHolderStatus === "valid" &&
        cardExpiryStatus === "valid" &&
        cardCvvStatus === "valid" &&
        cardDocumentStatus === "valid" &&
        cardBillingZipCodeStatus === "valid" &&
        !isSubmittingCard,
    );
  }, [
    cardBillingZipCodeStatus,
    cardBrand,
    cardDocumentStatus,
    cardExpiryStatus,
    cardHolderStatus,
    cardNumberStatus,
    cardPaymentsEnabled,
    cardCvvStatus,
    guildId,
    isLoadingOrder,
    isPreparingBaseOrder,
    isSubmittingCard,
    lastKnownOrderNumber,
    pixOrder?.orderNumber,
  ]);

  const paymentStatus = pixOrder?.status || "pending";
  const resolvedOrderNumber = pixOrder?.orderNumber || lastKnownOrderNumber || null;
  const activeCheckoutQuery =
    typeof window !== "undefined"
      ? readCheckoutStatusQuery()
      : {
          code: null as number | null,
          status: null as string | null,
          guild: null as string | null,
          checkoutToken: null as string | null,
          paymentId: null as string | null,
          paymentRef: null as string | null,
        };
  const currentPaymentStatusLabel = paymentStatusLabel(pixOrder);
  const orderDiagnostic = resolveOrderDiagnostic(pixOrder);
  const isHostedCardApprovalAwaitingConfirmation = Boolean(
    pixOrder &&
      pixOrder.method === "card" &&
      pixOrder.status === "pending" &&
      activeCheckoutQuery.status === "approved",
  );
  const canChoosePaymentMethod = Boolean(
    guildId &&
      !isLoadingOrder &&
      !isPreparingBaseOrder &&
      !!resolvedOrderNumber &&
      !isSubmittingCard &&
      !isCancellingPendingCard &&
      !isHostedCardApprovalAwaitingConfirmation,
  );
  const shouldShowStatusResultPanel = Boolean(
    view === "methods" &&
      pixOrder &&
      (paymentStatus !== "pending" || pixOrder.method === "card"),
  );
  const shouldShowApprovedConfirmationPanel = Boolean(
    phase === "checkout" &&
      shouldShowStatusResultPanel &&
      pixOrder &&
      paymentStatus === "approved",
  );
  const canManuallyCancelPendingCard = Boolean(
    guildId &&
      pixOrder &&
      pixOrder.method === "card" &&
      pixOrder.status === "pending",
  );
  const shouldShowCardRecoveryActions = Boolean(
    guildId &&
      shouldShowStatusResultPanel &&
      pixOrder &&
      pixOrder.method === "card" &&
      (paymentStatus === "rejected" ||
        paymentStatus === "cancelled" ||
        paymentStatus === "failed" ||
        paymentStatus === "expired"),
  );
  const diagnosticOriginLabel = resolveDiagnosticOriginLabel(
    orderDiagnostic?.category || null,
  );
  const diagnosticToneClass = resolveDiagnosticToneClass(
    orderDiagnostic?.category || null,
  );
  const statusStageKey = useMemo(() => {
    if (view === "card_form") {
      return `card-redirect-${isSubmittingCard ? "live" : "idle"}-${cardRedirectRequestKey}`;
    }

    if (shouldShowStatusResultPanel && pixOrder) {
      return `status-${pixOrder.method}-${pixOrder.status}-${resolvedOrderNumber ?? "none"}`;
    }

    return `view-${view}-${resolvedOrderNumber ?? "none"}`;
  }, [
    cardRedirectRequestKey,
    isSubmittingCard,
    pixOrder,
    resolvedOrderNumber,
    shouldShowStatusResultPanel,
    view,
  ]);
  const isPlanSelectionLocked = Boolean(
    isPlanLoading ||
      isSubmittingTrial ||
      isSubmittingPix ||
      isSubmittingCard ||
      isCancellingPendingCard,
  );

  useEffect(() => {
    replaceCurrentPlanPath(selectedPlanCode, selectedBillingPeriodCode);
  }, [selectedBillingPeriodCode, selectedPlanCode]);

  useEffect(() => {
    if (!shouldShowStatusResultPanel) return;
    if (paymentStatus !== "approved") return;
    if (!resolvedOrderNumber) return;

    if (hasApprovedOrderBeenAutoRedirected(resolvedOrderNumber)) {
      return;
    }

    const redirectConfig = resolveApprovedRedirectConfig(guildId);

    const timeoutId = window.setTimeout(() => {
      markApprovedOrderAutoRedirected(resolvedOrderNumber);
      window.location.assign(redirectConfig.targetUrl);
    }, redirectConfig.delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [guildId, paymentStatus, resolvedOrderNumber, shouldShowStatusResultPanel]);

  const triggerPixFormValidationError = useCallback((message: string) => {
    setPixFormError(message);
    setPixFormHasInputError(true);
    setPixFormErrorAnimationTick((current) => current + 1);
  }, []);

  const triggerCardFormValidationError = useCallback((message: string) => {
    setCardFormError(message);
    setCardFormHasInputError(true);
    setCardFormErrorAnimationTick((current) => current + 1);
  }, []);

  const handleActiveLicenseCheckoutBlock = useCallback(
    (blockedGuildId: string | null, licenseExpiresAt?: string | null) => {
      clearPendingCardRedirectState(blockedGuildId);
      removeCachedOrderByGuild(blockedGuildId);
      clearCheckoutStatusQuery();
      paymentPollingInFlightRef.current = false;
      orderBootstrapInFlightRef.current = false;
      forceNewCheckoutRef.current = false;
      setPixOrder(null);
      setLastKnownOrderNumber(null);
      setPhase("cart");
      setSelectedRail(null);
      setView("methods");
      setCopied(false);
      setMethodMessage(buildActiveLicenseMessage(licenseExpiresAt));
    },
    [],
  );

  const handleCheckoutBack = useCallback(() => {
    if (phase !== "cart") {
      setPhase("cart");
      setSelectedRail(null);
      setView("methods");
      setMethodMessage(null);
      setPixFormHasInputError(false);
      setPixFormError(null);
      setCardFormHasInputError(false);
      setCardFormError(null);
      setCopied(false);
      clearCheckoutStatusQuery();
      return;
    }

    if (typeof window === "undefined") return;

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    const fallbackUrl = (() => {
      try {
        const currentUrl = new URL(window.location.href);
        if (document.referrer) {
          const referrerUrl = new URL(document.referrer);
          if (
            referrerUrl.origin === currentUrl.origin &&
            referrerUrl.href !== currentUrl.href
          ) {
            return buildConfigUrlWithHashRoute(
              referrerUrl.pathname,
              referrerUrl.search,
              referrerUrl.hash,
            );
          }
        }
      } catch {
        // seguir para fallback padrao
      }

      return resolveApprovedRedirectConfig(guildId).targetUrl || "/servers/plans";
    })();

    window.location.assign(fallbackUrl);
  }, [guildId, phase]);

  const handleSelectPlan = useCallback(
    (nextPlanCode: PlanCode) => {
      if (nextPlanCode === selectedPlanCode) return;

      if (isPlanSelectionLocked) {
        setMethodMessage(
          "Aguarde a atualizacao atual terminar antes de trocar o plano.",
        );
        return;
      }

      const nextBillingPeriodOptions = getAvailableBillingPeriodsForPlan(nextPlanCode);
      const nextBillingPeriodCode = nextBillingPeriodOptions.some(
        (period) => period.code === selectedBillingPeriodCode,
      )
        ? selectedBillingPeriodCode
        : nextBillingPeriodOptions[0]?.code || DEFAULT_PLAN_BILLING_PERIOD_CODE;
      const nextPlan = resolvePlanSummary(
        nextPlanCode,
        nextBillingPeriodCode,
        decoratePlanSummaries(getAllPlanPricingDefinitions(nextBillingPeriodCode)),
      );

      if (guildId) {
        clearPendingCardRedirectState(guildId);
        removeCachedOrderByGuild(guildId);
      }

      paymentPollingInFlightRef.current = false;
      orderBootstrapInFlightRef.current = false;
      lastHandledCardRedirectKeyRef.current = 0;
      lastAutoResolvedPendingCardOrderRef.current = null;
      if (trialActivationRedirectTimeoutRef.current !== null) {
        window.clearTimeout(trialActivationRedirectTimeoutRef.current);
        trialActivationRedirectTimeoutRef.current = null;
      }

      setSelectedPlanCode(nextPlanCode);
      setSelectedBillingPeriodCode(nextBillingPeriodCode);
      setResolvedPlan(nextPlan);
      setSelectedPlanChange(
        buildFallbackPlanChangeSummary(nextPlan, knownFlowPointsBalance),
      );
      setScheduledPlanChange(null);
      setPhase("cart");
      setView("methods");
      setSelectedRail(null);
      setPixOrder(null);
      setLastKnownOrderNumber(null);
      setCopied(false);
      setMethodMessage(null);
      setPixFormError(null);
      setPixFormHasInputError(false);
      setCardFormError(null);
      setCardFormHasInputError(false);
      setDiscountPreview(
        buildFallbackDiscountPreview({
          baseAmount: nextPlan.totalAmount,
          currency: nextPlan.currency,
          flowPointsBalance: knownFlowPointsBalance,
        }),
      );
      setDiscountMessage(null);
      clearCheckoutStatusQuery();
    },
    [
      guildId,
      isPlanSelectionLocked,
      knownFlowPointsBalance,
      selectedBillingPeriodCode,
      selectedPlanCode,
    ],
  );

  const handleSelectBillingPeriod = useCallback(
    (nextBillingPeriodCode: PlanBillingPeriodCode) => {
      if (nextBillingPeriodCode === selectedBillingPeriodCode) return;

      if (isPlanSelectionLocked) {
        setMethodMessage(
          "Aguarde a atualizacao atual terminar antes de trocar o periodo.",
        );
        return;
      }

      const allowedBillingPeriods = getAvailableBillingPeriodsForPlan(selectedPlanCode);
      if (!allowedBillingPeriods.some((period) => period.code === nextBillingPeriodCode)) {
        return;
      }

      const nextPlan = resolvePlanSummary(
        selectedPlanCode,
        nextBillingPeriodCode,
        decoratePlanSummaries(getAllPlanPricingDefinitions(nextBillingPeriodCode)),
      );

      if (guildId) {
        clearPendingCardRedirectState(guildId);
        removeCachedOrderByGuild(guildId);
      }

      paymentPollingInFlightRef.current = false;
      orderBootstrapInFlightRef.current = false;
      lastHandledCardRedirectKeyRef.current = 0;
      lastAutoResolvedPendingCardOrderRef.current = null;
      if (trialActivationRedirectTimeoutRef.current !== null) {
        window.clearTimeout(trialActivationRedirectTimeoutRef.current);
        trialActivationRedirectTimeoutRef.current = null;
      }

      setSelectedBillingPeriodCode(nextBillingPeriodCode);
      setResolvedPlan(nextPlan);
      setSelectedPlanChange(
        buildFallbackPlanChangeSummary(nextPlan, knownFlowPointsBalance),
      );
      setScheduledPlanChange(null);
      setPhase("cart");
      setView("methods");
      setSelectedRail(null);
      setPixOrder(null);
      setLastKnownOrderNumber(null);
      setCopied(false);
      setMethodMessage(null);
      setPixFormError(null);
      setPixFormHasInputError(false);
      setCardFormError(null);
      setCardFormHasInputError(false);
      setDiscountPreview(
        buildFallbackDiscountPreview({
          baseAmount: nextPlan.totalAmount,
          currency: nextPlan.currency,
          flowPointsBalance: knownFlowPointsBalance,
        }),
      );
      setDiscountMessage(null);
      clearCheckoutStatusQuery();
    },
    [
      guildId,
      isPlanSelectionLocked,
      knownFlowPointsBalance,
      selectedBillingPeriodCode,
      selectedPlanCode,
    ],
  );

  const handlePayerDocumentChange = useCallback((value: string) => {
    setPayerDocument(formatDocumentInput(value));
    setPixFormHasInputError(false);
    setPixFormError(null);
  }, []);

  const handlePayerNameChange = useCallback((value: string) => {
    setPayerName(value);
    setPixFormHasInputError(false);
    setPixFormError(null);
  }, []);

  const handleCardNumberChange = useCallback((value: string) => {
    setCardNumber(formatCardNumberInput(value));
    setCardFormHasInputError(false);
    setCardFormError(null);
  }, []);

  const handleCardHolderChange = useCallback((value: string) => {
    setCardHolderName(value);
    setCardFormHasInputError(false);
    setCardFormError(null);
  }, []);

  const handleCardExpiryChange = useCallback((value: string) => {
    setCardExpiry(formatCardExpiryInput(value));
    setCardFormHasInputError(false);
    setCardFormError(null);
  }, []);

  const handleCardCvvChange = useCallback((value: string) => {
    setCardCvv(normalizeCardCvv(value));
    setCardFormHasInputError(false);
    setCardFormError(null);
  }, []);

  const handleCardDocumentChange = useCallback((value: string) => {
    setCardDocument(formatDocumentInput(value));
    setCardFormHasInputError(false);
    setCardFormError(null);
  }, []);

  const handleCardBillingZipCodeChange = useCallback((value: string) => {
    setCardBillingZipCode(formatBrazilZipCode(value));
    setCardFormHasInputError(false);
    setCardFormError(null);
  }, []);

  const startCardRedirectCheckout = useCallback(async (surfaceLabel = "cartao") => {
    if (!guildId || isSubmittingCard) return;

    if (pixOrder?.method === "card" && pixOrder.status === "pending") {
      setView("methods");
      setMethodMessage(
        "Ja existe um pagamento com cartao em analise para esta conta. Aguarde o retorno antes de tentar novamente.",
      );
      return;
    }

    setIsSubmittingCard(true);
    setCardFormHasInputError(false);
    setCardFormError(null);
    setMethodMessage(`Redirecionando para o checkout seguro de ${surfaceLabel}.`);

    let redirected = false;

    try {
      const params =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : null;
      const renew =
        params?.get("renew")?.trim() === "1" ||
        params?.get("renew")?.trim()?.toLowerCase() === "true";
      const rawReturnTarget = params?.get("return")?.trim().toLowerCase() || null;
      const returnTarget = rawReturnTarget === "servers" ? "servers" : null;
      const returnGuildId = normalizeGuildIdFromQuery(params?.get("returnGuild") || null);
      const rawReturnTab = params?.get("returnTab");
      const returnTab = rawReturnTab
        ? normalizeServersTabFromQuery(rawReturnTab)
        : null;

      const response = await fetch("/api/auth/me/payments/card/redirect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          planCode: selectedPlanCode,
          billingPeriodCode: selectedBillingPeriodCode,
          couponCode,
          giftCardCode,
          renew,
          returnTarget,
          returnGuildId,
          returnTab,
          forceNew: forceNewCheckoutRef.current,
        }),
      });
      const requestId = resolveResponseRequestId(response);
      const payload = (await response.json()) as CardRedirectApiResponse;

      if (payload.blockedByActiveLicense) {
        handleActiveLicenseCheckoutBlock(guildId, payload.licenseExpiresAt);
        return;
      }

      if (payload.alreadyProcessing) {
        setView("methods");
        setMethodMessage(
          withSupportRequestId(
            payload.message ||
              "Ja existe um pagamento com cartao em analise para esta conta.",
            requestId,
          ),
        );
        return;
      }

      if (!response.ok || !payload.ok || !payload.redirectUrl) {
        throw new Error(
          withSupportRequestId(
            payload.message || "Falha ao preparar checkout com cartao.",
            requestId,
          ),
        );
      }

      if (payload.orderNumber && Number.isInteger(payload.orderNumber)) {
        setLastKnownOrderNumber(payload.orderNumber);
      }

      writePendingCardRedirectState({
        guildId,
        orderNumber:
          payload.orderNumber && Number.isInteger(payload.orderNumber)
            ? payload.orderNumber
            : null,
      });

      forceNewCheckoutRef.current = false;
      redirected = true;
      window.setTimeout(() => {
        window.location.assign(payload.redirectUrl!);
      }, 180);
    } catch (error) {
      const message =
        parseUnknownErrorMessage(error) ||
        "Falha ao preparar checkout com cartao.";

      setCardFormHasInputError(false);
      setCardFormError(message);
      setCardFormErrorAnimationTick((current) => current + 1);
      setMethodMessage(message);
    } finally {
      if (!redirected) {
        clearPendingCardRedirectState(guildId);
        setIsSubmittingCard(false);
      }
    }
  }, [
    couponCode,
    giftCardCode,
    guildId,
    handleActiveLicenseCheckoutBlock,
    isSubmittingCard,
    pixOrder?.method,
    pixOrder?.status,
    selectedBillingPeriodCode,
    selectedPlanCode,
  ]);

  useEffect(() => {
    if (view !== "card_form") return;
    if (cardRedirectRequestKey === 0) return;
    if (!cardPaymentsEnabled) {
      setView("methods");
      setMethodMessage(CARD_PAYMENTS_DISABLED_MESSAGE);
      return;
    }
    if (lastHandledCardRedirectKeyRef.current === cardRedirectRequestKey) {
      return;
    }

    lastHandledCardRedirectKeyRef.current = cardRedirectRequestKey;
    void startCardRedirectCheckout();
  }, [cardPaymentsEnabled, cardRedirectRequestKey, startCardRedirectCheckout, view]);

  const handleChooseMethod = useCallback((method: PaymentMethod) => {
    if (!canChoosePaymentMethod) {
      setMethodMessage("Aguardando o pedido ficar pronto para pagamento.");
      return;
    }

    if (method === "card" && !cardPaymentsEnabled) {
      setView("methods");
      setMethodMessage(CARD_PAYMENTS_DISABLED_MESSAGE);
      return;
    }

    if (guildId) {
      clearPendingCardRedirectState(guildId);
      paymentPollingInFlightRef.current = false;
    }

    setIsLoadingOrder(false);
    setPhase("checkout");
    setIsSubmittingCard(false);
    setMethodMessage(null);
    setPixFormHasInputError(false);
    setPixFormError(null);
    setCardFormHasInputError(false);
    setCardFormError(null);
    setCopied(false);
    clearCheckoutStatusQuery();

    if (method === "pix") {
      if (selectedRail === "pix" && view === "methods") {
        setSelectedRail(null);
        setMethodMessage(null);
        return;
      }
      setSelectedRail("pix");
      setView("methods");
      setMethodMessage(null);
      return;
    }

    setSelectedRail("google_pay");
    setView("card_form");
    setMethodMessage("Preparando checkout seguro do cartao.");
    setCardRedirectRequestKey((current) => current + 1);
  }, [canChoosePaymentMethod, cardPaymentsEnabled, guildId, selectedRail, view]);

  const handleStartPixFlow = useCallback(() => {
    if (!canChoosePaymentMethod) {
      setMethodMessage("Aguardando o pedido ficar pronto para pagamento.");
      return;
    }

    setPhase("checkout");
    setSelectedRail("pix");
    setView("pix_form");
    setMethodMessage(null);
    setPixFormHasInputError(false);
    setPixFormError(null);
  }, [canChoosePaymentMethod]);

  const handleRefreshExpiredPixPayment = useCallback(async () => {
    if (!guildId || pixAutoRefreshInFlightRef.current) {
      return;
    }

    pixAutoRefreshInFlightRef.current = true;
    setMethodMessage("O PIX anterior venceu. Gerando uma nova tentativa segura...");
    setCopied(false);
    setPixFormHasInputError(false);
    setPixFormError(null);

    try {
      const payloadBody: Record<string, unknown> = {
        guildId,
        planCode: selectedPlanCode,
        billingPeriodCode: selectedBillingPeriodCode,
        couponCode,
        giftCardCode,
        forceNew: forceNewCheckoutRef.current,
      };

      const normalizedName = normalizePersonName(payerName);
      const normalizedDocument = normalizeBrazilDocumentDigits(payerDocument);

      if (normalizedName) {
        payloadBody.payerName = normalizedName;
      }

      if (normalizedDocument) {
        payloadBody.payerDocument = normalizedDocument;
      }

      const response = await fetch("/api/auth/me/payments/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadBody),
      });
      const requestId = resolveResponseRequestId(response);
      const payload = (await response.json()) as PixPaymentApiResponse;

      if (payload.blockedByActiveLicense) {
        handleActiveLicenseCheckoutBlock(guildId, payload.licenseExpiresAt);
        return;
      }

      if (!response.ok || !payload.ok || !payload.order) {
        throw new Error(
          withSupportRequestId(
            payload.message || "Nao foi possivel renovar o pagamento PIX.",
            requestId,
          ),
        );
      }

      setPixOrder(payload.order);
      setLastKnownOrderNumber(payload.order.orderNumber);
      writeCachedOrderByGuild(guildId, payload.order);
      forceNewCheckoutRef.current = false;
      setPhase("checkout");
      setSelectedRail("pix");

      if (payload.order.status === "approved") {
        setView("methods");
        setMethodMessage(
          payload.licenseActive
            ? buildActiveLicenseMessage(payload.licenseExpiresAt)
            : "Pagamento aprovado para a conta.",
        );
        setCheckoutStatusQuery({ order: payload.order, guildId });
        if (onApproved) {
          onApproved(payload.order);
        }
      } else if (payload.order.status === "pending" && payload.order.qrCodeText) {
        setView("pix_checkout");
        setMethodMessage(
          "Geramos um novo PIX automaticamente para manter o pagamento valido.",
        );
        setCheckoutStatusQuery({ order: payload.order, guildId });
      } else {
        setView("pix_form");
        setMethodMessage(
          "Atualizamos a tentativa de PIX. Confirme os dados para gerar um novo codigo.",
        );
        clearCheckoutStatusQuery();
      }
    } catch (error) {
      removeCachedOrderByGuild(guildId);
      setView("pix_form");
      setMethodMessage(
        parseUnknownErrorMessage(error) ||
          "Nao foi possivel renovar o PIX automaticamente. Confirme os dados para gerar uma nova tentativa.",
      );
      clearCheckoutStatusQuery();
    } finally {
      pixAutoRefreshInFlightRef.current = false;
    }
  }, [
    couponCode,
    giftCardCode,
    guildId,
    handleActiveLicenseCheckoutBlock,
    payerDocument,
    payerName,
    selectedBillingPeriodCode,
    selectedPlanCode,
    onApproved,
  ]);

  useEffect(() => {
    if (!guildId) return;
    if (view !== "pix_checkout") return;
    if (!pixOrder || pixOrder.method !== "pix") return;
    if (!isPixOrderExpiredOrUnavailable(pixOrder)) return;
    if (lastAutoRefreshedPixOrderRef.current === pixOrder.orderNumber) return;

    lastAutoRefreshedPixOrderRef.current = pixOrder.orderNumber;
    void handleRefreshExpiredPixPayment();
  }, [guildId, handleRefreshExpiredPixPayment, pixOrder, view]);

  const handleActivateTrialPlan = useCallback(async () => {
    if (!guildId || isSubmittingTrial || isPlanLoading || isLoadingOrder) {
      return;
    }

    if (trialActivationRedirectTimeoutRef.current !== null) {
      window.clearTimeout(trialActivationRedirectTimeoutRef.current);
      trialActivationRedirectTimeoutRef.current = null;
    }

    if (guildId) {
      clearPendingCardRedirectState(guildId);
      removeCachedOrderByGuild(guildId);
    }

    paymentPollingInFlightRef.current = false;
    orderBootstrapInFlightRef.current = false;
    lastHandledCardRedirectKeyRef.current = 0;
    lastAutoResolvedPendingCardOrderRef.current = null;

    setIsSubmittingTrial(true);
    setMethodMessage(null);
    setPixOrder(null);
    setLastKnownOrderNumber(null);
    setSelectedRail(null);
    clearCheckoutStatusQuery();

    try {
      const response = await fetch("/api/auth/me/payments/trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          planCode: selectedPlanCode,
          billingPeriodCode: selectedBillingPeriodCode,
        }),
      });
      const requestId = resolveResponseRequestId(response);
      const payload = (await response.json()) as PixPaymentApiResponse & {
        trialActivated?: boolean;
      };

      if (!response.ok || !payload.ok || !payload.order) {
        throw new Error(
          withSupportRequestId(
            payload.message || "Falha ao ativar o plano gratuito.",
            requestId,
          ),
        );
      }

      setPixOrder(payload.order);
      setLastKnownOrderNumber(payload.order.orderNumber);
      writeCachedOrderByGuild(guildId, payload.order);
      setMethodMessage(
        payload.licenseActive
          ? buildActiveLicenseMessage(payload.licenseExpiresAt)
          : payload.reused
            ? "Plano gratuito ja estava ativo nesta conta."
            : "Plano gratuito ativado com sucesso. Redirecionando...",
      );

      if (onApproved) {
        onApproved(payload.order);
      }

      const redirectConfig = resolveApprovedRedirectConfig(guildId);
      trialActivationRedirectTimeoutRef.current = window.setTimeout(() => {
        window.location.assign(redirectConfig.targetUrl);
      }, 1200);
    } catch (error) {
      setMethodMessage(
        parseUnknownErrorMessage(error) ||
          "Falha ao ativar o plano gratuito.",
      );
    } finally {
      setIsSubmittingTrial(false);
    }
  }, [
    guildId,
    isLoadingOrder,
    isPlanLoading,
    isSubmittingTrial,
    selectedBillingPeriodCode,
    selectedPlanCode,
    onApproved,
  ]);

  const handleSchedulePlanChange = useCallback(async () => {
    if (
      !guildId ||
      isPlanLoading ||
      isLoadingOrder ||
      selectedPlanChange.execution !== "schedule_for_renewal"
    ) {
      return;
    }

    if (selectedPlanChange.scheduledChangeMatchesTarget && scheduledPlanChange) {
      setMethodMessage("Essa troca ja esta agendada para o proximo vencimento.");
      return;
    }

    setIsSubmittingTrial(true);
    setMethodMessage(null);

    try {
      const response = await fetch("/api/auth/me/payments/plan-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          planCode: selectedPlanCode,
          billingPeriodCode: selectedBillingPeriodCode,
        }),
      });
      const requestId = resolveResponseRequestId(response);
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        scheduledChange?: ScheduledPlanChangeSummary | null;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(
          withSupportRequestId(
            payload.message || "Nao foi possivel agendar a troca de plano.",
            requestId,
          ),
        );
      }

      setScheduledPlanChange(payload.scheduledChange || null);
      setSelectedPlanChange((current) => ({
        ...current,
        scheduledChangeMatchesTarget: true,
        effectiveAt:
          payload.scheduledChange?.effectiveAt || current.effectiveAt || null,
      }));
      setPhase("cart");
      setView("methods");
      setMethodMessage(
        payload.message ||
          "Troca agendada com sucesso. O plano atual continua ativo ate o fim do ciclo.",
      );
    } catch (error) {
      setMethodMessage(
        parseUnknownErrorMessage(error) ||
          "Nao foi possivel agendar a troca de plano.",
      );
    } finally {
      setIsSubmittingTrial(false);
    }
  }, [
    guildId,
    isLoadingOrder,
    isPlanLoading,
    scheduledPlanChange,
    selectedBillingPeriodCode,
    selectedPlanChange.execution,
    selectedPlanChange.scheduledChangeMatchesTarget,
    selectedPlanCode,
  ]);

  const handleApplyCoveredPlanChange = useCallback(async () => {
    if (
      !guildId ||
      isPlanLoading ||
      isLoadingOrder ||
      activeDiscountPreview.totalAmount > 0
    ) {
      return;
    }

    setIsSubmittingTrial(true);
    setMethodMessage(null);

    try {
      const response = await fetch("/api/auth/me/payments/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          planCode: selectedPlanCode,
          billingPeriodCode: selectedBillingPeriodCode,
          couponCode,
          giftCardCode,
          forceNew: forceNewCheckoutRef.current,
        }),
      });
      const requestId = resolveResponseRequestId(response);
      const payload = (await response.json()) as PixPaymentApiResponse;

      if (!response.ok || !payload.ok || !payload.order) {
        throw new Error(
          withSupportRequestId(
            payload.message || "Nao foi possivel aplicar a troca agora.",
            requestId,
          ),
        );
      }

      setPixOrder(payload.order);
      setLastKnownOrderNumber(payload.order.orderNumber);
      writeCachedOrderByGuild(guildId, payload.order);
      forceNewCheckoutRef.current = false;
      setPhase("checkout");
      setView("methods");
      setMethodMessage(
        payload.licenseActive
          ? buildActiveLicenseMessage(payload.licenseExpiresAt)
          : "Troca aplicada com sucesso usando o credito disponivel da conta.",
      );
      setCheckoutStatusQuery({ order: payload.order, guildId });
      if (onApproved) {
        onApproved(payload.order);
      }
    } catch (error) {
      setMethodMessage(
        parseUnknownErrorMessage(error) ||
          "Nao foi possivel aplicar a troca agora.",
      );
    } finally {
      setIsSubmittingTrial(false);
    }
  }, [
    activeDiscountPreview.totalAmount,
    couponCode,
    giftCardCode,
    guildId,
    isLoadingOrder,
    isPlanLoading,
    selectedBillingPeriodCode,
    selectedPlanCode,
    onApproved,
  ]);

  const handleContinueToCheckout = useCallback(() => {
    if (!resolvedPlan.isAvailable) {
      setMethodMessage(
        resolvedPlan.unavailableReason ||
          "Esse plano nao esta disponivel nesta conta.",
      );
      return;
    }

    if (resolvedPlan.isTrial) {
      void handleActivateTrialPlan();
      return;
    }

    if (selectedPlanChange.execution === "schedule_for_renewal") {
      void handleSchedulePlanChange();
      return;
    }

    if (activeDiscountPreview.totalAmount <= 0) {
      void handleApplyCoveredPlanChange();
      return;
    }

    setPhase("checkout");
    if (view === "methods") {
      setMethodMessage(null);
    }
  }, [
    activeDiscountPreview.totalAmount,
    handleApplyCoveredPlanChange,
    handleActivateTrialPlan,
    handleSchedulePlanChange,
    resolvedPlan.isAvailable,
    resolvedPlan.isTrial,
    resolvedPlan.unavailableReason,
    selectedPlanChange.execution,
    view,
  ]);

  const handleHostedRailSelection = useCallback(
    (rail: Exclude<CheckoutRail, "pix">) => {
      if (!cardPaymentsEnabled) {
        setMethodMessage(CARD_PAYMENTS_DISABLED_MESSAGE);
        return;
      }

      setPhase("checkout");
      setSelectedRail(rail);
      setView("methods");
      void startCardRedirectCheckout(resolveCheckoutRailLabel(rail));
    },
    [cardPaymentsEnabled, startCardRedirectCheckout],
  );

  const handleSubmitPixPayment = useCallback(async () => {
    if (isSubmittingPix) return;
    if (
      !(pixOrder?.orderNumber || lastKnownOrderNumber) ||
      isLoadingOrder ||
      isPreparingBaseOrder
    ) {
      setPixFormHasInputError(false);
      setPixFormError("Aguardando o pedido ficar pronto para gerar o PIX.");
      setPixFormErrorAnimationTick((current) => current + 1);
      return;
    }

    if (pixDocumentStatus !== "valid") {
      triggerPixFormValidationError("CPF/CNPJ invalido. Verifique os digitos e tente novamente.");
      return;
    }

    if (pixNameStatus !== "valid") {
      triggerPixFormValidationError("Nome invalido. Verifique e tente novamente.");
      return;
    }

    const normalizedName = normalizePersonName(payerName);

    setIsSubmittingPix(true);
    setPixFormError(null);
    setPixFormHasInputError(false);
    setMethodMessage(null);

    try {
      const response = await fetch("/api/auth/me/payments/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          planCode: selectedPlanCode,
          billingPeriodCode: selectedBillingPeriodCode,
          couponCode,
          giftCardCode,
          payerDocument: documentDigits,
          payerName: normalizedName,
          forceNew: forceNewCheckoutRef.current,
        }),
      });
      const requestId = resolveResponseRequestId(response);

      const payload = (await response.json()) as PixPaymentApiResponse;

      if (payload.blockedByActiveLicense) {
        handleActiveLicenseCheckoutBlock(guildId, payload.licenseExpiresAt);
        return;
      }

      if (!response.ok || !payload.ok || !payload.order) {
        throw new Error(
          withSupportRequestId(
            payload.message || "Falha ao gerar pagamento PIX.",
            requestId,
          ),
        );
      }

      setPixOrder(payload.order);
      setLastKnownOrderNumber(payload.order.orderNumber);
      writeCachedOrderByGuild(guildId, payload.order);
      forceNewCheckoutRef.current = false;

      if (payload.order.status === "approved") {
        setView("methods");
        setPhase("checkout");
        setMethodMessage(
          payload.licenseActive
            ? buildActiveLicenseMessage(payload.licenseExpiresAt)
            : "Pagamento aprovado para a conta.",
        );
        setCheckoutStatusQuery({ order: payload.order, guildId });
        if (onApproved) {
          onApproved(payload.order);
        }
      } else if (payload.order.status === "pending" && payload.order.qrCodeText) {
        setView("pix_checkout");
        setMethodMessage("QR Code PIX gerado. Finalize o pagamento no card principal.");
        setCheckoutStatusQuery({ order: payload.order, guildId });
      } else if (payload.order.status === "expired") {
        setView("pix_form");
        setMethodMessage(
          "A tentativa anterior venceu. Preencha novamente os dados para gerar um novo PIX.",
        );
        clearCheckoutStatusQuery();
      } else {
        setView("pix_form");
        setMethodMessage(
          "Nao foi possivel liberar um novo PIX valido agora. Tente novamente em instantes.",
        );
        clearCheckoutStatusQuery();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao gerar pagamento PIX.";
      const normalizedMessage = message.toLowerCase();
      const shouldFlagInputError = normalizedMessage.includes("cpf/cnpj") || normalizedMessage.includes("identification number") || normalizedMessage.includes("documento");

      if (shouldFlagInputError) {
        triggerPixFormValidationError("CPF/CNPJ invalido. Verifique os digitos e tente novamente.");
      } else {
        setPixFormHasInputError(false);
        setPixFormError(message);
        setPixFormErrorAnimationTick((current) => current + 1);
      }
    } finally {
      setIsSubmittingPix(false);
    }
  }, [
    couponCode,
    documentDigits,
    giftCardCode,
    guildId,
    handleActiveLicenseCheckoutBlock,
    isLoadingOrder,
    isPreparingBaseOrder,
    isSubmittingPix,
    payerName,
    pixDocumentStatus,
    pixNameStatus,
    lastKnownOrderNumber,
    pixOrder?.orderNumber,
    selectedBillingPeriodCode,
    selectedPlanCode,
    triggerPixFormValidationError,
    onApproved,
  ]);

  const handleSubmitCardPayment = useCallback(async () => {
    if (isSubmittingCard) return;

    if (
      cardClientCooldownUntil &&
      Date.now() < cardClientCooldownUntil
    ) {
      const remainingSeconds = Math.max(
        1,
        Math.ceil((cardClientCooldownUntil - Date.now()) / 1000),
      );
      setCardFormHasInputError(false);
      setCardFormError(
        `Aguarde ${remainingSeconds}s para nova tentativa com cartao.`,
      );
      setCardFormErrorAnimationTick((current) => current + 1);
      return;
    }

    if (pixOrder?.method === "card" && pixOrder.status === "pending") {
      setCardFormHasInputError(false);
      setCardFormError(
        "Ja existe um pagamento com cartao em analise. Aguarde o retorno antes de tentar novamente.",
      );
      setCardFormErrorAnimationTick((current) => current + 1);
      return;
    }

    if (!canSubmitCard) {
      triggerCardFormValidationError("Revise os dados do cartao para continuar com seguranca.");
      return;
    }

    if (!isValidBrazilZipCode(cardBillingZipCodeDigits)) {
      triggerCardFormValidationError(
        "CEP de cobranca invalido para pagamento com cartao.",
      );
      return;
    }

    const documentType = resolveBrazilDocumentType(cardDocumentDigits);
    if (!documentType) {
      triggerCardFormValidationError(
        "CPF/CNPJ invalido para pagamento com cartao.",
      );
      return;
    }

    const publicKey = resolveCardPublicKey();
    if (!publicKey) {
      triggerCardFormValidationError(
        "Chave publica do Mercado Pago nao configurada para cartao.",
      );
      return;
    }

    const fallbackPaymentMethodId = resolveCardPaymentMethodIdFromBrand(cardBrand);
    if (!fallbackPaymentMethodId) {
      triggerCardFormValidationError(
        "Nao foi possivel identificar a bandeira do cartao.",
      );
      return;
    }

    setIsSubmittingCard(true);
    setCardFormError(null);
    setCardFormHasInputError(false);
    setMethodMessage(null);

    try {
      await loadMercadoPagoSdk();
      try {
        await loadMercadoPagoSecuritySdk();
      } catch {
        // Continuar mesmo sem a camada extra do fingerprint pronta.
      }

      if (!window.MercadoPago) {
        throw new Error("SDK do Mercado Pago indisponivel para cartao.");
      }

      const mercadoPago = new window.MercadoPago(publicKey, {
        locale: "pt-BR",
      });
      const deviceSessionId = resolveMercadoPagoDeviceSessionId();

      let tokenPayload: MercadoPagoCardTokenPayload;
      try {
        tokenPayload = await mercadoPago.createCardToken({
          cardNumber: cardNumberDigits,
          cardholderName: normalizePersonName(cardHolderName),
          identificationType: documentType,
          identificationNumber: cardDocumentDigits,
          securityCode: cardCvvDigits,
          cardExpirationMonth: cardExpiryDigits.slice(0, 2),
          cardExpirationYear: `20${cardExpiryDigits.slice(2, 4)}`,
          ...(deviceSessionId
            ? {
                device: {
                  id: deviceSessionId,
                },
              }
            : {}),
        });
      } catch (tokenizationError) {
        throw new Error(
          parseUnknownErrorMessage(tokenizationError) ||
            "Falha ao tokenizar o cartao. Verifique os dados e tente novamente.",
        );
      }

      const cardToken = tokenPayload?.id?.trim() || null;
      if (!cardToken) {
        throw new Error(
          parseMercadoPagoCardTokenError(tokenPayload) ||
            "Falha ao tokenizar o cartao.",
        );
      }

      const paymentMethodId =
        tokenPayload?.payment_method_id?.trim()?.toLowerCase() ||
        fallbackPaymentMethodId;
      const issuerId =
        tokenPayload?.issuer_id !== undefined &&
        tokenPayload?.issuer_id !== null &&
        String(tokenPayload.issuer_id).trim()
          ? String(tokenPayload.issuer_id).trim()
          : null;

      const response = await fetch("/api/auth/me/payments/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          planCode: selectedPlanCode,
          billingPeriodCode: selectedBillingPeriodCode,
          payerName: normalizePersonName(cardHolderName),
          payerDocument: cardDocumentDigits,
          billingZipCode: cardBillingZipCodeDigits,
          cardToken,
          paymentMethodId,
          installments: 1,
          issuerId,
          deviceSessionId,
          forceNew: forceNewCheckoutRef.current,
        }),
      });
      const requestId = resolveResponseRequestId(response);

      const payload = (await response.json()) as PixPaymentApiResponse;
      const retryAfterSeconds = resolveRetryAfterSeconds(response, payload);

      if (payload.blockedByActiveLicense) {
        handleActiveLicenseCheckoutBlock(guildId, payload.licenseExpiresAt);
        return;
      }

      if (!response.ok || !payload.ok || !payload.order) {
        if (retryAfterSeconds) {
          setCardClientCooldownUntil(
            Date.now() + retryAfterSeconds * 1000,
          );
        }
        throw new Error(
          withSupportRequestId(
            payload.message || "Falha ao processar pagamento com cartao.",
            requestId,
          ),
        );
      }

      setPixOrder(payload.order);
      setLastKnownOrderNumber(payload.order.orderNumber);
      writeCachedOrderByGuild(guildId, payload.order);
      forceNewCheckoutRef.current = false;
      setView("methods");
      setCardFormHasInputError(false);
      setCardFormError(null);

      if (
        payload.order.status === "rejected" &&
        retryAfterSeconds &&
        retryAfterSeconds > 0
      ) {
        setCardClientCooldownUntil(Date.now() + retryAfterSeconds * 1000);
      }

      if (payload.order.status === "approved") {
        setMethodMessage(
          payload.licenseActive
            ? buildActiveLicenseMessage(payload.licenseExpiresAt)
            : "Pagamento com cartao aprovado.",
        );
        setCheckoutStatusQuery({ order: payload.order, guildId });
        if (onApproved) {
          onApproved(payload.order);
        }
      } else if (payload.order.status === "pending") {
        setMethodMessage("Pagamento com cartao em analise.");
        setCheckoutStatusQuery({ order: payload.order, guildId });
      } else if (payload.order.status === "rejected") {
        setMethodMessage(
          retryAfterSeconds
            ? `Pagamento com cartao recusado pelo emissor. ${formatCooldownMessage(retryAfterSeconds) || "Aguarde alguns minutos antes de tentar novamente."}`
            : "Pagamento com cartao rejeitado.",
        );
        clearCheckoutStatusQuery();
      } else {
        setMethodMessage("Pagamento com cartao processado.");
        clearCheckoutStatusQuery();
      }
    } catch (error) {
      const message =
        parseUnknownErrorMessage(error) ||
        "Erro inesperado ao processar pagamento com cartao.";

      const normalizedMessage = message.toLowerCase();
      const isRiskOrCooldownMessage =
        normalizedMessage.includes("antifraude") ||
        normalizedMessage.includes("analise de risco") ||
        normalizedMessage.includes("recusado por seguranca") ||
        normalizedMessage.includes("aguarde") ||
        normalizedMessage.includes("retry-after");
      const shouldFlagInputError =
        !isRiskOrCooldownMessage &&
        (normalizedMessage.includes("cartao") ||
          normalizedMessage.includes("card") ||
          normalizedMessage.includes("token") ||
          normalizedMessage.includes("cvv") ||
          normalizedMessage.includes("cvc") ||
          normalizedMessage.includes("expiration") ||
          normalizedMessage.includes("cpf/cnpj") ||
          normalizedMessage.includes("documento") ||
          normalizedMessage.includes("cep"));

      if (shouldFlagInputError) {
        triggerCardFormValidationError(message);
      } else {
        setCardFormHasInputError(false);
        setCardFormError(message);
        setCardFormErrorAnimationTick((current) => current + 1);
      }
    } finally {
      setIsSubmittingCard(false);
    }
  }, [
    canSubmitCard,
    cardBrand,
    cardBillingZipCodeDigits,
    cardCvvDigits,
    cardDocumentDigits,
    cardExpiryDigits,
    cardHolderName,
    cardNumberDigits,
    cardClientCooldownUntil,
    guildId,
    handleActiveLicenseCheckoutBlock,
    isSubmittingCard,
    pixOrder?.method,
    pixOrder?.status,
    selectedBillingPeriodCode,
    selectedPlanCode,
    triggerCardFormValidationError,
    onApproved,
  ]);

  const handleCopyPixCode = useCallback(async () => {
    if (!pixOrder?.qrCodeText) return;

    try {
      await navigator.clipboard.writeText(pixOrder.qrCodeText);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1200);
    } catch {
      setCopied(false);
    }
  }, [pixOrder?.qrCodeText]);

  const handleCancelPendingCardPayment = useCallback(async (options?: {
    preserveCancelledResult?: boolean;
  }) => {
    if (!guildId || !pixOrder || pixOrder.method !== "card" || pixOrder.status !== "pending") {
      return;
    }

    const preserveCancelledResult = options?.preserveCancelledResult ?? true;

    setIsCancellingPendingCard(true);
    setMethodMessage("Cancelando checkout com cartao...");

    try {
      const response = await fetch("/api/auth/me/payments/card/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          orderNumber: pixOrder.orderNumber,
        }),
      });
      const requestId = resolveResponseRequestId(response);
      const payload = (await response.json()) as CardCancelApiResponse;

      if (!response.ok || !payload.ok || !payload.order) {
        throw new Error(
          withSupportRequestId(
            payload.message || "Nao foi possivel cancelar o checkout com cartao.",
            requestId,
          ),
        );
      }

      clearPendingCardRedirectState(guildId);
      removeCachedOrderByGuild(guildId);
      setView("methods");

      if (preserveCancelledResult) {
        setPixOrder(payload.order);
        setLastKnownOrderNumber(payload.order.orderNumber);
        setMethodMessage(null);
        setCheckoutStatusQuery({
          order: payload.order,
          guildId,
        });
      } else {
        setPixOrder(null);
        setLastKnownOrderNumber(null);
        setMethodMessage(
          "Tentativa anterior encerrada porque o checkout externo foi abandonado. Escolha novamente como deseja pagar.",
        );
        clearCheckoutStatusQuery();
      }
    } catch (error) {
      setMethodMessage(
        parseUnknownErrorMessage(error) ||
          "Nao foi possivel cancelar o checkout com cartao.",
      );
    } finally {
      setIsCancellingPendingCard(false);
    }
  }, [guildId, pixOrder]);

  useEffect(() => {
    if (!guildId) return;

    const checkoutQuery = readCheckoutStatusQuery();
    const hasFinalProviderCallbackContext =
      Boolean(checkoutQuery.paymentId) ||
      checkoutQuery.status === "approved" ||
      checkoutQuery.status === "cancelled" ||
      checkoutQuery.status === "rejected" ||
      checkoutQuery.status === "failed" ||
      checkoutQuery.status === "expired";

    if (hasFinalProviderCallbackContext) {
      clearPendingCardRedirectState(guildId);
      return;
    }

    if (!pixOrder || pixOrder.method !== "card" || pixOrder.status !== "pending") {
      clearPendingCardRedirectState(guildId);
      return;
    }

    if (pixOrder.providerPaymentId) {
      clearPendingCardRedirectState(guildId);
      return;
    }

    const pendingRedirectState = readPendingCardRedirectState(guildId);
    if (!pendingRedirectState) return;

    if (
      pendingRedirectState.orderNumber &&
      pendingRedirectState.orderNumber !== pixOrder.orderNumber
    ) {
      clearPendingCardRedirectState(guildId);
      return;
    }

    const shouldAutoReset =
      Date.now() - pendingRedirectState.startedAt >= 2500;

    if (!shouldAutoReset) return;
    if (lastAutoResolvedPendingCardOrderRef.current === pixOrder.orderNumber) return;

    const resolveManualReturn = () => {
      if (document.visibilityState !== "visible") return;
      lastAutoResolvedPendingCardOrderRef.current = pixOrder.orderNumber;
      void handleCancelPendingCardPayment({
        preserveCancelledResult: false,
      });
    };

    resolveManualReturn();

    window.addEventListener("focus", resolveManualReturn);
    window.addEventListener("pageshow", resolveManualReturn);
    document.addEventListener("visibilitychange", resolveManualReturn);

    return () => {
      window.removeEventListener("focus", resolveManualReturn);
      window.removeEventListener("pageshow", resolveManualReturn);
      document.removeEventListener("visibilitychange", resolveManualReturn);
    };
  }, [guildId, handleCancelPendingCardPayment, pixOrder]);

  useEffect(() => {
    if (!guildId) return;

    const resolveManualHostedCheckoutReturn = () => {
      if (document.visibilityState !== "visible") return;

      const pendingRedirectState = readPendingCardRedirectState(guildId);
      if (!pendingRedirectState) return;

      const checkoutQuery = readCheckoutStatusQuery();
      const hasFinalProviderCallbackContext =
        Boolean(checkoutQuery.paymentId) ||
        checkoutQuery.status === "approved" ||
        checkoutQuery.status === "cancelled" ||
        checkoutQuery.status === "rejected" ||
        checkoutQuery.status === "failed" ||
        checkoutQuery.status === "expired";

      if (hasFinalProviderCallbackContext) {
        clearPendingCardRedirectState(guildId);
        return;
      }

      if (Date.now() - pendingRedirectState.startedAt < 2500) {
        return;
      }

      const orphanPendingCardOrder =
        pixOrder?.method === "card" &&
        pixOrder.status === "pending" &&
        !pixOrder.providerPaymentId;

      if (orphanPendingCardOrder && pixOrder.orderNumber) {
        if (lastAutoResolvedPendingCardOrderRef.current === pixOrder.orderNumber) {
          return;
        }

        lastAutoResolvedPendingCardOrderRef.current = pixOrder.orderNumber;
        void handleCancelPendingCardPayment({
          preserveCancelledResult: false,
        });
        return;
      }

      const isHostedCheckoutStillMarkedAsLive =
        view === "card_form" && isSubmittingCard;

      if (!isHostedCheckoutStillMarkedAsLive) {
        return;
      }

      clearPendingCardRedirectState(guildId);
      paymentPollingInFlightRef.current = false;
      removeCachedOrderByGuild(guildId);
      setIsSubmittingCard(false);
      setIsLoadingOrder(false);
      setPixOrder(null);
      setLastKnownOrderNumber(null);
      setView("methods");
      setMethodMessage(
        "Tentativa anterior encerrada porque o checkout externo foi abandonado. Escolha novamente como deseja pagar.",
      );
      clearCheckoutStatusQuery();
    };

    resolveManualHostedCheckoutReturn();

    window.addEventListener("focus", resolveManualHostedCheckoutReturn);
    window.addEventListener("pageshow", resolveManualHostedCheckoutReturn);
    document.addEventListener(
      "visibilitychange",
      resolveManualHostedCheckoutReturn,
    );

    return () => {
      window.removeEventListener("focus", resolveManualHostedCheckoutReturn);
      window.removeEventListener("pageshow", resolveManualHostedCheckoutReturn);
      document.removeEventListener(
        "visibilitychange",
        resolveManualHostedCheckoutReturn,
      );
    };
  }, [
    guildId,
    handleCancelPendingCardPayment,
    isSubmittingCard,
    pixOrder,
    view,
  ]);

  const handleStartPixAfterCardIssue = useCallback(() => {
    if (!guildId) return;

    clearPendingCardRedirectState(guildId);
    paymentPollingInFlightRef.current = false;
    removeCachedOrderByGuild(guildId);
    clearCheckoutStatusQuery();
    setIsSubmittingCard(false);
    setIsLoadingOrder(false);
    setPixOrder(null);
    setLastKnownOrderNumber(null);
    setCopied(false);
    setPixFormError(null);
    setPixFormHasInputError(false);
    setMethodMessage("Preparando um novo pedido PIX com seguranca.");
    setView("pix_form");
  }, [guildId]);

  const handleStartCardRetry = useCallback(() => {
    if (!guildId) return;

    clearPendingCardRedirectState(guildId);
    paymentPollingInFlightRef.current = false;
    removeCachedOrderByGuild(guildId);
    clearCheckoutStatusQuery();
    setIsSubmittingCard(false);
    setIsLoadingOrder(false);
    setPixOrder(null);
    setLastKnownOrderNumber(null);
    setCopied(false);
    setMethodMessage("Preparando um novo checkout seguro do cartao.");
    setView("card_form");
    setCardRedirectRequestKey((current) => current + 1);
  }, [guildId]);

  const rightPanel =
    view === "card_form" ? (
      <CardFormPanel
        className=""
        cardNumber={cardNumber}
        cardHolderName={cardHolderName}
        cardExpiry={cardExpiry}
        cardCvv={cardCvv}
        cardDocument={cardDocument}
        cardBillingZipCode={cardBillingZipCode}
        cardBrand={cardBrand}
        cardNumberStatus={cardNumberStatus}
        cardHolderStatus={cardHolderStatus}
        cardExpiryStatus={cardExpiryStatus}
        cardCvvStatus={cardCvvStatus}
        cardDocumentStatus={cardDocumentStatus}
        cardBillingZipCodeStatus={cardBillingZipCodeStatus}
        onCardNumberChange={handleCardNumberChange}
        onCardHolderNameChange={handleCardHolderChange}
        onCardExpiryChange={handleCardExpiryChange}
        onCardCvvChange={handleCardCvvChange}
        onCardDocumentChange={handleCardDocumentChange}
        onCardBillingZipCodeChange={handleCardBillingZipCodeChange}
        onSubmit={() => {
          void handleSubmitCardPayment();
        }}
        onBack={() => {
          setCardFormError(null);
          setCardFormHasInputError(false);
          setView("methods");
        }}
        isSubmitting={isSubmittingCard}
        canSubmit={canSubmitCard}
        cooldownMessage={cardCooldownMessage}
        errorMessage={cardFormError}
        hasInputError={cardFormHasInputError}
        errorAnimationTick={cardFormErrorAnimationTick}
      />
    ) : null;

  const checkoutStatusLabel =
    methodMessage ||
    (shouldShowStatusResultPanel ? currentPaymentStatusLabel : null);
  const planDisplayName = resolvedPlan.name;
  const planBillingLabel = resolvedPlan.billingLabel;
  const planTotalLabel = resolvedPlan.totalLabel;
  const planPeriodLabel = resolvedPlan.checkoutPeriodLabel;
  const planRenewalLabel = resolvedPlan.renewalLabel;
  const effectiveMonthlyAmount =
    resolvedPlan.isTrial || resolvedPlan.billingPeriodMonths <= 0
      ? activeDiscountPreview.totalAmount
      : roundMoney(
          activeDiscountPreview.totalAmount / resolvedPlan.billingPeriodMonths,
        );
  const effectiveMonthlyLabel = formatMoney(
    effectiveMonthlyAmount,
    activeDiscountPreview.currency,
  );
  const summaryTotalLabel = formatMoney(
    activeDiscountPreview.totalAmount,
    activeDiscountPreview.currency,
  );
  const summaryBaseLabel = formatMoney(
    activeDiscountPreview.baseAmount,
    activeDiscountPreview.currency,
  );
  const compareMonthlyAmountLabel = formatMoney(
    resolvedPlan.compareMonthlyAmount,
    activeDiscountPreview.currency,
  );
  const compareTotalAmountLabel = formatMoney(
    resolvedPlan.compareTotalAmount,
    activeDiscountPreview.currency,
  );
  const planSavingsAmount = Math.max(
    0,
    resolvedPlan.compareTotalAmount - activeDiscountPreview.totalAmount,
  );
  const planSavingsLabel = formatMoney(planSavingsAmount, activeDiscountPreview.currency);
  const showCompareAmount = planSavingsAmount > 0;
  const couponDiscountLabel = activeDiscountPreview.coupon
    ? `- ${formatMoney(activeDiscountPreview.coupon.amount, activeDiscountPreview.currency)}`
    : formatMoney(0, activeDiscountPreview.currency);
  const giftCardDiscountLabel = activeDiscountPreview.giftCard
    ? `- ${formatMoney(activeDiscountPreview.giftCard.amount, activeDiscountPreview.currency)}`
    : formatMoney(0, activeDiscountPreview.currency);
  const flowPointsDiscountLabel =
    activeDiscountPreview.flowPoints && activeDiscountPreview.flowPoints.appliedAmount > 0
      ? `- ${formatMoney(
          activeDiscountPreview.flowPoints.appliedAmount,
          activeDiscountPreview.currency,
        )}`
      : formatMoney(0, activeDiscountPreview.currency);
  const flowPointsBalanceAmount = Math.max(
    0,
    roundMoney(
      activeDiscountPreview.flowPoints?.balanceBefore ??
        knownFlowPointsBalance,
    ),
  );
  const flowPointsBalanceLabel = formatMoney(
    flowPointsBalanceAmount,
    activeDiscountPreview.currency,
  );
  const flowPointsAfterApplyAmount = Math.max(
    0,
    roundMoney(
      activeDiscountPreview.flowPoints?.balanceAfter ??
        flowPointsBalanceAmount,
    ),
  );
  const flowPointsAfterApplyLabel = formatMoney(
    flowPointsAfterApplyAmount,
    activeDiscountPreview.currency,
  );
  const flowPointsGrantAmount = Math.max(
    0,
    resolveFlowPointsGrantFromSubtotal({
      planChange: selectedPlanChange,
      subtotalAmount: activeDiscountPreview.subtotalAmount,
    }),
  );
  const flowPointsGrantLabel =
    flowPointsGrantAmount > 0
      ? `+ ${formatMoney(flowPointsGrantAmount, activeDiscountPreview.currency)}`
      : formatMoney(0, activeDiscountPreview.currency);
  const showCartDiscountEditor =
    isDiscountEditorOpen || Boolean(couponCode.trim()) || Boolean(giftCardCode.trim());
  const approvedRedirectConfig = shouldShowApprovedConfirmationPanel
    ? resolveApprovedRedirectConfig(guildId)
    : null;
  const checkoutPanelTitle = shouldShowApprovedConfirmationPanel
    ? pixOrder?.method === "trial"
      ? "Ativacao concluida"
      : "Pagamento confirmado"
    : view === "pix_checkout"
      ? "QR Code PIX"
      : view === "pix_form"
        ? "Dados do pagador"
        : "Pagamento";
  const checkoutPanelDescription = shouldShowApprovedConfirmationPanel
    ? "O pagamento ja foi validado. Aguarde alguns instantes enquanto terminamos a liberacao do sistema da conta."
    : view === "pix_checkout"
      ? "Pague pelo app do seu banco ou use o copia e cola logo abaixo."
      : view === "pix_form"
        ? "Preencha nome completo e CPF abaixo para gerar o PIX sem sair deste card."
        : "Escolha como deseja pagar sem sair da tela do carrinho.";
  const isContinueButtonAwaitingPayment = phase !== "cart";
  const isScheduledTargetAlreadyPending =
    selectedPlanChange.execution === "schedule_for_renewal" &&
    selectedPlanChange.scheduledChangeMatchesTarget &&
    scheduledPlanChange?.status === "scheduled";
  const isContinueButtonDisabled = Boolean(
    isPlanSelectionLocked ||
      isSubmittingTrial ||
      isContinueButtonAwaitingPayment ||
      isScheduledTargetAlreadyPending ||
      !resolvedPlan.isAvailable,
  );
  const isContinueButtonBusy =
    phase === "cart" &&
    Boolean(
      isPlanLoading || isLoadingOrder || isPreparingBaseOrder || isSubmittingTrial,
    );
  const continueButtonLabel = !resolvedPlan.isAvailable
    ? "Indisponivel"
    : resolvedPlan.isTrial
      ? "Ativar gratuitamente"
      : selectedPlanChange.execution === "schedule_for_renewal"
        ? isScheduledTargetAlreadyPending
          ? "Troca agendada"
          : "Agendar troca"
        : activeDiscountPreview.totalAmount <= 0
          ? "Aplicar agora"
      : isContinueButtonAwaitingPayment
        ? "Aguardando pagamento"
        : "Continuar";

  return (
    <main
      className="min-h-screen bg-black px-4 pt-[20px] pb-[92px] sm:px-5 lg:px-6 lg:pt-[24px]"
    >
      <section className="mx-auto w-full max-w-[1540px]">
        {!isCartNoticeDismissed ? (
          <div className="rounded-[28px] bg-[#0D0D0F] px-[18px] py-[18px] shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:px-[28px] sm:py-[24px]">
            <div className="flex items-center justify-between gap-[16px]">
              <div className="flex items-center gap-[14px] sm:gap-[18px]">
                <div className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full border border-[rgba(0,98,255,0.42)] bg-[rgba(0,98,255,0.12)] text-[#63A5FF]">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    className="h-[16px] w-[16px]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <circle cx="10" cy="10" r="7.2" />
                    <path d="M10 8.2v4.6" strokeLinecap="round" />
                    <circle cx="10" cy="5.9" r="0.9" fill="currentColor" stroke="none" />
                  </svg>
                </div>
                <p className="max-w-[1180px] text-[15px] leading-[1.55] text-[#EAEAEA] sm:text-[17px]">
                  Voce foi direcionado para o checkout Flowdesk, que e onde sua conta esta registrada.
                  Os valores do pedido foram atualizados de acordo com sua regiao.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCartNoticeDismissed(true)}
                className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[#BBBBBB] transition-colors hover:bg-[#151515] hover:text-white"
                aria-label="Fechar aviso"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="h-[18px] w-[18px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M5 5l10 10" />
                  <path d="M15 5 5 15" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}

        <div
          key={`payment-${statusStageKey}-${phase}`}
          className="mt-[22px] grid gap-[20px] xl:grid-cols-[minmax(0,1.62fr)_minmax(360px,0.9fr)] xl:items-start"
        >
          <div className="space-y-[18px]">
            <div>
              <p className="text-[18px] font-semibold text-[#F4F4F4] sm:text-[21px]">
                Seu carrinho
              </p>
              <div className="mt-[22px] rounded-[30px] bg-[linear-gradient(180deg,rgba(13,13,13,0.98)_0%,rgba(8,8,8,0.98)_100%)] px-[20px] py-[22px] shadow-[0_28px_90px_rgba(0,0,0,0.32)] sm:px-[34px] sm:py-[34px]">
                <div className="flex flex-col gap-[22px]">
                  <div className="flex flex-col gap-[16px] xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex items-center gap-[16px] sm:gap-[18px]">
                        <div className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-[18px] bg-[#171717] text-[#EFEFEF]">
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            className="h-[28px] w-[28px]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="4.5" y="5.5" width="15" height="5.5" rx="1.8" />
                            <rect x="4.5" y="13" width="15" height="5.5" rx="1.8" />
                            <path d="M8 8.25h2.5" />
                            <path d="M8 15.75h2.5" />
                          </svg>
                        </div>

                        <div className="flex items-center gap-[12px]">
                          <CompactPlanSelect
                            plans={availablePlanOptions}
                            selectedPlanCode={selectedPlanCode}
                            onSelectPlan={handleSelectPlan}
                            disabled={
                              isPlanSelectionLocked || availablePlanOptions.length <= 1
                            }
                          />
                          {isPlanSelectionLocked ? (
                            <span className="inline-flex min-h-[28px] items-center gap-[8px] rounded-full bg-[#151515] px-[12px] text-[12px] font-medium text-[#D2D2D2]">
                              <ButtonLoader size={12} colorClassName="text-[#D2D2D2]" />
                              Atualizando
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="xl:text-right">
                        <div className="flex flex-wrap items-start gap-[12px] xl:justify-end">
                          {planSavingsAmount > 0 ? (
                            <span className="mt-[4px] inline-flex min-h-[32px] items-center rounded-full bg-[rgba(0,98,255,0.18)] px-[14px] text-[14px] font-semibold text-[#81B8FF]">
                              Economize {planSavingsLabel}
                            </span>
                          ) : null}

                          <div>
                            <div className="flex items-end gap-[4px] xl:justify-end">
                              <span className="text-[24px] font-semibold tracking-[-0.04em] text-[#F5F5F5] sm:text-[26px]">
                                {effectiveMonthlyLabel}
                              </span>
                              <span className="pb-[2px] text-[16px] text-[#C8C8C8]">
                                {planBillingLabel}
                              </span>
                            </div>
                            {showCompareAmount ? (
                              <p className="mt-[4px] text-[14px] text-[#777777] line-through xl:text-right">
                                {compareMonthlyAmountLabel}
                                {planBillingLabel}
                              </p>
                            ) : null}
                            <p className="mt-[5px] text-[13px] text-[#8E8E8E] xl:text-right">
                              Cobrado hoje: {summaryBaseLabel}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                  {phase === "cart" ? (
                    <>
                    <div className="mt-[2px]">
                      <p className="text-[16px] font-medium text-[#F0F0F0]">Periodo</p>
                      {availableBillingPeriodOptions.length > 0 ? (
                        <BillingPeriodSwitcher
                          className="mt-[12px]"
                          periods={availableBillingPeriodOptions}
                          selectedBillingPeriodCode={selectedBillingPeriodCode}
                          onSelectBillingPeriod={handleSelectBillingPeriod}
                          disabled={isPlanSelectionLocked}
                        />
                      ) : (
                        <div className="mt-[12px] inline-flex h-[56px] items-center rounded-[18px] border border-[#202020] bg-[#111111] px-[16px] text-[13px] font-medium text-[#D9D9D9]">
                          {resolvedPlan.billingPeriodLabel}
                        </div>
                      )}
                      <div className="mt-[14px] flex flex-wrap items-center gap-[10px] text-[14px] text-[#B8B8B8]">
                        <span className="inline-flex min-h-[30px] items-center rounded-full border border-[#202020] bg-[#111111] px-[12px] font-medium text-[#ECECEC]">
                          {planPeriodLabel}
                        </span>
                        <span className="inline-flex min-h-[30px] items-center rounded-full border border-[#202020] bg-[#111111] px-[12px] font-medium text-[#ECECEC]">
                          Total do ciclo {summaryBaseLabel} {planTotalLabel}
                        </span>
                        {showCompareAmount ? (
                          <span className="inline-flex min-h-[30px] items-center rounded-full border border-[#202020] bg-[#111111] px-[12px] font-medium text-[#A0A0A0] line-through">
                            {compareTotalAmountLabel}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-[12px] text-[14px] leading-[1.6] text-[#909090]">
                        {planRenewalLabel}
                      </p>
                    </div>

                    <div className="mt-[28px] flex flex-col gap-[18px] rounded-[22px] bg-[#131C2E] px-[16px] py-[16px] sm:flex-row sm:items-center sm:justify-between sm:px-[18px]">
                      <div className="flex items-center gap-[14px]">
                        <div className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[16px] bg-[#0062FF] text-[28px] font-semibold text-white">
                          %
                        </div>
                        <div>
                          <p className="text-[16px] font-semibold text-white">Nao perca!</p>
                          <p className="mt-[3px] text-[15px] leading-[1.45] text-[#D6E6FF]">
                            Oferta ativa no {planDisplayName} + ativacao imediata
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-[10px] text-[15px] font-semibold tracking-[0.14em] text-[#F6F6F6] sm:gap-[12px]">
                        <span className="inline-flex min-w-[58px] items-center justify-center rounded-[12px] bg-[rgba(0,98,255,0.18)] px-[12px] py-[10px]">
                          {promoCountdown.days}D
                        </span>
                        <span className="inline-flex min-w-[58px] items-center justify-center rounded-[12px] bg-[rgba(0,98,255,0.18)] px-[12px] py-[10px]">
                          {promoCountdown.hours}H
                        </span>
                        <span className="inline-flex min-w-[58px] items-center justify-center rounded-[12px] bg-[rgba(0,98,255,0.18)] px-[12px] py-[10px]">
                          {promoCountdown.minutes}M
                        </span>
                        <span className="inline-flex min-w-[58px] items-center justify-center rounded-[12px] bg-[rgba(0,98,255,0.18)] px-[12px] py-[10px]">
                          {promoCountdown.seconds}S
                        </span>
                      </div>
                    </div>

                    <div className="mt-[28px] flex items-start gap-[10px] border-t border-[#1D1D1D] pt-[22px] text-[15px] leading-[1.55] text-[#F0F0F0]">
                      <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#0ECF9C] text-[11px] font-semibold text-[#08100D]">
                        ?
                      </span>
                      <p>Boa noticia! A ativacao automatica ja esta incluida neste pedido.</p>
                    </div>
                    </>
                  ) : (
                    <>
                    <div className="flex flex-col gap-[14px] xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <p className="text-[16px] font-medium text-[#F0F0F0]">
                          {checkoutPanelTitle}
                        </p>
                        <p className="mt-[8px] max-w-[720px] text-[14px] leading-[1.65] text-[#8C8C8C] sm:text-[15px]">
                          {checkoutPanelDescription}
                        </p>
                      </div>
                    </div>

                    <div>
                      {shouldShowApprovedConfirmationPanel &&
                      approvedRedirectConfig ? (
                        <ApprovedPaymentPanel
                          className=""
                          order={pixOrder}
                          statusMessage={checkoutStatusLabel}
                          redirectDelayMs={approvedRedirectConfig.delayMs}
                          redirectTargetUrl={approvedRedirectConfig.targetUrl}
                          onContinueNow={() => {
                            window.location.assign(
                              approvedRedirectConfig.targetUrl,
                            );
                          }}
                        />
                      ) : view === "pix_form" ? (
                        <PixFormPanel
                          className=""
                          payerDocument={payerDocument}
                          payerName={payerName}
                          payerDocumentStatus={pixDocumentStatus}
                          payerNameStatus={pixNameStatus}
                          onPayerDocumentChange={handlePayerDocumentChange}
                          onPayerNameChange={handlePayerNameChange}
                          onSubmit={() => {
                            void handleSubmitPixPayment();
                          }}
                          onBack={() => {
                            setPixFormError(null);
                            setPixFormHasInputError(false);
                            setView("methods");
                          }}
                          isSubmitting={isSubmittingPix}
                          canSubmit={canSubmitPix}
                          errorMessage={pixFormError}
                          hasInputError={pixFormHasInputError}
                          errorAnimationTick={pixFormErrorAnimationTick}
                        />
                      ) : view === "pix_checkout" ? (
                        <PixCheckoutPanel
                          className=""
                          order={pixOrder}
                          copied={copied}
                          onCopy={() => {
                            void handleCopyPixCode();
                          }}
                          onBackToMethods={() => {
                            setCopied(false);
                            setView("methods");
                          }}
                        />
                      ) : (
                        <MethodSelectorPanel
                          className=""
                          onChoosePix={() => handleChooseMethod("pix")}
                          onStartPixFlow={handleStartPixFlow}
                          onTogglePixTerms={(checked) => {
                            setPixTermsAccepted(checked);
                          }}
                          onSelectHostedRail={handleHostedRailSelection}
                          methodMessage={checkoutStatusLabel}
                          canInteract={canChoosePaymentMethod}
                          cardEnabled={cardPaymentsEnabled}
                          selectedRail={selectedRail}
                          pixTermsAccepted={pixTermsAccepted}
                          view={view}
                        />
                      )}
                    </div>

                    {shouldShowCardRecoveryActions && orderDiagnostic ? (
                      <div className={`rounded-[22px] border px-[18px] py-[16px] ${diagnosticToneClass}`}>
                        <p className="text-[11px] uppercase tracking-[0.16em]">{diagnosticOriginLabel}</p>
                        <p className="mt-[8px] text-[15px] font-medium text-[#ECECEC]">{orderDiagnostic.headline}</p>
                        <p className="mt-[6px] text-[13px] leading-[1.65] text-[#BBBBBB]">{orderDiagnostic.recommendation}</p>
                        <div className="mt-[12px] flex flex-col gap-[10px] sm:flex-row">
                          <button type="button" onClick={handleStartPixAfterCardIssue} className="inline-flex h-[46px] items-center justify-center rounded-[14px] border border-[#1F1F1F] bg-[#111111] px-[18px] text-[14px] font-medium text-[#E3E3E3] transition-colors hover:border-[#2B2B2B] hover:bg-[#151515]">Pagar com PIX</button>
                          {cardPaymentsEnabled ? (
                            <button type="button" onClick={handleStartCardRetry} className="inline-flex h-[46px] items-center justify-center rounded-[14px] bg-[#F0F0F0] px-[18px] text-[14px] font-medium text-[#111111] transition-opacity hover:opacity-90">Tentar novamente</button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <aside className="relative space-y-[18px] xl:pt-[54px]">
            <div className="flex justify-end xl:absolute xl:top-0 xl:right-0 xl:z-10">
              <button
                type="button"
                onClick={handleCheckoutBack}
                className="inline-flex h-[42px] items-center justify-center gap-[10px] rounded-[14px] bg-[#0C0C0C] px-[16px] text-[14px] font-medium text-[#E1E1E1] shadow-[0_18px_44px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors hover:bg-[#121212] hover:text-[#FFFFFF]"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="h-[14px] w-[14px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11.75 4.75 6.5 10l5.25 5.25" />
                </svg>
                <span>Voltar</span>
              </button>
            </div>

            {phase === "checkout" && rightPanel ? (
              rightPanel
            ) : (
              <div className="rounded-[30px] bg-[linear-gradient(180deg,rgba(13,13,13,0.98)_0%,rgba(8,8,8,0.98)_100%)] px-[22px] py-[24px] shadow-[0_28px_90px_rgba(0,0,0,0.32)] sm:px-[30px] sm:py-[32px]">
                <p className="text-[22px] font-semibold text-[#F5F5F5] sm:text-[24px]">
                  Resumo do pedido
                </p>

                <div className="mt-[26px]">
                  <div className="flex items-start justify-between gap-[12px]">
                    <div>
                      <p className="text-[18px] font-semibold text-[#F1F1F1]">
                        {planDisplayName}
                      </p>
                      <p className="mt-[6px] text-[13px] leading-[1.6] text-[#8B8B8B]">
                        {planPeriodLabel}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[19px] font-semibold text-[#F5F5F5]">
                        {effectiveMonthlyLabel}
                        <span className="ml-[4px] text-[13px] font-medium text-[#B9B9B9]">
                          {planBillingLabel}
                        </span>
                      </p>
                      <p className="mt-[4px] text-[12px] text-[#8B8B8B]">
                        exibido por mes
                      </p>
                    </div>
                  </div>

                  <div className="mt-[18px] space-y-[14px] text-[15px] text-[#E6E6E6]">
                    <div className="flex items-center justify-between gap-[14px]">
                      <span className="text-[#DDDDDD]">Total do ciclo</span>
                      <div className="flex items-center gap-[10px]">
                        {showCompareAmount ? (
                          <span className="text-[14px] text-[#7B7B7B] line-through">
                            {compareTotalAmountLabel}
                          </span>
                        ) : null}
                        <span className="text-[18px] font-semibold text-[#F5F5F5]">
                          {summaryBaseLabel}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-[14px]">
                      <span className="text-[#DDDDDD]">Equivale por mes</span>
                      <div className="flex items-center gap-[10px]">
                        {showCompareAmount ? (
                          <span className="text-[14px] text-[#7B7B7B] line-through">
                            {compareMonthlyAmountLabel}
                          </span>
                        ) : null}
                        <span className="font-medium text-[#F5F5F5]">
                          {effectiveMonthlyLabel}
                        </span>
                      </div>
                    </div>

                    {activeDiscountPreview.coupon && activeDiscountPreview.coupon.amount > 0 ? (
                      <div className="flex items-center justify-between gap-[14px]">
                        <span className="text-[#DDDDDD]">Cupom</span>
                        <span className="font-medium text-[#0ECF9C]">{couponDiscountLabel}</span>
                      </div>
                    ) : null}

                    {activeDiscountPreview.giftCard && activeDiscountPreview.giftCard.amount > 0 ? (
                      <div className="flex items-center justify-between gap-[14px]">
                        <span className="text-[#DDDDDD]">Vale-presente</span>
                        <span className="font-medium text-[#0ECF9C]">{giftCardDiscountLabel}</span>
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-[14px]">
                      <span className="text-[#DDDDDD]">FlowPoints</span>
                      <span className="font-medium text-[#F5F5F5]">{flowPointsDiscountLabel}</span>
                    </div>

                    <div className="flex items-center justify-between gap-[14px]">
                      <span className="text-[#DDDDDD]">Carteira FlowPoints</span>
                      <span className="font-medium text-[#F5F5F5]">{flowPointsBalanceLabel}</span>
                    </div>

                    <div className="flex items-center justify-between gap-[14px]">
                      <span className="text-[#DDDDDD]">Saldo apos abatimento</span>
                      <span className="font-medium text-[#F5F5F5]">{flowPointsAfterApplyLabel}</span>
                    </div>

                    <div className="flex items-center justify-between gap-[14px]">
                      <span className="text-[#DDDDDD]">FlowPoints que ganha</span>
                      <span
                        className={`font-medium ${
                          flowPointsGrantAmount > 0 ? "text-[#81B8FF]" : "text-[#F5F5F5]"
                        }`}
                      >
                        {flowPointsGrantLabel}
                      </span>
                    </div>
                  </div>

                  <div className="mt-[20px] border-t border-[#1D1D1D] pt-[18px]">
                    <div className="flex items-center justify-between gap-[14px] text-[15px] text-[#DDDDDD]">
                      <span>Impostos</span>
                      <span className="font-medium text-[#F5F5F5]">
                        {formatMoney(0, activeDiscountPreview.currency)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-[20px] border-t border-[#1D1D1D] pt-[20px]">
                    <div className="flex items-end justify-between gap-[14px]">
                      <span className="text-[20px] font-semibold text-[#F5F5F5]">Total</span>
                      <div className="text-right">
                        {showCompareAmount ? (
                          <p className="text-[14px] text-[#7B7B7B] line-through">
                            {compareTotalAmountLabel}
                          </p>
                        ) : null}
                        <p className="mt-[4px] text-[22px] font-semibold tracking-[-0.04em] text-[#F5F5F5] sm:text-[24px]">
                          {summaryTotalLabel}
                        </p>
                      </div>
                    </div>
                  </div>

                  {phase === "cart" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsDiscountEditorOpen((current) => !current)}
                        className="mt-[24px] inline-flex items-center gap-[10px] text-left text-[16px] font-semibold text-[#63A5FF] transition-colors hover:text-[#8CC0FF]"
                      >
                        Tem um cupom ou vale-presente?
                        <span
                          aria-hidden="true"
                          className={`inline-flex transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                            showCartDiscountEditor ? "rotate-180" : "rotate-0"
                          }`}
                        >
                          <svg
                            viewBox="0 0 20 20"
                            className="h-[16px] w-[16px]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m5 7.5 5 5 5-5" />
                          </svg>
                        </span>
                      </button>

                      <div
                        className={`grid overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                          showCartDiscountEditor
                            ? "mt-[16px] grid-rows-[1fr] opacity-100"
                            : "mt-0 grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <div
                          className={`min-h-0 overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                            showCartDiscountEditor
                              ? "translate-y-0"
                              : "-translate-y-[10px]"
                          }`}
                        >
                          <div className="space-y-[12px] pb-[2px]">
                          <input
                            type="text"
                            value={couponCode}
                            onChange={(event) =>
                              setCouponCode(event.currentTarget.value.toUpperCase().slice(0, 64))
                            }
                            placeholder="Cupom ou vale-presente"
                            className="h-[52px] w-full rounded-[16px] border border-[#242424] bg-[#121212] px-[16px] text-[14px] text-[#F5F5F5] outline-none placeholder:text-[#5B5B5B]"
                          />

                          {discountMessage && !isDiscountLoading ? (
                            <p className="flowdesk-slide-down text-[13px] leading-[1.6] text-[#A8A8A8]">
                              {discountMessage}
                            </p>
                          ) : null}

                          {isDiscountLoading ? (
                            <div className="inline-flex items-center gap-[8px] text-[12px] text-[#B4B4B4]">
                              <ButtonLoader size={14} colorClassName="text-[#B4B4B4]" />
                              Validando codigo
                            </div>
                          ) : null}
                        </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {canManuallyCancelPendingCard ? (
                        <button
                          type="button"
                          onClick={() => {
                            void handleCancelPendingCardPayment();
                          }}
                          disabled={isCancellingPendingCard}
                          className="mt-[12px] inline-flex h-[46px] w-full items-center justify-center rounded-[14px] border border-[#232323] bg-[#0E0E0E] text-[14px] font-medium text-[#DADADA] transition-colors hover:border-[#303030] hover:bg-[#131313] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isCancellingPendingCard ? "Cancelando..." : "Cancelar checkout"}
                        </button>
                      ) : null}

                    </>
                  )}

                  <button
                    type="button"
                    onClick={handleContinueToCheckout}
                    disabled={isContinueButtonDisabled}
                    className="group relative mt-[24px] inline-flex h-[55px] w-full shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[18px] leading-none font-semibold transition-transform duration-150 ease-out hover:scale-[1.00] active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 rounded-[12px] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985] ${
                        isContinueButtonDisabled
                          ? "bg-[#0E0E0E]"
                          : "bg-[linear-gradient(180deg,#0062FF_0%,#0153D5_100%)]"
                      }`}
                    />
                    <span className="relative z-10 inline-flex items-center justify-center gap-[10px] whitespace-nowrap leading-none">
                      {isContinueButtonBusy ? (
                        <ButtonLoader size={18} colorClassName="text-[#E6E6E6]" />
                      ) : (
                        <span
                          className={
                            isContinueButtonDisabled
                              ? "text-[#D6D6D6]"
                              : "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] bg-clip-text text-transparent"
                          }
                        >
                          {continueButtonLabel}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </aside>

          <span className="sr-only">{displayName}</span>
        </div>
      </section>
    </main>
  );
}
