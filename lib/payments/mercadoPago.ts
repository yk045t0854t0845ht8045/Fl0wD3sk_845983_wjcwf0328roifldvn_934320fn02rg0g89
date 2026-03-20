import crypto from "node:crypto";

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
};

type CreateCardPaymentInput = {
  amount: number;
  description: string;
  payerName: string;
  payerEmail: string;
  payerIdentification: MercadoPagoPayerIdentification;
  externalReference: string;
  metadata: Record<string, string>;
  token: string;
  paymentMethodId: string;
  installments: number;
  issuerId?: string | null;
  deviceSessionId?: string | null;
  idempotencyKey?: string | null;
  capture?: boolean | null;
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
  date_approved?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: MercadoPagoPointOfInteraction | null;
};

function resolveMercadoPagoAccessToken() {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (typeof token !== "string") return null;
  const normalized = token.trim();
  return normalized || null;
}

function getMercadoPagoAccessTokenOrThrow() {
  const token = resolveMercadoPagoAccessToken();
  if (!token) {
    throw new Error("MERCADO_PAGO_ACCESS_TOKEN nao configurado no ambiente.");
  }

  return token;
}

function resolveMercadoPagoCardAccessToken() {
  const candidates = [
    process.env.MERCADO_PAGO_CARD_ACCESS_TOKEN,
    process.env.MERCADO_PAGO_CARD_PRODUCTION_ACCESS_TOKEN,
    process.env.MERCADO_PAGO_ACCESS_TOKEN,
    process.env.MERCADO_PAGO_CARD_TEST_ACCESS_TOKEN,
  ]
    .map((token) => (typeof token === "string" ? token.trim() : ""))
    .filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.find((token) => !token.startsWith("TEST-")) || candidates[0];
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
  const token = resolveMercadoPagoCardAccessToken() || "";

  return token.startsWith("TEST-") ? "test" : "production";
}

function resolveMercadoPagoFetchTokens(preferCardToken: boolean) {
  const primary = preferCardToken
    ? resolveMercadoPagoCardAccessToken()
    : resolveMercadoPagoAccessToken();
  const secondary = preferCardToken
    ? resolveMercadoPagoAccessToken()
    : resolveMercadoPagoCardAccessToken();

  return Array.from(new Set([primary, secondary].filter(Boolean))) as string[];
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
      identification: {
        type: input.payerIdentification.type,
        number: input.payerIdentification.number,
      },
    },
    external_reference: input.externalReference,
    metadata: input.metadata,
    capture: typeof input.capture === "boolean" ? input.capture : undefined,
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
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const message = data.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
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
  const idempotencyKey = crypto.randomUUID();

  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(buildRequestBody(input)),
    cache: "no-store",
  });

  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const providerMessage =
      parseMercadoPagoErrorMessage(payload) || "Falha ao criar pagamento PIX.";

    throw new Error(`Mercado Pago: ${providerMessage}`);
  }

  return payload as MercadoPagoPaymentResponse;
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

  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers,
    body: JSON.stringify(buildCardRequestBody(input)),
    cache: "no-store",
  });

  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const providerMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao criar pagamento com cartao.";

    throw new Error(`Mercado Pago: ${providerMessage}`);
  }

  return payload as MercadoPagoPaymentResponse;
}

export async function cancelMercadoPagoCardPayment(paymentId: string | number) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();

  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId))}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        status: "cancelled",
      }),
      cache: "no-store",
    },
  );

  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const providerMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao cancelar validacao do cartao.";

    throw new Error(`Mercado Pago: ${providerMessage}`);
  }

  return payload as MercadoPagoPaymentResponse;
}

export async function fetchMercadoPagoPaymentById(
  paymentId: string | number,
  options?: { useCardToken?: boolean; useCardTestToken?: boolean },
) {
  const useCardToken = Boolean(options?.useCardToken || options?.useCardTestToken);
  const candidateTokens = resolveMercadoPagoFetchTokens(useCardToken);
  if (candidateTokens.length === 0) {
    throw new Error(
      "MERCADO_PAGO_ACCESS_TOKEN/MERCADO_PAGO_CARD_ACCESS_TOKEN nao configurado no ambiente.",
    );
  }

  let lastProviderMessage =
    "Falha ao consultar pagamento no Mercado Pago.";

  for (const token of candidateTokens) {
    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId))}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    const rawText = await response.text();
    let payload: unknown = null;

    if (rawText) {
      try {
        payload = JSON.parse(rawText) as unknown;
      } catch {
        payload = rawText;
      }
    }

    if (response.ok) {
      return payload as MercadoPagoPaymentResponse;
    }

    lastProviderMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao consultar pagamento no Mercado Pago.";
  }

  throw new Error(`Mercado Pago: ${lastProviderMessage}`);
}

export async function refundMercadoPagoPixPayment(paymentId: string | number) {
  const accessToken = getMercadoPagoAccessTokenOrThrow();
  const idempotencyKey = crypto.randomUUID();

  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId))}/refunds`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({}),
      cache: "no-store",
    },
  );

  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const providerMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao estornar pagamento PIX no Mercado Pago.";
    throw new Error(`Mercado Pago: ${providerMessage}`);
  }

  return payload;
}

export async function refundMercadoPagoCardPayment(paymentId: string | number) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();
  const idempotencyKey = crypto.randomUUID();

  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId))}/refunds`,
    {
      method: "POST",
      headers: {
        "X-Idempotency-Key": idempotencyKey,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const providerMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao estornar validacao do cartao.";

    throw new Error(`Mercado Pago: ${providerMessage}`);
  }

  return payload;
}
