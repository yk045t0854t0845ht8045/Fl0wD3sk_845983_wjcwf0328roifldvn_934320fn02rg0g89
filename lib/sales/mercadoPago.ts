import crypto from "node:crypto";

export type SalesMercadoPagoPaymentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export type SalesMercadoPagoPayment = {
  id: number | string;
  status?: string | null;
  status_detail?: string | null;
  external_reference?: string | null;
  transaction_amount?: number | null;
  date_approved?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string | null;
      qr_code_base64?: string | null;
      ticket_url?: string | null;
    } | null;
  } | null;
  metadata?: Record<string, unknown> | null;
};

type CreateSalesPixPaymentInput = {
  accessToken: string;
  amount: number;
  description: string;
  payerEmail: string;
  payerName: string;
  externalReference: string;
  metadata: Record<string, string>;
  notificationUrl?: string | null;
  expiresAt?: string | null;
  idempotencyKey?: string | null;
};

const MERCADO_PAGO_API_BASE_URL = "https://api.mercadopago.com";
const MERCADO_PAGO_TIMEOUT_MS = 20_000;

function splitName(value: string) {
  const parts = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: parts[0] || "Cliente", lastName: undefined };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function normalizeAccessToken(value: string) {
  return value.trim();
}

async function readJsonSafely(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function parseProviderMessage(payload: unknown, fallback: string) {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  for (const key of ["message", "description", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const cause = record.cause;
  if (Array.isArray(cause)) {
    const first = cause.find((item) => item && typeof item === "object") as
      | Record<string, unknown>
      | undefined;
    const description = first?.description;
    if (typeof description === "string" && description.trim()) {
      return description.trim();
    }
  }
  return fallback;
}

async function fetchMercadoPago<TPayload>(
  path: string,
  input: {
    accessToken: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    fallbackError: string;
  },
) {
  const accessToken = normalizeAccessToken(input.accessToken);
  if (!accessToken) {
    throw new Error("Access Token do Mercado Pago nao configurado.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MERCADO_PAGO_TIMEOUT_MS);
  try {
    const response = await fetch(`${MERCADO_PAGO_API_BASE_URL}${path}`, {
      method: input.method || "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
        ...(input.headers || {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await readJsonSafely(response)) as TPayload;
    if (!response.ok) {
      throw new Error(
        `Mercado Pago: ${parseProviderMessage(payload, input.fallbackError)}`,
      );
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveSalesMercadoPagoStatus(
  status: string | null | undefined,
): SalesMercadoPagoPaymentStatus {
  switch ((status || "").trim().toLowerCase()) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
    case "canceled":
    case "refunded":
    case "charged_back":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "pending";
  }
}

export function toSalesQrDataUri(value: string | null | undefined) {
  if (!value) return null;
  return value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`;
}

export async function validateSalesMercadoPagoAccessToken(accessToken: string) {
  const payload = await fetchMercadoPago<Record<string, unknown>>("/users/me", {
    accessToken,
    fallbackError: "nao foi possivel validar as credenciais.",
  });
  return payload;
}

export async function createSalesMercadoPagoPixPayment(
  input: CreateSalesPixPaymentInput,
) {
  const payerName = splitName(input.payerName);
  const idempotencyKey =
    input.idempotencyKey?.trim() ||
    crypto
      .createHash("sha256")
      .update(
        [
          "flowdesk-sales-pix",
          input.externalReference,
          input.amount.toFixed(2),
          input.payerEmail,
        ].join(":"),
      )
      .digest("hex");

  return fetchMercadoPago<SalesMercadoPagoPayment>("/v1/payments", {
    accessToken: input.accessToken,
    method: "POST",
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
    body: {
      transaction_amount: input.amount,
      description: input.description,
      payment_method_id: "pix",
      payer: {
        email: input.payerEmail,
        first_name: payerName.firstName,
        last_name: payerName.lastName,
      },
      external_reference: input.externalReference,
      metadata: input.metadata,
      notification_url: input.notificationUrl || undefined,
      date_of_expiration: input.expiresAt || undefined,
    },
    fallbackError: "falha ao criar PIX.",
  });
}

export async function fetchSalesMercadoPagoPaymentById(input: {
  accessToken: string;
  paymentId: string | number;
}) {
  return fetchMercadoPago<SalesMercadoPagoPayment>(
    `/v1/payments/${encodeURIComponent(String(input.paymentId))}`,
    {
      accessToken: input.accessToken,
      fallbackError: "falha ao consultar pagamento.",
    },
  );
}

export async function refundSalesMercadoPagoPayment(input: {
  accessToken: string;
  paymentId: string | number;
}) {
  return fetchMercadoPago<Record<string, unknown>>(
    `/v1/payments/${encodeURIComponent(String(input.paymentId))}/refunds`,
    {
      accessToken: input.accessToken,
      method: "POST",
      headers: {
        "X-Idempotency-Key": crypto
          .createHash("sha256")
          .update(`flowdesk-sales-refund:${input.paymentId}`)
          .digest("hex"),
      },
      fallbackError: "falha ao processar reembolso.",
    },
  );
}
