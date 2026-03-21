import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { cancelMercadoPagoCardPayment } from "@/lib/payments/mercadoPago";
import { applyNoStoreHeaders, ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CancelCardPaymentBody = {
  guildId?: unknown;
  orderNumber?: unknown;
};

type PaymentOrderRecord = {
  id: number;
  order_number: number;
  guild_id: string;
  payment_method: "pix" | "card";
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired" | "failed";
  amount: string | number;
  currency: string;
  payer_name: string | null;
  payer_document: string | null;
  payer_document_type: "CPF" | "CNPJ" | null;
  provider_payment_id: string | null;
  provider_external_reference: string | null;
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

const PAYMENT_ORDER_SELECT_COLUMNS =
  "id, order_number, guild_id, payment_method, status, amount, currency, payer_name, payer_document, payer_document_type, provider_payment_id, provider_external_reference, provider_qr_code, provider_qr_base64, provider_ticket_url, provider_status, provider_status_detail, paid_at, expires_at, created_at, updated_at";

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function normalizeOrderNumber(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,12}$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function parseAmount(amount: string | number) {
  if (typeof amount === "number") return amount;
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric : 0;
}

function maskPayerDocument(document: string | null) {
  if (!document) return null;
  const digits = document.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function toApiOrder(record: PaymentOrderRecord) {
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
    providerExternalReference: record.provider_external_reference,
    providerStatus: record.provider_status,
    providerStatusDetail: record.provider_status_detail,
    qrCodeText: record.provider_qr_code,
    qrCodeBase64: record.provider_qr_base64,
    qrCodeDataUri: null,
    ticketUrl: record.provider_ticket_url,
    paidAt: record.paid_at,
    expiresAt: record.expires_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

async function ensureGuildAccess(guildId: string) {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    return {
      ok: false as const,
      response: applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Nao autenticado." }, { status: 401 }),
      ),
    };
  }

  if (!sessionData.accessToken) {
    return {
      ok: false as const,
      response: applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Token OAuth ausente na sessao." },
          { status: 401 },
        ),
      ),
    };
  }

  if (sessionData.authSession.activeGuildId === guildId) {
    return {
      ok: true as const,
      context: {
        sessionData,
      },
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
    accessibleGuild = null;
  }

  if (!accessibleGuild && sessionData.authSession.activeGuildId !== guildId) {
    return {
      ok: false as const,
      response: applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Servidor nao encontrado para este usuario." },
          { status: 403 },
        ),
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
    throw new Error(`Erro ao localizar pagamento: ${result.error.message}`);
  }

  return result.data || null;
}

async function getOrderByNumberForUserAndGuild(
  userId: number,
  guildId: string,
  orderNumber: number,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .eq("order_number", orderNumber)
    .maybeSingle<PaymentOrderRecord>();

  if (result.error) {
    throw new Error(`Erro ao localizar pedido: ${result.error.message}`);
  }

  return result.data || null;
}

async function createPaymentOrderEvent(
  paymentOrderId: number,
  eventType: string,
  eventPayload: Record<string, unknown>,
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

export async function POST(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      baseRequestContext.requestId,
    );

  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) {
      return attachRequestId(securityResponse, baseRequestContext.requestId);
    }

    let body: CancelCardPaymentBody = {};
    try {
      body = (await request.json()) as CancelCardPaymentBody;
    } catch {
      return respond(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const orderNumber = normalizeOrderNumber(body.orderNumber);

    if (!guildId) {
      return respond(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(access.response, baseRequestContext.requestId);
    }

    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionData.authSession.id,
      userId: access.context.sessionData.authSession.user.id,
      guildId,
    });

    const rateLimit = await enforceRequestRateLimit({
      action: "payment_card_cancel_post",
      windowMs: 5 * 60 * 1000,
      maxAttempts: 10,
      context: auditContext,
    });
    if (!rateLimit.ok) {
      const response = respond(
        {
          ok: false,
          message: "Muitas tentativas de cancelamento em pouco tempo. Aguarde alguns instantes.",
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    const user = access.context.sessionData.authSession.user;
    let order = orderNumber
      ? await getOrderByNumberForUserAndGuild(user.id, guildId, orderNumber)
      : await getLatestOrderForUserAndGuild(user.id, guildId);

    if (!order) {
      return respond(
        { ok: false, message: "Pedido nao encontrado para este servidor." },
        { status: 404 },
      );
    }

    if (order.payment_method !== "card") {
      return respond(
        { ok: false, message: "Este pedido nao pertence ao checkout com cartao." },
        { status: 400 },
      );
    }

    if (order.status !== "pending") {
      return respond({
        ok: true,
        order: toApiOrder(order),
      });
    }

    if (order.provider_payment_id) {
      try {
        await cancelMercadoPagoCardPayment(order.provider_payment_id);
      } catch (error) {
        await logSecurityAuditEventSafe(auditContext, {
          action: "payment_card_cancel_post",
          outcome: "failed",
          metadata: {
            orderNumber: order.order_number,
            providerPaymentId: order.provider_payment_id,
            message: error instanceof Error ? error.message : "provider_cancel_failed",
          },
        });

        return respond(
          {
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : "Nao foi possivel cancelar o pagamento com cartao agora.",
          },
          { status: 502 },
        );
      }
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const updateResult = await supabase
      .from("payment_orders")
      .update({
        status: "cancelled",
        provider_status: "cancelled",
        provider_status_detail: "cancelled_manually_by_user",
      })
      .eq("id", order.id)
      .eq("status", "pending")
      .select(PAYMENT_ORDER_SELECT_COLUMNS)
      .single<PaymentOrderRecord>();

    if (updateResult.error || !updateResult.data) {
      throw new Error(
        updateResult.error?.message || "Falha ao cancelar o pedido com cartao.",
      );
    }

    order = updateResult.data;

    await createPaymentOrderEvent(order.id, "order_cancelled_manually_by_user", {
      orderNumber: order.order_number,
      guildId,
      userId: user.id,
      providerPaymentId: order.provider_payment_id,
    });

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_card_cancel_post",
      outcome: "succeeded",
      metadata: {
        orderNumber: order.order_number,
      },
    });

    return respond({
      ok: true,
      order: toApiOrder(order),
    });
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_card_cancel_post",
      outcome: "failed",
      metadata: {
        message: error instanceof Error ? error.message : "unexpected_error",
      },
    });

    return respond(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Falha ao cancelar o pagamento com cartao.",
      },
      { status: 500 },
    );
  }
}
