import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  isValidBrazilDocument,
  normalizeBrazilDocumentDigits,
  resolveBrazilDocumentType,
} from "@/lib/payments/brazilDocument";
import {
  createMercadoPagoCardPayment,
  resolvePaymentStatus,
  toQrDataUri,
} from "@/lib/payments/mercadoPago";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CreateCardPaymentBody = {
  guildId?: unknown;
  payerName?: unknown;
  payerDocument?: unknown;
  cardToken?: unknown;
  paymentMethodId?: unknown;
  installments?: unknown;
  issuerId?: unknown;
};

type PaymentOrderRecord = {
  id: number;
  order_number: number;
  guild_id: string;
  payment_method: "pix" | "card";
  status: string;
  amount: string | number;
  currency: string;
  payer_name: string | null;
  payer_document: string | null;
  payer_document_type: "CPF" | "CNPJ" | null;
  provider_payment_id: string | null;
  provider_qr_code: string | null;
  provider_qr_base64: string | null;
  provider_ticket_url: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type PaymentOrderEventPayload = Record<string, unknown>;

const DEFAULT_AMOUNT = 9.99;
const DEFAULT_CURRENCY = "BRL";
const PAYMENT_ORDER_SELECT_COLUMNS =
  "id, order_number, guild_id, payment_method, status, amount, currency, payer_name, payer_document, payer_document_type, provider_payment_id, provider_qr_code, provider_qr_base64, provider_ticket_url, provider_status, provider_status_detail, paid_at, expires_at, created_at, updated_at";

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function normalizePayerName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return null;
  if (name.length < 3 || name.length > 120) return null;
  return name;
}

function normalizePayerDocument(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = normalizeBrazilDocumentDigits(value);
  const type = resolveBrazilDocumentType(normalized);
  if (!type) return null;
  if (!isValidBrazilDocument(normalized)) return null;

  return {
    normalized,
    type,
  };
}

function normalizeCardToken(value: unknown) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length < 8 || token.length > 300) return null;
  return token;
}

function normalizePaymentMethodId(value: unknown) {
  if (typeof value !== "string") return null;
  const methodId = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,32}$/.test(methodId)) return null;
  return methodId;
}

function normalizeInstallments(value: unknown) {
  if (value === undefined || value === null || value === "") return 1;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return null;
  if (numeric < 1 || numeric > 12) return null;
  return numeric;
}

function normalizeIssuerId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const issuerId = String(value).trim();
  if (!issuerId) return null;
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(issuerId)) return null;
  return issuerId;
}

function maskPayerDocument(document: string | null) {
  if (!document) return null;

  const digits = document.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function parseAmount(amount: string | number) {
  if (typeof amount === "number") return amount;
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric : DEFAULT_AMOUNT;
}

function resolveAmount() {
  const rawValue = process.env.MERCADO_PAGO_PIX_AMOUNT;
  if (!rawValue) return DEFAULT_AMOUNT;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AMOUNT;

  return Math.round(parsed * 100) / 100;
}

function resolveCurrency() {
  return process.env.MERCADO_PAGO_PIX_CURRENCY || DEFAULT_CURRENCY;
}

function toApiOrder(record: PaymentOrderRecord) {
  const qrDataUri = toQrDataUri(record.provider_qr_base64);

  return {
    id: record.id,
    orderNumber: record.order_number,
    guildId: record.guild_id,
    method: record.payment_method,
    status: record.status,
    amount: parseAmount(record.amount),
    currency: record.currency,
    payerName: record.payer_name,
    payerDocumentMasked: maskPayerDocument(record.payer_document),
    payerDocumentType: record.payer_document_type,
    providerPaymentId: record.provider_payment_id,
    providerStatus: record.provider_status,
    providerStatusDetail: record.provider_status_detail,
    qrCodeText: record.provider_qr_code,
    qrCodeBase64: record.provider_qr_base64,
    qrCodeDataUri: qrDataUri,
    ticketUrl: record.provider_ticket_url,
    paidAt: record.paid_at,
    expiresAt: record.expires_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function isProviderDocumentErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("identification number") ||
    normalizedMessage.includes("cpf/cnpj") ||
    normalizedMessage.includes("documento")
  );
}

function isProviderCardFieldErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("card") ||
    normalizedMessage.includes("token") ||
    normalizedMessage.includes("security_code") ||
    normalizedMessage.includes("cvc") ||
    normalizedMessage.includes("cvv") ||
    normalizedMessage.includes("expiration") ||
    normalizedMessage.includes("payment_method_id") ||
    normalizedMessage.includes("issuer")
  );
}

async function ensureGuildAccess(guildId: string) {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    };
  }

  if (!sessionData.accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      ),
    };
  }

  let accessibleGuild = null;
  try {
    accessibleGuild = await assertUserAdminInGuildOrNull(
      {
        authSession: sessionData.authSession,
        accessToken: sessionData.accessToken,
      },
      guildId,
    );
  } catch {
    // fallback resiliente quando houver erro temporario na API do Discord
    accessibleGuild = null;
  }

  if (!accessibleGuild && sessionData.authSession.activeGuildId !== guildId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    context: {
      sessionData,
    },
  };
}

async function createPaymentOrderEvent(
  paymentOrderId: number,
  eventType: string,
  eventPayload: PaymentOrderEventPayload,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase.from("payment_order_events").insert({
    payment_order_id: paymentOrderId,
    event_type: eventType,
    event_payload: eventPayload,
  });

  if (result.error) {
    throw new Error(`Erro ao salvar evento de pagamento: ${result.error.message}`);
  }
}

async function getLatestOrderForUserAndGuild(userId: number, guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PaymentOrderRecord>();

  if (result.error) {
    throw new Error(`Erro ao carregar pagamento: ${result.error.message}`);
  }

  return result.data || null;
}

async function createDraftOrderForCheckout(input: {
  userId: number;
  guildId: string;
  amount: number;
  currency: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();

  const createdOrderResult = await supabase
    .from("payment_orders")
    .insert({
      user_id: input.userId,
      guild_id: input.guildId,
      payment_method: "card",
      status: "pending",
      amount: input.amount,
      currency: input.currency,
      provider: "mercado_pago",
      provider_payload: {
        source: "flowdesk_checkout",
        step: 4,
        channel: "card_test",
        precreated: true,
      },
    })
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .single<PaymentOrderRecord>();

  if (createdOrderResult.error || !createdOrderResult.data) {
    throw new Error(createdOrderResult.error?.message || "Falha ao iniciar pedido.");
  }

  await createPaymentOrderEvent(createdOrderResult.data.id, "order_created", {
    orderNumber: createdOrderResult.data.order_number,
    guildId: input.guildId,
    userId: input.userId,
    precreated: true,
    method: "card",
  });

  return createdOrderResult.data;
}

export async function POST(request: Request) {
  try {
    let body: CreateCardPaymentBody = {};
    try {
      body = (await request.json()) as CreateCardPaymentBody;
    } catch {
      return NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const payerName = normalizePayerName(body.payerName);
    const payerDocument = normalizePayerDocument(body.payerDocument);
    const cardToken = normalizeCardToken(body.cardToken);
    const paymentMethodId = normalizePaymentMethodId(body.paymentMethodId);
    const installments = normalizeInstallments(body.installments);
    const issuerId = normalizeIssuerId(body.issuerId);

    if (!guildId) {
      return NextResponse.json(
        { ok: false, message: "Guild ID invalido para pagamento." },
        { status: 400 },
      );
    }

    if (!payerName) {
      return NextResponse.json(
        { ok: false, message: "Nome completo invalido para pagamento." },
        { status: 400 },
      );
    }

    if (!payerDocument) {
      return NextResponse.json(
        { ok: false, message: "CPF/CNPJ invalido para pagamento." },
        { status: 400 },
      );
    }

    if (!cardToken || !paymentMethodId || installments === null) {
      return NextResponse.json(
        { ok: false, message: "Dados do cartao invalidos para pagamento." },
        { status: 400 },
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return access.response;
    }

    const user = access.context.sessionData.authSession.user;
    const supabase = getSupabaseAdminClientOrThrow();
    const latestOrder = await getLatestOrderForUserAndGuild(user.id, guildId);

    const amount = resolveAmount();
    const currency = resolveCurrency();

    let createdOrder: PaymentOrderRecord;
    const canReuseDraftOrderForPayment =
      !!latestOrder &&
      latestOrder.status === "pending" &&
      !latestOrder.provider_payment_id;

    if (canReuseDraftOrderForPayment) {
      const reusedOrderResult = await supabase
        .from("payment_orders")
        .update({
          payment_method: "card",
          status: "pending",
          amount,
          currency,
          payer_name: payerName,
          payer_document: payerDocument.normalized,
          payer_document_type: payerDocument.type,
          provider_status: null,
          provider_status_detail: null,
          provider_qr_code: null,
          provider_qr_base64: null,
          provider_ticket_url: null,
        })
        .eq("id", latestOrder.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (reusedOrderResult.error || !reusedOrderResult.data) {
        throw new Error(reusedOrderResult.error?.message || "Falha ao preparar pedido.");
      }

      createdOrder = reusedOrderResult.data;

      await createPaymentOrderEvent(createdOrder.id, "order_payment_started", {
        orderNumber: createdOrder.order_number,
        guildId,
        userId: user.id,
        method: "card",
      });
    } else {
      createdOrder = await createDraftOrderForCheckout({
        userId: user.id,
        guildId,
        amount,
        currency,
      });

      const preparedOrderResult = await supabase
        .from("payment_orders")
        .update({
          payment_method: "card",
          payer_name: payerName,
          payer_document: payerDocument.normalized,
          payer_document_type: payerDocument.type,
        })
        .eq("id", createdOrder.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (preparedOrderResult.error || !preparedOrderResult.data) {
        throw new Error(preparedOrderResult.error?.message || "Falha ao preparar pedido.");
      }

      createdOrder = preparedOrderResult.data;
    }

    const externalReference = `flowdesk-order-${createdOrder.order_number}`;

    try {
      const payerEmailForCardTest =
        process.env.MERCADO_PAGO_CARD_TEST_PAYER_EMAIL?.trim() ||
        "test_user_123456@testuser.com";

      const mercadoPagoPayment = await createMercadoPagoCardPayment({
        amount,
        description: `Flowdesk pagamento #${createdOrder.order_number}`,
        payerName,
        payerEmail: payerEmailForCardTest,
        payerIdentification: {
          type: payerDocument.type,
          number: payerDocument.normalized,
        },
        externalReference,
        metadata: {
          flowdesk_order_number: String(createdOrder.order_number),
          flowdesk_user_id: String(user.id),
          flowdesk_discord_user_id: user.discord_user_id,
          flowdesk_guild_id: guildId,
          flowdesk_payment_channel: "card_test",
        },
        token: cardToken,
        paymentMethodId,
        installments,
        issuerId,
      });

      const providerPaymentId = String(mercadoPagoPayment.id);
      const providerStatus = mercadoPagoPayment.status || null;
      const resolvedStatus = resolvePaymentStatus(mercadoPagoPayment.status);
      const paidAt =
        resolvedStatus === "approved"
          ? mercadoPagoPayment.date_approved || new Date().toISOString()
          : null;
      const expiresAt = mercadoPagoPayment.date_of_expiration || null;

      const updatedOrderResult = await supabase
        .from("payment_orders")
        .update({
          status: resolvedStatus,
          provider_payment_id: providerPaymentId,
          provider_external_reference: externalReference,
          provider_qr_code: null,
          provider_qr_base64: null,
          provider_ticket_url: null,
          provider_status: providerStatus,
          provider_status_detail: mercadoPagoPayment.status_detail || null,
          provider_payload: {
            source: "flowdesk_checkout",
            step: 4,
            channel: "card_test",
            mercado_pago: mercadoPagoPayment,
          },
          paid_at: paidAt,
          expires_at: expiresAt,
        })
        .eq("id", createdOrder.id)
        .select(PAYMENT_ORDER_SELECT_COLUMNS)
        .single<PaymentOrderRecord>();

      if (updatedOrderResult.error || !updatedOrderResult.data) {
        throw new Error(
          updatedOrderResult.error?.message ||
            "Falha ao salvar retorno do pagamento.",
        );
      }

      await createPaymentOrderEvent(createdOrder.id, "provider_payment_created", {
        providerPaymentId,
        providerStatus,
        providerStatusDetail: mercadoPagoPayment.status_detail || null,
        method: "card",
      });

      return NextResponse.json({
        ok: true,
        reused: false,
        order: toApiOrder(updatedOrderResult.data),
      });
    } catch (providerError) {
      const message =
        providerError instanceof Error
          ? providerError.message
          : "Falha ao criar pagamento com cartao.";

      await supabase
        .from("payment_orders")
        .update({
          status: "failed",
          provider_external_reference: externalReference,
          provider_status: "error",
          provider_status_detail: message,
        })
        .eq("id", createdOrder.id);

      await createPaymentOrderEvent(createdOrder.id, "provider_payment_failed", {
        message,
        method: "card",
      });

      if (isProviderDocumentErrorMessage(message)) {
        return NextResponse.json(
          { ok: false, message: "CPF/CNPJ invalido para pagamento." },
          { status: 400 },
        );
      }

      if (isProviderCardFieldErrorMessage(message)) {
        return NextResponse.json(
          { ok: false, message: "Dados do cartao invalidos para pagamento." },
          { status: 400 },
        );
      }

      throw new Error(message);
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao criar pagamento com cartao.",
      },
      { status: 500 },
    );
  }
}
