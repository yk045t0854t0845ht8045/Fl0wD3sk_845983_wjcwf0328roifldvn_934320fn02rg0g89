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
  dateOfExpiration?: string | null;
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

function normalizeMercadoPagoIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

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

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
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
              surname: hasPayerName ? payerName.lastName || undefined : undefined,
            }
          : undefined,
      back_urls: {
        success: input.successUrl,
        pending: input.pendingUrl,
        failure: input.failureUrl,
      },
      auto_return: "approved",
      expires: Boolean(expirationDateTo),
      expiration_date_from: expirationDateTo ? expirationDateFrom : undefined,
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
    cache: "no-store",
  });

  const payload = await readMercadoPagoPayload(response);

  if (!response.ok) {
    const providerMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao preparar checkout redirecionado com cartao.";

    throw new Error(`Mercado Pago: ${providerMessage}`);
  }

  return payload as MercadoPagoCheckoutPreferenceResponse;
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

export async function searchMercadoPagoPaymentsByExternalReference(
  externalReference: string,
  options?: { useCardToken?: boolean; useCardTestToken?: boolean },
) {
  const normalizedReference = externalReference.trim();
  if (!normalizedReference) {
    return [] as MercadoPagoPaymentResponse[];
  }

  const useCardToken = Boolean(options?.useCardToken || options?.useCardTestToken);
  const candidateTokens = resolveMercadoPagoFetchTokens(useCardToken);
  if (candidateTokens.length === 0) {
    throw new Error(
      "MERCADO_PAGO_ACCESS_TOKEN/MERCADO_PAGO_CARD_ACCESS_TOKEN nao configurado no ambiente.",
    );
  }

  let lastProviderMessage =
    "Falha ao consultar pagamentos no Mercado Pago.";

  for (const token of candidateTokens) {
    const params = new URLSearchParams({
      external_reference: normalizedReference,
      sort: "date_created",
      criteria: "desc",
      limit: "10",
    });

    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/search?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    const payload = await readMercadoPagoPayload(response);

    if (response.ok) {
      const results = Array.isArray(
        (payload as MercadoPagoPaymentSearchResponse | null)?.results,
      )
        ? ((payload as MercadoPagoPaymentSearchResponse).results as MercadoPagoPaymentResponse[])
        : [];

      return results;
    }

    lastProviderMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao consultar pagamentos no Mercado Pago.";
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

export async function searchMercadoPagoCustomerByEmail(email: string) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();
  const normalizedEmail = email.trim().toLowerCase();

  const response = await fetch(
    `https://api.mercadopago.com/v1/customers/search?email=${encodeURIComponent(normalizedEmail)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  const payload = await readMercadoPagoPayload(response);

  if (!response.ok) {
    const providerMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao buscar cliente no Mercado Pago.";
    throw new Error(`Mercado Pago: ${providerMessage}`);
  }

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

  const response = await fetch("https://api.mercadopago.com/v1/customers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      first_name: input.firstName,
      last_name: input.lastName || undefined,
    }),
    cache: "no-store",
  });

  const payload = await readMercadoPagoPayload(response);

  if (!response.ok) {
    const providerMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao criar cliente no Mercado Pago.";
    throw new Error(`Mercado Pago: ${providerMessage}`);
  }

  return payload as MercadoPagoCustomerResponse;
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

  const response = await fetch(
    `https://api.mercadopago.com/v1/customers/${encodeURIComponent(String(input.customerId))}/cards`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        token: input.token,
      }),
      cache: "no-store",
    },
  );

  const payload = await readMercadoPagoPayload(response);

  if (!response.ok) {
    const providerMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao salvar cartao no cofre seguro do Mercado Pago.";
    throw new Error(`Mercado Pago: ${providerMessage}`);
  }

  return payload as MercadoPagoCustomerCardResponse;
}

export async function deleteMercadoPagoCustomerCard(input: {
  customerId: string | number;
  cardId: string | number;
}) {
  const accessToken = getMercadoPagoCardAccessTokenOrThrow();

  const response = await fetch(
    `https://api.mercadopago.com/v1/customers/${encodeURIComponent(String(input.customerId))}/cards/${encodeURIComponent(String(input.cardId))}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  const payload = await readMercadoPagoPayload(response);

  if (!response.ok) {
    const providerMessage =
      parseMercadoPagoErrorMessage(payload) ||
      "Falha ao remover cartao salvo do Mercado Pago.";
    throw new Error(`Mercado Pago: ${providerMessage}`);
  }

  return payload;
}
