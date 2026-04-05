"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClientErrorBoundary } from "@/components/common/ClientErrorBoundary";
import { BotMissingModal } from "@/components/config/BotMissingModal";
import { ConfigStepMultiSelect } from "@/components/config/ConfigStepMultiSelect";
import { ConfigStepSelect } from "@/components/config/ConfigStepSelect";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { ServerSettingsEditorSkeleton } from "@/components/servers/ServerSettingsEditorSkeleton";
import { TicketMessageBuilder } from "@/components/servers/TicketMessageBuilder";
import { serversScale } from "@/components/servers/serversScale";
import {
  getServerDashboardSettings,
  readCachedServerDashboardSettings,
} from "@/lib/servers/serverDashboardSettingsClient";
import type { ServerDashboardSettingsPayload } from "@/lib/servers/serverDashboardSettingsClient";
import {
  countTicketPanelFunctionButtons,
  createDefaultTicketPanelLayout,
  normalizeTicketPanelLayout,
  ticketPanelLayoutHasAtMostOneFunctionButton,
  ticketPanelLayoutHasRequiredParts,
  type TicketPanelLayout,
} from "@/lib/servers/ticketPanelBuilder";
import {
  createDefaultWelcomeEntryLayout,
  createDefaultWelcomeExitLayout,
  normalizeWelcomeLayout,
  welcomeLayoutHasContent,
  type WelcomeThumbnailMode,
} from "@/lib/servers/welcomeMessageBuilder";
import {
  isValidBrazilDocument,
  normalizeBrazilDocumentDigits,
  resolveBrazilDocumentType,
} from "@/lib/payments/brazilDocument";
import {
  areCardPaymentsEnabled,
  CARD_PAYMENTS_COMING_SOON_BADGE,
  CARD_PAYMENTS_DISABLED_MESSAGE,
  CARD_RECURRING_DISABLED_MESSAGE,
} from "@/lib/payments/cardAvailability";
import { useBodyScrollLock } from "@/lib/ui/useBodyScrollLock";

type ManagedServerStatus = "paid" | "expired" | "off";
type EditorTab = "settings" | "payments" | "methods" | "plans";
type ServerSettingsSection =
  | "overview"
  | "message"
  | "entry_exit_overview"
  | "entry_exit_message";
type PaymentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";
type CardBrand = "visa" | "mastercard" | "amex" | "elo" | null;
type AddMethodFieldKey =
  | "cardNumber"
  | "holderName"
  | "expiry"
  | "cvv"
  | "document"
  | "nickname";

type SelectOption = {
  id: string;
  name: string;
};

type ServerSettingsDraft = {
  menuChannelId: string | null;
  ticketsCategoryId: string | null;
  logsCreatedChannelId: string | null;
  logsClosedChannelId: string | null;
  panelLayout: TicketPanelLayout;
  adminRoleId: string | null;
  claimRoleIds: string[];
  closeRoleIds: string[];
  notifyRoleIds: string[];
};

type WelcomeSettingsDraft = {
  enabled: boolean;
  entryPublicChannelId: string | null;
  entryLogChannelId: string | null;
  exitPublicChannelId: string | null;
  exitLogChannelId: string | null;
  entryLayout: TicketPanelLayout;
  exitLayout: TicketPanelLayout;
  entryThumbnailMode: WelcomeThumbnailMode;
  exitThumbnailMode: WelcomeThumbnailMode;
};

type PaymentOrder = {
  id: number;
  orderNumber: number;
  guildId: string;
  method: "pix" | "card";
  status: PaymentStatus;
  amount: number;
  currency: string;
  providerStatusDetail: string | null;
  card: {
    brand: string | null;
    firstSix: string | null;
    lastFour: string | null;
    expMonth: number | null;
    expYear: number | null;
  } | null;
  createdAt: string;
  technicalLabels: string[];
};

type SavedMethod = {
  id: string;
  brand: string | null;
  firstSix: string;
  lastFour: string;
  expMonth: number | null;
  expYear: number | null;
  lastUsedAt: string;
  timesUsed: number;
  nickname?: string | null;
  verificationStatus?: "verified" | "pending" | "failed" | "cancelled";
  verificationStatusDetail?: string | null;
  verificationAmount?: number | null;
  verifiedAt?: string | null;
  lastContextGuildId?: string | null;
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

type PlanSettings = {
  planCode: "pro";
  monthlyAmount: number;
  currency: string;
  recurringEnabled: boolean;
  recurringMethodId: string | null;
  recurringMethod: SavedMethod | null;
  availableMethods?: SavedMethod[];
  availableMethodsCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type PlanApiResponse = {
  ok: boolean;
  message?: string;
  plan?: PlanSettings;
};

type ServerSettingsEditorProps = {
  guildId: string;
  guildName: string;
  status: ManagedServerStatus;
  daysUntilExpire?: number;
  daysUntilOff?: number;
  accessMode?: "owner" | "viewer";
  canManage?: boolean;
  allServers: Array<{
    guildId: string;
    guildName: string;
    iconUrl: string | null;
  }>;
  initialTab?: EditorTab;
  settingsSection?: ServerSettingsSection;
  onTabChange?: (tab: EditorTab) => void;
  onClose: () => void;
  standalone?: boolean;
};

const TAB_INDEX: Record<EditorTab, number> = {
  settings: 0,
  payments: 1,
  methods: 2,
  plans: 3,
};

const WELCOME_VARIABLES = [
  { token: "{user}", description: "Menciona o usuario." },
  { token: "{user.id}", description: "ID do usuario no Discord." },
  { token: "{user.tag}", description: "Usuario#0000." },
  { token: "{user.avatar}", description: "URL da foto do usuario." },
  { token: "{inviter}", description: "Quem convidou o usuario." },
  { token: "{server}", description: "Nome do servidor." },
  { token: "{server.id}", description: "ID do servidor." },
  { token: "{memberCount}", description: "Total de membros." },
];

function normalizeSearch(value: string) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeBrandValue(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function normalizeDraftIds(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function normalizeServerSettingsDraft(
  draft: ServerSettingsDraft,
): ServerSettingsDraft {
  return {
    menuChannelId: draft.menuChannelId,
    ticketsCategoryId: draft.ticketsCategoryId,
    logsCreatedChannelId: draft.logsCreatedChannelId,
    logsClosedChannelId: draft.logsClosedChannelId,
    panelLayout: normalizeTicketPanelLayout(draft.panelLayout),
    adminRoleId: draft.adminRoleId,
    claimRoleIds: normalizeDraftIds(draft.claimRoleIds),
    closeRoleIds: normalizeDraftIds(draft.closeRoleIds),
    notifyRoleIds: normalizeDraftIds(draft.notifyRoleIds),
  };
}

function areServerSettingsDraftsEqual(
  left: ServerSettingsDraft | null,
  right: ServerSettingsDraft | null,
) {
  if (!left || !right) return left === right;

  return JSON.stringify(normalizeServerSettingsDraft(left)) === JSON.stringify(normalizeServerSettingsDraft(right));
}

function normalizeWelcomeSettingsDraft(
  draft: WelcomeSettingsDraft,
): WelcomeSettingsDraft {
  return {
    enabled: draft.enabled,
    entryPublicChannelId: draft.entryPublicChannelId,
    entryLogChannelId: draft.entryLogChannelId,
    exitPublicChannelId: draft.exitPublicChannelId,
    exitLogChannelId: draft.exitLogChannelId,
    entryLayout: normalizeTicketPanelLayout(draft.entryLayout),
    exitLayout: normalizeTicketPanelLayout(draft.exitLayout),
    entryThumbnailMode: draft.entryThumbnailMode,
    exitThumbnailMode: draft.exitThumbnailMode,
  };
}

function areWelcomeSettingsDraftsEqual(
  left: WelcomeSettingsDraft | null,
  right: WelcomeSettingsDraft | null,
) {
  if (!left || !right) return left === right;

  return JSON.stringify(normalizeWelcomeSettingsDraft(left)) === JSON.stringify(normalizeWelcomeSettingsDraft(right));
}

function orderStatusBadge(status: PaymentStatus) {
  if (status === "approved") return { label: "Pago", cls: "border-[#6AE25A] bg-[rgba(106,226,90,0.2)] text-[#6AE25A]" };
  if (status === "pending") return { label: "Pendente", cls: "border-[#D8D8D8] bg-[rgba(216,216,216,0.12)] text-[#D8D8D8]" };
  if (status === "expired") return { label: "Expirado", cls: "border-[#F2C823] bg-[rgba(242,200,35,0.2)] text-[#F2C823]" };
  if (status === "cancelled") return { label: "Cancelado", cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]" };
  if (status === "rejected") return { label: "Rejeitado", cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]" };
  return { label: "Falhou", cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]" };
}

function technicalHistoryBadge(label: string) {
  if (label === "Aprovado por reconciliacao de retorno") {
    return {
      label,
      cls: "border-[#5CA9FF] bg-[rgba(92,169,255,0.12)] text-[#8CC2FF]",
    };
  }

  if (label === "Aprovado por webhook") {
    return {
      label,
      cls: "border-[#7FE3C2] bg-[rgba(127,227,194,0.12)] text-[#9FF1D4]",
    };
  }

  if (label === "Estorno automatico de seguranca") {
    return {
      label,
      cls: "border-[#F2C823] bg-[rgba(242,200,35,0.12)] text-[#F2C823]",
    };
  }

  return {
    label,
    cls: "border-[#3A3A3A] bg-[rgba(255,255,255,0.04)] text-[#B8B8B8]",
  };
}

function methodVerificationBadge(status: SavedMethod["verificationStatus"]) {
  if (status === "pending") {
    return {
      label: "Validacao pendente",
      cls: "border-[#D8D8D8] bg-[rgba(216,216,216,0.12)] text-[#D8D8D8]",
    };
  }

  if (status === "failed" || status === "cancelled") {
    return {
      label: "Nao liberado",
      cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]",
    };
  }

  return {
    label: "Verificado",
    cls: "border-[#6AE25A] bg-[rgba(106,226,90,0.2)] text-[#6AE25A]",
  };
}

function cardBrandLabel(brand: string | null | undefined) {
  const normalized = normalizeBrandValue(brand);
  if (normalized === "visa") return "Visa";
  if (normalized === "mastercard") return "Mastercard";
  if (normalized === "amex") return "American Express";
  if (normalized === "elo") return "Elo";
  return typeof brand === "string" && brand.trim()
    ? brand.trim().toUpperCase()
    : "Cartao";
}

function cardBrandIcon(brand: string | null | undefined) {
  const normalized = normalizeBrandValue(brand);
  if (normalized === "visa") return "/cdn/icons/card_visa.svg";
  if (normalized === "mastercard") return "/cdn/icons/card_mastercard.svg";
  if (normalized === "amex") return "/cdn/icons/card_amex.svg";
  if (normalized === "elo") return "/cdn/icons/card_elo.svg";
  return "/cdn/icons/card_.png";
}

function PaymentMethodIcon({
  src,
  alt,
  size,
}: {
  src: string;
  alt: string;
  size: number;
}) {
  const fallbackSrc = "/cdn/icons/card_.png";
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    setCurrentSrc(src);
  }, [src]);

  return (
    <Image
      src={currentSrc}
      alt={alt}
      width={size}
      height={size}
      className="object-contain"
      loading="lazy"
      unoptimized
      onError={(event) => {
        const target = event.currentTarget as HTMLImageElement;
        if (target.src.endsWith(fallbackSrc)) return;
        setCurrentSrc(fallbackSrc);
      }}
    />
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
  if (!remainingSeconds) return `Aguarde ${minutes}min para tentar novamente.`;
  return `Aguarde ${minutes}min ${remainingSeconds}s para tentar novamente.`;
}

function resolveCardPublicKey() {
  const candidates = [
    process.env.NEXT_PUBLIC_MERCADO_PAGO_CARD_PUBLIC_KEY || null,
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
          () =>
            reject(
              new Error(
                "Falha ao carregar modulo de seguranca do Mercado Pago.",
              ),
            ),
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
        reject(
          new Error("Falha ao carregar modulo de seguranca do Mercado Pago."),
        );

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

function formatDateTime(value: string | null) {
  if (!value) return "--";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(amount);
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

const MERCADO_PAGO_SDK_URL = "https://sdk.mercadopago.com/js/v2";
const MERCADO_PAGO_SECURITY_SDK_URL = "https://www.mercadopago.com/v2/security.js";
const MERCADO_PAGO_DEVICE_SESSION_STORAGE_KEY =
  "flowdesk_mp_device_session_v1";
let mercadoPagoSdkPromise: Promise<void> | null = null;
let mercadoPagoSecuritySdkPromise: Promise<void> | null = null;

function normalizeCardDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 19);
}

function detectCardBrand(cardDigits: string) {
  const digits = normalizeCardDigits(cardDigits);
  if (!digits) return null;
  if (ELO_PREFIXES.some((prefix) => digits.startsWith(prefix))) return "elo";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(50|5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^4/.test(digits)) return "visa";
  return null;
}

function cardNumberLengthsForBrand(brand: string | null) {
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

function normalizeCardExpiryDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
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

function formatCardExpiryInput(value: string) {
  const digits = normalizeCardExpiryDigits(value);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
}

function normalizeCardCvvInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

function isValidCardExpiry(expiry: string) {
  const digits = normalizeCardExpiryDigits(expiry);
  if (digits.length !== 4) return false;

  const month = Number(digits.slice(0, 2));
  const year = Number(digits.slice(2, 4)) + 2000;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear) return false;
  if (year === currentYear && month < currentMonth) return false;
  return true;
}

function createAddMethodTouchedFields(): Record<AddMethodFieldKey, boolean> {
  return {
    cardNumber: false,
    holderName: false,
    expiry: false,
    cvv: false,
    document: false,
    nickname: false,
  } satisfies Record<AddMethodFieldKey, boolean>;
}

function resolveAddMethodValidationErrors(input: {
  cardDigits: string;
  cardBrand: CardBrand;
  holderName: string;
  expiry: string;
  expiryDigits: string;
  cvvDigits: string;
  documentDigits: string;
  nickname: string;
}) {
  const errors: Record<AddMethodFieldKey, string | null> = {
    cardNumber: null,
    holderName: null,
    expiry: null,
    cvv: null,
    document: null,
    nickname: null,
  };

  if (!input.cardDigits) {
    errors.cardNumber = "Digite o numero do cartao.";
  } else if (!input.cardBrand) {
    errors.cardNumber =
      input.cardDigits.length >= 6
        ? "Nao foi possivel identificar a bandeira deste cartao."
        : "Digite o numero completo do cartao.";
  } else {
    const validLengths = cardNumberLengthsForBrand(input.cardBrand);
    const minLength = Math.min(...validLengths);
    const hasValidLength = validLengths.includes(input.cardDigits.length);

    if (input.cardDigits.length < minLength) {
      errors.cardNumber = "Digite o numero completo do cartao.";
    } else if (!hasValidLength || !isLuhnValid(input.cardDigits)) {
      errors.cardNumber = "Numero de cartao invalido.";
    }
  }

  const normalizedHolderName = input.holderName.trim().replace(/\s+/g, " ");
  if (!normalizedHolderName) {
    errors.holderName = "Digite o nome do titular.";
  } else if (normalizedHolderName.length < 2) {
    errors.holderName =
      "Digite o nome do titular como aparece no cartao.";
  }

  if (!input.expiryDigits) {
    errors.expiry = "Digite a data de validade.";
  } else if (input.expiryDigits.length < 4) {
    errors.expiry = "Use o formato MM/AA.";
  } else {
    const month = Number(input.expiryDigits.slice(0, 2));
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      errors.expiry = "Informe um mes valido entre 01 e 12.";
    } else if (!isValidCardExpiry(input.expiry)) {
      errors.expiry = "Cartao expirado ou com validade invalida.";
    }
  }

  const expectedCvvLength = input.cardBrand === "amex" ? 4 : 3;
  if (!input.cvvDigits) {
    errors.cvv = "Digite o CVV do cartao.";
  } else if (input.cvvDigits.length !== expectedCvvLength) {
    errors.cvv =
      expectedCvvLength === 4
        ? "Digite os 4 digitos do CVV."
        : "Digite os 3 digitos do CVV.";
  }

  if (!input.documentDigits) {
    errors.document = "Digite o CPF ou CNPJ do titular.";
  } else {
    const documentType = resolveBrazilDocumentType(input.documentDigits);

    if (!documentType) {
      errors.document =
        input.documentDigits.length < 11 ||
        (input.documentDigits.length > 11 && input.documentDigits.length < 14)
          ? "Digite um CPF ou CNPJ completo."
          : "CPF/CNPJ invalido.";
    } else if (!isValidBrazilDocument(input.documentDigits)) {
      errors.document =
        documentType === "CPF" ? "CPF invalido." : "CNPJ invalido.";
    }
  }

  if (input.nickname.trim().length > 42) {
    errors.nickname = "O apelido pode ter no maximo 42 caracteres.";
  }

  return errors;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toSafeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function toSafeNullableText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toSafeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function toSafeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toSafeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toSafePaymentStatus(value: unknown): PaymentStatus {
  if (value === "approved") return "approved";
  if (value === "pending") return "pending";
  if (value === "rejected") return "rejected";
  if (value === "cancelled") return "cancelled";
  if (value === "expired") return "expired";
  return "failed";
}

function toSafeVerificationStatus(value: unknown): SavedMethod["verificationStatus"] {
  if (value === "verified") return "verified";
  if (value === "pending") return "pending";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  return "verified";
}

function sanitizePaymentOrder(input: unknown): PaymentOrder | null {
  const order = asRecord(input);
  if (!order) return null;

  const id = toSafeInteger(order.id);
  const orderNumber = toSafeInteger(order.orderNumber);
  const guildId = toSafeText(order.guildId);
  const method = order.method === "card" ? "card" : order.method === "pix" ? "pix" : null;
  const status = toSafePaymentStatus(order.status);
  const currency = toSafeText(order.currency, "BRL");
  const providerStatusDetail = toSafeNullableText(order.providerStatusDetail);
  const createdAt = toSafeText(order.createdAt);
  const technicalLabels = Array.isArray(order.technicalLabels)
    ? order.technicalLabels.filter(
        (label): label is string =>
          typeof label === "string" && label.trim().length > 0,
      )
    : [];

  if (id === null || orderNumber === null || !guildId || !method || !createdAt) {
    return null;
  }

  const cardRaw = asRecord(order.card);
  const card = cardRaw
    ? {
        brand: toSafeNullableText(cardRaw.brand),
        firstSix: toSafeNullableText(cardRaw.firstSix),
        lastFour: toSafeNullableText(cardRaw.lastFour),
        expMonth: toSafeInteger(cardRaw.expMonth),
        expYear: toSafeInteger(cardRaw.expYear),
      }
    : null;

  return {
    id,
    orderNumber,
    guildId,
    method,
    status,
    amount: toSafeNumber(order.amount),
    currency,
    providerStatusDetail,
    card,
    createdAt,
    technicalLabels,
  };
}

function sanitizeSavedMethod(input: unknown): SavedMethod | null {
  const method = asRecord(input);
  if (!method) return null;

  const id = toSafeText(method.id);
  const firstSix = toSafeText(method.firstSix);
  const lastFour = toSafeText(method.lastFour);
  const lastUsedAt = toSafeText(method.lastUsedAt);
  const timesUsed = toSafeInteger(method.timesUsed);

  if (!id || !/^[a-z0-9:_-]{1,120}$/i.test(id)) return null;
  if (!/^\d{6}$/.test(firstSix) || !/^\d{4}$/.test(lastFour)) return null;
  if (!lastUsedAt) return null;

  return {
    id,
    brand: toSafeNullableText(method.brand),
    firstSix,
    lastFour,
    expMonth: toSafeInteger(method.expMonth),
    expYear: toSafeInteger(method.expYear),
    lastUsedAt,
    timesUsed: timesUsed === null ? 0 : Math.max(0, timesUsed),
    nickname: toSafeNullableText(method.nickname),
    verificationStatus: toSafeVerificationStatus(method.verificationStatus),
    verificationStatusDetail: toSafeNullableText(method.verificationStatusDetail),
    verificationAmount: toSafeNullableNumber(method.verificationAmount),
    verifiedAt: toSafeNullableText(method.verifiedAt),
    lastContextGuildId: toSafeNullableText(method.lastContextGuildId),
  };
}

export function ServerSettingsEditor({
  guildId,
  guildName,
  status,
  daysUntilExpire = 0,
  daysUntilOff = 0,
  accessMode = "owner",
  canManage,
  allServers,
  initialTab = "settings",
  settingsSection = "overview",
  onTabChange: _onTabChange,
  onClose,
  standalone = false,
}: ServerSettingsEditorProps) {
  const cardPaymentsEnabled = areCardPaymentsEnabled();
  const showServerFinancialPanels = false;
  const [activeTab, setActiveTab] = useState<EditorTab>("settings");
  void _onTabChange;
  void onClose;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingEmbed, setIsSendingEmbed] = useState(false);
  const isSendingEmbedRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showSaveSuccessBar, setShowSaveSuccessBar] = useState(false);
  const [isPortalMounted, setIsPortalMounted] = useState(false);
  const [isSaveBarRendered, setIsSaveBarRendered] = useState(false);
  const [isSaveBarExiting, setIsSaveBarExiting] = useState(false);

  const [textChannelOptions, setTextChannelOptions] = useState<SelectOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<SelectOption[]>([]);
  const [roleOptions, setRoleOptions] = useState<SelectOption[]>([]);

  const [menuChannelId, setMenuChannelId] = useState<string | null>(null);
  const [ticketsCategoryId, setTicketsCategoryId] = useState<string | null>(null);
  const [logsCreatedChannelId, setLogsCreatedChannelId] = useState<string | null>(null);
  const [logsClosedChannelId, setLogsClosedChannelId] = useState<string | null>(null);
  const [panelLayout, setPanelLayout] = useState<TicketPanelLayout>(
    createDefaultTicketPanelLayout(),
  );
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [entryPublicChannelId, setEntryPublicChannelId] = useState<string | null>(null);
  const [entryLogChannelId, setEntryLogChannelId] = useState<string | null>(null);
  const [exitPublicChannelId, setExitPublicChannelId] = useState<string | null>(null);
  const [exitLogChannelId, setExitLogChannelId] = useState<string | null>(null);
  const [entryLayout, setEntryLayout] = useState<TicketPanelLayout>(
    createDefaultWelcomeEntryLayout(),
  );
  const [exitLayout, setExitLayout] = useState<TicketPanelLayout>(
    createDefaultWelcomeExitLayout(),
  );
  const [entryThumbnailMode, setEntryThumbnailMode] =
    useState<WelcomeThumbnailMode>("custom");
  const [exitThumbnailMode, setExitThumbnailMode] =
    useState<WelcomeThumbnailMode>("custom");

  const [adminRoleId, setAdminRoleId] = useState<string | null>(null);
  const [claimRoleIds, setClaimRoleIds] = useState<string[]>([]);
  const [closeRoleIds, setCloseRoleIds] = useState<string[]>([]);
  const [notifyRoleIds, setNotifyRoleIds] = useState<string[]>([]);
  const [savedSettingsDraft, setSavedSettingsDraft] =
    useState<ServerSettingsDraft | null>(null);
  const [savedWelcomeSettingsDraft, setSavedWelcomeSettingsDraft] =
    useState<WelcomeSettingsDraft | null>(null);
  const [isStaffCardCollapsed, setIsStaffCardCollapsed] = useState(true);
  const [welcomeMessageTab, setWelcomeMessageTab] = useState<"entry" | "exit">(
    "entry",
  );
  const [isWelcomeActivationModalOpen, setIsWelcomeActivationModalOpen] =
    useState(false);
  const [hasDismissedWelcomeModal, setHasDismissedWelcomeModal] =
    useState(false);
  const [isActivatingWelcome, setIsActivatingWelcome] = useState(false);

  const [isPaymentsLoading, setIsPaymentsLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [methods, setMethods] = useState<SavedMethod[]>([]);
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [paymentGuildFilter, setPaymentGuildFilter] = useState<string>(guildId);
  const [methodSearch, setMethodSearch] = useState("");
  const [methodStatusFilter, setMethodStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [methodGuildFilter, setMethodGuildFilter] = useState<string>(guildId);
  const [openMethodMenuId, setOpenMethodMenuId] = useState<string | null>(null);
  const [deletingMethodId, setDeletingMethodId] = useState<string | null>(null);
  const [savingMethodNicknameId, setSavingMethodNicknameId] = useState<string | null>(null);
  const [methodNicknameDrafts, setMethodNicknameDrafts] = useState<Record<string, string>>({});
  const [methodActionMessage, setMethodActionMessage] = useState<string | null>(null);
  const [isAddMethodModalOpen, setIsAddMethodModalOpen] = useState(false);
  const [isAddingMethod, setIsAddingMethod] = useState(false);
  const [isAddMethodSdkLoading, setIsAddMethodSdkLoading] = useState(false);
  const [isAddMethodSdkReady, setIsAddMethodSdkReady] = useState(false);
  const [addMethodFlowState, setAddMethodFlowState] = useState<
    "idle" | "preparing" | "validating" | "approved" | "rejected"
  >("idle");
  const [addMethodStatusMessage, setAddMethodStatusMessage] = useState<string | null>(null);
  const [addMethodError, setAddMethodError] = useState<string | null>(null);
  const [addMethodClientCooldownUntil, setAddMethodClientCooldownUntil] =
    useState<number | null>(null);
  const [addMethodClientCooldownRemainingSeconds, setAddMethodClientCooldownRemainingSeconds] =
    useState<number | null>(null);
  const [addMethodForm, setAddMethodForm] = useState({
    cardNumber: "",
    holderName: "",
    expiry: "",
    cvv: "",
    document: "",
    nickname: "",
  });
  const [addMethodTouchedFields, setAddMethodTouchedFields] = useState(
    createAddMethodTouchedFields,
  );

  const [isPlanLoading, setIsPlanLoading] = useState(true);
  const [isPlanSaving, setIsPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const [planSettings, setPlanSettings] = useState<PlanSettings | null>(null);
  const [isRecurringMethodModalOpen, setIsRecurringMethodModalOpen] =
    useState(false);
  const [recurringMethodDraftId, setRecurringMethodDraftId] = useState<
    string | null
  >(null);
  const [shouldEnableRecurringAfterMethodAdd, setShouldEnableRecurringAfterMethodAdd] =
    useState(false);

  useBodyScrollLock(
    isRecurringMethodModalOpen ||
      isAddMethodModalOpen ||
      isWelcomeActivationModalOpen,
  );

  const locked = status === "expired" || status === "off";
  const renewalWindowOpen = status === "paid" && daysUntilExpire <= 3;
  const canRenewPlan = status !== "paid" || renewalWindowOpen;
  const isViewerOnly = !(canManage ?? accessMode === "owner");
  const settingsReadOnly = locked || isViewerOnly;
  const viewerOnlyMessage =
    "Neste acesso o painel esta disponivel somente para visualizacao.";
  const financialViewerMessage =
    "As funcoes financeiras deste servidor ficam disponiveis apenas para a conta responsavel pela licenca ativa.";

  const applyDashboardSettingsPayload = useCallback(
    (payload: ServerDashboardSettingsPayload) => {
      const text = payload.channels.text.map((channel) => ({
        id: channel.id,
        name: `# ${channel.name}`,
      }));
      const categories = payload.channels.categories.map((channel) => ({
        id: channel.id,
        name: channel.name,
      }));
      const roleList = payload.roles as SelectOption[];

      setTextChannelOptions(text);
      setCategoryOptions(categories);
      setRoleOptions(roleList);

      const textSet = new Set(text.map((item) => item.id));
      const categorySet = new Set(categories.map((item) => item.id));
      const roleSet = new Set(roleList.map((item) => item.id));

      const nextMenuChannelId =
        payload.ticketSettings?.menuChannelId &&
        textSet.has(payload.ticketSettings.menuChannelId)
          ? payload.ticketSettings.menuChannelId
          : null;
      const nextTicketsCategoryId =
        payload.ticketSettings?.ticketsCategoryId &&
        categorySet.has(payload.ticketSettings.ticketsCategoryId)
          ? payload.ticketSettings.ticketsCategoryId
          : null;
      const nextLogsCreatedChannelId =
        payload.ticketSettings?.logsCreatedChannelId &&
        textSet.has(payload.ticketSettings.logsCreatedChannelId)
          ? payload.ticketSettings.logsCreatedChannelId
          : null;
      const nextLogsClosedChannelId =
        payload.ticketSettings?.logsClosedChannelId &&
        textSet.has(payload.ticketSettings.logsClosedChannelId)
          ? payload.ticketSettings.logsClosedChannelId
          : null;
      const nextPanelLayout = normalizeTicketPanelLayout(
        payload.ticketSettings?.panelLayout,
        payload.ticketSettings || undefined,
      );

      const defaultEntryLayout = createDefaultWelcomeEntryLayout();
      const defaultExitLayout = createDefaultWelcomeExitLayout();
      const hasWelcomeSettings = Boolean(payload.welcomeSettings);
      const defaultTextChannelId = text[0]?.id ?? null;
      const nextWelcomeEnabled = Boolean(payload.welcomeSettings?.enabled);
      const nextEntryPublicChannelId = hasWelcomeSettings
        ? payload.welcomeSettings?.entryPublicChannelId &&
          textSet.has(payload.welcomeSettings.entryPublicChannelId)
          ? payload.welcomeSettings.entryPublicChannelId
          : null
        : defaultTextChannelId;
      const nextEntryLogChannelId = hasWelcomeSettings
        ? payload.welcomeSettings?.entryLogChannelId &&
          textSet.has(payload.welcomeSettings.entryLogChannelId)
          ? payload.welcomeSettings.entryLogChannelId
          : null
        : defaultTextChannelId;
      const nextExitPublicChannelId = hasWelcomeSettings
        ? payload.welcomeSettings?.exitPublicChannelId &&
          textSet.has(payload.welcomeSettings.exitPublicChannelId)
          ? payload.welcomeSettings.exitPublicChannelId
          : null
        : defaultTextChannelId;
      const nextExitLogChannelId = hasWelcomeSettings
        ? payload.welcomeSettings?.exitLogChannelId &&
          textSet.has(payload.welcomeSettings.exitLogChannelId)
          ? payload.welcomeSettings.exitLogChannelId
          : null
        : defaultTextChannelId;
      const nextEntryLayout = hasWelcomeSettings
        ? normalizeWelcomeLayout(
            payload.welcomeSettings?.entryLayout,
            defaultEntryLayout,
          )
        : defaultEntryLayout;
      const nextExitLayout = hasWelcomeSettings
        ? normalizeWelcomeLayout(
            payload.welcomeSettings?.exitLayout,
            defaultExitLayout,
          )
        : defaultExitLayout;
      const nextEntryThumbnailMode =
        payload.welcomeSettings?.entryThumbnailMode === "avatar"
          ? "avatar"
          : "custom";
      const nextExitThumbnailMode =
        payload.welcomeSettings?.exitThumbnailMode === "avatar"
          ? "avatar"
          : "custom";

      const nextAdminRoleId =
        payload.staffSettings?.adminRoleId &&
        roleSet.has(payload.staffSettings.adminRoleId)
          ? payload.staffSettings.adminRoleId
          : null;
      const nextClaimRoleIds = Array.isArray(payload.staffSettings?.claimRoleIds)
          ? payload.staffSettings.claimRoleIds.filter((id) => roleSet.has(id))
          : [];
      const nextCloseRoleIds = Array.isArray(payload.staffSettings?.closeRoleIds)
          ? payload.staffSettings.closeRoleIds.filter((id) => roleSet.has(id))
          : [];
      const nextNotifyRoleIds = Array.isArray(payload.staffSettings?.notifyRoleIds)
          ? payload.staffSettings.notifyRoleIds.filter((id) => roleSet.has(id))
          : [];

      setMenuChannelId(nextMenuChannelId);
      setTicketsCategoryId(nextTicketsCategoryId);
      setLogsCreatedChannelId(nextLogsCreatedChannelId);
      setLogsClosedChannelId(nextLogsClosedChannelId);
      setPanelLayout(nextPanelLayout);
      setWelcomeEnabled(nextWelcomeEnabled);
      setEntryPublicChannelId(nextEntryPublicChannelId);
      setEntryLogChannelId(nextEntryLogChannelId);
      setExitPublicChannelId(nextExitPublicChannelId);
      setExitLogChannelId(nextExitLogChannelId);
      setEntryLayout(nextEntryLayout);
      setExitLayout(nextExitLayout);
      setEntryThumbnailMode(nextEntryThumbnailMode);
      setExitThumbnailMode(nextExitThumbnailMode);
      setAdminRoleId(nextAdminRoleId);
      setClaimRoleIds(nextClaimRoleIds);
      setCloseRoleIds(nextCloseRoleIds);
      setNotifyRoleIds(nextNotifyRoleIds);
      setSavedSettingsDraft(
        normalizeServerSettingsDraft({
          menuChannelId: nextMenuChannelId,
          ticketsCategoryId: nextTicketsCategoryId,
          logsCreatedChannelId: nextLogsCreatedChannelId,
          logsClosedChannelId: nextLogsClosedChannelId,
          panelLayout: nextPanelLayout,
          adminRoleId: nextAdminRoleId,
          claimRoleIds: nextClaimRoleIds,
          closeRoleIds: nextCloseRoleIds,
          notifyRoleIds: nextNotifyRoleIds,
        }),
      );
      setSavedWelcomeSettingsDraft(
        normalizeWelcomeSettingsDraft({
          enabled: nextWelcomeEnabled,
          entryPublicChannelId: nextEntryPublicChannelId,
          entryLogChannelId: nextEntryLogChannelId,
          exitPublicChannelId: nextExitPublicChannelId,
          exitLogChannelId: nextExitLogChannelId,
          entryLayout: nextEntryLayout,
          exitLayout: nextExitLayout,
          entryThumbnailMode: nextEntryThumbnailMode,
          exitThumbnailMode: nextExitThumbnailMode,
        }),
      );
    },
    [],
  );

  useEffect(() => {
    setActiveTab("settings");
    setSavedSettingsDraft(null);
    setSavedWelcomeSettingsDraft(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setShowSaveSuccessBar(false);
    setPanelLayout(createDefaultTicketPanelLayout());
    setWelcomeEnabled(false);
    setEntryPublicChannelId(null);
    setEntryLogChannelId(null);
    setExitPublicChannelId(null);
    setExitLogChannelId(null);
    setEntryLayout(createDefaultWelcomeEntryLayout());
    setExitLayout(createDefaultWelcomeExitLayout());
    setEntryThumbnailMode("custom");
    setExitThumbnailMode("custom");
    setWelcomeMessageTab("entry");
    setIsWelcomeActivationModalOpen(false);
    setHasDismissedWelcomeModal(false);
    setIsActivatingWelcome(false);
    setPaymentGuildFilter(guildId);
    setPaymentSearch("");
    setPaymentStatusFilter("all");
    setMethodGuildFilter(guildId);
    setMethodSearch("");
    setMethodStatusFilter("all");
    setOpenMethodMenuId(null);
    setDeletingMethodId(null);
    setSavingMethodNicknameId(null);
    setMethodActionMessage(null);
    setIsAddMethodModalOpen(false);
    setIsAddingMethod(false);
    setIsAddMethodSdkLoading(false);
    setIsAddMethodSdkReady(false);
    setAddMethodFlowState("idle");
    setAddMethodStatusMessage(null);
    setAddMethodError(null);
    setAddMethodForm({
      cardNumber: "",
      holderName: "",
      expiry: "",
      cvv: "",
      document: "",
      nickname: "",
    });
    setAddMethodTouchedFields(createAddMethodTouchedFields());
    setPlanError(null);
    setPlanSuccess(null);
    setIsRecurringMethodModalOpen(false);
    setRecurringMethodDraftId(null);
    setShouldEnableRecurringAfterMethodAdd(false);
  }, [guildId, initialTab]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!(target instanceof Element)) {
        setOpenMethodMenuId(null);
        return;
      }
      if (!target.closest("[data-method-menu-root='true']")) {
        setOpenMethodMenuId(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMethodMenuId(null);
        setIsRecurringMethodModalOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function prepareAddMethodSdk() {
      if (!isAddMethodModalOpen) return;

      setIsAddMethodSdkLoading(true);
      setIsAddMethodSdkReady(false);
      setAddMethodFlowState("preparing");
      setAddMethodStatusMessage("Preparando o cofre seguro do cartao...");
      setAddMethodError(null);

      try {
        try {
          await loadMercadoPagoSecuritySdk();
        } catch {
          // A identificacao do dispositivo sera tentada novamente ao enviar.
        }
        await loadMercadoPagoSdk();
        if (!cancelled) {
          setIsAddMethodSdkReady(true);
          setAddMethodFlowState("idle");
          setAddMethodStatusMessage(null);
        }
      } catch (error) {
        if (!cancelled) {
          setIsAddMethodSdkReady(false);
          setAddMethodFlowState("rejected");
          setAddMethodError(
            parseUnknownErrorMessage(error) ||
              "Nao foi possivel preparar o cofre seguro do cartao.",
          );
          setAddMethodStatusMessage(
            "Falha ao preparar o cofre seguro do cartao.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsAddMethodSdkLoading(false);
        }
      }
    }

    void prepareAddMethodSdk();

    return () => {
      cancelled = true;
    };
  }, [isAddMethodModalOpen]);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function loadSettings() {
      const cachedPayload = readCachedServerDashboardSettings(guildId);

      if (cachedPayload) {
        applyDashboardSettingsPayload(cachedPayload);
        setErrorMessage(null);
        setIsLoading(false);
      } else {
        setIsLoading(true);
        setErrorMessage(null);
      }

      try {
        const payload = await getServerDashboardSettings(guildId, {
          signal: controller.signal,
          preferCache: !cachedPayload,
        });

        if (!mounted) return;
        applyDashboardSettingsPayload(payload);
        setErrorMessage(null);
      } catch (error) {
        if (!mounted) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (!cachedPayload) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Erro ao carregar configuracoes.",
          );
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [applyDashboardSettingsPayload, guildId]);

  useEffect(() => {
    setMethodNicknameDrafts((current) => {
      const next: Record<string, string> = {};
      for (const method of methods) {
        next[method.id] = current[method.id] ?? method.nickname ?? "";
      }
      return next;
    });
  }, [methods]);

  useEffect(() => {
    let mounted = true;
    async function loadPayments() {
      if (!showServerFinancialPanels) {
        if (!mounted) return;
        setOrders([]);
        setMethods([]);
        setPaymentsError(null);
        setIsPaymentsLoading(false);
        return;
      }

      if (isViewerOnly) {
        if (!mounted) return;
        setOrders([]);
        setMethods([]);
        setPaymentsError(null);
        setIsPaymentsLoading(false);
        return;
      }

      setIsPaymentsLoading(true);
      setPaymentsError(null);
      try {
        const response = await fetch("/api/auth/me/payments/history", { cache: "no-store" });
        const payload = await response.json();
        if (!mounted) return;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Falha ao carregar pagamentos.");
        }
        const safeOrders = Array.isArray(payload.orders)
          ? payload.orders
              .map((order: unknown) => sanitizePaymentOrder(order))
              .filter((order: PaymentOrder | null): order is PaymentOrder => Boolean(order))
          : [];
        const safeMethods = Array.isArray(payload.methods)
          ? payload.methods
              .map((method: unknown) => sanitizeSavedMethod(method))
              .filter((method: SavedMethod | null): method is SavedMethod => Boolean(method))
          : [];

        setOrders(safeOrders);
        setMethods(safeMethods);
      } catch (error) {
        if (!mounted) return;
        setPaymentsError(error instanceof Error ? error.message : "Erro ao carregar pagamentos.");
      } finally {
        if (mounted) setIsPaymentsLoading(false);
      }
    }
    void loadPayments();
    return () => {
      mounted = false;
    };
  }, [isViewerOnly, showServerFinancialPanels]);

  useEffect(() => {
    let mounted = true;

    async function loadPlan() {
      if (!showServerFinancialPanels) {
        if (!mounted) return;
        setPlanSettings(null);
        setPlanError(null);
        setIsPlanLoading(false);
        return;
      }

      if (isViewerOnly) {
        if (!mounted) return;
        setPlanSettings({
          planCode: "pro",
          monthlyAmount: 9.99,
          currency: "BRL",
          recurringEnabled: false,
          recurringMethodId: null,
          recurringMethod: null,
          availableMethods: [],
          availableMethodsCount: 0,
          createdAt: null,
          updatedAt: null,
        });
        setPlanError(null);
        setIsPlanLoading(false);
        return;
      }

      setIsPlanLoading(true);
      setPlanError(null);
      try {
        const response = await fetch(
          `/api/auth/me/servers/plans?guildId=${guildId}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as PlanApiResponse;

        if (!mounted) return;

        if (!response.ok || !payload.ok || !payload.plan) {
          throw new Error(payload.message || "Falha ao carregar plano do servidor.");
        }

        setPlanSettings(payload.plan);
      } catch (error) {
        if (!mounted) return;
        setPlanSettings(null);
        setPlanError(
          error instanceof Error ? error.message : "Erro ao carregar plano.",
        );
      } finally {
        if (mounted) setIsPlanLoading(false);
      }
    }

    void loadPlan();

    return () => {
      mounted = false;
    };
  }, [guildId, isViewerOnly, showServerFinancialPanels]);

  const serverMap = useMemo(() => {
    const map = new Map<string, { guildName: string; iconUrl: string | null }>();
    for (const server of allServers) {
      map.set(server.guildId, { guildName: server.guildName, iconUrl: server.iconUrl });
    }
    if (!map.has(guildId)) {
      map.set(guildId, { guildName, iconUrl: null });
    }
    return map;
  }, [allServers, guildId, guildName]);

  const serverOptions = useMemo(() => {
    const options = Array.from(serverMap.entries()).map(([id, info]) => ({ id, name: info.guildName }));
    options.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return [{ id: "all", name: "Todos servidores" }, ...options];
  }, [serverMap]);

  const filteredOrders = useMemo(() => {
    const search = normalizeSearch(paymentSearch);
    return orders.filter((order) => {
      if (paymentStatusFilter !== "all" && order.status !== paymentStatusFilter) return false;
      if (paymentGuildFilter !== "all" && order.guildId !== paymentGuildFilter) return false;
      if (!search) return true;
      const guildLabel = serverMap.get(order.guildId)?.guildName || order.guildId;
      const technicalText = order.technicalLabels.join(" ");
      const text = normalizeSearch(`${order.orderNumber} ${order.guildId} ${guildLabel} ${order.method} ${order.status} ${technicalText}`);
      return text.includes(search);
    });
  }, [orders, paymentGuildFilter, paymentSearch, paymentStatusFilter, serverMap]);

  const cardOrdersByMethod = useMemo(() => {
    const map = new Map<string, PaymentOrder[]>();
    for (const order of orders) {
      if (order.method !== "card" || !order.card?.firstSix || !order.card?.lastFour) continue;
      const methodKey = [
        (order.card.brand || "card").toLowerCase(),
        order.card.firstSix,
        order.card.lastFour,
        order.card.expMonth ?? "",
        order.card.expYear ?? "",
      ].join(":");

      const current = map.get(methodKey) || [];
      current.push(order);
      map.set(methodKey, current);
    }
    return map;
  }, [orders]);

  const filteredMethods = useMemo(() => {
    const search = normalizeSearch(methodSearch);

    return methods.filter((method) => {
      const relatedOrders = cardOrdersByMethod.get(method.id) || [];
      const fallbackGuildId = method.lastContextGuildId || null;

      if (methodStatusFilter !== "all") {
        const matchesStatus = relatedOrders.some((order) => order.status === methodStatusFilter);
        if (!matchesStatus) return false;
      }

      if (methodGuildFilter !== "all") {
        const matchesGuild = relatedOrders.some((order) => order.guildId === methodGuildFilter);
        const matchesFallbackGuild =
          relatedOrders.length === 0 && fallbackGuildId === methodGuildFilter;
        if (!matchesGuild && !matchesFallbackGuild) return false;
      }

      if (!search) return true;

      const brandLabel = cardBrandLabel(method.brand);
      const masked = `${method.firstSix} ${method.lastFour}`;
      const nickname = (method.nickname || "").trim();
      const relatedServerNames = relatedOrders
        .map((order) => serverMap.get(order.guildId)?.guildName || order.guildId)
        .join(" ");
      const fallbackServerName = fallbackGuildId
        ? serverMap.get(fallbackGuildId)?.guildName || fallbackGuildId
        : "";
      const relatedStatuses = relatedOrders.map((order) => order.status).join(" ");
      const verificationLabel =
        method.verificationStatus === "verified"
          ? "verificado"
          : method.verificationStatus === "pending"
            ? "pendente"
            : method.verificationStatus === "failed"
              ? "falhou"
              : "cancelado";
      const haystack = normalizeSearch(
        `${brandLabel} ${nickname} ${masked} ${relatedServerNames} ${fallbackServerName} ${relatedStatuses} ${verificationLabel}`,
      );
      return haystack.includes(search);
    });
  }, [
    cardOrdersByMethod,
    methodGuildFilter,
    methodSearch,
    methodStatusFilter,
    methods,
    serverMap,
  ]);

  const methodById = useMemo(
    () => new Map(methods.map((method) => [method.id, method])),
    [methods],
  );

  const recurringMethod = useMemo(() => {
    if (!planSettings?.recurringMethodId) return null;
    return (
      methodById.get(planSettings.recurringMethodId) ||
      planSettings.recurringMethod ||
      null
    );
  }, [methodById, planSettings]);

  const recurringMethodOptions = useMemo(() => {
    const fromPlan = planSettings?.availableMethods || [];
    if (fromPlan.length) return fromPlan;
    return methods;
  }, [methods, planSettings?.availableMethods]);

  const addMethodCardDigits = useMemo(
    () => normalizeCardDigits(addMethodForm.cardNumber),
    [addMethodForm.cardNumber],
  );

  const addMethodCardBrand = useMemo(
    () => detectCardBrand(addMethodCardDigits),
    [addMethodCardDigits],
  );

  const addMethodExpiryDigits = useMemo(
    () => normalizeCardExpiryDigits(addMethodForm.expiry),
    [addMethodForm.expiry],
  );

  const addMethodCvvDigits = useMemo(
    () => normalizeCardCvvInput(addMethodForm.cvv),
    [addMethodForm.cvv],
  );

  const addMethodBrandIconPath = useMemo(
    () => cardBrandIcon(addMethodCardBrand),
    [addMethodCardBrand],
  );
  const addMethodBrandIconSafePath = useMemo(
    () =>
      typeof addMethodBrandIconPath === "string" &&
      addMethodBrandIconPath.startsWith("/")
        ? addMethodBrandIconPath
        : "/cdn/icons/card_.png",
    [addMethodBrandIconPath],
  );

  const addMethodDocumentDigits = useMemo(
    () => normalizeBrazilDocumentDigits(addMethodForm.document),
    [addMethodForm.document],
  );

  const addMethodValidationErrors = useMemo(() => {
    return resolveAddMethodValidationErrors({
      cardDigits: addMethodCardDigits,
      cardBrand: addMethodCardBrand,
      holderName: addMethodForm.holderName,
      expiry: addMethodForm.expiry,
      expiryDigits: addMethodExpiryDigits,
      cvvDigits: addMethodCvvDigits,
      documentDigits: addMethodDocumentDigits,
      nickname: addMethodForm.nickname,
    });
  }, [
    addMethodCardBrand,
    addMethodCardDigits,
    addMethodCvvDigits,
    addMethodDocumentDigits,
    addMethodForm.expiry,
    addMethodForm.holderName,
    addMethodForm.nickname,
    addMethodExpiryDigits,
  ]);
  const addMethodVisibleErrors = useMemo(
    () => ({
      cardNumber: addMethodTouchedFields.cardNumber
        ? addMethodValidationErrors.cardNumber
        : null,
      holderName: addMethodTouchedFields.holderName
        ? addMethodValidationErrors.holderName
        : null,
      expiry: addMethodTouchedFields.expiry
        ? addMethodValidationErrors.expiry
        : null,
      cvv: addMethodTouchedFields.cvv ? addMethodValidationErrors.cvv : null,
      document: addMethodTouchedFields.document
        ? addMethodValidationErrors.document
        : null,
      nickname: addMethodTouchedFields.nickname
        ? addMethodValidationErrors.nickname
        : null,
    }),
    [addMethodTouchedFields, addMethodValidationErrors],
  );

  const addMethodCanSubmit = useMemo(() => {
    return Boolean(
      addMethodCardDigits &&
        addMethodForm.holderName.trim() &&
        addMethodExpiryDigits.length === 4 &&
        addMethodCvvDigits &&
        addMethodDocumentDigits &&
        Object.values(addMethodValidationErrors).every((error) => !error),
    );
  }, [
    addMethodCardDigits,
    addMethodCvvDigits,
    addMethodDocumentDigits,
    addMethodExpiryDigits.length,
    addMethodForm.holderName,
    addMethodValidationErrors,
  ]);
  const addMethodCooldownMessage = useMemo(
    () => formatCooldownMessage(addMethodClientCooldownRemainingSeconds),
    [addMethodClientCooldownRemainingSeconds],
  );

  const serverSettingsControlHeight = 60;

  const openAddMethodModal = useCallback(
    (options?: { enableRecurringAfterAdd?: boolean }) => {
      if (isViewerOnly) {
        setPaymentsError(null);
        setMethodActionMessage(financialViewerMessage);
        setPlanSuccess(null);
        setPlanError(financialViewerMessage);
        return;
      }

      if (!cardPaymentsEnabled) {
        setAddMethodFlowState("idle");
        setAddMethodStatusMessage(null);
        setAddMethodError(null);
        setShouldEnableRecurringAfterMethodAdd(false);
        if (options?.enableRecurringAfterAdd) {
          setPlanSuccess(null);
          setPlanError(CARD_RECURRING_DISABLED_MESSAGE);
        } else {
          setPaymentsError(null);
          setMethodActionMessage(CARD_PAYMENTS_DISABLED_MESSAGE);
        }
        return;
      }

      setAddMethodFlowState("idle");
      setAddMethodStatusMessage(null);
      setAddMethodError(null);
      setAddMethodTouchedFields(createAddMethodTouchedFields());
      setShouldEnableRecurringAfterMethodAdd(
        Boolean(options?.enableRecurringAfterAdd),
      );
      setIsAddMethodModalOpen(true);
    },
    [cardPaymentsEnabled, financialViewerMessage, isViewerOnly],
  );

  const closeAddMethodModal = useCallback(() => {
    if (isAddingMethod) return;
    setAddMethodFlowState("idle");
    setAddMethodStatusMessage(null);
    setAddMethodError(null);
    setAddMethodClientCooldownUntil(null);
    setAddMethodClientCooldownRemainingSeconds(null);
    setAddMethodTouchedFields(createAddMethodTouchedFields());
    setShouldEnableRecurringAfterMethodAdd(false);
    setIsAddMethodModalOpen(false);
  }, [isAddingMethod]);

  useEffect(() => {
    if (!addMethodClientCooldownUntil) {
      setAddMethodClientCooldownRemainingSeconds(null);
      return;
    }

    const syncRemaining = () => {
      const nextSeconds = Math.max(
        0,
        Math.ceil((addMethodClientCooldownUntil - Date.now()) / 1000),
      );
      if (nextSeconds <= 0) {
        setAddMethodClientCooldownUntil(null);
        setAddMethodClientCooldownRemainingSeconds(null);
        return;
      }

      setAddMethodClientCooldownRemainingSeconds(nextSeconds);
    };

    syncRemaining();
    const intervalId = window.setInterval(syncRemaining, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [addMethodClientCooldownUntil]);

  const markAddMethodFieldTouched = useCallback((field: AddMethodFieldKey) => {
    setAddMethodTouchedFields((current) =>
      current[field] ? current : { ...current, [field]: true },
    );
  }, []);

  const clearAddMethodRealtimeFeedback = useCallback(() => {
    setAddMethodError(null);
    setAddMethodFlowState((current) =>
      current === "rejected" ? "idle" : current,
    );
    setAddMethodStatusMessage((current) =>
      current && current !== "Cartao salvo e liberado para uso no sistema."
        ? null
        : current,
    );
  }, []);

  const isTicketSection =
    settingsSection === "overview" || settingsSection === "message";
  const isWelcomeSection =
    settingsSection === "entry_exit_overview" ||
    settingsSection === "entry_exit_message";
  const isTicketMessageSection = settingsSection === "message";
  const isWelcomeMessageSection = settingsSection === "entry_exit_message";

  const entryChannelsProvided = Boolean(
    entryPublicChannelId || entryLogChannelId,
  );
  const exitChannelsProvided = Boolean(exitPublicChannelId || exitLogChannelId);
  const isEntryLayoutValid = !entryChannelsProvided || welcomeLayoutHasContent(entryLayout);
  const isExitLayoutValid = !exitChannelsProvided || welcomeLayoutHasContent(exitLayout);

  const canSaveTicket = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      menuChannelId &&
      ticketsCategoryId &&
      logsCreatedChannelId &&
      logsClosedChannelId &&
      panelLayout.length &&
      ticketPanelLayoutHasRequiredParts(panelLayout) &&
      ticketPanelLayoutHasAtMostOneFunctionButton(panelLayout) &&
      adminRoleId &&
      claimRoleIds.length &&
      closeRoleIds.length &&
      notifyRoleIds.length,
  );

  const canSaveWelcome = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      welcomeEnabled &&
      entryChannelsProvided &&
      exitChannelsProvided &&
      isEntryLayoutValid &&
      isExitLayoutValid,
  );

  const canSendEmbed = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      !isSendingEmbed &&
      menuChannelId &&
      panelLayout.length &&
      ticketPanelLayoutHasRequiredParts(panelLayout) &&
      ticketPanelLayoutHasAtMostOneFunctionButton(panelLayout),
  );

  const currentSettingsDraft = useMemo(
    () =>
      normalizeServerSettingsDraft({
        menuChannelId,
        ticketsCategoryId,
        logsCreatedChannelId,
        logsClosedChannelId,
        panelLayout,
        adminRoleId,
        claimRoleIds,
        closeRoleIds,
        notifyRoleIds,
      }),
    [
      adminRoleId,
      claimRoleIds,
      closeRoleIds,
      logsClosedChannelId,
      logsCreatedChannelId,
      menuChannelId,
      notifyRoleIds,
      panelLayout,
      ticketsCategoryId,
    ],
  );

  const currentWelcomeDraft = useMemo(
    () =>
      normalizeWelcomeSettingsDraft({
        enabled: welcomeEnabled,
        entryPublicChannelId,
        entryLogChannelId,
        exitPublicChannelId,
        exitLogChannelId,
        entryLayout,
        exitLayout,
        entryThumbnailMode,
        exitThumbnailMode,
      }),
    [
      entryLayout,
      entryLogChannelId,
      entryPublicChannelId,
      entryThumbnailMode,
      exitLayout,
      exitLogChannelId,
      exitPublicChannelId,
      exitThumbnailMode,
      welcomeEnabled,
    ],
  );

  const hasLoadedTicketDraft = !isLoading && savedSettingsDraft !== null;
  const hasLoadedWelcomeDraft = !isLoading && savedWelcomeSettingsDraft !== null;
  const hasTicketUnsavedChanges = useMemo(
    () =>
      hasLoadedTicketDraft &&
      !areServerSettingsDraftsEqual(currentSettingsDraft, savedSettingsDraft),
    [currentSettingsDraft, hasLoadedTicketDraft, savedSettingsDraft],
  );
  const hasWelcomeUnsavedChanges = useMemo(
    () =>
      hasLoadedWelcomeDraft &&
      !areWelcomeSettingsDraftsEqual(currentWelcomeDraft, savedWelcomeSettingsDraft),
    [currentWelcomeDraft, hasLoadedWelcomeDraft, savedWelcomeSettingsDraft],
  );

  const hasLoadedSettingsDraft = isWelcomeSection
    ? hasLoadedWelcomeDraft
    : hasLoadedTicketDraft;
  const hasUnsavedChanges = isWelcomeSection
    ? hasWelcomeUnsavedChanges
    : hasTicketUnsavedChanges;

  const canResetSettings = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      hasUnsavedChanges &&
      (isWelcomeSection ? savedWelcomeSettingsDraft : savedSettingsDraft),
  );

  const functionButtonCount = countTicketPanelFunctionButtons(panelLayout);
  const hasTooManyFunctionButtons = functionButtonCount > 1;
  const isTicketMessageLayoutInvalid =
    !ticketPanelLayoutHasRequiredParts(panelLayout) ||
    hasTooManyFunctionButtons;
  const isWelcomeMessageLayoutInvalid =
    !isEntryLayoutValid || !isExitLayoutValid;
  const canPersistSettings = Boolean(
    (isWelcomeSection ? canSaveWelcome : canSaveTicket) && hasUnsavedChanges,
  );
  const showFloatingSaveBar =
    activeTab === "settings" &&
    !settingsReadOnly &&
    hasLoadedSettingsDraft &&
    (hasUnsavedChanges || isSaving || showSaveSuccessBar);
  const showSaveBarActions = !showSaveSuccessBar || hasUnsavedChanges || isSaving;
  const showInlineMessages = Boolean(
    isViewerOnly || locked || errorMessage,
  );
  const welcomeControlsDisabled =
    isSaving || settingsReadOnly || !welcomeEnabled || isActivatingWelcome;
  const showInvalidTicketSaveState =
    isTicketMessageSection &&
    hasUnsavedChanges &&
    !isSaving &&
    !showSaveSuccessBar &&
    isTicketMessageLayoutInvalid;
  const showInvalidWelcomeSaveState =
    isWelcomeMessageSection &&
    hasUnsavedChanges &&
    !isSaving &&
    !showSaveSuccessBar &&
    isWelcomeMessageLayoutInvalid;
  const showSaveBarSuccessState =
    showSaveSuccessBar &&
    !hasUnsavedChanges &&
    !isSaving;
  const saveActionVisualEnabled = canPersistSettings || isSaving;
  const floatingSaveBarTitle = showSaveBarSuccessState
    ? "Configuracoes salvas com sucesso."
    : isSaving
    ? "Salvando alteracoes do servidor..."
    : errorMessage
      ? "Nao foi possivel salvar agora"
      : showInvalidTicketSaveState
        ? hasTooManyFunctionButtons
          ? "Existe mais de um botao funcional no embed"
          : "Nao da para salvar uma mensagem vazia"
        : showInvalidWelcomeSaveState
          ? "Adicione pelo menos um conteudo na mensagem"
          : !canPersistSettings && hasUnsavedChanges
            ? isWelcomeSection
              ? "Complete os canais de entrada e saida para continuar"
              : "Complete os campos obrigatorios para continuar"
            : "Cuidado — voce tem alteracoes que nao foram salvas!";
  const floatingSaveBarDescription = showSaveBarSuccessState
    ? "Tudo ficou sincronizado e o painel ja esta atualizado para a equipe."
    : isSaving
    ? "Estamos sincronizando canais e cargos deste servidor com o painel."
      : errorMessage
      ? errorMessage
      : showInvalidTicketSaveState
        ? hasTooManyFunctionButtons
          ? "Deixe apenas um botao funcional para abrir o ticket. Botoes de link podem continuar em quantidade livre."
          : "Adicione pelo menos um conteudo com texto e uma acao no builder antes de salvar. Enquanto a mensagem estiver sem nada, essa barra continua em alerta."
        : showInvalidWelcomeSaveState
          ? "Preencha a mensagem de entrada ou saida com pelo menos um bloco de texto."
        : !canPersistSettings && hasUnsavedChanges
          ? isWelcomeSection
            ? "Defina canais publicos e privados para entrada e saida antes de salvar."
            : "Preencha todos os campos de ticket e staff para liberar o salvamento."
          : "Revise os campos abaixo e confirme para manter a operacao deste servidor atualizada.";

  useEffect(() => {
    setIsPortalMounted(true);
  }, []);

  useEffect(() => {
    setIsStaffCardCollapsed(true);
  }, [guildId]);

  useEffect(() => {
    if (hasUnsavedChanges && successMessage) {
      setSuccessMessage(null);
    }
    if (hasUnsavedChanges && showSaveSuccessBar) {
      setShowSaveSuccessBar(false);
    }
  }, [hasUnsavedChanges, showSaveSuccessBar, successMessage]);

  useEffect(() => {
    if (!showSaveSuccessBar) return;

    const timeoutId = window.setTimeout(() => {
      setShowSaveSuccessBar(false);
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [showSaveSuccessBar]);

  const activeWelcomeLayout =
    welcomeMessageTab === "entry" ? entryLayout : exitLayout;
  const activeWelcomeThumbnailMode =
    welcomeMessageTab === "entry" ? entryThumbnailMode : exitThumbnailMode;
  const activeWelcomeThumbnailPreviewUrl =
    activeWelcomeThumbnailMode === "avatar"
      ? "/cdn/icons/discord-icon.svg"
      : null;

  const handleWelcomeLayoutChange = useCallback(
    (nextLayout: TicketPanelLayout) => {
      if (welcomeMessageTab === "entry") {
        setEntryLayout(nextLayout);
        return;
      }
      setExitLayout(nextLayout);
    },
    [welcomeMessageTab],
  );

  const handleWelcomeThumbnailModeChange = useCallback(
    (mode: WelcomeThumbnailMode) => {
      if (welcomeMessageTab === "entry") {
        setEntryThumbnailMode(mode);
        return;
      }
      setExitThumbnailMode(mode);
    },
    [welcomeMessageTab],
  );

  useEffect(() => {
    if (showFloatingSaveBar) {
      setIsSaveBarRendered(true);
      setIsSaveBarExiting(false);
      return;
    }

    if (!isSaveBarRendered) return;

    setIsSaveBarExiting(true);
    const timeoutId = window.setTimeout(() => {
      setIsSaveBarRendered(false);
      setIsSaveBarExiting(false);
    }, 260);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isSaveBarRendered, showFloatingSaveBar]);

  const persistPlanSettings = useCallback(
    async (input: {
      recurringEnabled: boolean;
      recurringMethodId: string | null;
      successMessage: string;
    }) => {
      if (isViewerOnly) {
        setPlanSuccess(null);
        setPlanError(financialViewerMessage);
        return null;
      }

      if (isPlanSaving) return null;

      setIsPlanSaving(true);
      setPlanError(null);
      setPlanSuccess(null);

      try {
        const response = await fetch("/api/auth/me/servers/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            recurringEnabled: input.recurringEnabled,
            recurringMethodId: input.recurringMethodId,
          }),
        });
        const payload = (await response.json()) as PlanApiResponse;

        if (!response.ok || !payload.ok || !payload.plan) {
          throw new Error(payload.message || "Falha ao atualizar recorrencia.");
        }

        setPlanSettings(payload.plan);
        setPlanSuccess(input.successMessage);
        return payload.plan;
      } catch (error) {
        setPlanError(
          error instanceof Error
            ? error.message
            : "Erro ao atualizar recorrencia.",
        );
        return null;
      } finally {
        setIsPlanSaving(false);
      }
    },
    [financialViewerMessage, guildId, isPlanSaving, isViewerOnly],
  );

  const handleToggleRecurring = useCallback(async () => {
    if (isViewerOnly) {
      setPlanSuccess(null);
      setPlanError(financialViewerMessage);
      return;
    }

    if (!planSettings || isPlanSaving) return;

    if (planSettings.recurringEnabled) {
      setIsRecurringMethodModalOpen(false);
      setRecurringMethodDraftId(null);
      setShouldEnableRecurringAfterMethodAdd(false);
      await persistPlanSettings({
        recurringEnabled: false,
        recurringMethodId: null,
        successMessage: "Cobranca recorrente desativada com sucesso.",
      });
      return;
    }

    if (!cardPaymentsEnabled) {
      setPlanSuccess(null);
      setPlanError(CARD_RECURRING_DISABLED_MESSAGE);
      return;
    }

    const fallbackMethodId =
      planSettings.recurringMethodId || recurringMethodOptions[0]?.id || null;

    if (!fallbackMethodId) {
      setPlanError(
        "Salve um cartao verificado para ativar a cobranca recorrente deste servidor.",
      );
      setPlanSuccess(null);
      openAddMethodModal({ enableRecurringAfterAdd: true });
      return;
    }

    if (recurringMethodOptions.length > 1) {
      setPlanError(null);
      setPlanSuccess(null);
      setRecurringMethodDraftId(fallbackMethodId);
      setIsRecurringMethodModalOpen(true);
      return;
    }

    await persistPlanSettings({
      recurringEnabled: true,
      recurringMethodId: fallbackMethodId,
      successMessage: "Cobranca recorrente ativada com sucesso.",
    });
  }, [
    cardPaymentsEnabled,
    isPlanSaving,
    openAddMethodModal,
    persistPlanSettings,
    planSettings,
    recurringMethodOptions,
    financialViewerMessage,
    isViewerOnly,
  ]);

  const handleRenewByPix = useCallback(() => {
    if (isViewerOnly) {
      setPlanSuccess(null);
      setPlanError(financialViewerMessage);
      return;
    }

    const params = new URLSearchParams({
      guild: guildId,
      method: "pix",
      renew: "1",
      return: "servers",
      returnGuild: guildId,
      returnTab: "plans",
    });

    window.location.assign(`/config?${params.toString()}#/payment`);
  }, [financialViewerMessage, guildId, isViewerOnly]);

  const handleDeleteMethod = useCallback(
    async (methodId: string) => {
      if (deletingMethodId) return;

      setDeletingMethodId(methodId);
      setMethodActionMessage(null);
      setOpenMethodMenuId(null);
      setPaymentsError(null);

      try {
        const response = await fetch("/api/auth/me/payments/methods", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            methodId,
          }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          message?: string;
        };

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Falha ao remover metodo.");
        }

        setMethods((current) => current.filter((method) => method.id !== methodId));
        setMethodActionMessage("Metodo removido com sucesso.");
        setMethodNicknameDrafts((current) => {
          const next = { ...current };
          delete next[methodId];
          return next;
        });
        setPlanSettings((current) =>
          current
            ? {
                ...current,
                availableMethods: (current.availableMethods || []).filter(
                  (method) => method.id !== methodId,
                ),
              }
            : current,
        );

        if (planSettings?.recurringMethodId === methodId) {
          setPlanSettings((current) =>
            current
              ? {
                  ...current,
                  recurringMethodId: null,
                  recurringMethod: null,
                }
              : current,
          );
        }
      } catch (error) {
        setPaymentsError(
          error instanceof Error
            ? error.message
            : "Erro ao remover metodo de pagamento.",
        );
      } finally {
        setDeletingMethodId(null);
      }
    },
    [deletingMethodId, guildId, planSettings?.recurringMethodId],
  );

  const handleSaveMethodNickname = useCallback(
    async (methodId: string) => {
      if (savingMethodNicknameId) return;

      const nickname = (methodNicknameDrafts[methodId] || "").trim();
      setSavingMethodNicknameId(methodId);
      setPaymentsError(null);
      setMethodActionMessage(null);

      try {
        const response = await fetch("/api/auth/me/payments/methods", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            methodId,
            nickname,
          }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          message?: string;
          method?: SavedMethod;
        };

        if (!response.ok || !payload.ok || !payload.method) {
          throw new Error(payload.message || "Falha ao salvar apelido.");
        }

        setMethods((current) =>
          current.map((method) =>
            method.id === methodId ? { ...method, nickname: payload.method?.nickname || null } : method,
          ),
        );
        setPlanSettings((current) =>
          current
            ? {
                ...current,
                recurringMethod:
                  current.recurringMethodId === methodId && current.recurringMethod
                    ? {
                        ...current.recurringMethod,
                        nickname: payload.method?.nickname || null,
                      }
                    : current.recurringMethod,
                availableMethods: (current.availableMethods || []).map((method) =>
                  method.id === methodId
                    ? {
                        ...method,
                        nickname: payload.method?.nickname || null,
                      }
                    : method,
                ),
              }
            : current,
        );
        setMethodActionMessage("Apelido salvo com sucesso.");
      } catch (error) {
        setPaymentsError(
          error instanceof Error
            ? error.message
            : "Erro ao salvar apelido do cartao.",
        );
      } finally {
        setSavingMethodNicknameId(null);
      }
    },
    [guildId, methodNicknameDrafts, savingMethodNicknameId],
  );

  const handleAddMethodSubmit = useCallback(async () => {
    if (!addMethodCanSubmit || isAddingMethod || isAddMethodSdkLoading) {
      setAddMethodTouchedFields({
        cardNumber: true,
        holderName: true,
        expiry: true,
        cvv: true,
        document: true,
        nickname: true,
      } satisfies Record<AddMethodFieldKey, boolean>);
      setAddMethodFlowState("idle");
      setAddMethodStatusMessage(null);
      setAddMethodError("Revise os campos destacados para continuar.");
      return;
    }
    if (
      addMethodClientCooldownUntil &&
      Date.now() < addMethodClientCooldownUntil
    ) {
      const remainingMessage = formatCooldownMessage(
        Math.max(
          1,
          Math.ceil((addMethodClientCooldownUntil - Date.now()) / 1000),
        ),
      );
      setAddMethodFlowState("rejected");
      setAddMethodStatusMessage("Nova tentativa bloqueada temporariamente.");
      setAddMethodError(
        remainingMessage ||
          "Aguarde alguns instantes para validar este cartao novamente.",
      );
      return;
    }

    const holderName = addMethodForm.holderName.trim().replace(/\s+/g, " ");
    const documentType = resolveBrazilDocumentType(addMethodDocumentDigits);
    const publicKey = resolveCardPublicKey();
    const fallbackPaymentMethodId =
      resolveCardPaymentMethodIdFromBrand(addMethodCardBrand);

    if (!documentType) {
      setAddMethodError("CPF/CNPJ invalido para validar o cartao.");
      return;
    }

    if (!publicKey) {
      setAddMethodError(
        "Chave publica do Mercado Pago nao configurada para validar o cartao.",
      );
      return;
    }

    if (!fallbackPaymentMethodId) {
      setAddMethodError("Nao foi possivel identificar a bandeira do cartao.");
      return;
    }

    setIsAddingMethod(true);
    setAddMethodError(null);
    setMethodActionMessage(null);
    setPaymentsError(null);
    setAddMethodFlowState("validating");
    setAddMethodStatusMessage(
      isAddMethodSdkReady
        ? "Salvando o cartao no cofre seguro do Mercado Pago..."
        : "Preparando o ambiente seguro do cartao...",
    );

    try {
      await loadMercadoPagoSdk();

      if (!isAddMethodSdkReady) {
        setIsAddMethodSdkReady(true);
      }

      try {
        await loadMercadoPagoSecuritySdk();
      } catch {
        setAddMethodStatusMessage(
          "Continuando com a validacao reforcada do cartao...",
        );
      }

      if (!window.MercadoPago) {
        throw new Error("SDK do Mercado Pago indisponivel para validar o cartao.");
      }

      const mercadoPago = new window.MercadoPago(publicKey, {
        locale: "pt-BR",
      });
      const deviceSessionId = resolveMercadoPagoDeviceSessionId();
      let requestId: string | null = null;

      let tokenPayload: MercadoPagoCardTokenPayload;
      try {
        setAddMethodStatusMessage("Protegendo e tokenizando os dados do cartao...");
        tokenPayload = await mercadoPago.createCardToken({
          cardNumber: addMethodCardDigits,
          cardholderName: holderName,
          identificationType: documentType,
          identificationNumber: addMethodDocumentDigits,
          securityCode: addMethodCvvDigits,
          cardExpirationMonth: addMethodExpiryDigits.slice(0, 2),
          cardExpirationYear: `20${addMethodExpiryDigits.slice(2, 4)}`,
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
            "Falha ao tokenizar o cartao para salvamento seguro.",
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

      const expMonth = Number(addMethodExpiryDigits.slice(0, 2));
      const expYear = Number(addMethodExpiryDigits.slice(2, 4)) + 2000;
      const nickname = addMethodForm.nickname.trim().replace(/\s+/g, " ");

      setAddMethodStatusMessage(
        "Registrando o cartao no cofre seguro do Mercado Pago...",
      );
      const response = await fetch("/api/auth/me/payments/methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          brand: addMethodCardBrand,
          firstSix: addMethodCardDigits.slice(0, 6),
          lastFour: addMethodCardDigits.slice(-4),
          expMonth: Number.isInteger(expMonth) ? expMonth : null,
          expYear: Number.isInteger(expYear) ? expYear : null,
          nickname,
          payerName: holderName,
          payerDocument: addMethodDocumentDigits,
          cardToken,
          paymentMethodId,
          issuerId,
          deviceSessionId,
        }),
      });
      requestId = resolveResponseRequestId(response);

      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        retryAfterSeconds?: number;
        method?: SavedMethod;
        alreadyVerified?: boolean;
        vaulted?: boolean;
        verification?: {
          amount?: number;
          currency?: string;
        };
      };
      const retryAfterSeconds = resolveRetryAfterSeconds(response, payload);

      if (!response.ok || !payload.ok || !payload.method) {
        if (retryAfterSeconds) {
          setAddMethodClientCooldownUntil(
            Date.now() + retryAfterSeconds * 1000,
          );
        }
        throw new Error(
          withSupportRequestId(
            payload.message || "Falha ao adicionar metodo.",
            requestId,
          ),
        );
      }

      const addedMethod = payload.method;
      const shouldAutoEnableRecurring = shouldEnableRecurringAfterMethodAdd;

      setMethods((current) => {
        const methodExists = current.some((method) => method.id === addedMethod.id);
        if (methodExists) {
          return current.map((method) =>
            method.id === addedMethod.id ? { ...method, ...addedMethod } : method,
          );
        }
        return [addedMethod as SavedMethod, ...current];
      });

      setMethodNicknameDrafts((current) => ({
        ...current,
        [addedMethod.id]: addedMethod.nickname || "",
      }));
      setPlanSettings((current) => {
        if (!current) return current;
        const currentMethods = current.availableMethods || [];
        const exists = currentMethods.some((method) => method.id === addedMethod.id);
        const nextMethods = exists
          ? currentMethods.map((method) =>
              method.id === addedMethod.id
                ? {
                    ...method,
                    ...addedMethod,
                  }
                : method,
            )
          : [
              {
                id: addedMethod.id,
                brand: addedMethod.brand,
                firstSix: addedMethod.firstSix,
                lastFour: addedMethod.lastFour,
                expMonth: addedMethod.expMonth,
                expYear: addedMethod.expYear,
                lastUsedAt: addedMethod.lastUsedAt,
                timesUsed: addedMethod.timesUsed ?? 0,
                nickname: addedMethod.nickname || null,
                verificationStatus: addedMethod.verificationStatus,
                verificationStatusDetail: addedMethod.verificationStatusDetail,
                verificationAmount: addedMethod.verificationAmount,
                verifiedAt: addedMethod.verifiedAt,
                lastContextGuildId: addedMethod.lastContextGuildId,
              },
              ...currentMethods,
            ];

        return {
          ...current,
          availableMethods: nextMethods,
          availableMethodsCount: nextMethods.length,
        };
      });

      setAddMethodForm({
        cardNumber: "",
        holderName: "",
        expiry: "",
        cvv: "",
        document: "",
        nickname: "",
      });
      setAddMethodTouchedFields(createAddMethodTouchedFields());
      setAddMethodClientCooldownUntil(null);
      setAddMethodClientCooldownRemainingSeconds(null);
      setMethodSearch("");
      setMethodStatusFilter("all");
      setMethodGuildFilter(guildId);
      setAddMethodFlowState("approved");
      setMethodActionMessage(
        payload.alreadyVerified
          ? "Cartao reativado com sucesso."
          : payload.vaulted
            ? "Cartao salvo com sucesso no cofre seguro do Mercado Pago."
            : "Cartao salvo com sucesso.",
      );
      setAddMethodStatusMessage(
        payload.alreadyVerified
          ? "Cartao reconhecido e liberado para uso."
          : "Cartao salvo e liberado para uso no sistema.",
      );
      setShouldEnableRecurringAfterMethodAdd(false);
      await new Promise((resolve) => setTimeout(resolve, 900));
      setIsAddMethodModalOpen(false);

      if (shouldAutoEnableRecurring) {
        await persistPlanSettings({
          recurringEnabled: true,
          recurringMethodId: addedMethod.id,
          successMessage:
            "Cobranca recorrente ativada com sucesso com o novo cartao.",
        });
      }
    } catch (error) {
      setAddMethodFlowState("rejected");
      setAddMethodStatusMessage(
        "Nao foi possivel concluir o salvamento seguro deste cartao.",
      );
      setAddMethodError(
        parseUnknownErrorMessage(error) ||
          "Erro ao adicionar metodo de pagamento.",
      );
    } finally {
      setIsAddingMethod(false);
    }
  }, [
    addMethodCanSubmit,
    addMethodCardBrand,
    addMethodCardDigits,
    addMethodCvvDigits,
    addMethodDocumentDigits,
    addMethodExpiryDigits,
    addMethodForm.holderName,
    addMethodForm.nickname,
    persistPlanSettings,
    guildId,
    isAddMethodSdkLoading,
    isAddMethodSdkReady,
    isAddingMethod,
    addMethodClientCooldownUntil,
    shouldEnableRecurringAfterMethodAdd,
  ]);

  const handleSelectRecurringMethod = useCallback(
    async (methodId: string) => {
      if (isViewerOnly) {
        setPlanSuccess(null);
        setPlanError(financialViewerMessage);
        return;
      }

      if (!planSettings || isPlanSaving) return;
      if (!methodId) return;
      if (!cardPaymentsEnabled) {
        setPlanSuccess(null);
        setPlanError(CARD_RECURRING_DISABLED_MESSAGE);
        return;
      }

      const savedPlan = await persistPlanSettings({
        recurringEnabled: planSettings.recurringEnabled,
        recurringMethodId: methodId,
        successMessage: "Cartao da recorrencia atualizado com sucesso.",
      });

      if (savedPlan) {
        setIsRecurringMethodModalOpen(false);
      }
    },
    [
      cardPaymentsEnabled,
      financialViewerMessage,
      isPlanSaving,
      isViewerOnly,
      persistPlanSettings,
      planSettings,
    ],
  );

  const handleConfirmRecurringActivation = useCallback(async () => {
    if (isViewerOnly) {
      setPlanSuccess(null);
      setPlanError(financialViewerMessage);
      return;
    }

    if (!cardPaymentsEnabled) {
      setPlanSuccess(null);
      setPlanError(CARD_RECURRING_DISABLED_MESSAGE);
      return;
    }

    if (!recurringMethodDraftId) {
      setPlanError(
        "Escolha um cartao valido para ativar a cobranca recorrente.",
      );
      return;
    }

    const savedPlan = await persistPlanSettings({
      recurringEnabled: true,
      recurringMethodId: recurringMethodDraftId,
      successMessage: "Cobranca recorrente ativada com sucesso.",
    });

    if (savedPlan) {
      setIsRecurringMethodModalOpen(false);
    }
  }, [
    cardPaymentsEnabled,
    financialViewerMessage,
    isViewerOnly,
    persistPlanSettings,
    recurringMethodDraftId,
  ]);

  const handleResetSettings = useCallback(() => {
    if (!canResetSettings) return;

    if (isWelcomeSection && savedWelcomeSettingsDraft) {
      setWelcomeEnabled(savedWelcomeSettingsDraft.enabled);
      setEntryPublicChannelId(savedWelcomeSettingsDraft.entryPublicChannelId);
      setEntryLogChannelId(savedWelcomeSettingsDraft.entryLogChannelId);
      setExitPublicChannelId(savedWelcomeSettingsDraft.exitPublicChannelId);
      setExitLogChannelId(savedWelcomeSettingsDraft.exitLogChannelId);
      setEntryLayout(savedWelcomeSettingsDraft.entryLayout);
      setExitLayout(savedWelcomeSettingsDraft.exitLayout);
      setEntryThumbnailMode(savedWelcomeSettingsDraft.entryThumbnailMode);
      setExitThumbnailMode(savedWelcomeSettingsDraft.exitThumbnailMode);
    } else if (savedSettingsDraft) {
      setMenuChannelId(savedSettingsDraft.menuChannelId);
      setTicketsCategoryId(savedSettingsDraft.ticketsCategoryId);
      setLogsCreatedChannelId(savedSettingsDraft.logsCreatedChannelId);
      setLogsClosedChannelId(savedSettingsDraft.logsClosedChannelId);
      setPanelLayout(savedSettingsDraft.panelLayout);
      setAdminRoleId(savedSettingsDraft.adminRoleId);
      setClaimRoleIds(savedSettingsDraft.claimRoleIds);
      setCloseRoleIds(savedSettingsDraft.closeRoleIds);
      setNotifyRoleIds(savedSettingsDraft.notifyRoleIds);
    } else {
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
  }, [
    canResetSettings,
    isWelcomeSection,
    savedSettingsDraft,
    savedWelcomeSettingsDraft,
  ]);

  const handleSave = useCallback(async () => {
    if (!canPersistSettings) return;
    if (isTicketSection && !adminRoleId) return;
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (isWelcomeSection) {
        const response = await fetch("/api/auth/me/guilds/welcome-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            enabled: welcomeEnabled,
            entryPublicChannelId,
            entryLogChannelId,
            exitPublicChannelId,
            exitLogChannelId,
            entryLayout,
            exitLayout,
            entryThumbnailMode,
            exitThumbnailMode,
          }),
        });

        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Falha ao salvar canais de entrada e saida.");
        }

        setSavedWelcomeSettingsDraft(currentWelcomeDraft);
      } else {
        const [ticketRes, staffRes] = await Promise.all([
          fetch("/api/auth/me/guilds/ticket-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guildId,
              menuChannelId,
              ticketsCategoryId,
              logsCreatedChannelId,
              logsClosedChannelId,
              panelLayout,
            }),
          }),
          fetch("/api/auth/me/guilds/ticket-staff-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guildId,
              adminRoleId,
              claimRoleIds,
              closeRoleIds,
              notifyRoleIds,
            }),
          }),
        ]);

        const ticket = await ticketRes.json();
        const staff = await staffRes.json();
        if (!ticketRes.ok || !ticket.ok) throw new Error(ticket.message || "Falha ao salvar canais.");
        if (!staffRes.ok || !staff.ok) throw new Error(staff.message || "Falha ao salvar staff.");
        setSavedSettingsDraft(currentSettingsDraft);
      }

      setSuccessMessage("Configuracoes salvas com sucesso.");
      setShowSaveSuccessBar(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao salvar configuracoes.");
    } finally {
      setIsSaving(false);
    }
  }, [
    canPersistSettings,
    claimRoleIds,
    closeRoleIds,
    currentSettingsDraft,
    currentWelcomeDraft,
    entryLayout,
    entryLogChannelId,
    entryPublicChannelId,
    entryThumbnailMode,
    exitLayout,
    exitLogChannelId,
    exitPublicChannelId,
    exitThumbnailMode,
    guildId,
    isTicketSection,
    isWelcomeSection,
    logsClosedChannelId,
    logsCreatedChannelId,
    menuChannelId,
    notifyRoleIds,
    panelLayout,
    setSavedSettingsDraft,
    setSavedWelcomeSettingsDraft,
    ticketsCategoryId,
    welcomeEnabled,
    adminRoleId,
  ]);

  const handleSendEmbed = useCallback(async () => {
    if (!canSendEmbed || !menuChannelId) return;
    if (isSendingEmbedRef.current) return;
    isSendingEmbedRef.current = true;

    setIsSendingEmbed(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/me/guilds/ticket-panel-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          menuChannelId,
          panelLayout,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Falha ao enviar o embed do ticket.");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Erro ao enviar o embed do ticket.",
      );
    } finally {
      isSendingEmbedRef.current = false;
      setIsSendingEmbed(false);
    }
  }, [canSendEmbed, guildId, menuChannelId, panelLayout]);

  const handleActivateWelcome = useCallback(async () => {
    if (isActivatingWelcome || settingsReadOnly) return;
    setIsActivatingWelcome(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const fallbackChannelId = textChannelOptions[0]?.id ?? null;
    const nextEntryPublicId = entryPublicChannelId || fallbackChannelId;
    const nextEntryLogId = entryLogChannelId || fallbackChannelId;
    const nextExitPublicId = exitPublicChannelId || fallbackChannelId;
    const nextExitLogId = exitLogChannelId || fallbackChannelId;

    if (!nextEntryPublicId || !nextExitPublicId) {
      setErrorMessage(
        "Escolha pelo menos um canal de texto antes de ativar o modulo.",
      );
      setIsActivatingWelcome(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/me/guilds/welcome-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          enabled: true,
          entryPublicChannelId: nextEntryPublicId,
          entryLogChannelId: nextEntryLogId,
          exitPublicChannelId: nextExitPublicId,
          exitLogChannelId: nextExitLogId,
          entryLayout,
          exitLayout,
          entryThumbnailMode,
          exitThumbnailMode,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Falha ao ativar o modulo.");
      }

      setWelcomeEnabled(true);
      setEntryPublicChannelId(nextEntryPublicId);
      setEntryLogChannelId(nextEntryLogId);
      setExitPublicChannelId(nextExitPublicId);
      setExitLogChannelId(nextExitLogId);
      setSavedWelcomeSettingsDraft(
        normalizeWelcomeSettingsDraft({
          enabled: true,
          entryPublicChannelId: nextEntryPublicId,
          entryLogChannelId: nextEntryLogId,
          exitPublicChannelId: nextExitPublicId,
          exitLogChannelId: nextExitLogId,
          entryLayout,
          exitLayout,
          entryThumbnailMode,
          exitThumbnailMode,
        }),
      );
      setShowSaveSuccessBar(true);
      setSuccessMessage("Modulo ativado com sucesso.");
      setIsWelcomeActivationModalOpen(false);
      setHasDismissedWelcomeModal(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Erro ao ativar o modulo.",
      );
    } finally {
      setIsActivatingWelcome(false);
    }
  }, [
    entryLayout,
    entryLogChannelId,
    entryPublicChannelId,
    entryThumbnailMode,
    exitLayout,
    exitLogChannelId,
    exitPublicChannelId,
    exitThumbnailMode,
    guildId,
    isActivatingWelcome,
    settingsReadOnly,
    textChannelOptions,
  ]);

  useEffect(() => {
    if (!isWelcomeSection) {
      setIsWelcomeActivationModalOpen(false);
      return;
    }
    if (welcomeEnabled) {
      setIsWelcomeActivationModalOpen(false);
      return;
    }
    if (!hasDismissedWelcomeModal) {
      setIsWelcomeActivationModalOpen(true);
    }
  }, [hasDismissedWelcomeModal, isWelcomeSection, welcomeEnabled]);

  return (
    <ClientErrorBoundary
      fallback={
        <section
          className="flowdesk-fade-up-soft"
          style={{
            marginTop: standalone ? "0px" : `${serversScale.cardsTopSpacing}px`,
          }}
        >
          <div className="rounded-[24px] border border-[#161616] bg-[#090909] px-[22px] py-[28px] text-center">
            <div>
              <p className="text-[16px] text-[#D8D8D8]">
                Nao foi possivel carregar as configuracoes deste servidor.
              </p>
              <p className="mt-2 text-[12px] text-[#8E8E8E]">
                Atualize a pagina para tentar novamente.
              </p>
            </div>
          </div>
        </section>
      }
    >
      <section
        className="flowdesk-fade-up-soft"
        style={{
          marginTop: standalone ? "0px" : `${serversScale.cardsTopSpacing}px`,
        }}
      >
      <div className="overflow-x-hidden overflow-y-visible">
        <div
          className="flex w-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${TAB_INDEX[activeTab] * 100}%)` }}
        >
          <div className="min-w-0 w-full shrink-0">
            {isLoading ? (
              <ServerSettingsEditorSkeleton standalone />
            ) : (
              <>
                <div className={`space-y-[18px] ${showFloatingSaveBar ? "pb-[112px]" : ""}`}>
                  {settingsSection === "overview" ? (
                    <>
                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[12px] lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Ticket</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Configuracao de canais
                            </h3>
                            <p className="mt-[10px] max-w-[720px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Defina o canal principal, a categoria dos tickets e os logs que sustentam a operacao do servidor.
                            </p>
                          </div>
                          <span className="inline-flex h-[30px] items-center justify-center rounded-full border border-[#151515] bg-[#0B0B0B] px-[12px] text-[11px] uppercase tracking-[0.16em] text-[#686868]">
                            Canais
                          </span>
                        </div>

                        <div className="mt-[18px] grid grid-cols-1 gap-[16px] xl:grid-cols-2">
                          <ConfigStepSelect label="Canal do menu principal de tickets" placeholder="Escolha o canal" options={textChannelOptions} value={menuChannelId} onChange={setMenuChannelId} disabled={isSaving || settingsReadOnly} controlHeightPx={serverSettingsControlHeight} />
                          <ConfigStepSelect label="Categoria onde os tickets serao abertos" placeholder="Escolha uma categoria" options={categoryOptions} value={ticketsCategoryId} onChange={setTicketsCategoryId} disabled={isSaving || settingsReadOnly} controlHeightPx={serverSettingsControlHeight} />
                          <ConfigStepSelect label="Canal de logs de criacao" placeholder="Escolha o canal de logs" options={textChannelOptions} value={logsCreatedChannelId} onChange={setLogsCreatedChannelId} disabled={isSaving || settingsReadOnly} controlHeightPx={serverSettingsControlHeight} />
                          <ConfigStepSelect label="Canal de logs de fechamento" placeholder="Escolha o canal de logs" options={textChannelOptions} value={logsClosedChannelId} onChange={setLogsClosedChannelId} disabled={isSaving || settingsReadOnly} controlHeightPx={serverSettingsControlHeight} />
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <button
                          type="button"
                          onClick={() => setIsStaffCardCollapsed((current) => !current)}
                          className="group flex w-full items-start justify-between gap-[16px] text-left"
                          aria-expanded={!isStaffCardCollapsed}
                          aria-controls="server-staff-settings-panel"
                        >
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Ticket</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Permissoes e cargos
                            </h3>
                            <p className="mt-[10px] max-w-[720px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Controle quem administra, assume, fecha e recebe notificacoes dos tickets dentro do painel.
                            </p>
                          </div>

                          <span className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[14px] border border-[#1A1A1A] bg-[#0D0D0D] text-[#B9B9B9] transition-colors duration-200 group-hover:border-[#2A2A2A] group-hover:bg-[#111111] group-hover:text-[#F0F0F0]">
                            <svg
                              viewBox="0 0 20 20"
                              aria-hidden="true"
                              className={`h-[18px] w-[18px] transition-transform duration-300 ease-out ${
                                isStaffCardCollapsed ? "rotate-0" : "rotate-180"
                              }`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.1"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M5.5 7.75 10 12.25l4.5-4.5" />
                            </svg>
                          </span>
                        </button>

                        {!isStaffCardCollapsed ? (
                          <div
                            id="server-staff-settings-panel"
                            className="mt-[18px] flowdesk-fade-up-soft"
                          >
                            <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-2">
                              <ConfigStepSelect label="Cargo administrador do ticket" placeholder="Escolha o cargo" options={roleOptions} value={adminRoleId} onChange={setAdminRoleId} disabled={isSaving || settingsReadOnly} controlHeightPx={serverSettingsControlHeight} />
                              <ConfigStepMultiSelect label="Cargos que podem assumir tickets" placeholder="Escolha os cargos" options={roleOptions} values={claimRoleIds} onChange={setClaimRoleIds} disabled={isSaving || settingsReadOnly} controlHeightPx={serverSettingsControlHeight} />
                              <ConfigStepMultiSelect label="Cargos que podem fechar tickets" placeholder="Escolha os cargos" options={roleOptions} values={closeRoleIds} onChange={setCloseRoleIds} disabled={isSaving || settingsReadOnly} controlHeightPx={serverSettingsControlHeight} />
                              <ConfigStepMultiSelect label="Cargos que podem enviar notificacao" placeholder="Escolha os cargos" options={roleOptions} values={notifyRoleIds} onChange={setNotifyRoleIds} disabled={isSaving || settingsReadOnly} controlHeightPx={serverSettingsControlHeight} />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : settingsSection === "message" ? (
                    <TicketMessageBuilder
                      guildId={guildId}
                      value={panelLayout}
                      onChange={setPanelLayout}
                      disabled={isSaving || isSendingEmbed || settingsReadOnly}
                      canSendEmbed={canSendEmbed}
                      isSendingEmbed={isSendingEmbed}
                      onSendEmbed={handleSendEmbed}
                    />
                  ) : settingsSection === "entry_exit_overview" ? (
                    <>
                      {!welcomeEnabled ? (
                        <div className="rounded-[24px] border border-[#241616] bg-[linear-gradient(180deg,rgba(25,12,12,0.9)_0%,rgba(12,6,6,0.92)_100%)] px-[18px] py-[18px] text-[13px] leading-[1.6] text-[#D8A0A0] sm:px-[22px]">
                          O modulo de mensagem de entrada/saida ainda nao esta ativado. Clique em ativar para liberar a configuracao.
                          <div className="mt-[14px]">
                            <button
                              type="button"
                              onClick={() => {
                                setHasDismissedWelcomeModal(false);
                                setIsWelcomeActivationModalOpen(true);
                              }}
                              className="inline-flex h-[40px] items-center justify-center rounded-[12px] border border-[#2A1D1D] bg-[#120C0C] px-[16px] text-[13px] font-medium text-[#F2C3C3] transition-colors hover:border-[#3A2A2A] hover:bg-[#1B1212]"
                            >
                              Ativar modulo
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[12px] lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Mensagem Entrada/Saida</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Canais de entrada
                            </h3>
                            <p className="mt-[10px] max-w-[720px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Escolha onde a mensagem publica aparece e qual canal privado recebe o log de entrada.
                            </p>
                          </div>
                          <span className="inline-flex h-[30px] items-center justify-center rounded-full border border-[#151515] bg-[#0B0B0B] px-[12px] text-[11px] uppercase tracking-[0.16em] text-[#686868]">
                            Entrada
                          </span>
                        </div>

                        <div className="mt-[18px] grid grid-cols-1 gap-[16px] xl:grid-cols-2">
                          <ConfigStepSelect label="Canal de entrada publico" placeholder="Escolha o canal" options={textChannelOptions} value={entryPublicChannelId} onChange={setEntryPublicChannelId} disabled={welcomeControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                          <ConfigStepSelect label="Log privado de entrada" placeholder="Escolha o canal de log" options={textChannelOptions} value={entryLogChannelId} onChange={setEntryLogChannelId} disabled={welcomeControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[12px] lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Mensagem Entrada/Saida</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Canais de saida
                            </h3>
                            <p className="mt-[10px] max-w-[720px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Defina o canal publico de saida e o log privado para eventos de desligamento.
                            </p>
                          </div>
                          <span className="inline-flex h-[30px] items-center justify-center rounded-full border border-[#151515] bg-[#0B0B0B] px-[12px] text-[11px] uppercase tracking-[0.16em] text-[#686868]">
                            Saida
                          </span>
                        </div>

                        <div className="mt-[18px] grid grid-cols-1 gap-[16px] xl:grid-cols-2">
                          <ConfigStepSelect label="Canal de saida publico" placeholder="Escolha o canal" options={textChannelOptions} value={exitPublicChannelId} onChange={setExitPublicChannelId} disabled={welcomeControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                          <ConfigStepSelect label="Log privado de saida" placeholder="Escolha o canal de log" options={textChannelOptions} value={exitLogChannelId} onChange={setExitLogChannelId} disabled={welcomeControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {!welcomeEnabled ? (
                        <div className="rounded-[24px] border border-[#241616] bg-[linear-gradient(180deg,rgba(25,12,12,0.9)_0%,rgba(12,6,6,0.92)_100%)] px-[18px] py-[18px] text-[13px] leading-[1.6] text-[#D8A0A0] sm:px-[22px]">
                          O modulo de mensagem de entrada/saida ainda nao esta ativado. Clique em ativar para liberar a configuracao.
                          <div className="mt-[14px]">
                            <button
                              type="button"
                              onClick={() => {
                                setHasDismissedWelcomeModal(false);
                                setIsWelcomeActivationModalOpen(true);
                              }}
                              className="inline-flex h-[40px] items-center justify-center rounded-[12px] border border-[#2A1D1D] bg-[#120C0C] px-[16px] text-[13px] font-medium text-[#F2C3C3] transition-colors hover:border-[#3A2A2A] hover:bg-[#1B1212]"
                            >
                              Ativar modulo
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Mensagem Entrada/Saida</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Configure o embed de entrada e saida
                            </h3>
                            <p className="mt-[10px] max-w-[720px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Personalize as mensagens automaticas e use variaveis para mencionar o usuario, o convite e o servidor.
                            </p>
                          </div>

                          <div className="inline-flex items-center rounded-full border border-[#151515] bg-[#0B0B0B] p-[4px]">
                            {(["entry", "exit"] as const).map((tab) => {
                              const isActive = welcomeMessageTab === tab;
                              return (
                                <button
                                  key={tab}
                                  type="button"
                                  onClick={() => setWelcomeMessageTab(tab)}
                                  disabled={welcomeControlsDisabled}
                                  className={`rounded-full px-[16px] py-[8px] text-[12px] font-medium uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                    isActive
                                      ? "bg-[#1E1E1E] text-[#F0F0F0]"
                                      : "text-[#7A7A7A] hover:text-[#DADADA]"
                                  }`}
                                >
                                  {tab === "entry" ? "Entrada" : "Saida"}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="mt-[18px] grid grid-cols-1 gap-[16px] lg:grid-cols-[1.2fr_1fr]">
                          <div className="rounded-[18px] border border-[#161616] bg-[#0A0A0A] px-[16px] py-[14px]">
                            <p className="text-[12px] uppercase tracking-[0.16em] text-[#6D6D6D]">
                              Variaveis disponiveis
                            </p>
                            <div className="mt-[12px] grid grid-cols-1 gap-[8px] sm:grid-cols-2">
                              {WELCOME_VARIABLES.map((variable) => (
                                <div
                                  key={variable.token}
                                  className="rounded-[12px] border border-[#141414] bg-[#070707] px-[12px] py-[10px]"
                                >
                                  <p className="text-[13px] font-semibold text-[#E2E2E2]">
                                    {variable.token}
                                  </p>
                                  <p className="mt-[4px] text-[12px] leading-[1.5] text-[#6F6F6F]">
                                    {variable.description}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-[18px] border border-[#161616] bg-[#0A0A0A] px-[16px] py-[14px]">
                            <p className="text-[12px] uppercase tracking-[0.16em] text-[#6D6D6D]">
                              Miniatura do embed
                            </p>
                            <p className="mt-[8px] text-[13px] leading-[1.55] text-[#7A7A7A]">
                              Escolha se a miniatura usa o link informado no embed ou a foto do usuario automaticamente.
                            </p>
                            <div className="mt-[14px] flex flex-col gap-[10px]">
                              {(["custom", "avatar"] as const).map((mode) => {
                                const isActive = activeWelcomeThumbnailMode === mode;
                                return (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() => handleWelcomeThumbnailModeChange(mode)}
                                    disabled={welcomeControlsDisabled}
                                    className={`flex items-center justify-between rounded-[14px] border px-[12px] py-[10px] text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                      isActive
                                        ? "border-[#2A2A2A] bg-[#121212] text-[#F0F0F0]"
                                        : "border-[#141414] bg-[#0B0B0B] text-[#8A8A8A] hover:text-[#D8D8D8]"
                                    }`}
                                  >
                                    <span>
                                      {mode === "custom"
                                        ? "Usar link manual"
                                        : "Usar foto do usuario"}
                                    </span>
                                    <span className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border ${isActive ? "border-[#6AE25A] bg-[#6AE25A]" : "border-[#2A2A2A]"}`}>
                                      {isActive ? (
                                        <span className="text-[10px] font-semibold text-black">OK</span>
                                      ) : null}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>

                      <TicketMessageBuilder
                        guildId={guildId}
                        value={activeWelcomeLayout}
                        onChange={handleWelcomeLayoutChange}
                        disabled={welcomeControlsDisabled}
                        canSendEmbed={false}
                        isSendingEmbed={false}
                        onSendEmbed={undefined}
                        eyebrow={
                          welcomeMessageTab === "entry"
                            ? "Mensagem de entrada"
                            : "Mensagem de saida"
                        }
                        headline={
                          welcomeMessageTab === "entry"
                            ? "Monte a recepcao do servidor"
                            : "Confirme a saida com clareza"
                        }
                        description="O Flowdesk envia este embed automaticamente quando o evento acontecer."
                        hideSendButton
                        thumbnailPreviewUrl={activeWelcomeThumbnailPreviewUrl}
                      />
                    </>
                  )}

                  {showInlineMessages ? (
                    <div className="pt-[2px]">
                      <div className="max-w-[720px] space-y-[8px]">
                        {isViewerOnly ? (
                          <p className="text-[12px] leading-[1.55] text-[#8CC2FF]">
                            {viewerOnlyMessage}
                          </p>
                        ) : null}
                        {locked ? (
                          <p className="text-[12px] leading-[1.55] text-[#C2C2C2]">
                            Plano expirado ou desligado. Renove a licenca na configuracao da conta para liberar alteracoes novamente.
                          </p>
                        ) : null}
                        {errorMessage ? (
                          <p className="text-[12px] leading-[1.55] text-[#D98A8A]">
                            {errorMessage}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>

          <div className="min-w-0 w-full shrink-0 pl-0 min-[860px]:pl-[8px]">
            <div className="grid grid-cols-1 gap-3 min-[980px]:grid-cols-[1fr_auto_auto]">
              <input
                type="text"
                value={paymentSearch}
                onChange={(event) => setPaymentSearch(event.currentTarget.value)}
                disabled={isViewerOnly}
                placeholder="Pesquisar pagamento por ID, servidor ou metodo"
                className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] placeholder:text-[#3A3A3A] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px]"
              />
              <select value={paymentGuildFilter} onChange={(event) => setPaymentGuildFilter(event.currentTarget.value)} disabled={isViewerOnly} className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px] min-[980px]:min-w-[238px]">
                {serverOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.currentTarget.value as "all" | PaymentStatus)} disabled={isViewerOnly} className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px] min-[980px]:min-w-[213px]">
                <option value="all">Todos status</option>
                <option value="approved">Pago</option>
                <option value="pending">Pendente</option>
                <option value="expired">Expirado</option>
                <option value="cancelled">Cancelado</option>
                <option value="rejected">Rejeitado</option>
                <option value="failed">Falhou</option>
              </select>
            </div>

            <div className="mt-4 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A]">
              {isViewerOnly ? (
                <p className="px-4 py-8 text-center text-[15px] text-[#C2C2C2]">
                  {financialViewerMessage}
                </p>
              ) : isPaymentsLoading ? (
                <div className="flex h-[275px] items-center justify-center">
                  <ButtonLoader size={28} />
                </div>
              ) : paymentsError ? (
                <p className="px-4 py-8 text-center text-[15px] text-[#C2C2C2]">{paymentsError}</p>
              ) : filteredOrders.length ? (
                <div className="max-h-[575px] overflow-y-auto thin-scrollbar">
                  {filteredOrders.map((order) => {
                    const badge = orderStatusBadge(order.status);
                    const methodIcon = order.method === "pix" ? "/cdn/icons/pix_.png" : cardBrandIcon(order.card?.brand || null);
                    const serverName = serverMap.get(order.guildId)?.guildName || order.guildId;
                    return (
                      <div key={order.id} className="flex flex-col gap-3 border-b border-[#1C1C1C] px-4 py-4 last:border-b-0 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-between min-[720px]:py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[#111111] min-[720px]:h-[38px] min-[720px]:w-[38px]">
                              <PaymentMethodIcon src={methodIcon} alt="Metodo" size={30} />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[15px] text-[#D8D8D8]">Pagamento #{order.orderNumber}</p>
                              <p className="truncate text-[14px] text-[#777777]">{serverName}</p>
                            </div>
                          </div>
                          {order.technicalLabels.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {order.technicalLabels.map((label) => {
                                const technicalBadge = technicalHistoryBadge(label);
                                return (
                                  <span
                                    key={`${order.id}-${label}`}
                                    className={`inline-flex rounded-[3px] border px-[8px] py-[3px] text-[10px] ${technicalBadge.cls}`}
                                  >
                                    {technicalBadge.label}
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                          {order.providerStatusDetail ? (
                            <p className="mt-2 truncate text-[12px] text-[#686868]">{order.providerStatusDetail}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-end justify-between gap-3 text-right min-[720px]:block">
                          <span className={`inline-flex rounded-[3px] border px-[10px] py-[4px] text-[12px] ${badge.cls}`}>{badge.label}</span>
                          <div>
                            <p className="mt-1 text-[12px] text-[#777777]">{formatDateTime(order.createdAt)}</p>
                            <p className="mt-1 text-[14px] text-[#D8D8D8]">{formatAmount(order.amount, order.currency)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-[15px] text-[#C2C2C2]">Nenhum pagamento encontrado para esse filtro.</p>
              )}
            </div>
          </div>

          <div className="min-w-0 w-full shrink-0 pl-0 min-[860px]:pl-[8px]">
            <div className="grid grid-cols-1 gap-3 min-[980px]:grid-cols-[1fr_auto_auto]">
              <input
                type="text"
                value={methodSearch}
                onChange={(event) => setMethodSearch(event.currentTarget.value)}
                disabled={isViewerOnly}
                placeholder="Pesquisar metodo por bandeira, final ou servidor"
                className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] placeholder:text-[#3A3A3A] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px]"
              />
              <select
                value={methodGuildFilter}
                onChange={(event) => setMethodGuildFilter(event.currentTarget.value)}
                disabled={isViewerOnly}
                className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px] min-[980px]:min-w-[238px]"
              >
                {serverOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <select
                value={methodStatusFilter}
                onChange={(event) => setMethodStatusFilter(event.currentTarget.value as "all" | PaymentStatus)}
                disabled={isViewerOnly}
                className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px] min-[980px]:min-w-[213px]"
              >
                <option value="all">Todos status</option>
                <option value="approved">Pago</option>
                <option value="pending">Pendente</option>
                <option value="expired">Expirado</option>
                <option value="cancelled">Cancelado</option>
                <option value="rejected">Rejeitado</option>
                <option value="failed">Falhou</option>
              </select>
            </div>

            <div className="mt-4">
              {isViewerOnly ? (
                <div className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-8 text-center text-[15px] text-[#C2C2C2]">
                  {financialViewerMessage}
                </div>
              ) : isPaymentsLoading ? (
                <div className="flex h-[275px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A]">
                  <ButtonLoader size={28} />
                </div>
              ) : filteredMethods.length ? (
                <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-2">
                  {filteredMethods.map((method) => {
                    const brandLabel = cardBrandLabel(method.brand);
                    const masked = `${method.firstSix} ****** ${method.lastFour}`;
                    const isDeleting = deletingMethodId === method.id;
                    const verificationBadge = methodVerificationBadge(
                      method.verificationStatus,
                    );
                    return (
                      <article key={method.id} className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-4 min-[900px]:py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[#111111]">
                              <PaymentMethodIcon src={cardBrandIcon(method.brand)} alt={brandLabel} size={32} />
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-[15px] text-[#D8D8D8]">{method.nickname?.trim() || brandLabel}</p>
                                <span className={`inline-flex shrink-0 rounded-[3px] border px-[8px] py-[3px] text-[10px] ${verificationBadge.cls}`}>
                                  {verificationBadge.label}
                                </span>
                              </div>
                              <p className="truncate text-[14px] text-[#777777]">{masked}</p>
                            </div>
                          </div>

                          <div className="relative" data-method-menu-root="true">
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => {
                                setOpenMethodMenuId((current) =>
                                  current === method.id ? null : method.id,
                                );
                              }}
                              className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-[2px] text-[18px] leading-none text-[#4A4A4A] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-[#7A7A7A] disabled:cursor-not-allowed disabled:opacity-45 min-[900px]:h-[26px] min-[900px]:w-[26px]"
                              aria-label="Abrir menu do metodo"
                            >
                              ...
                            </button>

                            {openMethodMenuId === method.id ? (
                              <div className="flowdesk-scale-in-soft absolute right-0 top-[30px] z-20 min-w-[122px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] py-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleDeleteMethod(method.id);
                                  }}
                                  className="block w-full px-3 py-2 text-left text-[12px] text-[#DB4646] transition-colors hover:bg-[#121212]"
                                >
                                  {isDeleting ? "Removendo..." : "Deletar"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2 min-[620px]:grid-cols-[1fr_auto] min-[620px]:items-end">
                          <div>
                            <p className="mb-1 text-[11px] text-[#686868]">Apelido do cartao</p>
                            <div className="flex flex-col gap-2 min-[520px]:flex-row min-[520px]:items-center">
                              <input
                                type="text"
                                value={methodNicknameDrafts[method.id] ?? ""}
                                onChange={(event) => {
                                  const nextValue = event.currentTarget.value.slice(0, 42);
                                  setMethodNicknameDrafts((current) => ({
                                    ...current,
                                    [method.id]: nextValue,
                                  }));
                                }}
                                placeholder="Ex: Cartao principal"
                                className="h-[36px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-3 text-[12px] text-[#D8D8D8] placeholder:text-[#3A3A3A] outline-none min-[520px]:h-[33px] min-[520px]:px-2"
                              />
                              <button
                                type="button"
                                disabled={savingMethodNicknameId === method.id}
                                onClick={() => {
                                  void handleSaveMethodNickname(method.id);
                                }}
                                className="inline-flex h-[36px] w-full items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#121212] px-3 text-[11px] text-[#D8D8D8] transition-colors hover:bg-[#1A1A1A] disabled:cursor-not-allowed disabled:opacity-50 min-[520px]:h-[33px] min-[520px]:w-auto"
                              >
                                {savingMethodNicknameId === method.id ? (
                                  <ButtonLoader size={14} colorClassName="text-[#D8D8D8]" />
                                ) : (
                                  "Salvar"
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col text-[12px] text-[#777777] min-[620px]:items-end">
                            <span>{method.timesUsed} uso(s)</span>
                            <span className="mt-1">
                              Validade:{" "}
                              {method.expMonth && method.expYear
                                ? `${String(method.expMonth).padStart(2, "0")}/${String(method.expYear).slice(-2)}`
                                : "--/--"}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-col gap-1 text-[11px] text-[#686868] min-[620px]:flex-row min-[620px]:items-center min-[620px]:justify-between">
                          <span>
                            Bandeira: {brandLabel}
                          </span>
                          <span>Metodo: {method.id}</span>
                        </div>

                        <div className="mt-3 flex flex-col gap-1 text-[12px] text-[#777777] min-[620px]:flex-row min-[620px]:items-center min-[620px]:justify-between">
                          <span>
                            Ultimo uso: {formatDateTime(method.lastUsedAt)}
                          </span>
                          <span>
                            {method.verifiedAt
                              ? `Validado em ${formatDateTime(method.verifiedAt)}`
                              : "Validacao recente"}
                          </span>
                        </div>

                        {method.verificationStatusDetail ? (
                          <p className="mt-2 text-[11px] text-[#686868]">
                            {method.verificationStatusDetail}
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-8 text-center text-[15px] text-[#C2C2C2]">
                  Nenhum metodo encontrado para esse filtro.
                </div>
              )}

              <button
                type="button"
                onClick={() => openAddMethodModal()}
                disabled={isViewerOnly || !cardPaymentsEnabled}
                className={`mt-4 flex h-[48px] w-full items-center justify-center gap-3 rounded-[3px] border px-4 text-[13px] font-medium transition-colors min-[680px]:mt-3 min-[680px]:h-[46px] ${
                  cardPaymentsEnabled
                    ? "border-transparent bg-[#D8D8D8] text-black hover:opacity-90"
                    : "border-[#2E2E2E] bg-[#0A0A0A] text-[#D8D8D8] disabled:cursor-not-allowed"
                }`}
              >
                <span>ADICIONAR NOVO METODO</span>
                {!cardPaymentsEnabled ? (
                  <span className="pointer-events-none inline-flex h-[22px] items-center justify-center rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-2 text-[10px] tracking-[0.04em] text-[#F2C823] shadow-[0_0_0_1px_rgba(10,10,10,0.55)]">
                    {CARD_PAYMENTS_COMING_SOON_BADGE}
                  </span>
                ) : null}
              </button>

              {methodActionMessage ? (
                <p
                  className={`mt-2 text-[11px] ${
                    methodActionMessage === CARD_PAYMENTS_DISABLED_MESSAGE
                      ? "text-[#F2C823]"
                      : "text-[#9BD694]"
                  }`}
                >
                  {methodActionMessage}
                </p>
              ) : null}
              {paymentsError ? (
                <p className="mt-2 text-[11px] text-[#C2C2C2]">{paymentsError}</p>
              ) : null}
            </div>
          </div>

          <div className="min-w-0 w-full shrink-0 pl-0 min-[860px]:pl-[8px]">
            {isPlanLoading ? (
              <div className="flex h-[275px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A]">
                <ButtonLoader size={28} />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {canRenewPlan ? (
                  <div className="flex flex-col items-start gap-3 rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-4 py-4 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between min-[640px]:px-3 min-[640px]:py-3">
                    <div className="min-w-0">
                      <p className="text-[14px] text-[#F2C823]">
                        {renewalWindowOpen
                          ? "Renovacao antecipada disponivel neste servidor"
                          : status === "expired"
                            ? "Plano expirado neste servidor"
                            : "Plano desligado neste servidor"}
                      </p>
                      <p className="mt-1 text-[11px] text-[#D6C68A]">
                        {renewalWindowOpen
                          ? `Renove agora e os ${daysUntilExpire} dia${
                              daysUntilExpire === 1 ? "" : "s"
                            } restantes desta assinatura serao somados ao proximo ciclo de 30 dias.`
                          : status === "expired"
                            ? `Renove agora para reativar o Flowdesk. Os ${daysUntilOff} dia${
                                daysUntilOff === 1 ? "" : "s"
                              } de tolerancia em aberto nao viram bonus no proximo ciclo.`
                            : "Renove agora para reativar o Flowdesk com mais 30 dias de licenca."}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleRenewByPix}
                      disabled={isViewerOnly}
                      className="inline-flex h-[40px] w-full items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#D8D8D8] px-4 text-[13px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 min-[520px]:w-auto min-[520px]:text-[12px] min-[520px]:h-[34px]"
                    >
                      RENOVAR
                    </button>
                  </div>
                ) : null}

                <div className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[16px] font-medium text-[#D8D8D8]">Plano Pro</p>
                      <p className="text-[12px] text-[#8E8E8E]">
                        Licenca padrao do servidor por 30 dias
                      </p>
                    </div>
                    <span className="inline-flex h-[23px] items-center justify-center rounded-[3px] border border-[#6AE25A] bg-[rgba(106,226,90,0.2)] px-3 text-[11px] text-[#6AE25A]">
                      R$ 9,99 / mes
                    </span>
                  </div>

                  <div className="mt-4 rounded-[3px] border border-[#2E2E2E] bg-[#090909] px-3 py-3">
                    <div className="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between">
                      <div>
                        <p className="text-[14px] text-[#D8D8D8]">Cobranca recorrente</p>
                        <p className="mt-1 text-[11px] text-[#8E8E8E]">
                          Ative para renovar automaticamente a cada 30 dias.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          void handleToggleRecurring();
                        }}
                        disabled={
                          isPlanSaving ||
                          !planSettings ||
                          isViewerOnly ||
                          (!cardPaymentsEnabled && !planSettings?.recurringEnabled)
                        }
                        className={`inline-flex h-[36px] w-full min-w-[92px] items-center justify-center rounded-[3px] border px-3 text-[12px] transition-opacity disabled:cursor-not-allowed min-[640px]:h-[31px] min-[640px]:w-auto ${
                          planSettings?.recurringEnabled
                            ? "border-[#6AE25A] bg-[rgba(106,226,90,0.2)] text-[#6AE25A]"
                            : !cardPaymentsEnabled
                              ? "border-[#4A4020] bg-[rgba(242,200,35,0.08)] text-[#CDBA64]"
                              : "border-[#2E2E2E] bg-[#0A0A0A] text-[#D8D8D8]"
                        }`}
                      >
                        {isPlanSaving ? (
                          <ButtonLoader size={16} colorClassName="text-[#D8D8D8]" />
                        ) : planSettings?.recurringEnabled ? (
                          "Ativado"
                        ) : (
                          "Desativado"
                        )}
                      </button>
                    </div>
                    {!cardPaymentsEnabled && !planSettings?.recurringEnabled ? (
                      <div className="mt-3 flex justify-end">
                        <span className="inline-flex h-[22px] items-center justify-center rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-2 text-[10px] tracking-[0.04em] text-[#F2C823]">
                          {CARD_PAYMENTS_COMING_SOON_BADGE}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-[3px] border border-[#2E2E2E] bg-[#090909] px-3 py-3">
                    <div className="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between">
                      <p className="text-[12px] text-[#8E8E8E]">Cartao vinculado a recorrencia</p>
                      <button
                        type="button"
                        onClick={() => openAddMethodModal()}
                        disabled={isViewerOnly || !cardPaymentsEnabled}
                        className="inline-flex h-[36px] w-full items-center justify-center gap-2 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-3 text-[11px] text-[#D8D8D8] transition-colors hover:bg-[#111111] disabled:cursor-not-allowed disabled:opacity-55 min-[640px]:h-[31px] min-[640px]:w-auto"
                      >
                        <span>Adicionar cartao</span>
                        {!cardPaymentsEnabled ? (
                          <span className="inline-flex h-[18px] items-center justify-center rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-2 text-[9px] tracking-[0.04em] text-[#F2C823]">
                            {CARD_PAYMENTS_COMING_SOON_BADGE}
                          </span>
                        ) : null}
                      </button>
                    </div>

                    {recurringMethodOptions.length > 1 ? (
                      <div className="mt-2">
                        <label className="mb-1 block text-[11px] text-[#686868]">
                          Escolha o cartao para renovar
                        </label>
                        <select
                          value={planSettings?.recurringMethodId || ""}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            if (!value) return;
                            void handleSelectRecurringMethod(value);
                          }}
                          disabled={
                            isPlanSaving ||
                            isViewerOnly ||
                            !planSettings?.recurringEnabled ||
                            !cardPaymentsEnabled
                          }
                          className="h-[38px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-3 text-[12px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {recurringMethodOptions.map((method) => (
                            <option key={method.id} value={method.id}>
                              {(method.nickname?.trim() || cardBrandLabel(method.brand)) +
                                " - " +
                                `${method.firstSix} ****** ${method.lastFour}`}
                            </option>
                          ))}
                        </select>
                        {!planSettings?.recurringEnabled ? (
                          <p className="mt-1 text-[11px] text-[#686868]">
                            Ative a cobranca recorrente para escolher o cartao.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {recurringMethod ? (
                      <div className="mt-2 flex items-center gap-3">
                        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[#111111]">
                          <PaymentMethodIcon
                            src={cardBrandIcon(recurringMethod.brand)}
                            alt={cardBrandLabel(recurringMethod.brand)}
                            size={32}
                          />
                        </span>
                        <div>
                          <p className="text-[14px] text-[#D8D8D8]">
                            {recurringMethod.nickname?.trim() || cardBrandLabel(recurringMethod.brand)}
                          </p>
                          <p className="text-[12px] text-[#777777]">
                            {recurringMethod.firstSix} ****** {recurringMethod.lastFour}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-[12px] text-[#777777]">
                        {cardPaymentsEnabled
                          ? "Nenhum cartao vinculado. Adicione ou valide um cartao para usar na recorrencia."
                          : "Cartoes para recorrencia ficarao disponiveis em breve."}
                      </p>
                    )}
                  </div>

                  {isViewerOnly ? (
                    <p className="mt-3 text-[11px] text-[#8CC2FF]">
                      {financialViewerMessage}
                    </p>
                  ) : null}
                  {locked ? (
                    <p className="mt-3 text-[11px] text-[#C2C2C2]">
                      Mesmo com o servidor expirado ou desligado, voce ainda pode configurar a cobranca recorrente para reativacao automatica.
                    </p>
                  ) : null}
                  {!cardPaymentsEnabled ? (
                    <p className="mt-3 text-[11px] text-[#C2C2C2]">
                      Pagamentos com cartao e cobranca recorrente estao temporariamente desativados e retornarao em breve.
                    </p>
                  ) : null}

                  {planError ? <p className="mt-2 text-[11px] text-[#C2C2C2]">{planError}</p> : null}
                  {planSuccess ? <p className="mt-2 text-[11px] text-[#9BD694]">{planSuccess}</p> : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isPortalMounted && isSaveBarRendered
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-[22px] z-[170] flex justify-center px-4 md:px-6 lg:px-8 xl:pl-[358px] xl:pr-[42px]">
              <div className="w-full max-w-[1220px]">
                <div
                  className={`pointer-events-auto relative w-full overflow-hidden rounded-[26px] shadow-[0_26px_90px_rgba(0,0,0,0.48)] backdrop-blur-[18px] ${
                    isSaveBarExiting ? "flowdesk-sheet-down" : "flowdesk-sheet-up"
                  } ${showInvalidTicketSaveState ? "flowdesk-savebar-shake-soft" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 rounded-[26px] border ${
                      showInvalidTicketSaveState
                        ? "border-[rgba(219,70,70,0.38)]"
                        : showSaveBarSuccessState
                          ? "border-[rgba(106,226,90,0.34)]"
                          : "border-[#0E0E0E]"
                    }`}
                  />
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-[-2px] rounded-[26px] ${
                      showInvalidTicketSaveState
                        ? "flowdesk-tag-border-glow-danger"
                        : showSaveBarSuccessState
                          ? "flowdesk-tag-border-glow-success"
                        : "flowdesk-tag-border-glow"
                    }`}
                  />
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-[-1px] rounded-[26px] ${
                      showInvalidTicketSaveState
                        ? "flowdesk-tag-border-core-danger"
                        : showSaveBarSuccessState
                          ? "flowdesk-tag-border-core-success"
                        : "flowdesk-tag-border-core"
                    }`}
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-[1px] rounded-[25px] bg-[#070707]"
                  />

                  <div className="relative z-10 flex flex-col gap-[16px] px-[18px] py-[16px] sm:px-[22px] sm:py-[18px] xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] leading-[1.2] font-medium tracking-[-0.03em] text-[#D8D8D8]">
                        {floatingSaveBarTitle}
                      </p>
                      <p className="mt-[8px] max-w-[680px] text-[13px] leading-[1.55] text-[#7F7F7F]">
                        {floatingSaveBarDescription}
                      </p>
                    </div>

                    {showSaveBarActions ? (
                      <div className="flex shrink-0 flex-col-reverse gap-[10px] sm:flex-row sm:items-center">
                        <button
                          type="button"
                          onClick={handleResetSettings}
                          disabled={!canResetSettings}
                          className={`group relative inline-flex h-[46px] items-center justify-center overflow-hidden whitespace-nowrap rounded-[12px] px-6 text-[15px] leading-none font-semibold transition-colors ${
                            canResetSettings ? "" : "cursor-not-allowed"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute inset-0 rounded-[12px] border transition-colors ${
                              canResetSettings
                                ? "border-[#1B1B1B] bg-[#111111]"
                                : "border-[#151515] bg-[#0E0E0E]"
                            }`}
                          />
                          <span
                            className={`relative z-10 inline-flex items-center justify-center whitespace-nowrap ${
                              canResetSettings ? "text-[#D0D0D0]" : "text-[#666666]"
                            }`}
                          >
                            Redefinir
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            void handleSave();
                          }}
                          disabled={!canPersistSettings}
                          className={`group relative inline-flex h-[46px] items-center justify-center overflow-hidden whitespace-nowrap rounded-[12px] px-6 text-[15px] leading-none font-semibold ${
                            canPersistSettings ? "" : "cursor-not-allowed"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute inset-0 rounded-[12px] transition-transform duration-150 ease-out ${
                              saveActionVisualEnabled
                                ? "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] group-hover:scale-[1.02] group-active:scale-[0.985]"
                                : "bg-[#111111]"
                            }`}
                          />
                          <span
                            className={`relative z-10 inline-flex items-center justify-center whitespace-nowrap transition-opacity ${
                              saveActionVisualEnabled ? "text-[#282828]" : "text-[#B7B7B7]"
                            } ${isSaving ? "opacity-0" : "opacity-100"}`}
                          >
                            Salvar alteracoes
                          </span>
                          {isSaving ? (
                            <span className="absolute inset-0 z-20 inline-flex items-center justify-center">
                              <ButtonLoader
                                size={20}
                                colorClassName={saveActionVisualEnabled ? "text-[#282828]" : "text-[#B7B7B7]"}
                              />
                            </span>
                          ) : null}
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex h-[40px] shrink-0 items-center justify-center rounded-full border border-[rgba(155,214,148,0.28)] bg-[rgba(155,214,148,0.08)] px-[14px] text-[12px] font-medium text-[#9BD694]">
                        Tudo sincronizado
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {isRecurringMethodModalOpen ? (
        <div className="fixed inset-0 z-[125] overflow-y-auto overscroll-contain bg-black/75 px-4 py-6">
          <div className="flex min-h-full items-center justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Escolha o cartao da renovacao"
            className="relative w-full max-w-[560px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] p-6"
          >
            <button
              type="button"
              onClick={() => {
                if (isPlanSaving) return;
                setIsRecurringMethodModalOpen(false);
              }}
              className="absolute right-4 top-4 inline-flex h-[28px] w-[28px] items-center justify-center rounded-[3px] text-[#8A8A8A] transition-colors hover:text-[#D8D8D8]"
              aria-label="Fechar modal de recorrencia"
            >
              X
            </button>

            <h3 className="text-center text-[24px] text-[#D8D8D8]">
              Escolha o cartao da renovacao
            </h3>

            <div className="mt-6 h-[1px] w-full bg-[#242424]" />

            <p className="mt-5 text-center text-[12px] text-[#8E8E8E]">
              Selecione qual cartao sera usado para renovar automaticamente este servidor.
            </p>

            <div className="thin-scrollbar mt-5 flex max-h-[320px] flex-col gap-3 overflow-y-auto pr-1">
              {recurringMethodOptions.map((method) => {
                const isSelected = recurringMethodDraftId === method.id;
                const label =
                  method.nickname?.trim() || cardBrandLabel(method.brand);

                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => setRecurringMethodDraftId(method.id)}
                    className={`flex items-center gap-3 rounded-[3px] border px-3 py-3 text-left transition-colors ${
                      isSelected
                        ? "border-[#6AE25A] bg-[rgba(106,226,90,0.12)]"
                        : "border-[#2E2E2E] bg-[#090909] hover:bg-[#101010]"
                    }`}
                  >
                    <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[3px] bg-[#111111]">
                      <PaymentMethodIcon
                        src={cardBrandIcon(method.brand)}
                        alt={cardBrandLabel(method.brand)}
                        size={32}
                      />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] text-[#D8D8D8]">
                        {label}
                      </p>
                      <p className="mt-1 text-[12px] text-[#777777]">
                        {method.firstSix} ****** {method.lastFour}
                      </p>
                    </div>

                    <span
                      className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${
                        isSelected
                          ? "border-[#6AE25A] bg-[#6AE25A]"
                          : "border-[#3A3A3A] bg-transparent"
                      }`}
                    >
                      {isSelected ? (
                        <span className="text-[10px] font-semibold text-black">OK</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isPlanSaving) return;
                  setIsRecurringMethodModalOpen(false);
                }}
                className="inline-flex h-[40px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[13px] text-[#D8D8D8] transition-colors hover:bg-[#111111]"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => {
                  void handleConfirmRecurringActivation();
                }}
                disabled={!recurringMethodDraftId || isPlanSaving}
                className="inline-flex h-[40px] min-w-[180px] items-center justify-center rounded-[3px] bg-[#D8D8D8] px-4 text-[13px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPlanSaving ? <ButtonLoader size={20} /> : "Ativar recorrencia"}
              </button>
            </div>
          </div>
          </div>
        </div>
      ) : null}

      {isAddMethodModalOpen ? (
        <ClientErrorBoundary
          fallback={
            <div className="fixed inset-0 z-[130] overflow-y-auto overscroll-contain bg-black/75 px-4 py-6">
              <div className="flex min-h-full items-center justify-center">
              <div className="w-full max-w-[520px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] p-6 text-center">
                <p className="text-[16px] text-[#D8D8D8]">
                  Nao foi possivel abrir o modal de cartao.
                </p>
                <p className="mt-2 text-[12px] text-[#8E8E8E]">
                  Feche e tente novamente em alguns segundos.
                </p>
                <button
                  type="button"
                  onClick={closeAddMethodModal}
                  className="mt-5 inline-flex h-[40px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[13px] text-[#D8D8D8] transition-colors hover:bg-[#121212]"
                >
                  Fechar
                </button>
              </div>
              </div>
            </div>
          }
        >
          <div className="fixed inset-0 z-[130] overflow-y-auto overscroll-contain bg-black/75 px-4 py-6">
            <div className="flex min-h-full items-center justify-center">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Adicionar um cartao"
              className="relative w-full max-w-[760px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] p-6"
            >
            <button
              type="button"
              onClick={closeAddMethodModal}
              className="absolute right-4 top-4 inline-flex h-[28px] w-[28px] items-center justify-center rounded-[3px] text-[#8A8A8A] transition-colors hover:text-[#D8D8D8]"
              aria-label="Fechar modal"
            >
              X
            </button>

            <h3 className="text-center text-[24px] text-[#D8D8D8]">
              Adicionar um cartao
            </h3>

            <div className="mt-6 h-[1px] w-full bg-[#242424]" />

            {addMethodFlowState !== "idle" || addMethodStatusMessage ? (
              <div
                className={`mt-4 flex min-h-[46px] items-center gap-3 rounded-[3px] border px-4 py-3 ${
                  addMethodFlowState === "approved"
                    ? "border-[#6AE25A] bg-[rgba(106,226,90,0.12)] text-[#9FE88F]"
                    : addMethodFlowState === "rejected"
                      ? "border-[#DB4646] bg-[rgba(219,70,70,0.12)] text-[#F09A9A]"
                      : "border-[#2E2E2E] bg-[#0F0F0F] text-[#D8D8D8]"
                }`}
                aria-live="polite"
              >
                <span className="inline-flex h-[22px] w-[22px] items-center justify-center">
                  {addMethodFlowState === "approved" ? (
                    <span className="text-[14px] font-semibold text-[#6AE25A]">OK</span>
                  ) : addMethodFlowState === "rejected" ? (
                    <span className="text-[14px] font-semibold text-[#DB4646]">ER</span>
                  ) : (
                    <ButtonLoader
                      size={18}
                      colorClassName="text-[#D8D8D8]"
                    />
                  )}
                </span>
                <p className="text-[12px]">
                  {addMethodStatusMessage ||
                    (addMethodFlowState === "preparing"
                      ? "Preparando ambiente seguro..."
                      : "Salvando cartao...")}
                </p>
              </div>
            ) : null}

            <div className="mt-6">
              <p className="mb-3 text-[12px] text-[#D8D8D8]">Dados do Cartao</p>
              <p className="mb-3 text-[11px] text-[#8A8A8A]">
                O cartao so e liberado depois de ser salvo com seguranca no cofre do Mercado Pago.
              </p>

              <div className="grid grid-cols-1 gap-3">
                <div className="relative">
                  <input
                    type="text"
                    value={addMethodForm.cardNumber}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      markAddMethodFieldTouched("cardNumber");
                      clearAddMethodRealtimeFeedback();
                      setAddMethodForm((current) => ({
                        ...current,
                        cardNumber: formatCardNumberInput(nextValue),
                      }));
                    }}
                    onBlur={() => {
                      markAddMethodFieldTouched("cardNumber");
                    }}
                    placeholder="Numero do Cartao"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 pr-[52px] text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                      addMethodVisibleErrors.cardNumber
                        ? "border-[#DB4646]"
                        : "border-[#2E2E2E]"
                    }`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 inline-flex h-[26px] w-[26px] -translate-y-1/2 items-center justify-center rounded-[3px] bg-[#111111]">
                    <PaymentMethodIcon
                      src={addMethodBrandIconSafePath}
                      alt={addMethodCardBrand ? cardBrandLabel(addMethodCardBrand) : "Cartao"}
                      size={18}
                    />
                  </span>
                </div>
                {addMethodVisibleErrors.cardNumber ? (
                  <p className="mt-[-4px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                    {addMethodVisibleErrors.cardNumber}
                  </p>
                ) : null}

                <div>
                  <input
                    type="text"
                    value={addMethodForm.holderName}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      markAddMethodFieldTouched("holderName");
                      clearAddMethodRealtimeFeedback();
                      setAddMethodForm((current) => ({
                        ...current,
                        holderName: nextValue.slice(0, 120),
                      }));
                    }}
                    onBlur={() => {
                      markAddMethodFieldTouched("holderName");
                    }}
                    placeholder="Nome do Titular"
                    className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                      addMethodVisibleErrors.holderName
                        ? "border-[#DB4646]"
                        : "border-[#2E2E2E]"
                    }`}
                  />
                  {addMethodVisibleErrors.holderName ? (
                    <p className="mt-[8px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                      {addMethodVisibleErrors.holderName}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input
                      type="text"
                      value={addMethodForm.expiry}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        markAddMethodFieldTouched("expiry");
                        clearAddMethodRealtimeFeedback();
                        setAddMethodForm((current) => ({
                          ...current,
                          expiry: formatCardExpiryInput(nextValue),
                        }));
                      }}
                      onBlur={() => {
                        markAddMethodFieldTouched("expiry");
                      }}
                      placeholder="Data de Validade"
                      className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                        addMethodVisibleErrors.expiry
                          ? "border-[#DB4646]"
                          : "border-[#2E2E2E]"
                      }`}
                    />
                    {addMethodVisibleErrors.expiry ? (
                      <p className="mt-[8px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                        {addMethodVisibleErrors.expiry}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <input
                      type="text"
                      value={addMethodForm.cvv}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        markAddMethodFieldTouched("cvv");
                        clearAddMethodRealtimeFeedback();
                        setAddMethodForm((current) => ({
                          ...current,
                          cvv: normalizeCardCvvInput(nextValue),
                        }));
                      }}
                      onBlur={() => {
                        markAddMethodFieldTouched("cvv");
                      }}
                      placeholder="CVV/CVC"
                      className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                        addMethodVisibleErrors.cvv
                          ? "border-[#DB4646]"
                          : "border-[#2E2E2E]"
                      }`}
                    />
                    {addMethodVisibleErrors.cvv ? (
                      <p className="mt-[8px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                        {addMethodVisibleErrors.cvv}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    value={addMethodForm.document}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      const digits = normalizeBrazilDocumentDigits(nextValue).slice(0, 14);
                      markAddMethodFieldTouched("document");
                      clearAddMethodRealtimeFeedback();
                      setAddMethodForm((current) => ({
                        ...current,
                        document: formatDocumentInput(digits),
                      }));
                    }}
                    onBlur={() => {
                      markAddMethodFieldTouched("document");
                    }}
                    placeholder="CPF/CNPJ"
                    className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                      addMethodVisibleErrors.document
                        ? "border-[#DB4646]"
                        : "border-[#2E2E2E]"
                    }`}
                  />
                  {addMethodVisibleErrors.document ? (
                    <p className="mt-[8px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                      {addMethodVisibleErrors.document}
                    </p>
                  ) : null}
                </div>

                <div>
                  <input
                    type="text"
                    value={addMethodForm.nickname}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      markAddMethodFieldTouched("nickname");
                      clearAddMethodRealtimeFeedback();
                      setAddMethodForm((current) => ({
                        ...current,
                        nickname: nextValue.slice(0, 42),
                      }));
                    }}
                    onBlur={() => {
                      markAddMethodFieldTouched("nickname");
                    }}
                    placeholder="Apelido do cartao (opcional)"
                    className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                      addMethodVisibleErrors.nickname
                        ? "border-[#DB4646]"
                        : "border-[#2E2E2E]"
                    }`}
                  />
                  {addMethodVisibleErrors.nickname ? (
                    <p className="mt-[8px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                      {addMethodVisibleErrors.nickname}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                void handleAddMethodSubmit();
              }}
              disabled={!addMethodCanSubmit || isAddingMethod || isAddMethodSdkLoading}
              className="mt-5 flex h-[51px] w-full items-center justify-center rounded-[3px] bg-[#D8D8D8] text-[16px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAddingMethod || isAddMethodSdkLoading ? (
                <ButtonLoader size={24} />
              ) : (
                "Validar e salvar cartao"
              )}
            </button>

            {addMethodCooldownMessage ? (
              <p className="mt-3 text-center text-[12px] text-[#8E8E8E]">
                {addMethodCooldownMessage}
              </p>
            ) : null}

            {addMethodError ? (
              <p className="mt-3 text-[14px] text-[#DB4646]" aria-live="polite">
                {addMethodError}
              </p>
            ) : null}
            </div>
            </div>
          </div>
        </ClientErrorBoundary>
      ) : null}

      <BotMissingModal
        isOpen={isWelcomeActivationModalOpen}
        onClose={() => {
          setIsWelcomeActivationModalOpen(false);
          setHasDismissedWelcomeModal(true);
        }}
        onContinue={() => {
          void handleActivateWelcome();
        }}
        isChecking={isActivatingWelcome}
        title="Modulo nao ativado"
        description="O modulo de mensagens de entrada e saida ainda nao esta ativo neste servidor. Deseja ativar agora?"
      />
      </section>
    </ClientErrorBoundary>
  );
}
