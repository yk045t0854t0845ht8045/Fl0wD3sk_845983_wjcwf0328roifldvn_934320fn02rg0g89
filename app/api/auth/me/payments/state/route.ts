import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  ensureCheckoutAccessTokenForOrder,
  PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS,
} from "@/lib/payments/checkoutLinkSecurity";
import {
  resolvePaymentStatus,
  searchMercadoPagoPaymentsByExternalReference,
} from "@/lib/payments/mercadoPago";
import {
  reconcilePaymentOrderRecord,
  reconcilePaymentOrderWithProviderPayment,
} from "@/lib/payments/reconciliation";
import {
  getApprovedOrdersForGuild,
  resolveLatestLicenseCoverageFromApprovedOrders,
} from "@/lib/payments/licenseStatus";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type PaymentOrderStateRecord = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id: string;
  payment_method: "pix" | "card" | "trial";
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired" | "failed";
  plan_billing_cycle_days: number | null;
  provider_payment_id: string | null;
  provider_external_reference: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  provider_qr_code: string | null;
  paid_at: string | null;
  expires_at: string | null;
  checkout_link_nonce: string | null;
  checkout_link_expires_at: string | null;
  checkout_link_invalidated_at: string | null;
  created_at: string;
  updated_at: string;
};

const STALE_CARD_REDIRECT_PENDING_MS = 4 * 60 * 1000;
const PAYMENT_STATE_SELECT_COLUMNS =
  `id, order_number, user_id, guild_id, payment_method, status, plan_billing_cycle_days, provider_payment_id, provider_external_reference, provider_status, provider_status_detail, provider_qr_code, paid_at, expires_at, created_at, updated_at, ${PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS}`;

function normalizeGuildId(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function toOrderState(
  order: PaymentOrderStateRecord,
  checkoutAccessToken: string | null = null,
) {
  return {
    orderNumber: order.order_number,
    guildId: order.guild_id,
    method: order.payment_method,
    status: order.status,
    providerPaymentId: order.provider_payment_id,
    providerExternalReference: order.provider_external_reference,
    providerStatus: order.provider_status,
    providerStatusDetail: order.provider_status_detail,
    hasPixQr: Boolean(order.provider_qr_code),
    paidAt: order.paid_at,
    expiresAt: order.expires_at,
    checkoutAccessToken,
    checkoutAccessTokenExpiresAt: order.checkout_link_expires_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

function isStaleHostedCardPendingOrder(order: PaymentOrderStateRecord) {
  if (order.payment_method !== "card") return false;
  if (order.status !== "pending") return false;
  if (order.provider_payment_id) return false;

  const createdAtMs = Date.parse(order.created_at);
  if (!Number.isFinite(createdAtMs)) return false;

  return Date.now() - createdAtMs >= STALE_CARD_REDIRECT_PENDING_MS;
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
    // telemetria nao deve quebrar o fluxo
  }
}

async function finalizeStaleHostedCardPendingOrder(order: PaymentOrderStateRecord) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .update({
      status: "cancelled",
      provider_status: "cancelled",
      provider_status_detail: "checkout_session_abandoned_or_expired",
    })
    .eq("id", order.id)
    .eq("status", "pending")
    .is("provider_payment_id", null)
    .select(PAYMENT_STATE_SELECT_COLUMNS)
    .maybeSingle<PaymentOrderStateRecord>();

  if (result.error) {
    throw new Error(
      `Erro ao finalizar checkout com cartao abandonado: ${result.error.message}`,
    );
  }

  return result.data || order;
}

async function reconcileHostedCardPendingOrderByExternalReference(
  order: PaymentOrderStateRecord,
) {
  if (order.payment_method !== "card") return order;
  if (order.status !== "pending") return order;
  if (order.provider_payment_id) return order;

  const externalReference =
    order.provider_external_reference || `flowdesk-order-${order.order_number}`;

  const providerPayments = await searchMercadoPagoPaymentsByExternalReference(
    externalReference,
    { useCardToken: true },
  );

  const matchingPayments = providerPayments.filter((payment) => {
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

  const reconciled = await reconcilePaymentOrderWithProviderPayment(
    order,
    providerPayment,
    {
      source: "auth_payment_state_external_reference",
    },
  );

  return {
    ...order,
    ...reconciled.order,
    provider_payment_id:
      reconciled.order.provider_payment_id ?? order.provider_payment_id,
    provider_external_reference:
      reconciled.order.provider_external_reference ??
      order.provider_external_reference,
    provider_status: reconciled.order.provider_status ?? null,
    provider_status_detail:
      reconciled.order.provider_status_detail ?? null,
  };
}

async function refreshLatestOrderIfProviderPaymentExists(
  order: PaymentOrderStateRecord,
) {
  if (!order.provider_payment_id) return order;

  const reconciled = await reconcilePaymentOrderRecord(order, {
    source: "auth_payment_state_external_reference",
  });

  return {
    ...order,
    ...reconciled.order,
    provider_payment_id:
      reconciled.order.provider_payment_id ?? order.provider_payment_id,
    provider_external_reference:
      reconciled.order.provider_external_reference ??
      order.provider_external_reference,
    provider_status: reconciled.order.provider_status ?? null,
    provider_status_detail:
      reconciled.order.provider_status_detail ?? null,
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

async function getLatestApprovedLicenseCoverageForGuild(guildId: string) {
  const approvedOrders = await getApprovedOrdersForGuild<PaymentOrderStateRecord>(
    guildId,
    PAYMENT_STATE_SELECT_COLUMNS,
  );
  return resolveLatestLicenseCoverageFromApprovedOrders(approvedOrders);
}

async function getLatestUserOrderForGuild(userId: number, guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_STATE_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PaymentOrderStateRecord>();

  if (result.error) {
    throw new Error(`Erro ao carregar pedido do usuario: ${result.error.message}`);
  }

  return result.data || null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = normalizeGuildId(url.searchParams.get("guildId"));

    if (!guildId) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return access.response;
    }

    const user = access.context.sessionData.authSession.user;
    await cleanupExpiredUnpaidServerSetups({
      userId: user.id,
      guildId,
      source: "auth_payment_state",
    });

    let [activeLicenseCoverage, latestUserOrder] = await Promise.all([
      getLatestApprovedLicenseCoverageForGuild(guildId),
      getLatestUserOrderForGuild(user.id, guildId),
    ]);

    if (latestUserOrder && isStaleHostedCardPendingOrder(latestUserOrder)) {
      try {
        latestUserOrder = await finalizeStaleHostedCardPendingOrder(
          latestUserOrder,
        );
      } catch {
        // melhor esforco; nao quebrar consulta por falha nessa normalizacao
      }
    }

    const shouldResolveHostedCardByExternalReference =
      !!latestUserOrder &&
      latestUserOrder.payment_method === "card" &&
      latestUserOrder.status === "pending" &&
      !latestUserOrder.provider_payment_id;

    if (shouldResolveHostedCardByExternalReference && latestUserOrder) {
      try {
        latestUserOrder =
          await reconcileHostedCardPendingOrderByExternalReference(
            latestUserOrder,
          );

        await createPaymentOrderEventSafe(
          latestUserOrder.id,
          "flowdesk_hosted_card_return_reconciled",
          {
            source: "auth_payment_state_external_reference",
            resolvedStatus: latestUserOrder.status,
            providerPaymentId: latestUserOrder.provider_payment_id,
            providerStatus: latestUserOrder.provider_status,
            providerStatusDetail: latestUserOrder.provider_status_detail,
            externalReference: latestUserOrder.provider_external_reference,
          },
        );

        if (
          latestUserOrder.status === "approved" ||
          latestUserOrder.status === "cancelled" ||
          latestUserOrder.status === "rejected" ||
          latestUserOrder.status === "failed"
        ) {
          activeLicenseCoverage = await getLatestApprovedLicenseCoverageForGuild(guildId);
        }
      } catch {
        // melhor esforco; nao quebrar consulta de estado
      }
    }

    const shouldReconcileLatestOrder =
      !!latestUserOrder &&
      !!latestUserOrder.provider_payment_id &&
      (latestUserOrder.status === "pending" ||
        latestUserOrder.status === "failed" ||
        latestUserOrder.status === "expired" ||
        latestUserOrder.status === "rejected");

    if (shouldReconcileLatestOrder && latestUserOrder) {
      try {
        latestUserOrder = await refreshLatestOrderIfProviderPaymentExists(
          latestUserOrder,
        );

        if (
          latestUserOrder.status === "approved" ||
          latestUserOrder.status === "cancelled"
        ) {
          activeLicenseCoverage = await getLatestApprovedLicenseCoverageForGuild(guildId);
        }
      } catch {
        // melhor esforco; nao quebrar a consulta de estado por falha na reconciliacao
      }
    }

    const securedLatestOrder =
      latestUserOrder && latestUserOrder.user_id === user.id
        ? await ensureCheckoutAccessTokenForOrder({
            order: latestUserOrder,
            forceRotate: false,
            invalidateOtherOrders: false,
          })
        : null;
    const activeLicenseOrder =
      activeLicenseCoverage?.status === "paid" ? activeLicenseCoverage.order : null;
    const securedActiveLicenseOrder =
      activeLicenseOrder && activeLicenseOrder.user_id === user.id
        ? await ensureCheckoutAccessTokenForOrder({
            order: activeLicenseOrder,
            forceRotate: false,
            invalidateOtherOrders: false,
          })
        : null;

    return applyNoStoreHeaders(
      NextResponse.json({
      ok: true,
      guildId,
      activeLicense: activeLicenseOrder
        ? {
            ...toOrderState(
              activeLicenseOrder,
              securedActiveLicenseOrder?.checkoutAccessToken || null,
            ),
            licenseExpiresAt: activeLicenseCoverage?.licenseExpiresAt || null,
          }
        : null,
      latestOrder: latestUserOrder
        ? toOrderState(
            latestUserOrder,
            securedLatestOrder?.checkoutAccessToken || null,
          )
        : null,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao consultar estado de pagamento do servidor.",
      },
      { status: 500 },
      ),
    );
  }
}

