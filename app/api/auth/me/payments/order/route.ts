import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  fetchMercadoPagoPaymentById,
  resolvePaymentStatus,
  searchMercadoPagoPaymentsByExternalReference,
  toQrDataUri,
} from "@/lib/payments/mercadoPago";
import { resolvePaymentDiagnostic } from "@/lib/payments/paymentDiagnostics";
import {
  ensureCheckoutAccessTokenForOrder,
  PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS,
  resolveCheckoutLinkFailureMessage,
  verifyCheckoutAccessToken,
} from "@/lib/payments/checkoutLinkSecurity";
import {
  reconcilePaymentOrderRecord,
  reconcilePaymentOrderWithProviderPayment,
} from "@/lib/payments/reconciliation";
import {
  getApprovedOrdersForGuild,
  resolveCoverageForApprovedOrder,
} from "@/lib/payments/licenseStatus";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
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
  user_id: number;
  checkout_link_nonce: string | null;
  checkout_link_expires_at: string | null;
  checkout_link_invalidated_at: string | null;
  created_at: string;
  updated_at: string;
};

const PAYMENT_ORDER_SELECT_COLUMNS =
  `id, order_number, guild_id, payment_method, status, amount, currency, payer_name, payer_document, payer_document_type, provider_payment_id, provider_external_reference, provider_qr_code, provider_qr_base64, provider_ticket_url, provider_status, provider_status_detail, paid_at, expires_at, user_id, created_at, updated_at, ${PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS}`;

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

function normalizeCheckoutToken(value: string | null) {
  if (!value) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeHostedCheckoutReturnStatus(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "canceled") return "cancelled" as const;
  if (
    normalized === "approved" ||
    normalized === "pending" ||
    normalized === "cancelled" ||
    normalized === "rejected" ||
    normalized === "expired" ||
    normalized === "failed"
  ) {
    return normalized;
  }

  return null;
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

function toApiOrder(
  record: PaymentOrderRecord,
  checkoutAccessToken: string | null = null,
) {
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
    checkoutAccessToken,
    checkoutAccessTokenExpiresAt: record.checkout_link_expires_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

async function createPaymentOrderEventSafe(
  paymentOrderId: number,
  eventType: string,
  eventPayload: Record<string, unknown>,
) {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    await supabase.from("payment_order_events").insert({
      payment_order_id: paymentOrderId,
      event_type: eventType,
      event_payload: eventPayload,
    });
  } catch {
    // nao quebrar o retorno por telemetria
  }
}

async function finalizeHostedCheckoutFallbackOrder(input: {
  order: PaymentOrderRecord;
  returnStatus: "pending" | "cancelled" | "rejected" | "failed";
}) {
  const { order, returnStatus } = input;

  if (order.payment_method !== "card") return order;
  if (order.status !== "pending") return order;
  if (order.provider_payment_id) return order;

  const supabase = getSupabaseAdminClientOrThrow();
  const finalStatus = returnStatus === "pending" ? "cancelled" : returnStatus;
  const providerStatusDetail =
    returnStatus === "pending"
      ? "checkout_returned_without_payment_confirmation"
      : returnStatus === "cancelled"
        ? "checkout_cancelled_by_user"
        : returnStatus === "rejected"
          ? "checkout_rejected_before_provider_confirmation"
          : "checkout_failed_before_provider_confirmation";

  const result = await supabase
    .from("payment_orders")
    .update({
      status: finalStatus,
      provider_status: finalStatus,
      provider_status_detail: providerStatusDetail,
    })
    .eq("id", order.id)
    .eq("status", "pending")
    .is("provider_payment_id", null)
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .maybeSingle<PaymentOrderRecord>();

  if (result.error) {
    throw new Error(
      `Erro ao finalizar retorno do checkout com cartao: ${result.error.message}`,
    );
  }

  const nextOrder = result.data || order;
  const diagnostic = resolvePaymentDiagnostic({
    paymentMethod: "card",
    status: nextOrder.status,
    providerStatus: nextOrder.provider_status,
    providerStatusDetail: nextOrder.provider_status_detail,
  });

  await createPaymentOrderEventSafe(nextOrder.id, "flowdesk_payment_diagnostic_registered", {
    source: "auth_payment_order_query",
    category: diagnostic.category,
    headline: diagnostic.headline,
    summary: diagnostic.summary,
    recommendation: diagnostic.recommendation,
    providerStatus: nextOrder.provider_status,
    providerStatusDetail: nextOrder.provider_status_detail,
  });

  return nextOrder;
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
    .maybeSingle<PaymentOrderRecord | null>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar pedido por codigo: ${result.error.message}`,
    );
  }

  return result.data || null;
}

async function getOrderByCodeForUserAndGuild(
  userId: number,
  guildId: string,
  orderCode: number,
) {
  const order = await getOrderByCodeForGuild(guildId, orderCode);
  if (!order) return { order: null, foreignOwner: false };

  if (order.user_id !== userId) {
    return { order: null, foreignOwner: true };
  }
  return { order, foreignOwner: false };
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

async function getCoverageForApprovedOrder(order: PaymentOrderRecord) {
  if (order.status !== "approved") return null;

  const approvedOrders = await getApprovedOrdersForGuild<PaymentOrderRecord>(
    order.guild_id,
    PAYMENT_ORDER_SELECT_COLUMNS,
  );

  return resolveCoverageForApprovedOrder(approvedOrders, order);
}

async function reconcileHostedCardOrderByExternalReference(
  order: PaymentOrderRecord,
  source: string,
) {
  if (order.payment_method !== "card") return order;
  if (order.status !== "pending") return order;

  const externalReference =
    order.provider_external_reference || `flowdesk-order-${order.order_number}`;

  const payments = await searchMercadoPagoPaymentsByExternalReference(
    externalReference,
    { useCardToken: true },
  );

  const matchingPayments = payments.filter((payment) => {
    const providerExternalReference =
      typeof payment.external_reference === "string"
        ? payment.external_reference.trim()
        : "";
    return providerExternalReference === externalReference;
  });

  const providerPayment =
    matchingPayments.find(
      (payment) => resolvePaymentStatus(payment.status) === "approved",
    ) ||
    matchingPayments.find(
      (payment) => resolvePaymentStatus(payment.status) !== "pending",
    ) ||
    matchingPayments[0] ||
    null;

  if (!providerPayment) {
    return order;
  }

  await reconcilePaymentOrderWithProviderPayment(order, providerPayment, {
    source,
  });

  const refreshedOrder =
    (await getOrderByCodeForGuild(order.guild_id, order.order_number)) || order;

  await createPaymentOrderEventSafe(
    order.id,
    "flowdesk_hosted_card_return_reconciled",
    {
      source,
      providerPaymentId:
        providerPayment.id !== undefined && providerPayment.id !== null
          ? String(providerPayment.id)
          : null,
      resolvedStatus: refreshedOrder.status,
      providerStatus: refreshedOrder.provider_status,
      providerStatusDetail: refreshedOrder.provider_status_detail,
      externalReference,
    },
  );

  return refreshedOrder;
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
    const checkoutToken = normalizeCheckoutToken(
      url.searchParams.get("checkoutToken"),
    );
    const returnStatus = normalizeHostedCheckoutReturnStatus(
      url.searchParams.get("status"),
    );

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
    await cleanupExpiredUnpaidServerSetups({
      userId: user.id,
      guildId,
      source: "auth_payment_order_query",
    });

    let foreignOwner = false;
    let order = null;

    if (orderCode) {
      const lookup = await getOrderByCodeForUserAndGuild(
        user.id,
        guildId,
        orderCode,
      );
      order = lookup.order;
      foreignOwner = lookup.foreignOwner;
    } else {
      order = await getLatestOrderForUserAndGuild(user.id, guildId);
    }

    if (!order) {
      return respond(
        {
          ok: false,
          message: foreignOwner
            ? "Este link de pagamento pertence a outra conta autenticada."
            : "Pedido nao encontrado para este servidor.",
        },
        { status: foreignOwner ? 403 : 404 },
      );
    }

    if (orderCode) {
      const tokenValidation = verifyCheckoutAccessToken(order, checkoutToken);
      if (!tokenValidation.ok) {
        return respond(
          {
            ok: false,
            message: resolveCheckoutLinkFailureMessage(tokenValidation.reason),
          },
          {
            status:
              tokenValidation.reason === "expired" ? 410 : 403,
          },
        );
      }
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
    }

    const shouldResolveApprovedHostedCardReturn =
      returnStatus === "approved" &&
      order.payment_method === "card" &&
      order.status === "pending";

    if (shouldResolveApprovedHostedCardReturn) {
      try {
        order = await reconcileHostedCardOrderByExternalReference(
          order,
          "auth_payment_order_query_approved_return",
        );
      } catch {
        // melhor esforco; mantemos reconciliacao/polling seguintes
      }
    }

    if (
      returnStatus &&
      order.payment_method === "card" &&
      order.status === "pending" &&
      !order.provider_payment_id
    ) {
      try {
        order = await reconcileHostedCardOrderByExternalReference(
          order,
          "auth_payment_order_query_hosted_search",
        );
      } catch {
        // melhor esforco; seguir com o estado persistido
      }
    }

    if (
      returnStatus &&
      (returnStatus === "pending" ||
        returnStatus === "cancelled" ||
        returnStatus === "rejected" ||
        returnStatus === "failed")
    ) {
      try {
        order = await finalizeHostedCheckoutFallbackOrder({
          order,
          returnStatus,
        });
      } catch {
        // melhor esforco; ainda retornamos o estado persistido
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

    const securedOrder = await ensureCheckoutAccessTokenForOrder({
      order,
      forceRotate: false,
      invalidateOtherOrders: false,
    });
    const orderCoverage =
      securedOrder.order.status === "approved"
        ? await getCoverageForApprovedOrder(securedOrder.order)
        : null;

    return respond({
      ok: true,
      order: toApiOrder(securedOrder.order, securedOrder.checkoutAccessToken),
      licenseActive: orderCoverage?.status === "paid",
      licenseExpiresAt: orderCoverage?.licenseExpiresAt || null,
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
