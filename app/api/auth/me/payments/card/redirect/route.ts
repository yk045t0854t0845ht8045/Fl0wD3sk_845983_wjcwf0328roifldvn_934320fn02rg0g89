import { NextResponse } from "next/server";
import {
  createMercadoPagoCardCheckoutPreference,
  resolveMercadoPagoCardEnvironment,
  resolveMercadoPagoCardPayerEmail,
  resolveMercadoPagoHostedCheckoutUrl,
} from "@/lib/payments/mercadoPago";
import { resolveDiscountPricing } from "@/lib/payments/discountPricing";
import {
  ensureCheckoutAccessTokenForOrder,
} from "@/lib/payments/checkoutLinkSecurity";
import {
  getLatestApprovedLicenseCoverageForGuild,
  getLatestOrderForUserAndGuild,
  createDraftOrderForCheckout,
  reuseDraftOrderForCheckout,
  ensureGuildAccess,
  buildCheckoutTransitionProviderPayload,
  canReuseDraftCheckoutOrder,
  createPaymentOrderEventSafe,
  doesOrderMatchCheckoutPlan,
  invalidatePaymentReadCachesForOrder,
  isOrderExpiredOrExpiringSoon,
  normalizeGuildId,
  normalizePayerEmail,
  parseForceNewFlag,
  resolveCheckoutPlanForGuild,
  resolveFlowPointsGrantedFromSubtotal,
  type PaymentOrderRecord,
} from "../../pix/route";
import {
  cleanupExpiredUnpaidServerSetups,
  resolveUnpaidSetupExpiresAt,
} from "@/lib/payments/setupCleanup";
import { resolveRenewalPaymentDecision } from "@/lib/payments/licenseStatus";
import { buildPaymentCheckoutEntryHref } from "@/lib/payments/paymentRouting";
import {
  createStablePaymentIdempotencyKey,
} from "@/lib/payments/paymentIntegrity";
import {
  applyFlowPointsToAmount,
} from "@/lib/plans/change";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import {
  areHostedCardCheckoutsEnabled,
  CARD_PAYMENTS_DISABLED_MESSAGE,
} from "@/lib/payments/cardAvailability";
import { runCoalescedRouteResponse } from "@/lib/security/routeCoalescing";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import {
  resolveDatabaseFailureMessage,
  resolveDatabaseFailureStatus,
} from "@/lib/security/databaseAvailability";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  buildCanonicalUrlFromInternalPath,
} from "@/lib/routing/subdomains";
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
  forceNew?: unknown;
};

const CARD_REDIRECT_ROUTE_COALESCE_TTL_MS = 1500;

function normalizeReturnTarget(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "servers" ? "servers" : null;
}

function normalizeReturnTab(value: unknown) {
  if (typeof value !== "string") return "plans";
  const normalized = value.trim().toLowerCase();
  return normalized === "settings" ? "settings" : "plans";
}

function buildHostedCheckoutReturnInternalPath(input: {
  guildId: string | null;
  planCode: string;
  billingPeriodCode: string;
  order: Pick<PaymentOrderRecord, "id" | "order_number">;
  checkoutToken: string | null;
  renew: boolean;
  returnTarget: "servers" | null;
  returnGuildId: string | null;
  returnTab: string;
}) {
  return buildPaymentCheckoutEntryHref({
    planCode: input.planCode,
    billingPeriodCode: input.billingPeriodCode,
    orderNumber: input.order.order_number,
    orderId: input.order.id,
    searchParams: {
      ...(input.guildId ? { guild: input.guildId } : {}),
      ...(input.checkoutToken ? { checkoutToken: input.checkoutToken } : {}),
      ...(input.renew ? { renew: 1 } : {}),
      ...(input.returnTarget ? { return: input.returnTarget } : {}),
      ...(input.returnGuildId ? { returnGuild: input.returnGuildId } : {}),
      ...(input.returnTarget ? { returnTab: input.returnTab } : {}),
    },
  });
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
    const originGuard = ensureSameOriginJsonMutationRequest(request);
    if (originGuard) {
      return attachRequestId(
        applyNoStoreHeaders(originGuard),
        baseRequestContext.requestId,
      );
    }

    if (!areHostedCardCheckoutsEnabled()) {
      return respond(
        {
          ok: false,
          message: CARD_PAYMENTS_DISABLED_MESSAGE,
        },
        { status: 503 },
      );
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
    const forceNew = parseForceNewFlag(body.forceNew);
    const renew = parseForceNewFlag(body.renew);
    const returnTarget = normalizeReturnTarget(body.returnTarget);
    const returnGuildId = normalizeGuildId(body.returnGuildId) || guildId;
    const returnTab = normalizeReturnTab(body.returnTab);

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(
        applyNoStoreHeaders(access.response),
        baseRequestContext.requestId,
      );
    }

    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionData.authSession.id,
      userId: access.context.sessionData.authSession.user.id,
      guildId,
    });

    const mutationKey = createStablePaymentIdempotencyKey({
      namespace: "payment-card-redirect-post-route",
      parts: [
        access.context.sessionData.authSession.user.id,
        guildId || "__account__",
        typeof body.planCode === "string" ? body.planCode : "",
        typeof body.billingPeriodCode === "string" ? body.billingPeriodCode : "",
        typeof body.couponCode === "string" ? body.couponCode : "",
        typeof body.giftCardCode === "string" ? body.giftCardCode : "",
        renew,
        returnTarget || "__none__",
        returnGuildId || "__none__",
        returnTab,
        forceNew,
      ],
    });

    return await runCoalescedRouteResponse({
      key: mutationKey,
      ttlMs: CARD_REDIRECT_ROUTE_COALESCE_TTL_MS,
      producer: async () => {
        const rateLimit = await enforceRequestRateLimit({
          action: "payment_card_redirect_post",
          windowMs: 10 * 60 * 1000,
          maxAttempts: 10,
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
                "Muitas tentativas de abrir checkout com cartao em pouco tempo. Aguarde alguns instantes.",
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

        const user = access.context.sessionData.authSession.user;
        if (guildId) {
          await cleanupExpiredUnpaidServerSetups({
            userId: user.id,
            guildId,
            source: "payment_card_redirect_post",
          });
        }

        const checkoutPlan = await resolveCheckoutPlanForGuild({
          userId: user.id,
          guildId,
          requestedPlanCode: body.planCode,
          requestedBillingPeriodCode: body.billingPeriodCode,
        });

        if (checkoutPlan.planChange.execution === "schedule_for_renewal") {
          return respond(
            {
              ok: false,
              message:
                "Esse downgrade deve ser agendado para o proximo vencimento. Use a acao de agendar troca na tela de pagamento.",
            },
            { status: 409 },
          );
        }

        const latestCoverage = guildId
          ? await getLatestApprovedLicenseCoverageForGuild(guildId)
          : null;
        const renewalDecision =
          guildId && checkoutPlan.planChange.kind === "upgrade"
            ? {
                allowed: true as const,
                reason: "immediate_upgrade" as const,
                licenseStartsAtMs: Date.now(),
              }
            : resolveRenewalPaymentDecision(latestCoverage);

        if (guildId && latestCoverage && !renewalDecision.allowed) {
          return respond(
            {
              ok: false,
              blockedByActiveLicense: true,
              licenseActive: true,
              licenseExpiresAt: latestCoverage.licenseExpiresAt,
              message:
                "Ja existe uma licenca ativa neste servidor. Aguarde a janela correta para renovar ou escolha outro plano.",
            },
            { status: 409 },
          );
        }

        if (checkoutPlan.currentPlanRepurchaseBlocked) {
          return respond(
            {
              ok: false,
              message:
                "Seu plano atual ja esta ativo. Escolha outro plano para mudar agora.",
            },
            { status: 409 },
          );
        }

        if (checkoutPlan.plan.isTrial) {
          return respond(
            {
              ok: false,
              message:
                "O plano gratuito e ativado sem checkout. Use a acao gratuita na tela de pagamento.",
            },
            { status: 409 },
          );
        }

        const pricing = await resolveDiscountPricing({
          baseAmount: checkoutPlan.amount,
          currency: checkoutPlan.currency,
          couponCode: typeof body.couponCode === "string" ? body.couponCode : null,
          giftCardCode:
            typeof body.giftCardCode === "string" ? body.giftCardCode : null,
          userId: user.id,
          planCode: checkoutPlan.plan.code,
          billingPeriodCode: checkoutPlan.plan.billingPeriodCode,
        });

        const flowPointsPreview = applyFlowPointsToAmount({
          amount: pricing.totalAmount,
          flowPointsBalance: checkoutPlan.flowPointsBalance,
        });
        const pricingWithFlowPoints = {
          ...pricing,
          totalAmount: flowPointsPreview.remainingAmount,
          flowPoints: {
            appliedAmount: flowPointsPreview.appliedAmount,
            balanceBefore: checkoutPlan.flowPointsBalance,
            balanceAfter: flowPointsPreview.nextBalanceAmount,
          },
        };
        const flowPointsGranted = resolveFlowPointsGrantedFromSubtotal({
          planChange: checkoutPlan.planChange,
          discountedSubtotalAmount: pricing.subtotalAmount,
        });
        const amount = pricingWithFlowPoints.totalAmount;
        const currency = pricingWithFlowPoints.currency;
        const transitionProviderPayload = buildCheckoutTransitionProviderPayload({
          planChange: checkoutPlan.planChange,
          flowPointsApplied: flowPointsPreview.appliedAmount,
          flowPointsGranted,
          scheduledChangeId: checkoutPlan.scheduledChange?.id || null,
        });

        if (amount <= 0) {
          return respond(
            {
              ok: false,
              message:
                "Esse pedido nao precisa de cartao porque o valor ja foi coberto por creditos.",
            },
            { status: 409 },
          );
        }

        const latestOrder = await getLatestOrderForUserAndGuild(user.id, guildId);
        const hasPendingCardUnderAnalysis =
          !forceNew &&
          !!latestOrder &&
          latestOrder.payment_method === "card" &&
          latestOrder.status === "pending" &&
          !!latestOrder.provider_payment_id &&
          !isOrderExpiredOrExpiringSoon(latestOrder);

        if (hasPendingCardUnderAnalysis && latestOrder) {
          return respond({
            ok: true,
            reused: true,
            alreadyProcessing: true,
            orderNumber: latestOrder.order_number,
            message:
              "Ja existe um pagamento com cartao em analise para esta conta. Aguarde o retorno antes de tentar novamente.",
          });
        }

        const canReuseLatestDraft =
          !forceNew &&
          !!latestOrder &&
          canReuseDraftCheckoutOrder(latestOrder) &&
          doesOrderMatchCheckoutPlan(latestOrder, {
            plan: checkoutPlan.plan,
            amount,
            currency,
          });

        let preparedOrder: PaymentOrderRecord;
        if (canReuseLatestDraft && latestOrder) {
          preparedOrder = await reuseDraftOrderForCheckout({
            order: latestOrder,
            paymentMethod: "card",
            amount,
            currency,
            plan: checkoutPlan.plan,
            providerPayload: {
              pricing: pricingWithFlowPoints,
              ...transitionProviderPayload,
              hostedCheckout: {
                environment: resolveMercadoPagoCardEnvironment(),
                mode: "redirect",
                precreated: true,
              },
            },
          });
        } else {
          preparedOrder = await createDraftOrderForCheckout({
            userId: user.id,
            guildId,
            paymentMethod: "card",
            amount,
            currency,
            plan: checkoutPlan.plan,
            providerPayload: {
              pricing: pricingWithFlowPoints,
              ...transitionProviderPayload,
              hostedCheckout: {
                environment: resolveMercadoPagoCardEnvironment(),
                mode: "redirect",
                precreated: true,
              },
            },
          });
        }

        const securedOrder = await ensureCheckoutAccessTokenForOrder({
          order: preparedOrder,
          forceRotate: forceNew,
          invalidateOtherOrders: forceNew,
        });

        const externalReference = `flowdesk-order-${securedOrder.order.order_number}`;
        const internalReturnPath = buildHostedCheckoutReturnInternalPath({
          guildId,
          planCode: checkoutPlan.plan.code,
          billingPeriodCode: checkoutPlan.plan.billingPeriodCode,
          order: securedOrder.order,
          checkoutToken: securedOrder.checkoutAccessToken,
          renew,
          returnTarget,
          returnGuildId,
          returnTab,
        });
        const successUrl = buildCanonicalUrlFromInternalPath(
          request,
          internalReturnPath,
          { fallbackHost: "pay" },
        );
        const pendingUrl = successUrl;
        const failureUrl = successUrl;
        const notificationUrl = buildCanonicalUrlFromInternalPath(
          request,
          "/api/payments/mercadopago/webhook",
          { fallbackHost: "public" },
        );

        if (!successUrl || !notificationUrl) {
          throw new Error("Nao foi possivel montar as URLs seguras do checkout.");
        }

        const payerEmail = resolveMercadoPagoCardPayerEmail(
          normalizePayerEmail(user.email) ||
            `${
              user.discord_user_id
                ? `discord-${user.discord_user_id}`
                : `user-${user.id}`
            }@flowdeskbot.app`,
        );

        const preference = await createMercadoPagoCardCheckoutPreference({
          amount,
          currency,
          title: `Flowdesk ${checkoutPlan.plan.name}`,
          description: `Flowdesk pagamento #${securedOrder.order.order_number}`,
          externalReference,
          payerEmail,
          payerName: user.display_name || "Cliente",
          metadata: {
            flowdesk_order_number: String(securedOrder.order.order_number),
            flowdesk_user_id: String(user.id),
            ...(user.discord_user_id
              ? {
                  flowdesk_discord_user_id: user.discord_user_id,
                }
              : {}),
            ...(guildId
              ? {
                  flowdesk_guild_id: guildId,
                }
              : {}),
            flowdesk_plan_code: checkoutPlan.plan.code,
            flowdesk_plan_name: checkoutPlan.plan.name,
            flowdesk_pricing_total: String(amount),
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
            ...(flowPointsPreview.appliedAmount > 0
              ? {
                  flowdesk_flow_points_applied: String(
                    flowPointsPreview.appliedAmount,
                  ),
                }
              : {}),
          },
          notificationUrl,
          successUrl,
          pendingUrl,
          failureUrl,
          expiresAt: resolveUnpaidSetupExpiresAt(securedOrder.order.created_at),
          idempotencyKey: createStablePaymentIdempotencyKey({
            namespace: "flowdesk-card-hosted-preference",
            parts: [
              securedOrder.order.order_number,
              externalReference,
              amount,
              currency,
              resolveMercadoPagoCardEnvironment(),
            ],
          }),
        });

        const redirectUrl = resolveMercadoPagoHostedCheckoutUrl(preference);
        if (!redirectUrl) {
          throw new Error(
            "O Mercado Pago nao retornou uma URL valida para o checkout de teste.",
          );
        }

        const supabase = getSupabaseAdminClientOrThrow();
        const updatedOrderResult = await supabase
          .from("payment_orders")
          .update({
            payment_method: "card",
            status: "pending",
            amount,
            currency,
            plan_code: checkoutPlan.plan.code,
            plan_name: checkoutPlan.plan.name,
            plan_billing_cycle_days: checkoutPlan.plan.billingCycleDays,
            plan_max_licensed_servers:
              checkoutPlan.plan.entitlements.maxLicensedServers,
            plan_max_active_tickets:
              checkoutPlan.plan.entitlements.maxActiveTickets,
            plan_max_automations: checkoutPlan.plan.entitlements.maxAutomations,
            plan_max_monthly_actions:
              checkoutPlan.plan.entitlements.maxMonthlyActions,
            provider_payment_id: null,
            provider_external_reference: externalReference,
            provider_qr_code: null,
            provider_qr_base64: null,
            provider_ticket_url: redirectUrl,
            provider_status: "checkout_created",
            provider_status_detail: "hosted_card_checkout_created",
            provider_payload: {
              source: "flowdesk_checkout",
              step: 4,
              pricing: pricingWithFlowPoints,
              ...transitionProviderPayload,
              plan: {
                code: checkoutPlan.plan.code,
                name: checkoutPlan.plan.name,
                billingCycleDays: checkoutPlan.plan.billingCycleDays,
                entitlements: {
                  ...checkoutPlan.plan.entitlements,
                },
              },
              hostedCheckout: {
                environment: resolveMercadoPagoCardEnvironment(),
                mode: "redirect",
                redirectUrl,
                preferenceId:
                  preference.id !== undefined && preference.id !== null
                    ? String(preference.id)
                    : null,
                successUrl,
                pendingUrl,
                failureUrl,
                notificationUrl,
                payerEmail,
              },
            },
            expires_at: resolveUnpaidSetupExpiresAt(securedOrder.order.created_at),
          })
          .eq("id", securedOrder.order.id)
          .select(
            "id, order_number, guild_id, payment_method, status, amount, currency, plan_code, plan_name, plan_billing_cycle_days, plan_max_licensed_servers, plan_max_active_tickets, plan_max_automations, plan_max_monthly_actions, payer_name, payer_document, payer_document_last4, payer_document_type, provider_payment_id, provider_external_reference, provider_qr_code, provider_qr_base64, provider_ticket_url, provider_payload, provider_status, provider_status_detail, paid_at, expires_at, user_id, checkout_link_nonce, checkout_link_expires_at, checkout_link_invalidated_at, created_at, updated_at",
          )
          .single<PaymentOrderRecord>();

        if (updatedOrderResult.error || !updatedOrderResult.data) {
          throw new Error(
            updatedOrderResult.error?.message ||
              "Falha ao preparar checkout com cartao.",
          );
        }

        invalidatePaymentReadCachesForOrder(updatedOrderResult.data);
        await createPaymentOrderEventSafe(
          updatedOrderResult.data.id,
          "hosted_card_checkout_created",
          {
            orderNumber: updatedOrderResult.data.order_number,
            externalReference,
            preferenceId:
              preference.id !== undefined && preference.id !== null
                ? String(preference.id)
                : null,
            environment: resolveMercadoPagoCardEnvironment(),
          },
        );

        await logSecurityAuditEventSafe(auditContext, {
          action: "payment_card_redirect_post",
          outcome: "succeeded",
          metadata: {
            orderNumber: updatedOrderResult.data.order_number,
            environment: resolveMercadoPagoCardEnvironment(),
            reused: canReuseLatestDraft,
          },
        });

        return respond({
          ok: true,
          reused: canReuseLatestDraft,
          orderNumber: updatedOrderResult.data.order_number,
          redirectUrl,
        });
      },
    });
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_card_redirect_post",
      outcome: "failed",
      metadata: {
        message: sanitizeErrorMessage(
          error,
          "Erro ao preparar checkout com cartao.",
        ),
      },
    });

    return respond(
      {
        ok: false,
        message: resolveDatabaseFailureMessage(
          error,
          sanitizeErrorMessage(error, "Erro ao preparar checkout com cartao."),
        ),
      },
      { status: resolveDatabaseFailureStatus(error) },
    );
  }
}
