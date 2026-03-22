
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  hasStepFourDraftValues,
  type StepFourDraft,
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

type ConfigStepFourProps = {
  displayName: string;
  guildId: string | null;
  initialDraft?: StepFourDraft | null;
  onDraftChange?: (guildId: string, draft: StepFourDraft) => void;
};

type PaymentMethod = "pix" | "card";
type ValidationStatus = "idle" | "validating" | "valid" | "invalid";
type CardBrand = "visa" | "mastercard" | "amex" | "elo" | null;

type PixOrder = {
  id: number;
  orderNumber: number;
  guildId: string;
  method: "pix" | "card";
  status: string;
  amount: number;
  currency: string;
  payerName: string | null;
  payerDocumentMasked: string | null;
  payerDocumentType: "CPF" | "CNPJ" | null;
  providerPaymentId: string | null;
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
  onChooseMethod: (method: PaymentMethod) => void;
  methodMessage: string | null;
  canInteract: boolean;
  cardEnabled: boolean;
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

type StatusResultPanelProps = {
  className: string;
  iconPath?: string | null;
  label: string;
  useLoader?: boolean;
  loaderColorClassName?: string;
  panelTone?: "neutral" | "live" | "success";
};

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
  "checkoutToken",
  "payment_id",
  "paymentId",
  "collection_id",
] as const;

const EMPTY_STEP_FOUR_DRAFT: StepFourDraft = {
  visited: false,
  view: "methods",
  lastKnownOrderNumber: null,
  payerDocument: "",
  payerName: "",
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

function buildStepFourDraft(input: Partial<StepFourDraft> | null | undefined): StepFourDraft {
  if (!input) return EMPTY_STEP_FOUR_DRAFT;

  const view: StepFourView =
    input.view === "pix_form" ||
    input.view === "card_form" ||
    input.view === "pix_checkout"
      ? input.view
      : "methods";

  return {
    visited: Boolean(input.visited),
    view,
    lastKnownOrderNumber:
      typeof input.lastKnownOrderNumber === "number" &&
      Number.isInteger(input.lastKnownOrderNumber) &&
      input.lastKnownOrderNumber > 0
        ? input.lastKnownOrderNumber
        : null,
    payerDocument: normalizeDraftText(input.payerDocument, 24),
    payerName: normalizeDraftText(input.payerName, 120),
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
    (data.method === "pix" || data.method === "card") &&
    typeof data.status === "string" &&
    typeof data.amount === "number" &&
    typeof data.currency === "string"
  );
}

function readCachedOrderByGuild(guildId: string): PixOrder | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(PAYMENT_ORDER_CACHE_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const item = (parsed as Record<string, unknown>)[guildId];
    return isCachedPixOrder(item) ? item : null;
  } catch {
    return null;
  }
}

function writeCachedOrderByGuild(guildId: string, order: PixOrder) {
  if (typeof window === "undefined") return;

  try {
    const raw = window.sessionStorage.getItem(PAYMENT_ORDER_CACHE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const next = {
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      [guildId]: order,
    };

    window.sessionStorage.setItem(
      PAYMENT_ORDER_CACHE_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // ignorar erro de cache local
  }
}

function removeCachedOrderByGuild(guildId: string) {
  if (typeof window === "undefined") return;

  try {
    const raw = window.sessionStorage.getItem(PAYMENT_ORDER_CACHE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return;

    const next = { ...(parsed as Record<string, unknown>) };
    delete next[guildId];

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
    return `Licenca ativa para este servidor ate ${formattedExpiresAt}.`;
  }

  return "Licenca ativa para este servidor. Pagamento bloqueado ate o fim do periodo.";
}

function readCheckoutStatusQuery() {
  if (typeof window === "undefined") {
    return {
      code: null as number | null,
      status: null as string | null,
      guild: null as string | null,
      checkoutToken: null as string | null,
      paymentId: null as string | null,
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

  return { code, status, guild, checkoutToken, paymentId };
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
  url.searchParams.delete("payment_id");
  url.searchParams.delete("paymentId");
  url.searchParams.delete("collection_id");

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function buildPaymentOrderLookupUrl(input: {
  guildId: string;
  orderCode?: number | null;
  checkoutToken?: string | null;
  paymentId?: string | null;
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

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
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

function parseUnknownErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const message = error.message?.trim();
    return message || null;
  }

  if (typeof error === "string") {
    const message = error.trim();
    return message || null;
  }

  if (!error || typeof error !== "object") {
    return null;
  }

  const data = error as UnknownErrorObject;

  const directMessage = data.message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage.trim();
  }

  const errorMessage = data.errorMessage;
  if (typeof errorMessage === "string" && errorMessage.trim()) {
    return errorMessage.trim();
  }

  const cause = data.cause;
  if (Array.isArray(cause) && cause.length > 0) {
    const firstCause = cause[0];
    if (firstCause && typeof firstCause === "object") {
      const description = (firstCause as UnknownErrorObject).description;
      if (typeof description === "string" && description.trim()) {
        return description.trim();
      }
    }
  }

  return null;
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
      return "Pagamento aprovado";
    case "pending":
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

type StatusVisual = {
  title: string;
  label: string;
  colorClassName: string;
  iconPath: string | null;
  showRegenerate: boolean;
  useLoaderPanel?: boolean;
};

function resolveStatusVisual(order: PixOrder | null | undefined): StatusVisual {
  const status = order?.status || "pending";
  const method = order?.method || "pix";
  const diagnostic = resolveOrderDiagnostic(order);

  if (status === "approved") {
    return {
      title: "Ja Aprovado, Todos seus sistemas estao ja online!!",
      label: "Pagamento aprovado",
      colorClassName: "text-[#6AE25A]",
      iconPath: "/cdn/icons/check.png",
      showRegenerate: false,
      useLoaderPanel: false,
    };
  }

  if (status === "pending" && method === "card") {
    return {
      title: "Pagamento em analise, aguardando confirmacao do emissor",
      label: "Pagamento em analise",
      colorClassName: "text-[#D8D8D8]",
      iconPath: null,
      showRegenerate: false,
      useLoaderPanel: true,
    };
  }

  if (status === "expired") {
    return {
      title: "Pagamento Expirado, Gere outro pagamento",
      label: "Pagamento Expirado",
      colorClassName: "text-[#F2C823]",
      iconPath: "/cdn/icons/expired.png",
      showRegenerate: true,
      useLoaderPanel: false,
    };
  }

  if (status === "cancelled") {
    return {
      title:
        method === "card"
          ? diagnostic?.category === "checkout_closed"
            ? "Checkout encerrado antes da confirmacao do pagamento"
            : "Checkout cancelado, Crie um novo novamente"
          : "Pagamento Cancelado, Gere outro pagamento",
      label: method === "card" ? "Checkout cancelado" : "Pagamento Cancelado",
      colorClassName: "text-[#DB4646]",
      iconPath: "/cdn/icons/canceled.png",
      showRegenerate: true,
      useLoaderPanel: false,
    };
  }

  if (status === "rejected") {
    return {
      title:
        method === "card" && diagnostic?.category === "antifraud"
          ? "Pagamento nao aprovado na analise de seguranca"
          : method === "card" && diagnostic?.category === "issuer"
            ? "Pagamento nao aprovado pelo banco emissor"
            : "Pagamento nao aprovado, revise os dados e tente novamente",
      label: "Pagamento nao aprovado",
      colorClassName: "text-[#DB4646]",
      iconPath: "/cdn/icons/canceled.png",
      showRegenerate: true,
      useLoaderPanel: false,
    };
  }

  if (status === "failed") {
    return {
      title:
        method === "card"
          ? diagnostic?.category === "checkout_failed"
            ? "Tentativa com cartao nao foi concluida com seguranca"
            : "Falha ao concluir o checkout, gere uma nova tentativa"
          : "Pagamento Cancelado, Gere outro pagamento",
      label: method === "card" ? "Falha no checkout" : "Pagamento Cancelado",
      colorClassName: "text-[#DB4646]",
      iconPath: "/cdn/icons/canceled.png",
      showRegenerate: true,
      useLoaderPanel: false,
    };
  }

  return {
    title: "Ultima etapa, Realize o pagamento para confirmacao",
    label: "Pagamento pendente",
    colorClassName: "text-[#D8D8D8]",
    iconPath: null,
    showRegenerate: false,
    useLoaderPanel: false,
  };
}

function resolveStatusSupportCopy(order: PixOrder | null | undefined) {
  if (!order) {
    return "Apos a confirmacao do pagamento, a aprovacao sera imediata, juntamente com a liberacao do sistema.";
  }

  const diagnostic = resolveOrderDiagnostic(order);

  if (order.method === "card" && order.status === "pending") {
    return diagnostic
      ? `${diagnostic.summary} ${diagnostic.recommendation}`
      : "Seu pagamento com cartao foi enviado para analise do emissor. Em alguns casos, a confirmacao pode levar alguns instantes. Se o status mudar, esta tela sera atualizada automaticamente.";
  }

  if (order.method === "card" && order.status === "rejected") {
    return diagnostic
      ? `${diagnostic.summary} ${diagnostic.recommendation}`
      : "O emissor do cartao nao aprovou esta tentativa. Revise os dados, utilize o mesmo titular do cartao e tente novamente. Se preferir, voce tambem pode concluir por PIX.";
  }

  if (order.method === "card" && order.status === "cancelled") {
    return diagnostic
      ? `${diagnostic.summary} ${diagnostic.recommendation}`
      : "O checkout com cartao foi encerrado antes da confirmacao do pagamento. Quando quiser, voce pode gerar uma nova tentativa segura e concluir novamente.";
  }

  if (order.method === "card" && order.status === "failed") {
    return diagnostic
      ? `${diagnostic.summary} ${diagnostic.recommendation}`
      : "Nao foi possivel concluir o checkout do cartao nesta tentativa. Gere um novo checkout para continuar com seguranca.";
  }

  if (order.status === "expired") {
    return "O prazo deste pagamento terminou. Gere um novo pagamento para continuar a liberacao do sistema neste servidor.";
  }

  return "Apos a confirmacao do pagamento, a aprovacao sera imediata, juntamente com a liberacao do sistema.";
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

function resolveRegenerateButtonLabel(order: PixOrder | null | undefined) {
  if (!order) return "Gerar novo pagamento";

  if (order.method === "card") {
    switch (order.status) {
      case "cancelled":
        return "Escolher pagamento novamente";
      case "rejected":
        return "Escolher pagamento novamente";
      case "failed":
        return "Escolher pagamento novamente";
      case "expired":
        return "Escolher pagamento novamente";
      default:
        return "Escolher pagamento novamente";
    }
  }

  switch (order.status) {
    case "expired":
      return "Gerar novo PIX";
    case "cancelled":
    case "failed":
      return "Gerar novo pagamento";
    default:
      return "Gerar novo pagamento";
  }
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
      O Flowdesk nao realizara renovacao automatica do pagamento no checkout atual. No momento, o pagamento esta disponivel via PIX e o cartao retornara em breve com a mesma camada de seguranca.
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

function MethodSelectorPanel({
  className,
  onChooseMethod,
  methodMessage,
  canInteract,
  cardEnabled,
}: MethodSelectorPanelProps) {
  return (
    <div className={className}>
      <h2 className="text-center text-[33px] font-medium text-[#D8D8D8] max-[1529px]:hidden">
        Escolha o metodo de pagamento
      </h2>

      <div className="mt-[25px] mb-[25px] h-[2px] w-full bg-[#242424] max-[1529px]:hidden" />

      <div className="mt-0 flex flex-col gap-4">
        <button
          type="button"
          onClick={() => onChooseMethod("pix")}
          disabled={!canInteract}
          className="flex h-[51px] w-full items-center justify-center gap-3 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] text-[16px] font-medium text-[#D8D8D8] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
        >
          <span className="relative h-[22px] w-[22px] shrink-0">
            <Image src="/cdn/icons/pix_.png" alt="PIX" fill sizes="22px" className="object-contain" />
          </span>
          Continuar com PIX
        </button>

        <button
          type="button"
          onClick={() => onChooseMethod("card")}
          disabled={!canInteract || !cardEnabled}
          className="relative flex h-[51px] w-full items-center justify-center gap-3 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] text-[16px] font-medium text-[#D8D8D8] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
        >
          <span className="relative h-[22px] w-[22px] shrink-0">
            <Image src="/cdn/icons/card_.png" alt="Cartao" fill sizes="22px" className="object-contain" />
          </span>
          <span>Continuar com Cartao</span>
          {!cardEnabled ? (
            <span className="pointer-events-none absolute -right-[7px] -top-[9px] inline-flex h-[22px] items-center justify-center rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-2 text-[10px] tracking-[0.04em] text-[#F2C823] shadow-[0_0_0_1px_rgba(10,10,10,0.55)]">
              {CARD_PAYMENTS_COMING_SOON_BADGE}
            </span>
          ) : null}
        </button>
      </div>

      {!canInteract ? (
        <div className="mt-[14px] flex items-center justify-center gap-2 text-[12px] text-[#C2C2C2]">
          <ButtonLoader size={14} colorClassName="text-[#C2C2C2]" />
          <span>Aguardando carregamento do pedido</span>
        </div>
      ) : null}

      {methodMessage ? <p className="mt-[14px] text-center text-[12px] text-[#C2C2C2]">{methodMessage}</p> : null}

      <div className="mt-[25px] h-[2px] w-full bg-[#242424]" />

      <CheckoutLegalText className="mt-[25px] hidden text-center text-[12px] leading-[1.6] text-[#949494] min-[1530px]:block" />
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
    <div className={className}>
      <div className="mx-auto mb-[14px] flex h-[64px] w-[64px] items-center justify-center">
        <span className="relative h-[64px] w-[64px]">
          <Image src="/cdn/icons/pix_.png" alt="PIX" fill sizes="64px" className="object-contain" />
        </span>
      </div>

      <h2 className="text-center text-[33px] font-medium text-[#D8D8D8]">Pagamento com PIX</h2>

      <div className="mt-[25px] h-[2px] w-full bg-[#242424]" />

      <p className="mt-[25px] text-[18px] font-medium text-[#D8D8D8]">Dados do pagamento</p>

      <div className="mt-[14px] flex flex-col gap-4">
        <div key={`payer-document-${errorAnimationTick}`} className={hasInputError ? "flowdesk-input-shake" : undefined}>
          <div className="relative">
            <input type="text" value={payerDocument} onChange={(event) => onPayerDocumentChange(event.currentTarget.value)} placeholder="CPF/CNPJ" className={`h-[56px] w-full rounded-[5px] border bg-[#0A0A0A] px-[24px] pr-[62px] text-[19px] text-[#D8D8D8] outline-none placeholder:text-[19px] placeholder:text-[#242424] ${resolveInputBorderClass(hasInputError, payerDocumentStatus)}`} inputMode="numeric" aria-invalid={hasInputError} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"><ValidationIndicator status={payerDocumentStatus} /></span>
          </div>
        </div>

        <div key={`payer-name-${errorAnimationTick}`} className={hasInputError ? "flowdesk-input-shake" : undefined}>
          <div className="relative">
            <input type="text" value={payerName} onChange={(event) => onPayerNameChange(event.currentTarget.value)} placeholder="Nome Completo" className={`h-[56px] w-full rounded-[5px] border bg-[#0A0A0A] px-[24px] pr-[62px] text-[19px] text-[#D8D8D8] outline-none placeholder:text-[19px] placeholder:text-[#242424] ${resolveInputBorderClass(hasInputError, payerNameStatus)}`} aria-invalid={hasInputError} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"><ValidationIndicator status={payerNameStatus} /></span>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <p key={`pix-form-error-${errorAnimationTick}-${errorMessage}`} className="mt-[10px] flowdesk-slide-down text-left text-[12px] text-[#DB4646]">
          {errorMessage}
        </p>
      ) : null}

      <button type="button" onClick={onSubmit} disabled={!canSubmit || isSubmitting} className="mt-[16px] flex h-[56px] w-full items-center justify-center rounded-[5px] bg-[#D8D8D8] text-[20px] font-medium text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-45">
        {isSubmitting ? <ButtonLoader size={24} /> : "Confirmar pagamento"}
      </button>

      <button type="button" onClick={onBack} disabled={isSubmitting} className="mt-[12px] w-full text-center text-[12px] text-[#8E8E8E] transition-colors hover:text-[#B5B5B5] disabled:cursor-not-allowed disabled:opacity-50">
        Voltar para metodos
      </button>

      <div className="mt-[25px] h-[2px] w-full bg-[#242424]" />

      <CheckoutLegalText className="mt-[25px] hidden text-center text-[12px] leading-[1.6] text-[#949494] min-[1530px]:block" />
    </div>
  );
}

function CardFormPanel(props: CardFormPanelProps) {
  const { className, onBack, isSubmitting, errorMessage } = props;
  return (
    <div className={`${className} flowdesk-stage-fade`}>
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
        Redirecionando para o checkout com Cartao
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
    <div className={className}>
      <h2 className="text-center text-[33px] font-medium text-[#D8D8D8] max-[1529px]:hidden">Finalizando seu pagamento</h2>

      <div className="mt-[25px] mb-[25px] h-[2px] w-full bg-[#242424] max-[1529px]:hidden" />

      <div className="relative aspect-square w-full overflow-hidden border border-[#2E2E2E] bg-[#0A0A0A]">
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
            sizes="(max-width: 1280px) 100vw, 536px"
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

      <button type="button" onClick={onCopy} disabled={!qrCodeText} className="mt-[16px] flex h-[51px] w-full items-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-6 text-left disabled:cursor-not-allowed disabled:opacity-45" aria-label="Copiar codigo PIX">
        <span className={`truncate pr-2 text-[16px] ${qrCodeText ? "text-[#D8D8D8]" : "text-[#242424]"}`} title={qrCodeText || "Codigo copia e cola indisponivel"}>
          {qrCodeText || "CODIGO COPIA E COLA DO PIX PARA O PAGAMENTO"}
        </span>
        <span className="ml-auto inline-flex items-center justify-center text-[#D8D8D8]">
          <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="10" height="10" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        </span>
      </button>

      {copied ? <p className="mt-[11px] text-center text-[14px] text-[#D8D8D8]">Codigo copiado</p> : null}

      <button type="button" onClick={onBackToMethods} className="mt-[12px] w-full text-center text-[12px] text-[#8E8E8E] transition-colors hover:text-[#B5B5B5]">
        Voltar para metodos
      </button>
    </div>
  );
}

function StatusResultPanel({
  className,
  iconPath = null,
  label,
  useLoader = false,
  loaderColorClassName = "text-[#D8D8D8]",
  panelTone = "neutral",
}: StatusResultPanelProps) {
  const panelEffectClass =
    panelTone === "success"
      ? "flowdesk-success-glow"
      : panelTone === "live"
        ? "flowdesk-panel-glow"
        : "flowdesk-scale-in-soft";

  return (
    <div className={`${className} flowdesk-stage-fade`}>
      <div
        className={`relative mx-auto h-[390px] w-[390px] overflow-hidden border border-[#2E2E2E] bg-[#0A0A0A] max-[520px]:h-[300px] max-[520px]:w-[300px] ${panelEffectClass}`}
      >
        {useLoader ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <ButtonLoader size={42} colorClassName={loaderColorClassName} />
          </div>
        ) : iconPath ? (
          <Image
            src={iconPath}
            alt={label}
            fill
            sizes="(max-width: 520px) 300px, 390px"
            className="object-contain p-10"
            priority
          />
        ) : null}
      </div>
    </div>
  );
}

export function ConfigStepFour({
  displayName,
  guildId,
  initialDraft = null,
  onDraftChange,
}: ConfigStepFourProps) {
  const cardPaymentsEnabled = areCardPaymentsEnabled();
  const initialStepFourDraft = useMemo(
    () => buildStepFourDraft(initialDraft),
    [initialDraft],
  );
  const hasInitialStepFourDraft = useMemo(
    () => hasStepFourDraftValues(initialDraft),
    [initialDraft],
  );
  const latestInitialStepFourDraftRef = useRef(initialStepFourDraft);
  const hasInitialStepFourDraftRef = useRef(hasInitialStepFourDraft);
  const paymentPollingInFlightRef = useRef(false);
  const orderBootstrapInFlightRef = useRef(false);
  const lastHandledCardRedirectKeyRef = useRef(0);
  const lastAutoResolvedPendingCardOrderRef = useRef<number | null>(null);
  const [view, setView] = useState<StepFourView>(initialStepFourDraft.view);
  const [methodMessage, setMethodMessage] = useState<string | null>(null);
  const [cardRedirectRequestKey, setCardRedirectRequestKey] = useState(0);

  const [payerDocument, setPayerDocument] = useState(initialStepFourDraft.payerDocument);
  const [payerName, setPayerName] = useState(initialStepFourDraft.payerName);
  const [pixDocumentStatus, setPixDocumentStatus] = useState<ValidationStatus>("idle");
  const [pixNameStatus, setPixNameStatus] = useState<ValidationStatus>("idle");
  const [isSubmittingPix, setIsSubmittingPix] = useState(false);
  const [pixFormError, setPixFormError] = useState<string | null>(null);
  const [pixFormHasInputError, setPixFormHasInputError] = useState(false);
  const [pixFormErrorAnimationTick, setPixFormErrorAnimationTick] = useState(0);

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
  const cardCooldownMessage = useMemo(
    () => formatCooldownMessage(cardClientCooldownRemainingSeconds),
    [cardClientCooldownRemainingSeconds],
  );

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
      clearCheckoutStatusQuery();
      setView("methods");
      setMethodMessage(null);
      setPayerDocument("");
      setPayerName("");
      setCardNumber("");
      setCardHolderName("");
      setCardExpiry("");
      setCardCvv("");
      setCardDocument("");
      setCardBillingZipCode("");
      setIsSubmittingCard(false);
      setPixOrder(null);
      setLastKnownOrderNumber(null);
      setCopied(false);
      setIsLoadingOrder(false);
      return;
    }

    const activeGuildId = guildId;
    const guildDraft = latestInitialStepFourDraftRef.current;
    const hasStoredDraft = hasInitialStepFourDraftRef.current;
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
    const cachedPendingOrder =
      cachedOrder && cachedOrder.status === "pending" ? cachedOrder : null;

    if (cachedOrder && cachedOrder.status !== "pending") {
      removeCachedOrderByGuild(activeGuildId);
    }

    setView(guildDraft.view);
    setMethodMessage(null);
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

    let isMounted = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 9000);
    setIsLoadingOrder(true);

    async function loadLatestPixOrder() {
      try {
        const lookupUrl =
          shouldLoadOrderByCode && checkoutQuery.code !== null
            ? buildPaymentOrderLookupUrl({
                guildId: activeGuildId,
                orderCode: checkoutQuery.code,
                checkoutToken: checkoutQuery.checkoutToken,
                paymentId: checkoutQuery.paymentId,
                status: checkoutQuery.status,
              })
            : `/api/auth/me/payments/pix?${new URLSearchParams({
                guildId: activeGuildId,
              }).toString()}`;

        const response = await fetch(lookupUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as PixPaymentApiResponse;
        if (!isMounted) return;

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
          setPixOrder(remoteOrder);
          setLastKnownOrderNumber(remoteOrder.orderNumber);
          setView("methods");
          setMethodMessage(
            payload.licenseActive
              ? buildActiveLicenseMessage(payload.licenseExpiresAt)
              : "Pagamento aprovado para este servidor.",
          );
          setCheckoutStatusQuery({ order: remoteOrder, guildId: activeGuildId });
          writeCachedOrderByGuild(activeGuildId, remoteOrder);
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
      } catch {
        if (!isMounted) return;

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
            "Nao foi possivel validar este link de pagamento nesta conta. Faça login na conta que iniciou o pagamento e tente novamente.",
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
  }, [cardPaymentsEnabled, guildId]);

  useEffect(() => {
    if (!guildId || isLoadingOrder) return;

    onDraftChange?.(guildId, {
      visited: true,
      view,
      lastKnownOrderNumber,
      payerDocument,
      payerName,
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
    guildId,
    isLoadingOrder,
    lastKnownOrderNumber,
    onDraftChange,
    payerDocument,
    payerName,
    view,
  ]);

  useEffect(() => {
    if (!guildId) return;
    if (isLoadingOrder || isPreparingBaseOrder) return;
    if (pixOrder?.orderNumber || lastKnownOrderNumber) return;
    if (pixOrder) return;
    if (view !== "methods" && view !== "pix_form") return;
    if (isSubmittingPix || isSubmittingCard || isCancellingPendingCard) return;
    if (orderBootstrapInFlightRef.current) return;

    orderBootstrapInFlightRef.current = true;
    setIsPreparingBaseOrder(true);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 7000);

    void (async () => {
      try {
        const response = await fetch(
          `/api/auth/me/payments/pix?${new URLSearchParams({ guildId }).toString()}`,
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
      } catch (error) {
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
    isLoadingOrder,
    isPreparingBaseOrder,
    isSubmittingCard,
    isSubmittingPix,
    lastKnownOrderNumber,
    onDraftChange,
    pixOrder,
    pixOrder?.orderNumber,
    view,
  ]);

  useEffect(() => {
    if (!guildId || !pendingPixOrderId || !pendingPixOrderNumber) return;
    const activeGuildId = guildId;
    const activeOrderCode = pendingPixOrderNumber;
    const checkoutReturnStatus = readCheckoutStatusQuery().status;
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
          setView("methods");
          if (payload.order.status === "approved") {
            setMethodMessage(
              payload.licenseActive
                ? buildActiveLicenseMessage(payload.licenseExpiresAt)
                : "Pagamento aprovado para este servidor.",
            );
            setCheckoutStatusQuery({ order: payload.order, guildId: activeGuildId });
          } else if (payload.order.method === "card") {
            setMethodMessage(null);
            setCheckoutStatusQuery({ order: payload.order, guildId: activeGuildId });
          } else {
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
        };
  const orderNumberLabel = resolvedOrderNumber ? `#${resolvedOrderNumber}` : null;
  const currentPaymentStatusLabel = paymentStatusLabel(pixOrder);
  const statusVisual = resolveStatusVisual(pixOrder);
  const statusSupportCopy = resolveStatusSupportCopy(pixOrder);
  const orderDiagnostic = resolveOrderDiagnostic(pixOrder);
  const regenerateButtonLabel = resolveRegenerateButtonLabel(pixOrder);
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
  const statusBarEffectClass =
    shouldShowStatusResultPanel && paymentStatus === "approved"
      ? "flowdesk-success-glow"
      : (view === "card_form" && isSubmittingCard) ||
          (shouldShowStatusResultPanel &&
            pixOrder?.method === "card" &&
            paymentStatus === "pending")
        ? "flowdesk-panel-glow"
        : "";
  const resultPanelTone: "neutral" | "live" | "success" =
    shouldShowStatusResultPanel && paymentStatus === "approved"
      ? "success"
      : (view === "card_form" && isSubmittingCard) ||
            (shouldShowStatusResultPanel &&
              pixOrder?.method === "card" &&
              paymentStatus === "pending")
        ? "live"
        : "neutral";

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

  const startCardRedirectCheckout = useCallback(async () => {
    if (!guildId || isSubmittingCard) return;

    if (pixOrder?.method === "card" && pixOrder.status === "pending") {
      setView("methods");
      setMethodMessage(
        "Ja existe um pagamento com cartao em analise para este servidor. Aguarde o retorno antes de tentar novamente.",
      );
      return;
    }

    setIsSubmittingCard(true);
    setCardFormHasInputError(false);
    setCardFormError(null);
    setMethodMessage("Redirecionando para o checkout seguro do cartao.");

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
          renew,
          returnTarget,
          returnGuildId,
          returnTab,
        }),
      });
      const requestId = resolveResponseRequestId(response);
      const payload = (await response.json()) as CardRedirectApiResponse;

      if (payload.blockedByActiveLicense) {
        setView("methods");
        setMethodMessage(
          payload.licenseActive
            ? buildActiveLicenseMessage(payload.licenseExpiresAt)
            : "Pagamento bloqueado por licenca ativa neste servidor.",
        );
        return;
      }

      if (payload.alreadyProcessing) {
        setView("methods");
        setMethodMessage(
          withSupportRequestId(
            payload.message ||
              "Ja existe um pagamento com cartao em analise para este servidor.",
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
    } finally {
      if (!redirected) {
        clearPendingCardRedirectState(guildId);
        setIsSubmittingCard(false);
      }
    }
  }, [guildId, isSubmittingCard, pixOrder?.method, pixOrder?.status]);

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
    setIsSubmittingCard(false);
    setMethodMessage(null);
    setPixFormHasInputError(false);
    setPixFormError(null);
    setCardFormHasInputError(false);
    setCardFormError(null);
    setCopied(false);
    clearCheckoutStatusQuery();

    if (method === "pix") {
      setView("pix_form");
      return;
    }

    setView("card_form");
    setMethodMessage("Preparando checkout seguro do cartao.");
    setCardRedirectRequestKey((current) => current + 1);
  }, [canChoosePaymentMethod, cardPaymentsEnabled, guildId]);

  const handleSubmitPixPayment = useCallback(async () => {
    if (!guildId || isSubmittingPix) return;
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
          payerDocument: documentDigits,
          payerName: normalizedName,
        }),
      });
      const requestId = resolveResponseRequestId(response);

      const payload = (await response.json()) as PixPaymentApiResponse;

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

      if (payload.order.status === "approved" || payload.blockedByActiveLicense) {
        setView("methods");
        setMethodMessage(
          payload.licenseActive
            ? buildActiveLicenseMessage(payload.licenseExpiresAt)
            : "Pagamento aprovado para este servidor.",
        );
        setCheckoutStatusQuery({ order: payload.order, guildId });
      } else {
        setView("pix_checkout");
        setCheckoutStatusQuery({ order: payload.order, guildId });
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
    documentDigits,
    guildId,
    isLoadingOrder,
    isPreparingBaseOrder,
    isSubmittingPix,
    payerName,
    pixDocumentStatus,
    pixNameStatus,
    lastKnownOrderNumber,
    pixOrder?.orderNumber,
    triggerPixFormValidationError,
  ]);

  const handleSubmitCardPayment = useCallback(async () => {
    if (!guildId || isSubmittingCard) return;

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
          payerName: normalizePersonName(cardHolderName),
          payerDocument: cardDocumentDigits,
          billingZipCode: cardBillingZipCodeDigits,
          cardToken,
          paymentMethodId,
          installments: 1,
          issuerId,
          deviceSessionId,
        }),
      });
      const requestId = resolveResponseRequestId(response);

      const payload = (await response.json()) as PixPaymentApiResponse;
      const retryAfterSeconds = resolveRetryAfterSeconds(response, payload);

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

      if (payload.order.status === "approved" || payload.blockedByActiveLicense) {
        setMethodMessage(
          payload.licenseActive
            ? buildActiveLicenseMessage(payload.licenseExpiresAt)
            : "Pagamento com cartao aprovado.",
        );
        setCheckoutStatusQuery({ order: payload.order, guildId });
      } else if (payload.order.status === "pending") {
        setMethodMessage("Pagamento com cartao em analise.");
        clearCheckoutStatusQuery();
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
    isSubmittingCard,
    pixOrder?.method,
    pixOrder?.status,
    triggerCardFormValidationError,
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

  const handleRegeneratePayment = useCallback(() => {
    if (!guildId) return;

    const activeGuildId = guildId;
    const lastMethod: PaymentMethod = pixOrder?.method === "card" ? "card" : "pix";
    const normalizedName = normalizePersonName(payerName);
    const canReusePixData =
      resolveDocumentStatus(documentDigits) === "valid" &&
      isValidPersonName(normalizedName);

    setIsLoadingOrder(true);
    setMethodMessage("Regerando pagamento...");
    setCopied(false);
    setPixFormError(null);
    setPixFormHasInputError(false);
    setCardFormError(null);
    setCardFormHasInputError(false);
    setView("methods");
    clearCheckoutStatusQuery();

    void (async () => {
      try {
        removeCachedOrderByGuild(activeGuildId);
        setPixOrder(null);
        setLastKnownOrderNumber(null);

        const refreshOrderResponse = await fetch(
          `/api/auth/me/payments/pix?guildId=${activeGuildId}&forceNew=1`,
          { cache: "no-store" },
        );
        const refreshOrderPayload =
          (await refreshOrderResponse.json()) as PixPaymentApiResponse;

        if (
          !refreshOrderResponse.ok ||
          !refreshOrderPayload.ok ||
          !refreshOrderPayload.order
        ) {
          throw new Error(
            refreshOrderPayload.message ||
              "Nao foi possivel regerar o pedido de pagamento.",
          );
        }

        setPixOrder(refreshOrderPayload.order);
        setLastKnownOrderNumber(refreshOrderPayload.order.orderNumber);
        writeCachedOrderByGuild(activeGuildId, refreshOrderPayload.order);

        if (
          refreshOrderPayload.order.status === "approved" ||
          refreshOrderPayload.blockedByActiveLicense
        ) {
          setView("methods");
          setMethodMessage(
            refreshOrderPayload.licenseActive
              ? buildActiveLicenseMessage(refreshOrderPayload.licenseExpiresAt)
              : "Pagamento ja aprovado para este servidor.",
          );
          setCheckoutStatusQuery({
            order: refreshOrderPayload.order,
            guildId: activeGuildId,
          });
          return;
        }

        if (lastMethod === "card") {
          setView("methods");
          setMethodMessage(
            "Tentativa anterior encerrada. Escolha novamente como deseja pagar para abrir um novo checkout seguro.",
          );
          return;
        }

        if (!canReusePixData) {
          setView("pix_form");
          setMethodMessage(
            "Pedido regerado. Confira os dados PIX para gerar novo QR Code.",
          );
          return;
        }

        const pixPaymentResponse = await fetch("/api/auth/me/payments/pix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId: activeGuildId,
            payerDocument: documentDigits,
            payerName: normalizedName,
          }),
        });
        const requestId = resolveResponseRequestId(pixPaymentResponse);

        const pixPaymentPayload =
          (await pixPaymentResponse.json()) as PixPaymentApiResponse;

        if (!pixPaymentResponse.ok || !pixPaymentPayload.ok || !pixPaymentPayload.order) {
          setView("pix_form");
          setMethodMessage(
            withSupportRequestId(
              pixPaymentPayload.message ||
                "Pedido regerado. Confirme os dados para gerar novo QR Code PIX.",
              requestId,
            ),
          );
          return;
        }

        setPixOrder(pixPaymentPayload.order);
        setLastKnownOrderNumber(pixPaymentPayload.order.orderNumber);
        writeCachedOrderByGuild(activeGuildId, pixPaymentPayload.order);

        if (
          pixPaymentPayload.order.status === "approved" ||
          pixPaymentPayload.blockedByActiveLicense
        ) {
          setView("methods");
          setMethodMessage(
            pixPaymentPayload.licenseActive
              ? buildActiveLicenseMessage(pixPaymentPayload.licenseExpiresAt)
              : "Pagamento ja aprovado para este servidor.",
          );
          setCheckoutStatusQuery({
            order: pixPaymentPayload.order,
            guildId: activeGuildId,
          });
        } else {
          setView("pix_checkout");
          setMethodMessage("Novo QR Code PIX gerado com os dados anteriores.");
          setCheckoutStatusQuery({
            order: pixPaymentPayload.order,
            guildId: activeGuildId,
          });
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Falha ao regerar pagamento.";

        setMethodMessage(message);
        setView(lastMethod === "card" ? "card_form" : "pix_form");
        if (lastMethod === "card") {
          setCardFormError(message);
          setCardFormErrorAnimationTick((current) => current + 1);
        }
      } finally {
        setIsLoadingOrder(false);
      }
    })();
  }, [documentDigits, guildId, payerName, pixOrder?.method]);

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

  const rightPanel = useMemo(() => {
    if (isLoadingOrder) {
      return (
        <div className="mx-auto hidden w-full max-w-[536px] min-[1530px]:flex min-[1530px]:items-center min-[1530px]:justify-center min-[1530px]:self-center">
          <ButtonLoader size={34} />
        </div>
      );
    }

    if (shouldShowStatusResultPanel && (statusVisual.iconPath || statusVisual.useLoaderPanel)) {
      return (
        <div className="mx-auto hidden w-full max-w-[536px] min-[1530px]:block min-[1530px]:self-center">
          <StatusResultPanel
            className="min-[1530px]:flex min-[1530px]:items-center min-[1530px]:justify-center"
            iconPath={statusVisual.iconPath}
            label={currentPaymentStatusLabel}
            useLoader={Boolean(statusVisual.useLoaderPanel)}
            loaderColorClassName={statusVisual.colorClassName}
            panelTone={resultPanelTone}
          />
          {canManuallyCancelPendingCard ? (
            <button
              type="button"
              onClick={() => {
                void handleCancelPendingCardPayment();
              }}
              disabled={isCancellingPendingCard}
              className="mt-[12px] w-full text-center text-[11px] text-[#8E8E8E] transition-colors hover:text-[#BDBDBD] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCancellingPendingCard ? "Cancelando..." : "Cancelar"}
            </button>
          ) : null}
        </div>
      );
    }

    if (view === "pix_form") {
      return (
        <PixFormPanel
          className="mx-auto hidden w-full max-w-[536px] min-[1530px]:block min-[1530px]:self-center"
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
      );
    }

    if (view === "card_form") {
      return (
        <CardFormPanel
          className="mx-auto hidden w-full max-w-[536px] min-[1530px]:block min-[1530px]:self-center"
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
      );
    }

    if (view === "pix_checkout") {
      return (
        <PixCheckoutPanel
          className="mx-auto hidden w-full max-w-[536px] min-[1530px]:block min-[1530px]:self-center"
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
      );
    }

    return (
      <MethodSelectorPanel
        className="mx-auto hidden w-full max-w-[536px] min-[1530px]:block min-[1530px]:self-center"
        onChooseMethod={handleChooseMethod}
        methodMessage={methodMessage}
        canInteract={canChoosePaymentMethod}
        cardEnabled={cardPaymentsEnabled}
      />
    );
  }, [
    canManuallyCancelPendingCard,
    canChoosePaymentMethod,
    canSubmitCard,
    canSubmitPix,
    cardBrand,
    cardBillingZipCode,
    cardBillingZipCodeStatus,
    cardPaymentsEnabled,
    cardCvv,
    cardCvvStatus,
    cardDocument,
    cardDocumentStatus,
    cardExpiry,
    cardExpiryStatus,
    cardFormError,
    cardFormErrorAnimationTick,
    cardFormHasInputError,
    cardHolderName,
    cardHolderStatus,
    cardNumber,
    cardNumberStatus,
    cardCooldownMessage,
    copied,
    handleCancelPendingCardPayment,
    handleCardCvvChange,
    handleCardBillingZipCodeChange,
    handleCardDocumentChange,
    handleCardExpiryChange,
    handleCardHolderChange,
    handleCardNumberChange,
    handleChooseMethod,
    handleCopyPixCode,
    handlePayerDocumentChange,
    handlePayerNameChange,
    handleSubmitCardPayment,
    handleSubmitPixPayment,
    isCancellingPendingCard,
    isLoadingOrder,
    isSubmittingCard,
    isSubmittingPix,
    methodMessage,
    payerDocument,
    payerName,
    pixDocumentStatus,
    pixFormError,
    pixFormErrorAnimationTick,
    pixFormHasInputError,
    pixNameStatus,
    pixOrder,
    shouldShowStatusResultPanel,
    statusVisual.colorClassName,
    statusVisual.iconPath,
    statusVisual.useLoaderPanel,
    view,
    currentPaymentStatusLabel,
    resultPanelTone,
  ]);

  function renderInlinePanel() {
    if (isLoadingOrder) {
      return (
        <div className="mt-[26px] flex w-full justify-center min-[1530px]:hidden">
          <ButtonLoader size={34} />
        </div>
      );
    }

    if (shouldShowStatusResultPanel && (statusVisual.iconPath || statusVisual.useLoaderPanel)) {
      return (
        <div className="mt-[26px] w-full min-[1530px]:hidden">
          <StatusResultPanel
            className=""
            iconPath={statusVisual.iconPath}
            label={currentPaymentStatusLabel}
            useLoader={Boolean(statusVisual.useLoaderPanel)}
            loaderColorClassName={statusVisual.colorClassName}
            panelTone={resultPanelTone}
          />
          {canManuallyCancelPendingCard ? (
            <button
              type="button"
              onClick={() => {
                void handleCancelPendingCardPayment();
              }}
              disabled={isCancellingPendingCard}
              className="mt-[12px] w-full text-center text-[11px] text-[#8E8E8E] transition-colors hover:text-[#BDBDBD] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCancellingPendingCard ? "Cancelando..." : "Cancelar"}
            </button>
          ) : null}
        </div>
      );
    }

    if (view === "pix_form") {
      return (
        <PixFormPanel
          className="mt-[26px] w-full min-[1530px]:hidden"
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
      );
    }

    if (view === "card_form") {
      return (
        <CardFormPanel
          className="mt-[26px] w-full min-[1530px]:hidden"
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
      );
    }

    if (view === "pix_checkout") {
      return (
        <PixCheckoutPanel
          className="mt-[26px] w-full min-[1530px]:hidden"
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
      );
    }

    return (
      <MethodSelectorPanel
        className="mt-[26px] w-full min-[1530px]:hidden"
        onChooseMethod={handleChooseMethod}
        methodMessage={methodMessage}
        canInteract={canChoosePaymentMethod}
        cardEnabled={cardPaymentsEnabled}
      />
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 py-8 pb-[72px] max-[1529px]:items-start max-[1529px]:justify-start max-[1529px]:pb-[132px]">
      <section className="w-full max-w-[1840px]">
        <div className="grid grid-cols-1 items-start gap-12 max-[1529px]:justify-items-center min-[1530px]:grid-cols-[815px_536px] min-[1530px]:items-center min-[1530px]:justify-center min-[1530px]:gap-24">
          <div className="w-full max-[1529px]:max-w-[536px]">
            <div key={`header-${statusStageKey}`} className="flowdesk-stage-fade">
              <div className="flex flex-col items-center">
                <div className="relative h-[112px] w-[112px] shrink-0">
                  <Image src="/cdn/logos/logotipo_.svg" alt="Flowdesk" fill sizes="112px" className="object-contain" priority />
                </div>

                <h1 className="mt-[26px] whitespace-normal text-center text-[33px] font-medium text-[#D8D8D8] min-[960px]:whitespace-nowrap">
                  {statusVisual.title}
                </h1>
              </div>
            </div>

            {renderInlinePanel()}

            <div className="mt-[36px] hidden h-[2px] w-full bg-[#242424] min-[1530px]:block" />

            <div key={`summary-${statusStageKey}`} className="flowdesk-stage-fade">
              <div className="mt-[26px] flex justify-center">
                <div className="flex h-[51px] w-[256px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] text-[16px] text-[#D8D8D8]">
                  <span>Pedido:</span>
                  {orderNumberLabel ? (
                    <span className="ml-1">{orderNumberLabel}</span>
                  ) : isLoadingOrder || isPreparingBaseOrder ? (
                    <span className="ml-2 inline-flex items-center">
                      <ButtonLoader size={14} colorClassName="text-[#D8D8D8]" />
                    </span>
                  ) : (
                    <span className="ml-2 inline-flex items-center">
                      <ButtonLoader size={14} colorClassName="text-[#D8D8D8]" />
                    </span>
                  )}
                </div>
              </div>

              <p className="mt-[26px] text-[16px] leading-[1.55] text-[#D8D8D8]">
                A assinatura possui cobranca mensal no valor de{" "}
                <span className="font-semibold text-white">R$ 9,99</span>, com
                pagamento via <span className="font-semibold text-white">PIX</span>.
                {!cardPaymentsEnabled ? (
                  <>
                    {" "}
                    <span className="text-[#BDBDBD]">
                      Cartao e recorrencia retornarao em breve.
                    </span>
                  </>
                ) : null}
              </p>

              <p className="mt-[16px] text-[16px] leading-[1.55] text-[#D8D8D8]">
                Apos a confirmacao do pagamento (que ocorre de forma imediata), seu acesso sera liberado automaticamente e voce recebera um e-mail com a confirmacao da compra e os detalhes do servico.
              </p>

              <div
                className={`mt-[26px] flex h-[51px] w-full items-center justify-between rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-6 ${statusBarEffectClass}`}
              >
                <span
                  className={`max-w-[calc(100%-42px)] truncate pr-3 text-[16px] ${statusVisual.colorClassName}`}
                  title={currentPaymentStatusLabel}
                >
                  {currentPaymentStatusLabel}
                </span>
                <ButtonLoader size={24} colorClassName={statusVisual.colorClassName} />
              </div>

              <div className="mt-[36px] h-[2px] w-full bg-[#242424]" />

              <p className="mt-[36px] text-[12px] leading-[1.6] text-[#949494]">
                {statusSupportCopy} Caso ocorra algum erro, entre em contato imediatamente em:{" "}
                <a href="https://discord.gg/ddXtHhvvrx" target="_blank" rel="noreferrer noopener" className="text-[#A8A8A8] underline decoration-[#A0A0A0] underline-offset-2 transition-colors hover:text-[#C7C7C7]">
                  Ajuda com meu pagamento
                </a>
                . O pagamento de R$ 9,99 e referente a validacao de apenas 1 licenca, ou seja, o Flowdesk funcionara somente no servidor do Discord que foi configurado inicialmente.
              </p>

              {shouldShowCardRecoveryActions && orderDiagnostic ? (
                <div className={`mt-[18px] rounded-[3px] border px-[16px] py-[14px] ${diagnosticToneClass}`}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em]">
                    {diagnosticOriginLabel}
                  </p>
                  <p className="mt-[8px] text-[14px] font-medium text-[#D8D8D8]">
                    {orderDiagnostic.headline}
                  </p>
                  <p className="mt-[6px] text-[12px] leading-[1.55] text-[#B8B8B8]">
                    {orderDiagnostic.recommendation}
                  </p>
                </div>
              ) : null}

              <CheckoutLegalText className="mt-[16px] text-[12px] leading-[1.6] text-[#949494] min-[1530px]:hidden" />

              {shouldShowCardRecoveryActions ? (
                <div className={`mt-[26px] grid w-full gap-[12px] ${cardPaymentsEnabled ? "min-[760px]:grid-cols-2" : ""}`}>
                  <button
                    type="button"
                    onClick={handleStartPixAfterCardIssue}
                    className="flex h-[51px] w-full items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] text-[15px] font-medium text-[#D8D8D8] transition-colors hover:border-[#4A4A4A] hover:bg-[#111111]"
                  >
                    Pagar com PIX
                  </button>
                  {cardPaymentsEnabled ? (
                    <button
                      type="button"
                      onClick={handleStartCardRetry}
                      className="flex h-[51px] w-full items-center justify-center rounded-[3px] bg-[#D8D8D8] text-[16px] font-medium text-black transition-opacity hover:opacity-90"
                    >
                      Tentar outro cartao
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="flex h-[51px] w-full items-center justify-center gap-3 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] text-[15px] font-medium text-[#D8D8D8] opacity-45"
                    >
                      <span>Tentar com cartao</span>
                      <span className="inline-flex h-[22px] items-center justify-center rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-2 text-[10px] tracking-[0.04em] text-[#F2C823]">
                        {CARD_PAYMENTS_COMING_SOON_BADGE}
                      </span>
                    </button>
                  )}
                </div>
              ) : shouldShowStatusResultPanel && statusVisual.showRegenerate ? (
                <button
                  type="button"
                  onClick={handleRegeneratePayment}
                  className="mt-[26px] flex h-[51px] w-full items-center justify-center rounded-[3px] bg-[#D8D8D8] text-[16px] font-medium text-black transition-opacity hover:opacity-90"
                >
                  {regenerateButtonLabel}
                </button>
              ) : null}
            </div>
          </div>

          {rightPanel}

          <span className="sr-only">{displayName}</span>
        </div>
      </section>
    </main>
  );
}
