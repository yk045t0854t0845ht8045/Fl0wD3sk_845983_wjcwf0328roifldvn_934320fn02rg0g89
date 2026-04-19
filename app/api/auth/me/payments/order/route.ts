import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  hasAcceptedTeamAccessToGuild,
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
import {
  getCachedLatestPaymentOrderForUserAndGuild,
  getCachedPaymentOrderByCodeForGuild,
  invalidatePaymentOrderQueryCaches,
} from "@/lib/payments/orderQueryCache";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
import {
  resolveDatabaseFailureMessage,
  resolveDatabaseFailureStatus,
} from "@/lib/security/databaseAvailability";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type PaymentMethod = "pix" | "card" | "trial";
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
  guild_id: string | null;
  payment_method: PaymentMethod;
  status: PaymentOrderStatus;
  amount: string | number;
  currency: string;
  plan_code: string;
  plan_name: string;
  plan_billing_cycle_days: number;
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
  `id, order_number, guild_id, payment_method, status, amount, currency, plan_code, plan_name, plan_billing_cycle_days, payer_name, payer_document, payer_document_type, provider_payment_id, provider_external_reference, provider_qr_code, provider_qr_base64, provider_ticket_url, provider_status, provider_status_detail, paid_at, expires_at, user_id, created_at, updated_at, ${PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS}`;

function normalizeNullableProviderQueryValue(value: string | null) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const lowered = normalized.toLowerCase();
  if (
    lowered === "null" ||
    lowered === "undefined" ||
    lowered === "nan"
  ) {
    return null;
  }

  return normalized;
}

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

function normalizeCartId(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{1,12}$/.test(trimmed)) return null;
  const numeric = Number(trimmed);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizePaymentId(value: string | null) {
  const trimmed = normalizeNullableProviderQueryValue(value);
  if (!trimmed) return null;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed || null;
}

function normalizeCheckoutToken(value: string | null) {
  return normalizeNullableProviderQueryValue(value);
}

function normalizeExternalReference(value: string | null) {
  const normalized = normalizeNullableProviderQueryValue(value);
  if (!normalized) return null;
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(normalized)) return null;
  return normalized;
}

function normalizeHostedCheckoutReturnStatus(value: string | null) {
  const normalized = normalizeNullableProviderQueryValue(value)?.toLowerCase();
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
    planCode: record.plan_code,
    planName: record.plan_name,
    planBillingCycleDays: record.plan_billing_cycle_days,
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
  invalidatePaymentOrderQueryCaches({
    userId: nextOrder.user_id,
    guildId: nextOrder.guild_id,
    orderId: nextOrder.id,
    orderNumber: nextOrder.order_number,
  });
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

async function ensureGuildAccess(guildId: string | null) {
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

  if (!guildId) {
    return {
      ok: true as const,
      context: {
        sessionData,
      },
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

  if (!sessionData.accessToken) {
    const hasTeamAccessWithoutToken = await hasAcceptedTeamAccessToGuild(
      {
        authSession: sessionData.authSession,
        accessToken: "",
      },
      guildId,
    );

    if (hasTeamAccessWithoutToken) {
      return {
        ok: true as const,
        context: {
          sessionData,
        },
      };
    }

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

  const hasTeamAccess = accessibleGuild
    ? false
    : await hasAcceptedTeamAccessToGuild(
        {
          authSession: sessionData.authSession,
          accessToken: sessionData.accessToken,
        },
        guildId,
      );

  if (!accessibleGuild && !hasTeamAccess && sessionData.authSession.activeGuildId !== guildId) {
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

async function getOrderByCodeForScope(
  guildId: string | null,
  orderCode: number,
  cartId?: number | null,
) {
  return getCachedPaymentOrderByCodeForGuild<PaymentOrderRecord>({
    guildId,
    orderNumber: orderCode,
    cartId,
    selectColumns: PAYMENT_ORDER_SELECT_COLUMNS,
  });
}

async function getOrderByCodeForUserAndScope(
  userId: number,
  guildId: string | null,
  orderCode: number,
  cartId?: number | null,
) {
  const order = await getOrderByCodeForScope(guildId, orderCode, cartId);
  if (!order) return { order: null, foreignOwner: false };

  if (order.user_id !== userId) {
    return { order: null, foreignOwner: true };
  }
  return { order, foreignOwner: false };
}

async function getLatestOrderForUserAndScope(userId: number, guildId: string | null) {
  return getCachedLatestPaymentOrderForUserAndGuild<PaymentOrderRecord>({
    userId,
    guildId,
    selectColumns: PAYMENT_ORDER_SELECT_COLUMNS,
  });
}

async function getCoverageForApprovedOrder(order: PaymentOrderRecord) {
  if (order.status !== "approved") return null;
  if (!order.guild_id) return null;

  const approvedOrders = await getApprovedOrdersForGuild<
    PaymentOrderRecord & { guild_id: string }
  >(
    order.guild_id,
    PAYMENT_ORDER_SELECT_COLUMNS,
  );

  return resolveCoverageForApprovedOrder(
    approvedOrders,
    order as PaymentOrderRecord & { guild_id: string },
  );
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
    (await getOrderByCodeForScope(order.guild_id, order.order_number, order.id)) ||
    order;

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

async function reconcileOrderByExplicitExternalReference(input: {
  order: PaymentOrderRecord;
  externalReference: string;
  source: string;
}) {
  const providerPayments = await searchMercadoPagoPaymentsByExternalReference(
    input.externalReference,
    { useCardToken: input.order.payment_method === "card" },
  );

  const matchingPayments = providerPayments.filter((payment) => {
    const providerExternalReference =
      typeof payment.external_reference === "string"
        ? payment.external_reference.trim()
        : "";
    return providerExternalReference === input.externalReference;
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
    return input.order;
  }

  await reconcilePaymentOrderWithProviderPayment(input.order, providerPayment, {
    source: input.source,
  });

  return (
    (await getOrderByCodeForScope(
      input.order.guild_id,
      input.order.order_number,
      input.order.id,
    )) || input.order
  );
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
    const cartId =
      normalizeCartId(url.searchParams.get("cartId")) ||
      normalizeCartId(url.searchParams.get("orderId"));
    const paymentId =
      normalizePaymentId(url.searchParams.get("paymentId")) ||
      normalizePaymentId(url.searchParams.get("payment_id")) ||
      normalizePaymentId(url.searchParams.get("collection_id"));
    const paymentRef =
      normalizeExternalReference(url.searchParams.get("paymentRef")) ||
      normalizeExternalReference(url.searchParams.get("external_reference"));
    const checkoutToken = normalizeCheckoutToken(
      url.searchParams.get("checkoutToken"),
    );
    const returnStatus = normalizeHostedCheckoutReturnStatus(
      url.searchParams.get("status"),
    );

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(access.response, requestContext.requestId);
    }

    const user = access.context.sessionData.authSession.user;
    const auditContext = extendSecurityRequestContext(requestContext, {
      sessionId: access.context.sessionData.authSession.id,
      userId: user.id,
      guildId,
    });
    const rateLimit = await enforceRequestRateLimit({
      action: "payment_order_read",
      windowMs: 10 * 60 * 1000,
      maxAttempts: 90,
      context: auditContext,
    });

    if (!rateLimit.ok) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_order_read",
        outcome: "blocked",
        metadata: {
          reason: "rate_limit",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
      });

      const response = respond(
        { ok: false, message: "Muitas consultas. Tente novamente em instantes." },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_order_read",
      outcome: "started",
      metadata: {
        fromOrderCode: Boolean(orderCode),
        hasPaymentIdHint: Boolean(paymentId),
      },
    });

    if (guildId) {
      await cleanupExpiredUnpaidServerSetups({
        userId: user.id,
        guildId,
        source: "auth_payment_order_query",
      });
    }

    let foreignOwner = false;
    let order = null;

    if (orderCode) {
      const lookup = await getOrderByCodeForUserAndScope(
        user.id,
        guildId,
        orderCode,
        cartId,
      );
      order = lookup.order;
      foreignOwner = lookup.foreignOwner;
    } else {
      order = await getLatestOrderForUserAndScope(user.id, guildId);
    }

    if (!order) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_order_read",
        outcome: foreignOwner ? "blocked" : "failed",
        metadata: {
          reason: foreignOwner ? "foreign_owner_order_lookup" : "order_not_found",
          fromOrderCode: Boolean(orderCode),
        },
      });

      return respond(
        {
          ok: false,
          message: guildId
            ? "Pedido nao encontrado para este servidor."
            : "Pedido nao encontrado para esta conta.",
        },
        { status: 404 },
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
          forceFresh: true,
          useCardToken: order.payment_method === "card",
        });
        await reconcilePaymentOrderWithProviderPayment(order, providerPayment, {
          source: "auth_payment_order_query_payment_id",
        });
        order =
          (await getOrderByCodeForScope(guildId, order.order_number, order.id)) ||
          order;
      } catch {
        // melhor esforco; ainda podemos cair no estado persistido ou na reconciliacao normal
      }
    }

    if (paymentRef) {
      try {
        order = await reconcileOrderByExplicitExternalReference({
          order,
          externalReference: paymentRef,
          source: "auth_payment_order_query_external_reference",
        });
      } catch {
        // melhor esforco; mantemos o estado persistido
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
    } else if (
      order.provider_payment_id
    ) {
      try {
        const reconciled = await reconcilePaymentOrderRecord(order, {
          source: "auth_payment_order_query",
        });
        if (reconciled.changed) {
          order =
            (await getOrderByCodeForScope(guildId, order.order_number, order.id)) ||
            order;
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
    await logSecurityAuditEventSafe(requestContext, {
      action: "payment_order_read",
      outcome: "failed",
      metadata: {
        message: extractAuditErrorMessage(error),
      },
    });

    return respond(
      {
        ok: false,
        message: resolveDatabaseFailureMessage(
          error,
          sanitizeErrorMessage(
            error,
            "Erro ao carregar pedido de pagamento.",
          ),
        ),
      },
      { status: resolveDatabaseFailureStatus(error) },
    );
  }
}

