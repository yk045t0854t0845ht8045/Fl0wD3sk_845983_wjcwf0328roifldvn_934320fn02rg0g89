import crypto from "node:crypto";
import { createStablePaymentIdempotencyKey } from "@/lib/payments/paymentIntegrity";
import { normalizeUtcTimestampIso } from "@/lib/time/utcTimestamp";

type MercadoPagoPayerIdentification = {
  type: "CPF" | "CNPJ";
  number: string;
};

type CreatePixPaymentInput = {
  amount: number;
  description: string;
  payerName: string;
  payerEmail: string;
  payerIdentification: MercadoPagoPayerIdentification;
  externalReference: string;
  metadata: Record<string, string>;
  dateOfExpiration?: string | null;
  idempotencyKey?: string | null;
};

type CreateCardPaymentInput = {
  amount: number;
  description: string;
  payerName: string;
  payerEmail: string;
  payerIdentification: MercadoPagoPayerIdentification;
  payerEntityType?: "individual" | "association" | null;
  payerAddress?: {
    zipCode?: string | null;
  } | null;
  externalReference: string;
  metadata: Record<string, string>;
  token: string;
  paymentMethodId: string;
  installments: number;
  issuerId?: string | null;
  deviceSessionId?: string | null;
  idempotencyKey?: string | null;
  capture?: boolean | null;
  binaryMode?: boolean | null;
  threeDSecureMode?: "optional" | null;
  statementDescriptor?: string | null;
  additionalInfo?: {
    items?: Array<{
      id: string;
      title: string;
      description?: string;
      category_id?: string;
      quantity: number;
      unit_price: number;
    }>;
    payer?: {
      first_name?: string;
      last_name?: string;
      registration_date?: string;
      last_purchase?: string;
      is_first_purchase_online?: boolean;
      address?: {
        zip_code?: string;
      };
    };
  } | null;
};

type CreateCardCheckoutPreferenceInput = {
  amount: number;
  currency: string;
  title: string;
  description?: string | null;
  externalReference: string;
  payerEmail?: string | null;
  payerName?: string | null;
  metadata: Record<string, string>;
  notificationUrl: string;
  successUrl: string;
  pendingUrl: string;
  failureUrl: string;
  expiresAt?: string | null;
  statementDescriptor?: string | null;
  idempotencyKey?: string | null;
};

type PayerNameParts = {
  firstName: string;
  lastName?: string;
};

type MercadoPagoTransactionData = {
  qr_code?: string;
  qr_code_base64?: string;
  ticket_url?: string;
};

type MercadoPagoPointOfInteraction = {
  transaction_data?: MercadoPagoTransactionData;
};

export type MercadoPagoPaymentResponse = {
  id: number | string;
  status?: string;
  status_detail?: string;
  payment_method_id?: string | null;
  payment_type_id?: string | null;
  external_reference?: string | null;
  metadata?: Record<string, unknown> | null;
  transaction_amount?: number;
  transaction_details?: Record<string, unknown> | null;
  payer?: Record<string, unknown> | null;
  date_created?: string | null;
  date_last_updated?: string | null;
  date_approved?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: MercadoPagoPointOfInteraction | null;
};

type MercadoPagoCustomerResponse = {
  id: number | string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type MercadoPagoCustomerSearchResponse = {
  results?: MercadoPagoCustomerResponse[];
};

export type MercadoPagoCustomerCardResponse = {
  id: string | number;
  customer_id?: string | number | null;
  first_six_digits?: string | null;
  last_four_digits?: string | null;
  expiration_month?: number | null;
  expiration_year?: number | null;
  payment_method?: {
    id?: string | null;
    name?: string | null;
  } | null;
  issuer?: {
    id?: string | number | null;
  } | null;
};

export type MercadoPagoCheckoutPreferenceResponse = {
  id: string | number;
  init_point?: string | null;
  sandbox_init_point?: string | null;
};

type MercadoPagoPaymentSearchResponse = {
  results?: MercadoPagoPaymentResponse[];
};

type CacheEntry<TValue> = {
  expiresAt: number;
  value: TValue;
};

type MercadoPagoEnvironment = "production" | "test";

type MercadoPagoJsonRequestOptions = {
  method?: string;
  accessToken: string;
  headers?: Record<string, string>;
  body?: string;
  errorMessage: string;
  allowRetry?: boolean;
  timeoutMs?: number | null;
};

type MercadoPagoJsonResponse<TPayload> = {
  response: Response;
  payload: TPayload;
};

const PAYMENT_LOOKUP_CACHE_TTL_MS = 4_000;
const MERCADO_PAGO_API_BASE_URL = "https://api.mercadopago.com";
const MERCADO_PAGO_DEFAULT_TIMEOUT_MS = 20_000;
const MERCADO_PAGO_DEFAULT_RETRY_COUNT = 1;
const MERCADO_PAGO_RETRYABLE_STATUS_CODES = new Set([
  408, 409, 423, 425, 429, 500, 502, 503, 504,
]);
const paymentByIdCache = new Map<string, CacheEntry<MercadoPagoPaymentResponse>>();
const paymentByIdInflight = new Map<string, Promise<MercadoPagoPaymentResponse>>();
const paymentSearchCache = new Map<
  string,
  CacheEntry<MercadoPagoPaymentResponse[]>
>();
const paymentSearchInflight = new Map<
  string,
  Promise<MercadoPagoPaymentResponse[]>
>();

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readCacheEntry<TValue>(
  cache: Map<string, CacheEntry<TValue>>,
  key: string,
) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cloneJsonValue(cached.value);
}

function writeCacheEntry<TValue>(
  cache: Map<string, CacheEntry<TValue>>,
  key: string,
  value: TValue,
) {
  cache.set(key, {
    value: cloneJsonValue(value),
    expiresAt: Date.now() + PAYMENT_LOOKUP_CACHE_TTL_MS,
  });
}

function buildPaymentByIdCacheKey(paymentId: string | number, useCardToken: boolean) {
  return `${useCardToken ? "card" : "default"}:${String(paymentId).trim()}`;
}

function buildPaymentSearchCacheKey(
  externalReference: string,
  useCardToken: boolean,
) {
  return `${useCardToken ? "card" : "default"}:${externalReference.trim()}`;
}

function storeMercadoPagoPaymentLookupCache(
  payment: MercadoPagoPaymentResponse | null | undefined,
  useCardToken: boolean,
) {
  if (!payment || payment.id === undefined || payment.id === null) {
    return;
  }

  writeCacheEntry(
    paymentByIdCache,
    buildPaymentByIdCacheKey(payment.id, useCardToken),
    payment,
  );
}

export function invalidateMercadoPagoPaymentLookupCache(input?: {
  paymentId?: string | number | null;
  externalReference?: string | null;
}) {
  if (!input) {
    paymentByIdCache.clear();
    paymentByIdInflight.clear();
    paymentSearchCache.clear();
    paymentSearchInflight.clear();
    return;
  }

  if (input.paymentId !== undefined && input.paymentId !== null) {
    const normalizedPaymentId = String(input.paymentId).trim();
    if (normalizedPaymentId) {
      for (const mode of ["card", "default"]) {
        const key = `${mode}:${normalizedPaymentId}`;
        paymentByIdCache.delete(key);
        paymentByIdInflight.delete(key);
      }
    }
  }

  if (typeof input.externalReference === "string" && input.externalReference.trim()) {
    const normalizedReference = input.externalReference.trim();
    for (const mode of ["card", "default"]) {
      const key = `${mode}:${normalizedReference}`;
      paymentSearchCache.delete(key);
      paymentSearchInflight.delete(key);
    }
  }
}

function normalizeMercadoPagoIsoDate(value: string | null | undefined) {
  return normalizeUtcTimestampIso(value);
}

function normalizeMercadoPagoEnvValue(value: string | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeMercadoPagoEnvironmentValue(
  value: string | null | undefined,
): MercadoPagoEnvironment | null {
  const normalized = normalizeMercadoPagoEnvValue(value || undefined)?.toLowerCase();
  if (!normalized) return null;

  if (
    normalized === "production" ||
    normalized === "prod" ||
    normalized === "live"
  ) {
    return "production";
  }

  if (
    normalized === "test" ||
    normalized === "tests" ||
    normalized === "sandbox" ||
    normalized === "homolog"
  ) {
    return "test";
  }

  return null;
}

function resolveMercadoPagoRetryCount() {
  const rawValue = normalizeMercadoPagoEnvValue(
    process.env.MERCADO_PAGO_HTTP_RETRY_COUNT ||
      process.env.MERCADO_PAGO_RETRY_COUNT,
  );
  if (!rawValue) {
    return MERCADO_PAGO_DEFAULT_RETRY_COUNT;
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed)) {
    return MERCADO_PAGO_DEFAULT_RETRY_COUNT;
  }

  return Math.max(0, Math.min(parsed, 3));
}

function resolveMercadoPagoTimeoutMs() {
  const rawValue = normalizeMercadoPagoEnvValue(
    process.env.MERCADO_PAGO_HTTP_TIMEOUT_MS ||
      process.env.MERCADO_PAGO_TIMEOUT_MS,
  );
  if (!rawValue) {
    return MERCADO_PAGO_DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return MERCADO_PAGO_DEFAULT_TIMEOUT_MS;
  }

  return Math.max(5_000, Math.min(Math.trunc(parsed), 60_000));
}

function resolveMercadoPagoEnvironmentPreference(
  values: Array<string | null | undefined>,
) {
  for (const value of values) {
    const resolved = normalizeMercadoPagoEnvironmentValue(value);
    if (resolved) {
      return resolved;
    }
  }

  return "production" as const;
}

function uniqueMercadoPagoTokens(candidates: Array<string | null>) {
  return Array.from(new Set(candidates.filter(Boolean))) as string[];
}

function resolveMercadoPagoPixCandidateTokens() {
  const preferredEnvironment = resolveMercadoPagoEnvironmentPreference([
    process.env.MERCADO_PAGO_PIX_ENVIRONMENT,
    process.env.MERCADO_PAGO_ENVIRONMENT,
    process.env.NEXT_PUBLIC_MERCADO_PAGO_ENVIRONMENT,
  ]);
  const productionCandidates = [
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_PIX_ACCESS_TOKEN),
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_ACCESS_TOKEN),
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN),
  ];
  const testCandidates = [
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_PIX_TEST_ACCESS_TOKEN),
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN),
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_CARD_TEST_ACCESS_TOKEN),
  ];

  return uniqueMercadoPagoTokens(
    preferredEnvironment === "test"
      ? [...testCandidates, ...productionCandidates]
      : [...productionCandidates, ...testCandidates],
  );
}

function resolveMercadoPagoCardCandidateTokens() {
  const preferredEnvironment = resolveMercadoPagoEnvironmentPreference([
    process.env.MERCADO_PAGO_CARD_ENVIRONMENT,
    process.env.MERCADO_PAGO_ENVIRONMENT,
    process.env.NEXT_PUBLIC_MERCADO_PAGO_ENVIRONMENT,
  ]);
  const productionCandidates = [
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_CARD_ACCESS_TOKEN),
    normalizeMercadoPagoEnvValue(
      process.env.MERCADO_PAGO_CARD_PRODUCTION_ACCESS_TOKEN,
    ),
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_ACCESS_TOKEN),
  ];
  const testCandidates = [
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_CARD_TEST_ACCESS_TOKEN),
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN),
  ];

  return uniqueMercadoPagoTokens(
    preferredEnvironment === "test"
      ? [...testCandidates, ...productionCandidates]
      : [...productionCandidates, ...testCandidates],
  );
}

function inferMercadoPagoEnvironmentFromToken(
  token: string | null | undefined,
): MercadoPagoEnvironment {
  return token?.startsWith("TEST-") ? "test" : "production";
}

function resolveMercadoPagoAccessToken() {
  return resolveMercadoPagoPixCandidateTokens()[0] || null;
}

function getMercadoPagoAccessTokenOrThrow() {
  const token = resolveMercadoPagoAccessToken();
  if (!token) {
    throw new Error("MERCADO_PAGO_ACCESS_TOKEN nao configurado no ambiente.");
  }

  return token;
}

function resolveMercadoPagoCardAccessToken() {
  return resolveMercadoPagoCardCandidateTokens()[0] || null;
}

function getMercadoPagoCardAccessTokenOrThrow() {
  const token = resolveMercadoPagoCardAccessToken();
  if (!token) {
    throw new Error(
      "MERCADO_PAGO_CARD_ACCESS_TOKEN/MERCADO_PAGO_ACCESS_TOKEN nao configurado no ambiente.",
    );
  }

  return token;
}

export function resolveMercadoPagoCardEnvironment() {
  const configuredEnvironment = normalizeMercadoPagoEnvironmentValue(
    process.env.MERCADO_PAGO_CARD_ENVIRONMENT ||
      process.env.MERCADO_PAGO_ENVIRONMENT ||
      process.env.NEXT_PUBLIC_MERCADO_PAGO_ENVIRONMENT,
  );

  return configuredEnvironment || inferMercadoPagoEnvironmentFromToken(resolveMercadoPagoCardAccessToken());
}

export function resolveMercadoPagoPixEnvironment() {
  const configuredEnvironment = normalizeMercadoPagoEnvironmentValue(
    process.env.MERCADO_PAGO_PIX_ENVIRONMENT ||
      process.env.MERCADO_PAGO_ENVIRONMENT ||
      process.env.NEXT_PUBLIC_MERCADO_PAGO_ENVIRONMENT,
  );

  return configuredEnvironment || inferMercadoPagoEnvironmentFromToken(resolveMercadoPagoAccessToken());
}

export function resolveMercadoPagoPixPayerEmail(preferredEmail?: string | null) {
  const normalizedPreferredEmail = normalizeMercadoPagoEnvValue(
    preferredEmail || undefined,
  );

  if (resolveMercadoPagoPixEnvironment() !== "test") {
    return normalizedPreferredEmail;
  }

  return (
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_PIX_TEST_PAYER_EMAIL) ||
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_TEST_PAYER_EMAIL) ||
    normalizedPreferredEmail
  );
}

export function resolveMercadoPagoCardPayerEmail(preferredEmail?: string | null) {
  const normalizedPreferredEmail = normalizeMercadoPagoEnvValue(
    preferredEmail || undefined,
  );

  if (resolveMercadoPagoCardEnvironment() !== "test") {
    return normalizedPreferredEmail;
  }

  return (
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_CARD_TEST_PAYER_EMAIL) ||
    normalizeMercadoPagoEnvValue(process.env.MERCADO_PAGO_TEST_PAYER_EMAIL) ||
    normalizedPreferredEmail
  );
}

export function resolveMercadoPagoHostedCheckoutUrl(
  preference: MercadoPagoCheckoutPreferenceResponse | null | undefined,
) {
  if (!preference) return null;

  const preferredUrl =
    resolveMercadoPagoCardEnvironment() === "test"
      ? preference.sandbox_init_point || preference.init_point || null
      : preference.init_point || preference.sandbox_init_point || null;

  if (typeof preferredUrl !== "string") {
    return null;
  }

  const normalizedUrl = preferredUrl.trim();
  if (!normalizedUrl) return null;

  try {
    const parsed = new URL(normalizedUrl);
    const hostname = parsed.hostname.trim().toLowerCase();

    if (parsed.protocol !== "https:") {
      return null;
    }

    const isTrustedMercadoPagoHost =
      /(^|\.)mercadopago\.(com|com\.ar|com\.br|cl|co|com\.mx|com\.uy|com\.pe|com\.ec|com\.ve)$/i.test(
        hostname,
      ) ||
      /(^|\.)mercadolibre\.(com|com\.ar|com\.br|cl|co|com\.mx|com\.uy|com\.pe|com\.ec|com\.ve)$/i.test(
        hostname,
      );

    return isTrustedMercadoPagoHost ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function resolveMercadoPagoFetchTokens(preferCardToken: boolean) {
  return preferCardToken
    ? uniqueMercadoPagoTokens([
        ...resolveMercadoPagoCardCandidateTokens(),
        ...resolveMercadoPagoPixCandidateTokens(),
      ])
    : uniqueMercadoPagoTokens([
        ...resolveMercadoPagoPixCandidateTokens(),
        ...resolveMercadoPagoCardCandidateTokens(),
      ]);
}

function buildRequestBody(input: CreatePixPaymentInput) {
  const payerName = splitPayerName(input.payerName);

  return {
    transaction_amount: input.amount,
    description: input.description,
    payment_method_id: "pix",
    payer: {
      email: input.payerEmail,
      first_name: payerName.firstName,
      last_name: payerName.lastName,
      identification: {
        type: input.payerIdentification.type,
        number: input.payerIdentification.number,
      },
    },
    external_reference: input.externalReference,
    metadata: input.metadata,
    date_of_expiration: input.dateOfExpiration || undefined,
  };
}

function buildCardRequestBody(input: CreateCardPaymentInput) {
  const payerName = splitPayerName(input.payerName);

  return {
    transaction_amount: input.amount,
    description: input.description,
    token: input.token,
    payment_method_id: input.paymentMethodId,
    installments: input.installments,
    issuer_id: input.issuerId || undefined,
    payer: {
      email: input.payerEmail,
      first_name: payerName.firstName,
      last_name: payerName.lastName,
      entity_type: input.payerEntityType || undefined,
      identification: {
        type: input.payerIdentification.type,
        number: input.payerIdentification.number,
      },
      address: input.payerAddress
        ? {
            zip_code: input.payerAddress.zipCode || undefined,
          }
        : undefined,
    },
    external_reference: input.externalReference,
    metadata: input.metadata,
    capture: typeof input.capture === "boolean" ? input.capture : undefined,
    binary_mode:
      typeof input.binaryMode === "boolean" ? input.binaryMode : false,
    three_d_secure_mode: input.threeDSecureMode || undefined,
    statement_descriptor: input.statementDescriptor || undefined,
    additional_info: input.additionalInfo || undefined,
  };
}

function splitPayerName(value: string): PayerNameParts {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { firstName: "Cliente" };
  }

  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 1) {
    return { firstName: words[0] };
  }

  return {
    firstName: words[0],
    lastName: words.slice(1).join(" "),
  };
}

function parseMercadoPagoErrorMessage(payload: unknown) {
  if (typeof payload === "string") {
    const normalized = payload.trim();
    return normalized || null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const message = data.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  const details = data.details;
  if (typeof details === "string" && details.trim()) {
    return details.trim();
  }

  const description = data.description;
  if (typeof description === "string" && description.trim()) {
    return description.trim();
  }

  const error = data.error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  const cause = data.cause;
  if (Array.isArray(cause) && cause.length > 0) {
    const firstCause = cause[0];
    if (firstCause && typeof firstCause === "object") {
      const description = (firstCause as Record<string, unknown>).description;
      if (typeof description === "string" && description.trim()) {
        return description.trim();
      }
    }
  }

  return null;
}

function parseMercadoPagoErrorCode(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const directCode = data.error ?? data.code;
  if (typeof directCode === "string" && directCode.trim()) {
    return directCode.trim().toLowerCase();
  }

  const cause = data.cause;
  if (Array.isArray(cause) && cause.length > 0) {
    const firstCause = cause[0];
    if (firstCause && typeof firstCause === "object") {
      const causeCode = (firstCause as Record<string, unknown>).code;
      if (typeof causeCode === "string" && causeCode.trim()) {
        return causeCode.trim().toLowerCase();
      }
    }
  }

  return null;
}

async function readMercadoPagoPayload(response: Response) {
  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }

  return payload;
}

function buildMercadoPagoUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  return `${MERCADO_PAGO_API_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function isMercadoPagoRetryableResponse(statusCode: number, payload: unknown) {
  if (MERCADO_PAGO_RETRYABLE_STATUS_CODES.has(statusCode)) {
    return true;
  }

  const errorCode = parseMercadoPagoErrorCode(payload);
  if (!errorCode) {
    return false;
  }

  return (
    errorCode.includes("internal_error") ||
    errorCode.includes("rate_limit") ||
    errorCode.includes("timeout") ||
    errorCode.includes("temporarily_unavailable")
  );
}

function isMercadoPagoRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    error instanceof TypeError
  );
}

function resolveMercadoPagoTransportErrorMessage(
  error: unknown,
  fallbackMessage: string,
) {
  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return "Tempo limite ao comunicar com o Mercado Pago.";
  }

  if (error instanceof TypeError) {
    return "Falha de rede ao comunicar com o Mercado Pago.";
  }

  return fallbackMessage;
}

function sleepMercadoPago(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MercadoPagoRequestError extends Error {
  statusCode: number | null;

  constructor(providerMessage: string, statusCode?: number | null) {
    super(`Mercado Pago: ${providerMessage}`);
    this.name = "MercadoPagoRequestError";
    this.statusCode = statusCode ?? null;
  }
}

async function fetchMercadoPagoJson<TPayload>(
  pathOrUrl: string,
  options: MercadoPagoJsonRequestOptions,
): Promise<MercadoPagoJsonResponse<TPayload>> {
  const maxAttempts = options.allowRetry ? resolveMercadoPagoRetryCount() + 1 : 1;
  let lastProviderMessage = options.errorMessage;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? resolveMercadoPagoTimeoutMs(),
    );

    try {
      const response = await fetch(buildMercadoPagoUrl(pathOrUrl), {
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          ...(options.headers || {}),
        },
        body: options.body,
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await readMercadoPagoPayload(response)) as TPayload;

      if (response.ok) {
        return {
          response,
          payload,
        };
      }

      lastProviderMessage =
        parseMercadoPagoErrorMessage(payload) || options.errorMessage;

      if (
        attempt < maxAttempts &&
        isMercadoPagoRetryableResponse(response.status, payload)
      ) {
        await sleepMercadoPago(Math.min(250 * 2 ** (attempt - 1), 1_500));
        continue;
      }

      throw new MercadoPagoRequestError(lastProviderMessage, response.status);
    } catch (error) {
      if (error instanceof MercadoPagoRequestError) {
        throw error;
      }

      lastProviderMessage = resolveMercadoPagoTransportErrorMessage(
        error,
        options.errorMessage,
      );

      if (
        attempt < maxAttempts &&
        isMercadoPagoRetryableNetworkError(error)
      ) {
        await sleepMercadoPago(Math.min(250 * 2 ** (attempt - 1), 1_500));
        continue;
      }

      throw new MercadoPagoRequestError(lastProviderMessage);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new MercadoPagoRequestError(lastProviderMessage);
}

export function resolvePaymentStatus(status: string | null | undefined) {
  if (!status) return "pending";

  const normalizedStatus = status.toLowerCase();

  switch (normalizedStatus) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "canceled":
    case "cancelled":
    case "refunded":
    case "charged_back":
    case "reverted":
      return "cancelled";
    case "expired":
      return "expired";
    case "authorized":
    case "in_process":
    case "in_mediation":
    case "pending_waiting_transfer":
      return "pending";
    default:
      return "pending";
  }
}

export function toQrDataUri(qrBase64: string | null | undefined) {
  if (!qrBase64) return null;
  if (qrBase64.startsWith("data:image/")) return qrBase64;
  return `data:image/png;base64,${qrBase64}`;
}

export async function createMercadoPagoPixPayment(input: CreatePixPaymentInput) {
  const accessToken = getMercadoPagoAccessTokenOrThrow();
  const idempotencyKey =
    input.idempotencyKey?.trim() ||
    createStablePaymentIdempotencyKey({
      namespace: "mercado-pago-pix-create",
      parts: [
        input.externalReference,
        input.amount,
        input.payerEmail,
        input.payerIdentification.type,
        input.payerIdentification.number,
      ],
    });

  const { payload } = await fetchMercadoPagoJson<MercadoPagoPaymentResponse>(
    "/v1/payments",
    {
      method: "POST",
      accessToken,
      headers: {
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(buildRequestBody(input)),
      errorMessage: "Falha ao criar pagamento PIX.",
      allowRetry: true,
    },
  );

  return payload;
}

export async function createMercadoPagoCardPayment(input: CreateCardPaymentInput) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();
  const idempotencyKey =
    input.idempotencyKey?.trim() || crypto.randomUUID();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-Idempotency-Key": idempotencyKey,
  };
  const deviceSessionId = input.deviceSessionId?.trim() || null;
  if (deviceSessionId) {
    headers["X-meli-session-id"] = deviceSessionId;
  }

  const { payload } = await fetchMercadoPagoJson<MercadoPagoPaymentResponse>(
    "/v1/payments",
    {
      method: "POST",
      accessToken,
      headers,
      body: JSON.stringify(buildCardRequestBody(input)),
      errorMessage: "Falha ao criar pagamento com cartao.",
      allowRetry: true,
    },
  );

  return payload;
}

export async function createMercadoPagoCardCheckoutPreference(
  input: CreateCardCheckoutPreferenceInput,
) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();
  const idempotencyKey =
    input.idempotencyKey?.trim() || crypto.randomUUID();
  const payerName = splitPayerName(input.payerName || "");
  const hasPayerName =
    Boolean(payerName.firstName?.trim()) || Boolean(payerName.lastName?.trim());
  const expirationDateFrom = new Date().toISOString();
  const expirationDateTo = normalizeMercadoPagoIsoDate(input.expiresAt);

  const { payload } =
    await fetchMercadoPagoJson<MercadoPagoCheckoutPreferenceResponse>(
      "/checkout/preferences",
      {
        method: "POST",
        accessToken,
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          items: [
            {
              id: input.externalReference,
              title: input.title,
              description: input.description || input.title,
              category_id: "services",
              quantity: 1,
              currency_id: input.currency,
              unit_price: input.amount,
            },
          ],
          payer:
            input.payerEmail || hasPayerName
              ? {
                  email: input.payerEmail || undefined,
                  name: hasPayerName ? payerName.firstName : undefined,
                  surname: hasPayerName
                    ? payerName.lastName || undefined
                    : undefined,
                }
              : undefined,
          back_urls: {
            success: input.successUrl,
            pending: input.pendingUrl,
            failure: input.failureUrl,
          },
          auto_return: "approved",
          expires: Boolean(expirationDateTo),
          expiration_date_from: expirationDateTo
            ? expirationDateFrom
            : undefined,
          expiration_date_to: expirationDateTo || undefined,
          external_reference: input.externalReference,
          metadata: input.metadata,
          notification_url: input.notificationUrl,
          statement_descriptor: input.statementDescriptor || undefined,
          payment_methods: {
            excluded_payment_types: [
              { id: "ticket" },
              { id: "atm" },
              { id: "bank_transfer" },
            ],
            installments: 1,
            default_installments: 1,
          },
        }),
        errorMessage: "Falha ao preparar checkout redirecionado com cartao.",
        allowRetry: true,
      },
    );

  return payload;
}

export async function cancelMercadoPagoCardPayment(paymentId: string | number) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();

  const { payload } = await fetchMercadoPagoJson<MercadoPagoPaymentResponse>(
    `/v1/payments/${encodeURIComponent(String(paymentId))}`,
    {
      method: "PUT",
      accessToken,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "cancelled",
      }),
      errorMessage: "Falha ao cancelar validacao do cartao.",
    },
  );

  invalidateMercadoPagoPaymentLookupCache({ paymentId });
  return payload;
}

export async function fetchMercadoPagoPaymentById(
  paymentId: string | number,
  options?: {
    useCardToken?: boolean;
    useCardTestToken?: boolean;
    forceFresh?: boolean;
  },
) {
  const useCardToken = Boolean(options?.useCardToken || options?.useCardTestToken);
  const cacheKey = buildPaymentByIdCacheKey(paymentId, useCardToken);
  if (!options?.forceFresh) {
    const cached = readCacheEntry(paymentByIdCache, cacheKey);
    if (cached) {
      return cached;
    }

    const inflight = paymentByIdInflight.get(cacheKey);
    if (inflight) {
      return cloneJsonValue(await inflight);
    }
  } else {
    invalidateMercadoPagoPaymentLookupCache({ paymentId });
  }

  const candidateTokens = resolveMercadoPagoFetchTokens(useCardToken);
  if (candidateTokens.length === 0) {
    throw new Error(
      "MERCADO_PAGO_ACCESS_TOKEN/MERCADO_PAGO_CARD_ACCESS_TOKEN nao configurado no ambiente.",
    );
  }

  const loadPromise = (async () => {
    let lastProviderMessage =
      "Falha ao consultar pagamento no Mercado Pago.";

    for (const token of candidateTokens) {
      try {
        const { payload } = await fetchMercadoPagoJson<MercadoPagoPaymentResponse>(
          `/v1/payments/${encodeURIComponent(String(paymentId))}`,
          {
            method: "GET",
            accessToken: token,
            errorMessage: "Falha ao consultar pagamento no Mercado Pago.",
            allowRetry: true,
          },
        );
        const resolved = payload;
        storeMercadoPagoPaymentLookupCache(resolved, useCardToken);
        return resolved;
      } catch (error) {
        lastProviderMessage =
          error instanceof Error
            ? error.message.replace(/^Mercado Pago:\s*/i, "").trim() ||
              lastProviderMessage
            : lastProviderMessage;
      }
    }

    throw new Error(`Mercado Pago: ${lastProviderMessage}`);
  })().finally(() => {
    paymentByIdInflight.delete(cacheKey);
  });

  paymentByIdInflight.set(cacheKey, loadPromise);
  return cloneJsonValue(await loadPromise);
}

export async function searchMercadoPagoPaymentsByExternalReference(
  externalReference: string,
  options?: {
    useCardToken?: boolean;
    useCardTestToken?: boolean;
    forceFresh?: boolean;
  },
) {
  const normalizedReference = externalReference.trim();
  if (!normalizedReference) {
    return [] as MercadoPagoPaymentResponse[];
  }

  const useCardToken = Boolean(options?.useCardToken || options?.useCardTestToken);
  const cacheKey = buildPaymentSearchCacheKey(normalizedReference, useCardToken);
  if (!options?.forceFresh) {
    const cached = readCacheEntry(paymentSearchCache, cacheKey);
    if (cached) {
      return cached;
    }

    const inflight = paymentSearchInflight.get(cacheKey);
    if (inflight) {
      return cloneJsonValue(await inflight);
    }
  } else {
    invalidateMercadoPagoPaymentLookupCache({
      externalReference: normalizedReference,
    });
  }

  const candidateTokens = resolveMercadoPagoFetchTokens(useCardToken);
  if (candidateTokens.length === 0) {
    throw new Error(
      "MERCADO_PAGO_ACCESS_TOKEN/MERCADO_PAGO_CARD_ACCESS_TOKEN nao configurado no ambiente.",
    );
  }

  const loadPromise = (async () => {
    let lastProviderMessage =
      "Falha ao consultar pagamentos no Mercado Pago.";

    for (const token of candidateTokens) {
      const params = new URLSearchParams({
        external_reference: normalizedReference,
        sort: "date_created",
        criteria: "desc",
        limit: "10",
      });

      try {
        const { payload } =
          await fetchMercadoPagoJson<MercadoPagoPaymentSearchResponse>(
            `/v1/payments/search?${params.toString()}`,
            {
              method: "GET",
              accessToken: token,
              errorMessage: "Falha ao consultar pagamentos no Mercado Pago.",
              allowRetry: true,
            },
          );
        const results = Array.isArray(
          (payload as MercadoPagoPaymentSearchResponse | null)?.results,
        )
          ? ((payload as MercadoPagoPaymentSearchResponse)
              .results as MercadoPagoPaymentResponse[])
          : [];

        writeCacheEntry(paymentSearchCache, cacheKey, results);
        for (const payment of results) {
          storeMercadoPagoPaymentLookupCache(payment, useCardToken);
        }
        return results;
      } catch (error) {
        lastProviderMessage =
          error instanceof Error
            ? error.message.replace(/^Mercado Pago:\s*/i, "").trim() ||
              lastProviderMessage
            : lastProviderMessage;
      }
    }

    throw new Error(`Mercado Pago: ${lastProviderMessage}`);
  })().finally(() => {
    paymentSearchInflight.delete(cacheKey);
  });

  paymentSearchInflight.set(cacheKey, loadPromise);
  return cloneJsonValue(await loadPromise);
}

export async function refundMercadoPagoPixPayment(paymentId: string | number) {
  const accessToken = getMercadoPagoAccessTokenOrThrow();
  const idempotencyKey = createStablePaymentIdempotencyKey({
    namespace: "mercado-pago-pix-refund",
    parts: [String(paymentId)],
  });

  const { payload } = await fetchMercadoPagoJson<unknown>(
    `/v1/payments/${encodeURIComponent(String(paymentId))}/refunds`,
    {
      method: "POST",
      accessToken,
      headers: {
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({}),
      errorMessage: "Falha ao estornar pagamento PIX no Mercado Pago.",
      allowRetry: true,
    },
  );

  invalidateMercadoPagoPaymentLookupCache({ paymentId });
  return payload;
}

export async function refundMercadoPagoCardPayment(paymentId: string | number) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();
  const idempotencyKey = createStablePaymentIdempotencyKey({
    namespace: "mercado-pago-card-refund",
    parts: [String(paymentId)],
  });

  const { payload } = await fetchMercadoPagoJson<unknown>(
    `/v1/payments/${encodeURIComponent(String(paymentId))}/refunds`,
    {
      method: "POST",
      accessToken,
      headers: {
        "X-Idempotency-Key": idempotencyKey,
      },
      errorMessage: "Falha ao estornar validacao do cartao.",
      allowRetry: true,
    },
  );

  invalidateMercadoPagoPaymentLookupCache({ paymentId });
  return payload;
}

export async function searchMercadoPagoCustomerByEmail(email: string) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();
  const normalizedEmail = email.trim().toLowerCase();

  const { payload } =
    await fetchMercadoPagoJson<MercadoPagoCustomerSearchResponse>(
      `/v1/customers/search?email=${encodeURIComponent(normalizedEmail)}`,
      {
        method: "GET",
        accessToken,
        errorMessage: "Falha ao buscar cliente no Mercado Pago.",
        allowRetry: true,
      },
    );

  const results = Array.isArray(
    (payload as MercadoPagoCustomerSearchResponse | null)?.results,
  )
    ? ((payload as MercadoPagoCustomerSearchResponse).results as MercadoPagoCustomerResponse[])
    : [];

  return results[0] || null;
}

export async function createMercadoPagoCustomer(input: {
  email: string;
  firstName: string;
  lastName?: string | null;
  idempotencyKey?: string | null;
}) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();
  const idempotencyKey =
    typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()
      ? input.idempotencyKey.trim()
      : crypto.randomUUID();

  const { payload } = await fetchMercadoPagoJson<MercadoPagoCustomerResponse>(
    "/v1/customers",
    {
      method: "POST",
      accessToken,
      headers: {
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        email: input.email.trim().toLowerCase(),
        first_name: input.firstName,
        last_name: input.lastName || undefined,
      }),
      errorMessage: "Falha ao criar cliente no Mercado Pago.",
      allowRetry: true,
    },
  );

  return payload;
}

export async function createMercadoPagoCustomerCard(input: {
  customerId: string | number;
  token: string;
  idempotencyKey?: string | null;
}) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();
  const idempotencyKey =
    typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()
      ? input.idempotencyKey.trim()
      : crypto.randomUUID();

  const { payload } =
    await fetchMercadoPagoJson<MercadoPagoCustomerCardResponse>(
      `/v1/customers/${encodeURIComponent(String(input.customerId))}/cards`,
      {
        method: "POST",
        accessToken,
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          token: input.token,
        }),
        errorMessage: "Falha ao salvar cartao no cofre seguro do Mercado Pago.",
        allowRetry: true,
      },
    );

  return payload;
}

export async function deleteMercadoPagoCustomerCard(input: {
  customerId: string | number;
  cardId: string | number;
}) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();

  const { payload } = await fetchMercadoPagoJson<unknown>(
    `/v1/customers/${encodeURIComponent(String(input.customerId))}/cards/${encodeURIComponent(String(input.cardId))}`,
    {
      method: "DELETE",
      accessToken,
      errorMessage: "Falha ao remover cartao salvo do Mercado Pago.",
    },
  );

  return payload;
}
