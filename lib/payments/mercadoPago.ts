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
  date_approved?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: MercadoPagoPointOfInteraction | null;
};

function getMercadoPagoAccessTokenOrThrow() {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error("MERCADO_PAGO_ACCESS_TOKEN nao configurado no ambiente.");
  }

  return token;
}

function getMercadoPagoCardTestAccessTokenOrThrow() {
  const token = process.env.MERCADO_PAGO_CARD_TEST_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "MERCADO_PAGO_CARD_TEST_ACCESS_TOKEN nao configurado no ambiente.",
    );
  }

  if (!token.startsWith("TEST-")) {
    throw new Error(
      "MERCADO_PAGO_CARD_TEST_ACCESS_TOKEN invalido. Para cartao em ambiente de teste, use um token TEST-.",
    );
  }

  return token;
}

function buildRequestBody(input: CreatePixPaymentInput) {
  return {
    transaction_amount: input.amount,
    description: input.description,
    payment_method_id: "pix",
    payer: {
      email: input.payerEmail,
      first_name: input.payerName,
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
  return {
    transaction_amount: input.amount,
    description: input.description,
    token: input.token,
    payment_method_id: input.paymentMethodId,
    installments: input.installments,
    issuer_id: input.issuerId || undefined,
    payer: {
      email: input.payerEmail,
      first_name: input.payerName,
      identification: {
        type: input.payerIdentification.type,
        number: input.payerIdentification.number,
      },
    },
    external_reference: input.externalReference,
    metadata: input.metadata,
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

  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
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
  const accessToken = getMercadoPagoCardTestAccessTokenOrThrow();
  const idempotencyKey = crypto.randomUUID();

  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": idempotencyKey,
    },
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
