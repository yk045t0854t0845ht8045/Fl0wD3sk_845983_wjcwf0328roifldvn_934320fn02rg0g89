import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  fetchMercadoPagoPaymentById,
  toQrDataUri,
} from "@/lib/payments/mercadoPago";
import {
  reconcilePaymentOrderRecord,
  reconcilePaymentOrderWithProviderPayment,
} from "@/lib/payments/reconciliation";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
} from "@/lib/security/requestSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type PaymentMethod = "pix" | "card";
type PaymentOrderStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";

type PaymentOrderRecord = {
  id: number;
  order_number: number;
  guild_id: string;
  payment_method: PaymentMethod;
  status: PaymentOrderStatus;
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

const LICENSE_VALIDITY_DAYS = 30;
const LICENSE_VALIDITY_MS = LICENSE_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
const PAYMENT_ORDER_SELECT_COLUMNS =
  "id, order_number, guild_id, payment_method, status, amount, currency, payer_name, payer_document, payer_document_type, provider_payment_id, provider_external_reference, provider_qr_code, provider_qr_base64, provider_ticket_url, provider_status, provider_status_detail, paid_at, expires_at, created_at, updated_at";

function normalizeGuildId(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function normalizeOrderCode(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{1,12}$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizePaymentId(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

function resolveLicenseBaseTimestamp(order: PaymentOrderRecord) {
  const paidAtMs = order.paid_at ? Date.parse(order.paid_at) : Number.NaN;
  if (Number.isFinite(paidAtMs)) return paidAtMs;

  const createdAtMs = Date.parse(order.created_at);
  if (Number.isFinite(createdAtMs)) return createdAtMs;

  return Date.now();
}

function resolveLicenseExpiresAt(order: PaymentOrderRecord) {
  return new Date(
    resolveLicenseBaseTimestamp(order) + LICENSE_VALIDITY_MS,
  ).toISOString();
}

function isLicenseActiveForOrder(order: PaymentOrderRecord) {
  if (order.status !== "approved") return false;
  return Date.now() < Date.parse(resolveLicenseExpiresAt(order));
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
    qrCodeDataUri: toQrDataUri(record.provider_qr_base64),
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
        NextResponse.json(
          { ok: false, message: "Nao autenticado." },
          { status: 401 },
        ),
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

async function getOrderByCodeForGuild(guildId: string, orderCode: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("guild_id", guildId)
    .eq("order_number", orderCode)
    .maybeSingle<PaymentOrderRecord>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar pedido por codigo: ${result.error.message}`,
    );
  }

  return result.data || null;
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
    throw new Error(`Erro ao carregar pedido atual: ${result.error.message}`);
  }

  return result.data || null;
}

export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      requestContext.requestId,
    );

  try {
    const url = new URL(request.url);
    const guildId = normalizeGuildId(url.searchParams.get("guildId"));
    const orderCode = normalizeOrderCode(url.searchParams.get("code"));
    const paymentId =
      normalizePaymentId(url.searchParams.get("paymentId")) ||
      normalizePaymentId(url.searchParams.get("payment_id")) ||
      normalizePaymentId(url.searchParams.get("collection_id"));

    if (!guildId) {
      return respond(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(access.response, requestContext.requestId);
    }

    const user = access.context.sessionData.authSession.user;
    let order = orderCode
      ? await getOrderByCodeForGuild(guildId, orderCode)
      : await getLatestOrderForUserAndGuild(user.id, guildId);

    if (!order) {
      return respond(
        { ok: false, message: "Pedido nao encontrado para este servidor." },
        { status: 404 },
      );
    }

    if (paymentId) {
      try {
        const providerPayment = await fetchMercadoPagoPaymentById(paymentId, {
          useCardToken: order.payment_method === "card",
        });
        await reconcilePaymentOrderWithProviderPayment(order, providerPayment, {
          source: "auth_payment_order_query_payment_id",
        });
        order = (await getOrderByCodeForGuild(guildId, order.order_number)) || order;
      } catch {
        // melhor esforco; ainda podemos cair no estado persistido ou na reconciliacao normal
      }
    } else if (order.provider_payment_id) {
      try {
        const reconciled = await reconcilePaymentOrderRecord(order, {
          source: "auth_payment_order_query",
        });
        if (reconciled.changed) {
          order = (await getOrderByCodeForGuild(guildId, order.order_number)) || order;
        }
      } catch {
        // manter o estado persistido mesmo se a reconciliacao oportunista falhar
      }
    }

    return respond({
      ok: true,
      order: toApiOrder(order),
      licenseActive: isLicenseActiveForOrder(order),
      licenseExpiresAt: resolveLicenseExpiresAt(order),
      fromOrderCode: Boolean(orderCode),
    });
  } catch (error) {
    return respond(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao carregar pedido de pagamento.",
      },
      { status: 500 },
    );
  }
}
