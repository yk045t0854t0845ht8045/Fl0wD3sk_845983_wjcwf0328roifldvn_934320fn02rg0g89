import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  createMercadoPagoCardCheckoutPreference,
  resolveMercadoPagoCardEnvironment,
} from "@/lib/payments/mercadoPago";
import {
  areCardPaymentsEnabled,
  CARD_PAYMENTS_DISABLED_MESSAGE,
} from "@/lib/payments/cardAvailability";
import {
  buildCheckoutAccessToken,
  ensureCheckoutAccessTokenForOrder,
  PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS,
} from "@/lib/payments/checkoutLinkSecurity";
import {
  cleanupExpiredUnpaidServerSetups,
  resolveUnpaidSetupExpiresAt,
} from "@/lib/payments/setupCleanup";
import { resolveDiscountPricing } from "@/lib/payments/discountPricing";
import {
  buildConfigCheckoutPath,
  type PlanPricingDefinition,
} from "@/lib/plans/catalog";
import {
  resolveEffectivePlanSelection,
  syncUserPlanStateFromOrder,
} from "@/lib/plans/state";
import { ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CreateCardRedirectBody = {
  guildId?: unknown;
  planCode?: unknown;
  billingPeriodCode?: unknown;
  couponCode?: unknown;
  giftCardCode?: unknown;
  renew?: unknown;
  returnTarget?: unknown;
  returnGuildId?: unknown;
  returnTab?: unknown;
};

type PaymentOrderRecord = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id: string;
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
  provider_payment_id: string | null;
  provider_external_reference: string | null;
  provider_payload: unknown;
  paid_at: string | null;
  checkout_link_nonce: string | null;
  checkout_link_expires_at: string | null;
  checkout_link_invalidated_at: string | null;
  created_at: string;
};

type CheckoutRedirectPayload = {
  checkoutPreferenceId?: string | number | null;
  checkoutRedirectUrl?: string | null;
  checkoutEnvironment?: "test" | "production" | null;
  source?: string | null;
};

const DEFAULT_CURRENCY = "BRL";
const CHECKOUT_REDIRECT_REUSE_WINDOW_MS = 20 * 60 * 1000;
const LICENSE_VALIDITY_DAYS = 30;
const LICENSE_VALIDITY_MS = LICENSE_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
const PAYMENT_ORDER_SELECT_COLUMNS =
  `id, order_number, user_id, guild_id, payment_method, status, amount, currency, plan_code, plan_name, plan_billing_cycle_days, plan_max_licensed_servers, plan_max_active_tickets, plan_max_automations, plan_max_monthly_actions, provider_payment_id, provider_external_reference, provider_payload, paid_at, created_at, ${PAYMENT_ORDER_CHECKOUT_LINK_SELECT_COLUMNS}`;
const SERVER_TABS = new Set(["settings", "payments", "methods", "plans"]);

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function normalizeReturnTarget(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "servers" ? "servers" : null;
}

function normalizeReturnGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function normalizeReturnTab(value: unknown) {
  if (typeof value !== "string") return null;
  const tab = value.trim().toLowerCase();
  return SERVER_TABS.has(tab) ? tab : null;
}

function normalizePayerEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function shouldForwardSessionEmailToHostedCardCheckout() {
  const rawValue = process.env.MERCADO_PAGO_CARD_REDIRECT_USE_SESSION_EMAIL;
  if (!rawValue) return false;

  const normalized = rawValue.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveAmount() {
  return 0;
}

function resolveCurrency() {
  return process.env.MERCADO_PAGO_PIX_CURRENCY || DEFAULT_CURRENCY;
}

function parseAmount(amount: string | number) {
  if (typeof amount === "number") return amount;
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function resolveCheckoutPlanForGuild(input: {
  userId: number;
  guildId: string;
  requestedPlanCode?: unknown;
  requestedBillingPeriodCode?: unknown;
}) {
  const { plan } = await resolveEffectivePlanSelection({
    userId: input.userId,
    guildId: input.guildId,
    preferredPlanCode: input.requestedPlanCode,
    preferredBillingPeriodCode: input.requestedBillingPeriodCode,
  });

  return {
    plan,
    amount: Math.max(0, Math.round(plan.totalAmount * 100) / 100),
    currency: plan.currency || resolveCurrency(),
  };
}

function resolveLicenseBaseTimestamp(order: PaymentOrderRecord) {
  const paidAtMs = order.paid_at ? Date.parse(order.paid_at) : Number.NaN;
  if (Number.isFinite(paidAtMs)) return paidAtMs;

  const createdAtMs = Date.parse(order.created_at);
  if (Number.isFinite(createdAtMs)) return createdAtMs;

  return Date.now();
}

function resolveLicenseExpiresAt(order: PaymentOrderRecord) {
  const cycleDays =
    typeof order.plan_billing_cycle_days === "number" &&
    Number.isFinite(order.plan_billing_cycle_days) &&
    order.plan_billing_cycle_days > 0
      ? order.plan_billing_cycle_days
      : LICENSE_VALIDITY_DAYS;
  return new Date(
    resolveLicenseBaseTimestamp(order) + cycleDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function isLicenseActiveForOrder(order: PaymentOrderRecord) {
  if (order.status !== "approved") return false;
  return Date.now() < Date.parse(resolveLicenseExpiresAt(order));
}

function resolveCheckoutPayload(value: unknown): CheckoutRedirectPayload | null {
  if (!value || typeof value !== "object") return null;
  return value as CheckoutRedirectPayload;
}

function resolveReusableRedirectUrl(order: PaymentOrderRecord) {
  if (order.status !== "pending") return null;
  if (order.provider_payment_id) return null;
  if (order.payment_method !== "card") return null;

  const checkoutPayload = resolveCheckoutPayload(order.provider_payload);
  const redirectUrl =
    typeof checkoutPayload?.checkoutRedirectUrl === "string"
      ? checkoutPayload.checkoutRedirectUrl.trim()
      : "";
  if (!redirectUrl) return null;

  const createdAtMs = Date.parse(order.created_at);
  if (!Number.isFinite(createdAtMs)) return null;
  if (Date.now() - createdAtMs > CHECKOUT_REDIRECT_REUSE_WINDOW_MS) return null;

  return redirectUrl;
}

function buildConfigReturnUrl(input: {
  origin: string;
  status: "approved" | "pending" | "cancelled";
  orderNumber: number;
  guildId: string;
  checkoutToken: string;
  planCode: PlanPricingDefinition["code"];
  billingPeriodCode: PlanPricingDefinition["billingPeriodCode"];
  renew: boolean;
  returnTarget: "servers" | null;
  returnGuildId: string | null;
  returnTab: string | null;
}) {
  const url = new URL(
    buildConfigCheckoutPath({
      planCode: input.planCode,
      billingPeriodCode: input.billingPeriodCode,
    }),
    input.origin,
  );
  url.searchParams.set("status", input.status);
  url.searchParams.set("code", String(input.orderNumber));
  url.searchParams.set("guild", input.guildId);
  url.searchParams.set("method", "card");
  url.searchParams.set("checkoutToken", input.checkoutToken);

  if (input.renew) {
    url.searchParams.set("renew", "1");
  }

  if (input.returnTarget) {
    url.searchParams.set("return", input.returnTarget);
  }

  if (input.returnGuildId) {
    url.searchParams.set("returnGuild", input.returnGuildId);
  }

  if (input.returnTab) {
    url.searchParams.set("returnTab", input.returnTab);
  }

  url.hash = "/payment";
  return url.toString();
}

function buildWebhookNotificationUrl(origin: string) {
  const url = new URL("/api/payments/mercadopago/webhook", origin);
  const token = process.env.MERCADO_PAGO_WEBHOOK_TOKEN?.trim();
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
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

async function getActiveLicenseOrderForGuild(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(PAYMENT_ORDER_SELECT_COLUMNS)
    .eq("guild_id", guildId)
    .eq("status", "approved")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30)
    .returns<PaymentOrderRecord[]>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar licenca ativa do servidor: ${result.error.message}`,
    );
  }

  const orders = result.data || [];
  return orders.find((order) => isLicenseActiveForOrder(order)) || null;
}

async function hasStoredGuildSetupConfiguration(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const [ticketSettingsResult, staffSettingsResult] = await Promise.all([
    supabase
      .from("guild_ticket_settings")
      .select("id")
      .eq("guild_id", guildId)
      .maybeSingle<{ id: number }>(),
    supabase
      .from("guild_ticket_staff_settings")
      .select("id")
      .eq("guild_id", guildId)
      .maybeSingle<{ id: number }>(),
  ]);

  if (ticketSettingsResult.error) {
    throw new Error(
      `Erro ao verificar configuracoes de canais do servidor: ${ticketSettingsResult.error.message}`,
    );
  }

  if (staffSettingsResult.error) {
    throw new Error(
      `Erro ao verificar configuracoes de cargos do servidor: ${staffSettingsResult.error.message}`,
    );
  }

  return Boolean(ticketSettingsResult.data && staffSettingsResult.data);
}

async function createDraftOrderForCheckout(input: {
  userId: number;
  guildId: string;
  amount: number;
  currency: string;
  cardChannel: string;
  plan: PlanPricingDefinition;
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
      plan_code: input.plan.code,
      plan_name: input.plan.name,
      plan_billing_cycle_days: input.plan.billingCycleDays,
      plan_max_licensed_servers: input.plan.entitlements.maxLicensedServers,
      plan_max_active_tickets: input.plan.entitlements.maxActiveTickets,
      plan_max_automations: input.plan.entitlements.maxAutomations,
      plan_max_monthly_actions: input.plan.entitlements.maxMonthlyActions,
      provider: "mercado_pago",
      expires_at: resolveUnpaidSetupExpiresAt(),
      provider_payload: {
        source: "flowdesk_card_redirect_checkout",
        step: 4,
        channel: input.cardChannel,
        precreated: true,
        plan: {
          code: input.plan.code,
          name: input.plan.name,
          billingCycleDays: input.plan.billingCycleDays,
          entitlements: {
            ...input.plan.entitlements,
          },
        },
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
    checkoutMode: "redirect",
  });

  return createdOrderResult.data;
}

export async function POST(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(NextResponse.json(body, init), baseRequestContext.requestId);

  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) {
      return attachRequestId(securityResponse, baseRequestContext.requestId);
    }

    let body: CreateCardRedirectBody = {};
    try {
      body = (await request.json()) as CreateCardRedirectBody;
    } catch {
      return respond(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const renew = body.renew === true || body.renew === "1" || body.renew === 1;
    const returnTarget = normalizeReturnTarget(body.returnTarget);
    const returnGuildId = normalizeReturnGuildId(body.returnGuildId);
    const returnTab = normalizeReturnTab(body.returnTab);

    if (!guildId) {
      return respond(
        { ok: false, message: "Guild ID invalido para checkout com cartao." },
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
      action: "payment_card_redirect_post",
      windowMs: 10 * 60 * 1000,
      maxAttempts: 8,
      context: auditContext,
    });
    if (!rateLimit.ok) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_card_redirect_post",
        outcome: "blocked",
        metadata: {
          reason: "rate_limit",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
      });

      const response = respond(
        {
          ok: false,
          message:
            "Muitas tentativas de abrir o checkout com cartao em pouco tempo. Aguarde alguns instantes.",
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return response;
    }

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_card_redirect_post",
      outcome: "started",
    });

    if (!areCardPaymentsEnabled()) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_card_redirect_post",
        outcome: "blocked",
        metadata: {
          reason: "card_payments_disabled",
        },
      });

      return respond(
        {
          ok: false,
          message: CARD_PAYMENTS_DISABLED_MESSAGE,
        },
        { status: 503 },
      );
    }

    const user = access.context.sessionData.authSession.user;
    await cleanupExpiredUnpaidServerSetups({
      userId: user.id,
      guildId,
      source: "payment_card_redirect_post",
    });

    const activeLicenseOrder = await getActiveLicenseOrderForGuild(guildId);
    if (activeLicenseOrder) {
      return respond({
        ok: true,
        blockedByActiveLicense: true,
        licenseActive: true,
        licenseExpiresAt: resolveLicenseExpiresAt(activeLicenseOrder),
      });
    }

    if (!(await hasStoredGuildSetupConfiguration(guildId))) {
      return respond(
        {
          ok: false,
          message:
            "A configuracao desse servidor expirou apos 30 minutos sem pagamento. RefaÃ§a a configuracao antes de abrir um novo checkout.",
        },
        { status: 409 },
      );
    }

    const checkoutPlan = await resolveCheckoutPlanForGuild({
      userId: user.id,
      guildId,
      requestedPlanCode: body.planCode,
      requestedBillingPeriodCode: body.billingPeriodCode,
    });

    if (checkoutPlan.plan.isTrial) {
      return respond(
        {
          ok: false,
          message:
            "O plano gratuito e ativado sem checkout hospedado. Use a ativacao gratuita na tela de pagamento.",
        },
        { status: 409 },
      );
    }

    const pricing = await resolveDiscountPricing({
      baseAmount: checkoutPlan.amount,
      currency: checkoutPlan.currency,
      couponCode: typeof body.couponCode === "string" ? body.couponCode : null,
      giftCardCode: typeof body.giftCardCode === "string" ? body.giftCardCode : null,
    });
    const amount = pricing.totalAmount;
    const currency = pricing.currency;
    const cardEnvironment = resolveMercadoPagoCardEnvironment();
    const cardChannel =
      cardEnvironment === "production" ? "card_redirect_production" : "card_redirect_test";
    const latestOrder = await getLatestOrderForUserAndGuild(user.id, guildId);
    const reusableCheckoutToken =
      latestOrder ? buildCheckoutAccessToken(latestOrder) : null;
    const reusableRedirectUrl =
      reusableCheckoutToken && latestOrder ? resolveReusableRedirectUrl(latestOrder) : null;

    if (
      reusableRedirectUrl &&
      latestOrder &&
      latestOrder.plan_code === checkoutPlan.plan.code &&
      parseAmount(latestOrder.amount) === amount
    ) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "payment_card_redirect_post",
        outcome: "succeeded",
        metadata: {
          orderNumber: latestOrder.order_number,
          reusedRedirect: true,
        },
      });

      return respond({
        ok: true,
        reused: true,
        orderNumber: latestOrder.order_number,
        redirectUrl: reusableRedirectUrl,
      });
    }

    if (
      latestOrder &&
      latestOrder.status === "pending" &&
      latestOrder.payment_method === "card" &&
      latestOrder.provider_payment_id
    ) {
      return respond({
        ok: false,
        alreadyProcessing: true,
        message:
          "Ja existe um pagamento com cartao em analise para este servidor. Aguarde o retorno antes de tentar novamente.",
      });
    }

    const supabase = getSupabaseAdminClientOrThrow();
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
          plan_code: checkoutPlan.plan.code,
          plan_name: checkoutPlan.plan.name,
          plan_billing_cycle_days: checkoutPlan.plan.billingCycleDays,
          plan_max_licensed_servers: checkoutPlan.plan.entitlements.maxLicensedServers,
          plan_max_active_tickets: checkoutPlan.plan.entitlements.maxActiveTickets,
          plan_max_automations: checkoutPlan.plan.entitlements.maxAutomations,
          plan_max_monthly_actions: checkoutPlan.plan.entitlements.maxMonthlyActions,
          expires_at: resolveUnpaidSetupExpiresAt(latestOrder.created_at),
          provider_external_reference: null,
          provider_payload: {
            source: "flowdesk_card_redirect_checkout",
            step: 4,
            channel: cardChannel,
            reusedDraft: true,
            pricing,
            plan: {
              code: checkoutPlan.plan.code,
              name: checkoutPlan.plan.name,
              billingCycleDays: checkoutPlan.plan.billingCycleDays,
              entitlements: {
                ...checkoutPlan.plan.entitlements,
              },
            },
          },
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
        checkoutMode: "redirect",
      });
    } else {
      createdOrder = await createDraftOrderForCheckout({
        userId: user.id,
        guildId,
        amount,
        currency,
        cardChannel,
        plan: checkoutPlan.plan,
      });
    }

    const securedOrder = await ensureCheckoutAccessTokenForOrder({
      order: createdOrder,
      forceRotate: true,
      invalidateOtherOrders: true,
    });
    createdOrder = securedOrder.order;
    const checkoutToken = securedOrder.checkoutAccessToken;

    if (!checkoutToken) {
      throw new Error("Falha ao preparar token seguro do checkout.");
    }

    const externalReference = `flowdesk-order-${createdOrder.order_number}`;
    const requestUrl = new URL(request.url);
    const origin = requestUrl.origin;
    const payerEmail = shouldForwardSessionEmailToHostedCardCheckout()
      ? normalizePayerEmail(user.email)
      : null;
    const checkoutExpiresAt = resolveUnpaidSetupExpiresAt(createdOrder.created_at);
    const successUrl = buildConfigReturnUrl({
      origin,
      status: "approved",
      orderNumber: createdOrder.order_number,
      guildId,
      checkoutToken,
      planCode: checkoutPlan.plan.code,
      billingPeriodCode: checkoutPlan.plan.billingPeriodCode,
      renew,
      returnTarget,
      returnGuildId,
      returnTab,
    });
    const pendingUrl = buildConfigReturnUrl({
      origin,
      status: "pending",
      orderNumber: createdOrder.order_number,
      guildId,
      checkoutToken,
      planCode: checkoutPlan.plan.code,
      billingPeriodCode: checkoutPlan.plan.billingPeriodCode,
      renew,
      returnTarget,
      returnGuildId,
      returnTab,
    });
    const failureUrl = buildConfigReturnUrl({
      origin,
      status: "cancelled",
      orderNumber: createdOrder.order_number,
      guildId,
      checkoutToken,
      planCode: checkoutPlan.plan.code,
      billingPeriodCode: checkoutPlan.plan.billingPeriodCode,
      renew,
      returnTarget,
      returnGuildId,
      returnTab,
    });

    const preference = await createMercadoPagoCardCheckoutPreference({
      amount,
      currency,
      title: checkoutPlan.plan.name,
      description: `Assinatura ${checkoutPlan.plan.name} para o servidor ${guildId} no painel Flowdesk`,
      externalReference,
      payerEmail,
      payerName: user.display_name || user.global_name || user.username,
      notificationUrl: buildWebhookNotificationUrl(origin),
      successUrl,
      pendingUrl,
      failureUrl,
      expiresAt: checkoutExpiresAt,
      statementDescriptor: "FLOWDESK",
      metadata: {
        flowdesk_order_number: String(createdOrder.order_number),
        flowdesk_user_id: String(user.id),
        flowdesk_discord_user_id: user.discord_user_id,
        flowdesk_guild_id: guildId,
        flowdesk_plan_code: checkoutPlan.plan.code,
        flowdesk_plan_name: checkoutPlan.plan.name,
        flowdesk_payment_channel: cardChannel,
        flowdesk_checkout_surface: "config_step_4_card_redirect",
        flowdesk_pricing_total: String(pricing.totalAmount),
        ...(pricing.coupon?.code
          ? {
              flowdesk_coupon_code: pricing.coupon.code,
            }
          : {}),
        ...(pricing.giftCard?.code
          ? {
              flowdesk_gift_card_code: pricing.giftCard.code,
            }
          : {}),
      },
      idempotencyKey: `flowdesk-card-redirect-order-${createdOrder.id}`,
    });

    const redirectUrl =
      (cardEnvironment === "test"
        ? preference.sandbox_init_point || preference.init_point
        : preference.init_point || preference.sandbox_init_point) || null;

    if (!redirectUrl) {
      throw new Error("Nao foi possivel obter a URL de redirecionamento do checkout.");
    }

    const updatedOrderResult = await supabase
      .from("payment_orders")
      .update({
        provider_external_reference: externalReference,
        expires_at: checkoutExpiresAt,
        provider_payload: {
          source: "flowdesk_card_redirect_checkout",
          step: 4,
          channel: cardChannel,
          checkoutMode: "redirect",
          pricing,
          plan: {
            code: checkoutPlan.plan.code,
            name: checkoutPlan.plan.name,
            billingCycleDays: checkoutPlan.plan.billingCycleDays,
            entitlements: {
              ...checkoutPlan.plan.entitlements,
            },
          },
          checkoutPreferenceId: preference.id,
          checkoutRedirectUrl: redirectUrl,
          checkoutEnvironment: cardEnvironment,
          checkoutForwardedSessionEmail: Boolean(payerEmail),
        },
      })
      .eq("id", createdOrder.id)
      .select(PAYMENT_ORDER_SELECT_COLUMNS)
      .single<PaymentOrderRecord>();

    if (updatedOrderResult.error || !updatedOrderResult.data) {
      throw new Error(
        updatedOrderResult.error?.message ||
          "Falha ao salvar o redirecionamento do checkout.",
      );
    }

    await createPaymentOrderEvent(updatedOrderResult.data.id, "provider_checkout_redirect_created", {
      orderNumber: updatedOrderResult.data.order_number,
      externalReference,
      checkoutPreferenceId: preference.id,
      checkoutEnvironment: cardEnvironment,
    });

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_card_redirect_post",
      outcome: "succeeded",
      metadata: {
        orderNumber: updatedOrderResult.data.order_number,
        preferenceId: preference.id,
      },
    });

    if (updatedOrderResult.data.status === "approved") {
      await syncUserPlanStateFromOrder(updatedOrderResult.data);
    }

    return respond({
      ok: true,
      reused: false,
      orderNumber: updatedOrderResult.data.order_number,
      redirectUrl,
    });
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_card_redirect_post",
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
            : "Falha ao preparar checkout com cartao.",
      },
      { status: 500 },
    );
  }
}

