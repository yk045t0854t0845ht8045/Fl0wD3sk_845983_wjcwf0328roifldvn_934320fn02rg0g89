
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  hasStepFourDraftValues,
  type StepFourDraft,
  type StepFourView,
} from "@/lib/auth/configContext";
import {
  isValidBrazilDocument,
  normalizeBrazilDocumentDigits,
  resolveBrazilDocumentType,
} from "@/lib/payments/brazilDocument";

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
  cardBrand: CardBrand;
  cardNumberStatus: ValidationStatus;
  cardHolderStatus: ValidationStatus;
  cardExpiryStatus: ValidationStatus;
  cardCvvStatus: ValidationStatus;
  cardDocumentStatus: ValidationStatus;
  onCardNumberChange: (value: string) => void;
  onCardHolderNameChange: (value: string) => void;
  onCardExpiryChange: (value: string) => void;
  onCardCvvChange: (value: string) => void;
  onCardDocumentChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
  canSubmit: boolean;
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
  iconPath: string;
  label: string;
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
let mercadoPagoSdkPromise: Promise<void> | null = null;
let mercadoPagoSecuritySdkPromise: Promise<void> | null = null;
const PAYMENT_ORDER_CACHE_STORAGE_KEY = "flowdesk_payment_order_cache_v1";
const APPROVED_REDIRECTED_ORDERS_STORAGE_KEY =
  "flowdesk_approved_redirected_orders_v1";
const CHECKOUT_STATUS_QUERY_KEYS = ["status", "code", "guild"] as const;

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
  };
}

function resolveRestoredView(input: {
  hasStoredDraft: boolean;
  preferredView: StepFourView;
  order: PixOrder | null;
}): StepFourView {
  const hasPixCheckoutOrder = Boolean(
    input.order && input.order.method === "pix" && input.order.qrCodeText,
  );

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
    };
  }

  const params = new URLSearchParams(window.location.search);
  const rawCode = params.get("code");
  const code =
    rawCode && /^\d{1,12}$/.test(rawCode.trim()) ? Number(rawCode.trim()) : null;
  const status = params.get("status")?.trim().toLowerCase() || null;
  const guild = params.get("guild")?.trim() || null;

  return { code, status, guild };
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

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
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
        existingScript.addEventListener("load", () => resolve(), {
          once: true,
        });
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
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("Falha ao carregar SDK do Mercado Pago."));

      document.head.appendChild(script);
    });
  }

  await mercadoPagoSdkPromise;

  if (!window.MercadoPago) {
    throw new Error("SDK do Mercado Pago nao carregou corretamente.");
  }
}

async function loadMercadoPagoSecuritySdk() {
  if (typeof window === "undefined") return;

  if (!mercadoPagoSecuritySdkPromise) {
    mercadoPagoSecuritySdkPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        "script[data-mp-sdk='security-v2']",
      );

      if (existingScript) {
        if (window.MP_DEVICE_SESSION_ID || window.flowdeskDeviceSessionId) {
          resolve();
          return;
        }

        existingScript.addEventListener("load", () => resolve(), {
          once: true,
        });
        existingScript.addEventListener(
          "error",
          () => reject(new Error("Falha ao carregar modulo de seguranca do Mercado Pago.")),
          { once: true },
        );
        return;
      }

      const script = document.createElement("script");
      script.src = MERCADO_PAGO_SECURITY_SDK_URL;
      script.async = true;
      script.defer = true;
      script.dataset.mpSdk = "security-v2";
      script.setAttribute("view", "checkout");
      script.setAttribute("output", "flowdeskDeviceSessionId");
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("Falha ao carregar modulo de seguranca do Mercado Pago."));
      document.head.appendChild(script);
    });
  }

  await mercadoPagoSecuritySdkPromise;
}

function resolveMercadoPagoDeviceSessionId() {
  if (typeof window === "undefined") return null;

  const candidates = [
    window.MP_DEVICE_SESSION_ID,
    window.flowdeskDeviceSessionId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim();
    if (!normalized) continue;
    if (!/^[a-zA-Z0-9:_-]{8,200}$/.test(normalized)) continue;
    return normalized;
  }

  return null;
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

function paymentStatusLabel(order: PixOrder | null | undefined) {
  const status = order?.status || "pending";
  const reason = summarizeMercadoPagoStatusDetail(
    order?.providerStatusDetail || null,
    order?.providerStatus || null,
  );

  switch (status) {
    case "approved":
      return "Pagamento aprovado";
    case "cancelled":
    case "rejected":
      return reason
        ? `Pagamento cancelado: ${reason}`
        : "Pagamento cancelado";
    case "expired":
      return reason ? `Pagamento expirado: ${reason}` : "Pagamento expirado";
    case "failed":
      return reason ? `Falha no pagamento: ${reason}` : "Falha no pagamento";
    case "pending":
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
};

function resolveStatusVisual(status: string | null | undefined): StatusVisual {
  if (status === "approved") {
    return {
      title: "Ja Aprovado, Todos seus sistemas estao ja online!!",
      label: "Pagamento aprovado",
      colorClassName: "text-[#6AE25A]",
      iconPath: "/cdn/icons/check.png",
      showRegenerate: false,
    };
  }

  if (status === "expired") {
    return {
      title: "Pagamento Expirado, Gere outro pagamento",
      label: "Pagamento Expirado",
      colorClassName: "text-[#F2C823]",
      iconPath: "/cdn/icons/expired.png",
      showRegenerate: true,
    };
  }

  if (status === "cancelled" || status === "rejected" || status === "failed") {
    return {
      title: "Pagamento Cancelado, Gere outro pagamento",
      label: "Pagamento Cancelado",
      colorClassName: "text-[#DB4646]",
      iconPath: "/cdn/icons/canceled.png",
      showRegenerate: true,
    };
  }

  return {
    title: "Ultima etapa, Realize o pagamento para confirmacao",
    label: "Pagamento pendente",
    colorClassName: "text-[#D8D8D8]",
    iconPath: null,
    showRegenerate: false,
  };
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
      O Flowdesk nao realizara renovacao automatica do pagamento em nenhum metodo, incluindo cartao e PIX. Para ativar a renovacao automatica, voce deve acessar o nosso dashboard e configurar essa opcao manualmente.
      <br />
      Ao continuar com a confirmacao do pagamento, voce declara que concorda com nossos termos e a politica de privacidade.
    </p>
  );
}

function MethodSelectorPanel({
  className,
  onChooseMethod,
  methodMessage,
  canInteract,
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
          disabled={!canInteract}
          className="flex h-[51px] w-full items-center justify-center gap-3 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] text-[16px] font-medium text-[#D8D8D8] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
        >
          <span className="relative h-[22px] w-[22px] shrink-0">
            <Image src="/cdn/icons/card_.png" alt="Cartao" fill sizes="22px" className="object-contain" />
          </span>
          Continuar com Cartao
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

function CardFormPanel({
  className,
  cardNumber,
  cardHolderName,
  cardExpiry,
  cardCvv,
  cardDocument,
  cardBrand,
  cardNumberStatus,
  cardHolderStatus,
  cardExpiryStatus,
  cardCvvStatus,
  cardDocumentStatus,
  onCardNumberChange,
  onCardHolderNameChange,
  onCardExpiryChange,
  onCardCvvChange,
  onCardDocumentChange,
  onSubmit,
  onBack,
  isSubmitting,
  canSubmit,
  errorMessage,
  hasInputError,
  errorAnimationTick,
}: CardFormPanelProps) {
  return (
    <div className={className}>
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

      <h2 className="text-center text-[33px] font-medium text-[#D8D8D8]">Pagamento com Cartao</h2>

      <div className="mt-[25px] h-[2px] w-full bg-[#242424]" />

      <p className="mt-[25px] text-[18px] font-medium text-[#D8D8D8]">Dados do Cartao</p>

      <div className="mt-[14px] flex flex-col gap-3">
        <div key={`card-number-${errorAnimationTick}`} className={hasInputError ? "flowdesk-input-shake" : undefined}>
          <div className="relative">
            <input type="text" value={cardNumber} onChange={(event) => onCardNumberChange(event.currentTarget.value)} placeholder="Numero do Cartao" className={`h-[56px] w-full rounded-[5px] border bg-[#0A0A0A] px-[24px] pr-[70px] text-[19px] text-[#D8D8D8] outline-none placeholder:text-[19px] placeholder:text-[#242424] ${resolveInputBorderClass(hasInputError, cardNumberStatus)}`} inputMode="numeric" autoComplete="cc-number" aria-invalid={hasInputError} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"><ValidationIndicator status={cardNumberStatus} brand={cardBrand} /></span>
          </div>
        </div>

        <div key={`card-holder-${errorAnimationTick}`} className={hasInputError ? "flowdesk-input-shake" : undefined}>
          <div className="relative">
            <input type="text" value={cardHolderName} onChange={(event) => onCardHolderNameChange(event.currentTarget.value)} placeholder="Nome do Titular" className={`h-[56px] w-full rounded-[5px] border bg-[#0A0A0A] px-[24px] pr-[62px] text-[19px] text-[#D8D8D8] outline-none placeholder:text-[19px] placeholder:text-[#242424] ${resolveInputBorderClass(hasInputError, cardHolderStatus)}`} autoComplete="cc-name" aria-invalid={hasInputError} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"><ValidationIndicator status={cardHolderStatus} /></span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div key={`card-expiry-${errorAnimationTick}`} className={hasInputError ? "flowdesk-input-shake" : undefined}>
            <div className="relative">
              <input type="text" value={cardExpiry} onChange={(event) => onCardExpiryChange(event.currentTarget.value)} placeholder="Data de Validade" className={`h-[56px] w-full rounded-[5px] border bg-[#0A0A0A] px-[20px] pr-[52px] text-[19px] text-[#D8D8D8] outline-none placeholder:text-[19px] placeholder:text-[#242424] ${resolveInputBorderClass(hasInputError, cardExpiryStatus)}`} inputMode="numeric" autoComplete="cc-exp" aria-invalid={hasInputError} />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"><ValidationIndicator status={cardExpiryStatus} /></span>
            </div>
          </div>

          <div key={`card-cvv-${errorAnimationTick}`} className={hasInputError ? "flowdesk-input-shake" : undefined}>
            <div className="relative">
              <input type="text" value={cardCvv} onChange={(event) => onCardCvvChange(event.currentTarget.value)} placeholder="CVV/CVC" className={`h-[56px] w-full rounded-[5px] border bg-[#0A0A0A] px-[20px] pr-[52px] text-[19px] text-[#D8D8D8] outline-none placeholder:text-[19px] placeholder:text-[#242424] ${resolveInputBorderClass(hasInputError, cardCvvStatus)}`} inputMode="numeric" autoComplete="cc-csc" aria-invalid={hasInputError} />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"><ValidationIndicator status={cardCvvStatus} /></span>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-[14px] text-[18px] font-medium text-[#D8D8D8]">CPF ou CNPJ</p>

      <div key={`card-document-${errorAnimationTick}`} className={`mt-[10px] ${hasInputError ? "flowdesk-input-shake" : ""}`}>
        <div className="relative">
          <input type="text" value={cardDocument} onChange={(event) => onCardDocumentChange(event.currentTarget.value)} placeholder="CPF/CNPJ" className={`h-[56px] w-full rounded-[5px] border bg-[#0A0A0A] px-[24px] pr-[62px] text-[19px] text-[#D8D8D8] outline-none placeholder:text-[19px] placeholder:text-[#242424] ${resolveInputBorderClass(hasInputError, cardDocumentStatus)}`} inputMode="numeric" aria-invalid={hasInputError} />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"><ValidationIndicator status={cardDocumentStatus} /></span>
        </div>
      </div>

      {errorMessage ? (
        <p key={`card-form-error-${errorAnimationTick}-${errorMessage}`} className="mt-[10px] flowdesk-slide-down text-left text-[12px] text-[#DB4646]">
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

function PixCheckoutPanel({
  className,
  order,
  copied,
  onCopy,
  onBackToMethods,
}: PixCheckoutPanelProps) {
  const [isQrImageLoading, setIsQrImageLoading] = useState(true);
  const qrCodeDataUri = order?.qrCodeDataUri || null;
  const qrCodeText = order?.qrCodeText || "";

  useEffect(() => {
    setIsQrImageLoading(true);
  }, [qrCodeDataUri]);

  return (
    <div className={className}>
      <h2 className="text-center text-[33px] font-medium text-[#D8D8D8] max-[1529px]:hidden">Finalizando seu pagamento</h2>

      <div className="mt-[25px] mb-[25px] h-[2px] w-full bg-[#242424] max-[1529px]:hidden" />

      <div className="relative aspect-square w-full overflow-hidden border border-[#2E2E2E] bg-[#0A0A0A]">
        {!qrCodeDataUri || isQrImageLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <ButtonLoader size={34} />
          </div>
        ) : null}

        {qrCodeDataUri ? (
          <Image src={qrCodeDataUri} alt="QR Code PIX" fill sizes="(max-width: 1280px) 100vw, 536px" onLoad={() => { setIsQrImageLoading(false); }} className={`object-cover transition-opacity duration-200 ${isQrImageLoading ? "opacity-0" : "opacity-100"}`} unoptimized />
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

function StatusResultPanel({ className, iconPath, label }: StatusResultPanelProps) {
  return (
    <div className={className}>
      <div className="relative mx-auto h-[390px] w-[390px] overflow-hidden border border-[#2E2E2E] bg-[#0A0A0A] max-[520px]:h-[300px] max-[520px]:w-[300px]">
        <Image
          src={iconPath}
          alt={label}
          fill
          sizes="(max-width: 520px) 300px, 390px"
          className="object-contain p-10"
          priority
        />
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
  const initialStepFourDraft = useMemo(
    () => buildStepFourDraft(initialDraft),
    [initialDraft],
  );
  const [view, setView] = useState<StepFourView>(initialStepFourDraft.view);
  const [methodMessage, setMethodMessage] = useState<string | null>(null);

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
  const [cardNumberStatus, setCardNumberStatus] = useState<ValidationStatus>("idle");
  const [cardHolderStatus, setCardHolderStatus] = useState<ValidationStatus>("idle");
  const [cardExpiryStatus, setCardExpiryStatus] = useState<ValidationStatus>("idle");
  const [cardCvvStatus, setCardCvvStatus] = useState<ValidationStatus>("idle");
  const [cardDocumentStatus, setCardDocumentStatus] = useState<ValidationStatus>("idle");
  const [cardFormError, setCardFormError] = useState<string | null>(null);
  const [cardFormHasInputError, setCardFormHasInputError] = useState(false);
  const [cardFormErrorAnimationTick, setCardFormErrorAnimationTick] = useState(0);
  const [isSubmittingCard, setIsSubmittingCard] = useState(false);
  const [cardClientCooldownUntil, setCardClientCooldownUntil] = useState<number | null>(null);

  const [pixOrder, setPixOrder] = useState<PixOrder | null>(null);
  const [lastKnownOrderNumber, setLastKnownOrderNumber] = useState<number | null>(
    initialStepFourDraft.lastKnownOrderNumber,
  );
  const [copied, setCopied] = useState(false);
  const [isLoadingOrder, setIsLoadingOrder] = useState(true);

  const documentDigits = useMemo(() => normalizeBrazilDocumentDigits(payerDocument), [payerDocument]);
  const cardDocumentDigits = useMemo(() => normalizeBrazilDocumentDigits(cardDocument), [cardDocument]);
  const cardNumberDigits = useMemo(() => normalizeCardDigits(cardNumber), [cardNumber]);
  const cardBrand = useMemo(() => detectCardBrand(cardNumberDigits), [cardNumberDigits]);
  const cardExpiryDigits = useMemo(() => normalizeCardExpiryDigits(cardExpiry), [cardExpiry]);
  const cardCvvDigits = useMemo(() => normalizeCardCvv(cardCvv), [cardCvv]);

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
      setPixOrder(null);
      setLastKnownOrderNumber(null);
      setCopied(false);
      setIsLoadingOrder(false);
      return;
    }

    const activeGuildId = guildId;
    const guildDraft = buildStepFourDraft(initialDraft);
    const hasStoredDraft = hasStepFourDraftValues(initialDraft);
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
        const queryParams = new URLSearchParams({ guildId: activeGuildId });
        if (shouldLoadOrderByCode && checkoutQuery.code !== null) {
          queryParams.set("code", String(checkoutQuery.code));
        }

        const response = await fetch(`/api/auth/me/payments/pix?${queryParams.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as PixPaymentApiResponse;
        if (!isMounted) return;

        const remoteOrder =
          response.ok && payload.ok && payload.order ? payload.order : null;
        if (shouldLoadOrderByCode && !remoteOrder) {
          clearCheckoutStatusQuery();
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
          setPixOrder(null);
          setView("methods");
          setMethodMessage("Pagamento anterior finalizado. Escolha um novo metodo.");
          clearCheckoutStatusQuery();
          return;
        }

        const order = remoteOrder || cachedPendingOrder || null;

        if (remoteOrder) {
          writeCachedOrderByGuild(activeGuildId, remoteOrder);
          setLastKnownOrderNumber(remoteOrder.orderNumber);
          clearCheckoutStatusQuery();
        }

        setPixOrder(order);

        const restoredView = resolveRestoredView({
          hasStoredDraft,
          preferredView: guildDraft.view,
          order,
        });

        if (!order && requestedPaymentMethod) {
          setView(requestedPaymentMethod === "pix" ? "pix_form" : "card_form");
        } else {
          setView(restoredView);
        }
      } catch {
        if (!isMounted) return;
        setPixOrder(cachedPendingOrder || null);
        if (cachedPendingOrder) {
          setLastKnownOrderNumber(cachedPendingOrder.orderNumber);
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
          setView(
            requestedPaymentMethod === "pix"
              ? "pix_form"
              : requestedPaymentMethod === "card"
                ? "card_form"
                : "methods",
          );
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
  }, [guildId]);

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
    });
  }, [
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
    if (!guildId || !pixOrder || pixOrder.status !== "pending") return;
    const activeGuildId = guildId;
    const activeOrderCode = pixOrder.orderNumber;

    let isMounted = true;

    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const queryParams = new URLSearchParams({
            guildId: activeGuildId,
            code: String(activeOrderCode),
          });
          const response = await fetch(
            `/api/auth/me/payments/pix?${queryParams.toString()}`,
            { cache: "no-store" },
          );
          const payload = (await response.json()) as PixPaymentApiResponse;
          if (!isMounted || !response.ok || !payload.ok || !payload.order) return;

          setPixOrder(payload.order);
          setLastKnownOrderNumber(payload.order.orderNumber);
          writeCachedOrderByGuild(activeGuildId, payload.order);

          if (payload.order.status && payload.order.status !== "pending") {
            setView("methods");
            if (payload.order.status === "approved") {
              setMethodMessage(
                payload.licenseActive
                  ? buildActiveLicenseMessage(payload.licenseExpiresAt)
                  : "Pagamento aprovado para este servidor.",
              );
              setCheckoutStatusQuery({ order: payload.order, guildId: activeGuildId });
            } else {
              clearCheckoutStatusQuery();
            }
          }
        } catch {
          // polling silencioso
        }
      })();
    }, 8000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [guildId, pixOrder?.id, pixOrder?.orderNumber, pixOrder?.status]);

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

  const canSubmitPix = useMemo(() => {
    return Boolean(guildId && pixDocumentStatus === "valid" && pixNameStatus === "valid" && !isSubmittingPix);
  }, [guildId, isSubmittingPix, pixDocumentStatus, pixNameStatus]);

  const canSubmitCard = useMemo(() => {
    return Boolean(guildId && cardBrand && cardNumberStatus === "valid" && cardHolderStatus === "valid" && cardExpiryStatus === "valid" && cardCvvStatus === "valid" && cardDocumentStatus === "valid" && !isSubmittingCard);
  }, [cardBrand, cardCvvStatus, cardDocumentStatus, cardExpiryStatus, cardHolderStatus, cardNumberStatus, guildId, isSubmittingCard]);

  const paymentStatus = pixOrder?.status || "pending";
  const resolvedOrderNumber = pixOrder?.orderNumber || lastKnownOrderNumber || null;
  const orderNumberLabel = resolvedOrderNumber ? `#${resolvedOrderNumber}` : null;
  const currentPaymentStatusLabel = paymentStatusLabel(pixOrder);
  const statusVisual = resolveStatusVisual(paymentStatus);
  const canChoosePaymentMethod = Boolean(
    !isLoadingOrder &&
      resolvedOrderNumber &&
      (!pixOrder || pixOrder.status === "pending"),
  );
  const shouldShowStatusResultPanel = Boolean(
    view === "methods" &&
      pixOrder &&
      paymentStatus !== "pending",
  );

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

  const handleChooseMethod = useCallback((method: PaymentMethod) => {
    if (!canChoosePaymentMethod) {
      setMethodMessage("Aguardando o pedido ficar pronto para pagamento.");
      return;
    }

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
  }, [canChoosePaymentMethod]);

  const handleSubmitPixPayment = useCallback(async () => {
    if (!guildId || isSubmittingPix) return;

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

      const payload = (await response.json()) as PixPaymentApiResponse;

      if (!response.ok || !payload.ok || !payload.order) {
        throw new Error(payload.message || "Falha ao gerar pagamento PIX.");
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
  }, [documentDigits, guildId, isSubmittingPix, payerName, pixDocumentStatus, pixNameStatus, triggerPixFormValidationError]);

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
      await loadMercadoPagoSecuritySdk();
      await loadMercadoPagoSdk();

      if (!window.MercadoPago) {
        throw new Error("SDK do Mercado Pago indisponivel para cartao.");
      }

      const mercadoPago = new window.MercadoPago(publicKey, {
        locale: "pt-BR",
      });

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
          cardToken,
          paymentMethodId,
          installments: 1,
          issuerId,
          deviceSessionId: resolveMercadoPagoDeviceSessionId(),
        }),
      });

      const payload = (await response.json()) as PixPaymentApiResponse;

      if (!response.ok || !payload.ok || !payload.order) {
        if (payload.retryAfterSeconds && payload.retryAfterSeconds > 0) {
          setCardClientCooldownUntil(
            Date.now() + payload.retryAfterSeconds * 1000,
          );
        }
        throw new Error(payload.message || "Falha ao processar pagamento com cartao.");
      }

      setPixOrder(payload.order);
      setLastKnownOrderNumber(payload.order.orderNumber);
      writeCachedOrderByGuild(guildId, payload.order);
      setView("methods");
      setCardFormHasInputError(false);
      setCardFormError(null);

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
        setMethodMessage("Pagamento com cartao rejeitado.");
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
          normalizedMessage.includes("documento"));

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
          setView("card_form");
          setMethodMessage("Pedido regerado. Continue com o cartao.");
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

        const pixPaymentPayload =
          (await pixPaymentResponse.json()) as PixPaymentApiResponse;

        if (!pixPaymentResponse.ok || !pixPaymentPayload.ok || !pixPaymentPayload.order) {
          setView("pix_form");
          setMethodMessage(
            pixPaymentPayload.message ||
              "Pedido regerado. Confirme os dados para gerar novo QR Code PIX.",
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
      } finally {
        setIsLoadingOrder(false);
      }
    })();
  }, [documentDigits, guildId, payerName, pixOrder?.method]);

  const rightPanel = useMemo(() => {
    if (isLoadingOrder) {
      return (
        <div className="mx-auto hidden w-full max-w-[536px] min-[1530px]:flex min-[1530px]:items-center min-[1530px]:justify-center min-[1530px]:self-center">
          <ButtonLoader size={34} />
        </div>
      );
    }

    if (shouldShowStatusResultPanel && statusVisual.iconPath) {
      return (
        <StatusResultPanel
          className="mx-auto hidden w-full max-w-[536px] min-[1530px]:flex min-[1530px]:items-center min-[1530px]:justify-center min-[1530px]:self-center"
          iconPath={statusVisual.iconPath}
          label={currentPaymentStatusLabel}
        />
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
          cardBrand={cardBrand}
          cardNumberStatus={cardNumberStatus}
          cardHolderStatus={cardHolderStatus}
          cardExpiryStatus={cardExpiryStatus}
          cardCvvStatus={cardCvvStatus}
          cardDocumentStatus={cardDocumentStatus}
          onCardNumberChange={handleCardNumberChange}
          onCardHolderNameChange={handleCardHolderChange}
          onCardExpiryChange={handleCardExpiryChange}
          onCardCvvChange={handleCardCvvChange}
          onCardDocumentChange={handleCardDocumentChange}
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
      />
    );
  }, [
    canChoosePaymentMethod,
    canSubmitCard,
    canSubmitPix,
    cardBrand,
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
    copied,
    handleCardCvvChange,
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
    statusVisual.iconPath,
    view,
    currentPaymentStatusLabel,
  ]);

  function renderInlinePanel() {
    if (isLoadingOrder) {
      return (
        <div className="mt-[26px] flex w-full justify-center min-[1530px]:hidden">
          <ButtonLoader size={34} />
        </div>
      );
    }

    if (shouldShowStatusResultPanel && statusVisual.iconPath) {
      return (
        <StatusResultPanel
          className="mt-[26px] w-full min-[1530px]:hidden"
          iconPath={statusVisual.iconPath}
          label={currentPaymentStatusLabel}
        />
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
          cardBrand={cardBrand}
          cardNumberStatus={cardNumberStatus}
          cardHolderStatus={cardHolderStatus}
          cardExpiryStatus={cardExpiryStatus}
          cardCvvStatus={cardCvvStatus}
          cardDocumentStatus={cardDocumentStatus}
          onCardNumberChange={handleCardNumberChange}
          onCardHolderNameChange={handleCardHolderChange}
          onCardExpiryChange={handleCardExpiryChange}
          onCardCvvChange={handleCardCvvChange}
          onCardDocumentChange={handleCardDocumentChange}
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
      />
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 py-8 pb-[72px] max-[1529px]:items-start max-[1529px]:justify-start max-[1529px]:pb-[132px]">
      <section className="w-full max-w-[1840px]">
        <div className="grid grid-cols-1 items-start gap-12 max-[1529px]:justify-items-center min-[1530px]:grid-cols-[815px_536px] min-[1530px]:items-center min-[1530px]:justify-center min-[1530px]:gap-24">
          <div className="w-full max-[1529px]:max-w-[536px]">
            <div className="flex flex-col items-center">
              <div className="relative h-[112px] w-[112px] shrink-0">
                <Image src="/cdn/logos/logotipo.png" alt="Flowdesk" fill sizes="112px" className="object-contain" priority />
              </div>

              <h1 className="mt-[26px] whitespace-normal text-center text-[33px] font-medium text-[#D8D8D8] min-[960px]:whitespace-nowrap">
                {statusVisual.title}
              </h1>
            </div>

            {renderInlinePanel()}

            <div className="mt-[36px] hidden h-[2px] w-full bg-[#242424] min-[1530px]:block" />

            <div className="mt-[26px] flex justify-center">
              <div className="flex h-[51px] w-[256px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] text-[16px] text-[#D8D8D8]">
                <span>Pedido:</span>
                {orderNumberLabel ? (
                  <span className="ml-1">{orderNumberLabel}</span>
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
              pagamento via <span className="font-semibold text-white">PIX</span>{" "}
              ou <span className="font-semibold text-white">Cartao</span>.
            </p>

            <p className="mt-[16px] text-[16px] leading-[1.55] text-[#D8D8D8]">
              Apos a confirmacao do pagamento (que ocorre de forma imediata), seu acesso sera liberado automaticamente e voce recebera um e-mail com a confirmacao da compra e os detalhes do servico.
            </p>

            <div className="mt-[26px] flex h-[51px] w-full items-center justify-between rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-6">
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
              Apos a confirmacao do pagamento, a aprovacao sera imediata, juntamente com a liberacao do sistema. Caso ocorra algum erro, entre em contato imediatamente em:{" "}
              <a href="https://discord.gg/j9V2UUmfYP" target="_blank" rel="noreferrer noopener" className="text-[#A8A8A8] underline decoration-[#A0A0A0] underline-offset-2 transition-colors hover:text-[#C7C7C7]">
                Ajuda com meu pagamento
              </a>
              . O pagamento de R$ 9,99 e referente a validacao de apenas 1 licenca, ou seja, o Flowdesk funcionara somente no servidor do Discord que foi configurado inicialmente.
            </p>

            <CheckoutLegalText className="mt-[16px] text-[12px] leading-[1.6] text-[#949494] min-[1530px]:hidden" />

            {shouldShowStatusResultPanel && statusVisual.showRegenerate ? (
              <button
                type="button"
                onClick={handleRegeneratePayment}
                className="mt-[26px] flex h-[51px] w-full items-center justify-center rounded-[3px] bg-[#D8D8D8] text-[16px] font-medium text-black transition-opacity hover:opacity-90"
              >
                Regerar o pagamento
              </button>
            ) : null}
          </div>

          {rightPanel}

          <span className="sr-only">{displayName}</span>
        </div>
      </section>
    </main>
  );
}
