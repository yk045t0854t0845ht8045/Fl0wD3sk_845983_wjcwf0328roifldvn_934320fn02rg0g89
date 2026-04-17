import { NextResponse } from "next/server";
import { clearPlanStateCacheForUser } from "@/lib/account/managedPlanState";
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
  getApprovedOrdersForGuild,
  resolveLatestLicenseCoverageFromApprovedOrders,
  resolveRenewalPaymentDecision,
} from "@/lib/payments/licenseStatus";
import {
  cleanupExpiredUnpaidServerSetups,
} from "@/lib/payments/setupCleanup";
import {
  getBasicPlanAvailability,
  resolveEffectivePlanSelection,
  syncUserPlanStateFromOrder,
} from "@/lib/plans/state";
import { resolvePlanCycleExpirationIso } from "@/lib/plans/cycle";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type ActivateTrialBody = {
  guildId?: unknown;
  planCode?: unknown;
  billingPeriodCode?: unknown;
};

type PaymentOrderRecord = {
  id: number;
  order_number: number;
  guild_id: string;
  user_id: number;
  payment_method: "pix" | "card" | "trial";
  status: string;
  amount: string | number;
  currency: string;
  plan_code: string;
  plan_name: string;
  plan_billing_cycle_days: number;
  plan_max_licensed_servers: number;
  plan_max_active_tickets: number;
  plan_max_automations: number;
  plan_max_monthly_actions: number;
  provider_status: string | null;
  provider_status_detail: string | null;
  paid_at: string | null;
  expires_at: string | null;
  checkout_link_nonce: string | null;
  checkout_link_expires_at: string | null;
  checkout_link_invalidated_at: string | null;
  created_at: string;
  updated_at: string;
};

const PAYMENT_ORDER_SELECT_COLUMNS =
  `id, order_number, guild_id, user_id, payment_method, status, amount, currency, plan_code, plan_name, plan_billing_cycle_days, plan_max_licensed_servers, plan_max_active_tickets, plan_max_automations, plan_max_monthly_actions, provider_status, provider_status_detail, paid_at, expires_at, created_at, updated_at, ${PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS}`;

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function parseAmount(amount: string | number) {
  if (typeof amount === "number") return amount;
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric : 0;
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
    paidAt: record.paid_at,
    expiresAt: record.expires_at,
    checkoutAccessToken,
    checkoutAccessTokenExpiresAt: record.checkout_link_expires_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

async function ensureGuildAccess(guildId: string | null) {
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

async function getLatestApprovedLicenseCoverageForGuild(guildId: string | null) {
  if (!guildId) return null;
  const approvedOrders = await getApprovedOrdersForGuild<PaymentOrderRecord>(
    guildId,
    PAYMENT_ORDER_SELECT_COLUMNS,
  );
  return resolveLatestLicenseCoverageFromApprovedOrders(approvedOrders);
}

async function getLatestUserOrderForGuild(userId: number, guildId: string | null) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("user_id", userId)
    .filter("guild_id", guildId === null ? "is" : "eq", guildId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PaymentOrderRecord>();

  if (result.error) {
    throw new Error(`Erro ao carregar pedido atual do teste: ${result.error.message}`);
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
    throw new Error(`Erro ao salvar evento do trial: ${result.error.message}`);
  }
}

export async function POST(request: Request) {
  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) {
      return securityResponse;
    }

    let body: ActivateTrialBody = {};
    try {
      body = (await request.json()) as ActivateTrialBody;
    } catch {
      return NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return access.response;

    const user = access.context.sessionData.authSession.user;
    if (guildId) {
      await cleanupExpiredUnpaidServerSetups({
        userId: user.id,
        guildId,
        source: "payment_trial_post",
      });
    }

    const basicPlanAvailability = await getBasicPlanAvailability(user.id);
    if (!basicPlanAvailability.isAvailable) {
      return NextResponse.json(
        {
          ok: false,
          message:
            basicPlanAvailability.unavailableMessage ||
            "O plano gratuito ja nao esta disponivel nesta conta.",
        },
        { status: 403 },
      );
    }

    if (!guildId) {
      return NextResponse.json(
        { ok: false, message: "ID do servidor e obrigatorio para ativar o teste." },
        { status: 400 },
      );
    }

    const checkoutPlan = await resolveEffectivePlanSelection({
      userId: user.id,
      guildId,
      preferredPlanCode: body.planCode,
      preferredBillingPeriodCode: body.billingPeriodCode,
    });

    if (!checkoutPlan.plan.isTrial) {
      return NextResponse.json(
        {
          ok: false,
          message: "Este endpoint so ativa o plano gratuito.",
        },
        { status: 400 },
      );
    }

    const latestCoverage = await getLatestApprovedLicenseCoverageForGuild(guildId);
    const renewalDecision = resolveRenewalPaymentDecision(latestCoverage);
    if (latestCoverage && !renewalDecision.allowed) {
      const activeLicenseLink =
        latestCoverage.order.user_id === user.id
          ? await ensureCheckoutAccessTokenForOrder({
              order: latestCoverage.order,
              forceRotate: false,
              invalidateOtherOrders: false,
            })
          : null;

      return NextResponse.json({
        ok: true,
        blockedByActiveLicense: true,
        licenseActive: true,
        licenseExpiresAt: latestCoverage.licenseExpiresAt,
        order: toApiOrder(
          latestCoverage.order,
          activeLicenseLink?.checkoutAccessToken || null,
        ),
      });
    }

    const latestUserOrder = await getLatestUserOrderForGuild(user.id, guildId);
    if (
      latestUserOrder &&
      latestUserOrder.status === "approved" &&
      latestUserOrder.plan_code === checkoutPlan.plan.code
    ) {
      const securedExistingOrder = await ensureCheckoutAccessTokenForOrder({
        order: latestUserOrder,
        forceRotate: false,
        invalidateOtherOrders: false,
      });

      return NextResponse.json({
        ok: true,
        reused: true,
        licenseActive: true,
        licenseExpiresAt: latestUserOrder.expires_at,
        order: toApiOrder(
          securedExistingOrder.order,
          securedExistingOrder.checkoutAccessToken,
        ),
      });
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const nowIso = new Date().toISOString();
    const expiresAt =
      resolvePlanCycleExpirationIso({
        baseTimestamp: nowIso,
        billingCycleDays: checkoutPlan.plan.billingCycleDays,
      }) || nowIso;

    const createdOrderResult = await supabase
      .from("payment_orders")
      .insert({
        user_id: user.id,
        guild_id: guildId,
        payment_method: "trial",
        status: "approved",
        amount: 0,
        currency: checkoutPlan.plan.currency,
        plan_code: checkoutPlan.plan.code,
        plan_name: checkoutPlan.plan.name,
        plan_billing_cycle_days: checkoutPlan.plan.billingCycleDays,
        plan_max_licensed_servers: checkoutPlan.plan.entitlements.maxLicensedServers,
        plan_max_active_tickets: checkoutPlan.plan.entitlements.maxActiveTickets,
        plan_max_automations: checkoutPlan.plan.entitlements.maxAutomations,
        plan_max_monthly_actions: checkoutPlan.plan.entitlements.maxMonthlyActions,
        provider: "flowdesk",
        provider_status: "approved",
        provider_status_detail: "free_trial_activated",
        provider_payload: {
          source: "flowdesk_trial_checkout",
          step: 4,
          pricing: {
            baseAmount: 0,
            subtotalAmount: 0,
            totalAmount: 0,
            currency: checkoutPlan.plan.currency,
            coupon: null,
            giftCard: null,
          },
          plan: {
            code: checkoutPlan.plan.code,
            name: checkoutPlan.plan.name,
            billingCycleDays: checkoutPlan.plan.billingCycleDays,
            entitlements: {
              ...checkoutPlan.plan.entitlements,
            },
          },
          trial: true,
        },
        paid_at: nowIso,
        expires_at: expiresAt,
      })
      .select(PAYMENT_ORDER_SELECT_COLUMNS)
      .single<PaymentOrderRecord>();

    if (createdOrderResult.error || !createdOrderResult.data) {
      throw new Error(
        createdOrderResult.error?.message || "Falha ao ativar o plano gratuito.",
      );
    }

    await createPaymentOrderEvent(createdOrderResult.data.id, "order_created", {
      orderNumber: createdOrderResult.data.order_number,
      guildId,
      userId: user.id,
      method: "trial",
      source: "flowdesk_trial_checkout",
    });

    await createPaymentOrderEvent(
      createdOrderResult.data.id,
      "provider_payment_created",
      {
        providerStatus: "approved",
        providerStatusDetail: "free_trial_activated",
        source: "flowdesk_trial_checkout",
      },
    );

    const securedOrder = await ensureCheckoutAccessTokenForOrder({
      order: createdOrderResult.data,
      forceRotate: true,
      invalidateOtherOrders: true,
    });

    await syncUserPlanStateFromOrder(securedOrder.order);
    clearPlanStateCacheForUser(user.id);

    return NextResponse.json({
      ok: true,
      reused: false,
      trialActivated: true,
      licenseActive: true,
      licenseExpiresAt: expiresAt,
      order: toApiOrder(
        securedOrder.order,
        securedOrder.checkoutAccessToken,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Falha ao ativar o plano gratuito.",
        ),
      },
      { status: 500 },
    );
  }
}
