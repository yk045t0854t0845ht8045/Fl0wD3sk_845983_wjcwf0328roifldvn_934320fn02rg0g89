import {
  DEFAULT_PLAN_BILLING_PERIOD_CODE,
  DEFAULT_PLAN_CODE,
  buildPlanSnapshot,
  normalizePlanBillingPeriodCode,
  isPlanCode,
  type PlanPricingDefinition,
  resolvePlanDefinition,
  resolvePlanPricing,
  type PlanBillingPeriodCode,
  type PlanCode,
} from "@/lib/plans/catalog";
import {
  resolveBillingPeriodMonthsFromCycleDays,
  resolveEffectivePlanBillingCycleDays,
  resolvePlanLicenseExpiresAtIso,
} from "@/lib/plans/cycle";
import {
  applyBetaProgramPricing,
  BETA_COUPON_CODE,
  BETA_PINNED_BILLING_PERIOD_CODE,
  BETA_PINNED_MONTHLY_AMOUNT,
  BETA_PINNED_PLAN_CODE,
  canApplyBetaProgramToSelection,
} from "@/lib/payments/betaProgram";
import {
  applyFlowPointsEvent,
  getUserPlanFlowPointsBalance,
  getUserPlanScheduledChange,
  readOrderPlanTransitionPayload,
  resolveFlowPointsBalanceAmount,
  updateScheduledPlanChangeStatus,
} from "@/lib/plans/change";
import { finalizeDowngradeEnforcementAfterApprovedOrder } from "@/lib/plans/downgradeEnforcement";
import { licenseGuildForUser } from "@/lib/plans/planGuilds";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type GuildPlanSettingsRecord = {
  plan_code: PlanCode;
  monthly_amount: string | number;
  currency: string;
  recurring_enabled: boolean;
  recurring_method_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UserPlanStateRecord = {
  user_id: number;
  plan_code: PlanCode;
  plan_name: string;
  status: "inactive" | "trial" | "active" | "expired";
  amount: string | number;
  compare_amount: string | number;
  currency: string;
  billing_cycle_days: number;
  max_licensed_servers: number;
  max_active_tickets: number;
  max_automations: number;
  max_monthly_actions: number;
  last_payment_order_id: number | null;
  last_payment_guild_id: string | null;
  activated_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const USER_PLAN_STATE_SELECT_COLUMNS =
  "user_id, plan_code, plan_name, status, amount, compare_amount, currency, billing_cycle_days, max_licensed_servers, max_active_tickets, max_automations, max_monthly_actions, last_payment_order_id, last_payment_guild_id, activated_at, expires_at, metadata, created_at, updated_at";

const LATEST_APPROVED_ORDER_FOR_PLAN_STATE_SELECT_COLUMNS =
  "id, user_id, guild_id, payment_method, plan_code, plan_name, amount, currency, plan_billing_cycle_days, plan_max_licensed_servers, plan_max_active_tickets, plan_max_automations, plan_max_monthly_actions, paid_at, expires_at, created_at";

const BASIC_PLAN_ELIGIBILITY_SELECT_COLUMNS =
  "id, plan_code, payment_method, paid_at, created_at";

const BASIC_PLAN_FIRST_PURCHASE_BONUS_DAYS = 7;

type PaymentOrderPlanRecord = {
  id: number;
  user_id: number;
  guild_id: string;
  payment_method?: string | null;
  plan_code?: string | null;
  plan_name?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  plan_billing_cycle_days?: number | null;
  plan_max_licensed_servers?: number | null;
  plan_max_active_tickets?: number | null;
  plan_max_automations?: number | null;
  plan_max_monthly_actions?: number | null;
  provider_payload?: unknown;
  paid_at?: string | null;
  expires_at?: string | null;
  created_at: string;
};

type PaymentOrderEventPayload = Record<string, unknown>;

type UserPlanStateMetadataRecord = {
  metadata: Record<string, unknown> | null;
};

type ApprovedOrderEligibilityRecord = {
  id: number;
  plan_code?: string | null;
  payment_method?: string | null;
  paid_at?: string | null;
  created_at: string;
};

export type BasicPlanAvailability = {
  isAvailable: boolean;
  reason: "available" | "already_used" | "consumed_by_paid_purchase";
  unavailableMessage: string | null;
  grantedBonusDaysOnFirstPaidPurchase: number;
  approvedOrdersCount: number;
};

type PaymentOrderProviderPayloadRecord = {
  provider_payload: unknown;
};

type PaymentCouponBenefitRecord = {
  id: number;
  code: string;
  metadata: Record<string, unknown> | null;
};

type PaymentGiftCardBenefitRecord = {
  id: number;
  code: string;
  remaining_amount: string | number;
};

type ApprovedOrderPricingSnapshot = {
  couponCode: string | null;
  couponAmount: number;
  giftCardCode: string | null;
  giftCardAmount: number;
};

type ApprovedOrderBenefits = {
  betaMetadata: Record<string, unknown> | null;
  couponRedemption:
    | {
        couponId: number;
        code: string;
        discountAmount: number;
      }
    | null;
  giftCardRedemption:
    | {
        giftCardId: number;
        code: string;
        redeemedAmount: number;
      }
    | null;
};

function parseNumeric(value: string | number | null | undefined, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeCouponCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized ? normalized.slice(0, 64) : null;
}

function parseUnknownNumeric(value: unknown, fallback = 0) {
  if (typeof value === "number" || typeof value === "string") {
    return parseNumeric(value, fallback);
  }

  return fallback;
}

function parsePricingSnapshot(providerPayload: unknown): ApprovedOrderPricingSnapshot {
  if (!isRecord(providerPayload)) {
    return {
      couponCode: null,
      couponAmount: 0,
      giftCardCode: null,
      giftCardAmount: 0,
    };
  }

  const pricing = isRecord(providerPayload.pricing) ? providerPayload.pricing : null;
  const coupon = pricing && isRecord(pricing.coupon) ? pricing.coupon : null;
  const giftCard = pricing && isRecord(pricing.giftCard) ? pricing.giftCard : null;

  return {
    couponCode: normalizeCouponCode(coupon?.code),
    couponAmount: roundMoney(parseUnknownNumeric(coupon?.amount, 0)),
    giftCardCode: normalizeCouponCode(giftCard?.code),
    giftCardAmount: roundMoney(parseUnknownNumeric(giftCard?.amount, 0)),
  };
}

function buildPlanMetadata(input: {
  planCode: PlanCode;
  billingCycleDays: number;
  billingPeriodMonths: number;
}) {
  return {
    ...buildPlanSnapshot(input.planCode),
    billingCycleDays: input.billingCycleDays,
    billingPeriodMonths: input.billingPeriodMonths,
  };
}

export function applyUserPlanStatePricingAdjustments(
  plan: PlanPricingDefinition,
  userPlanState: UserPlanStateRecord | null,
) {
  return applyBetaProgramPricing(plan, userPlanState?.metadata || null);
}

function isTrialPaymentMethod(value: unknown) {
  return value === "trial";
}

function isCurrentlyActivePlanState(userPlanState: UserPlanStateRecord | null) {
  if (!userPlanState) return false;
  if (userPlanState.status !== "active" && userPlanState.status !== "trial") {
    return false;
  }

  const expiresAtMs = userPlanState.expires_at
    ? Date.parse(userPlanState.expires_at)
    : Number.NaN;
  return !Number.isFinite(expiresAtMs) || Date.now() <= expiresAtMs;
}

function readTrialConsumptionMetadata(metadata: Record<string, unknown> | null | undefined) {
  const trialMetadata = isRecord(metadata?.trial) ? metadata.trial : null;

  return {
    basicUsedAt:
      trialMetadata && typeof trialMetadata.basicUsedAt === "string"
        ? trialMetadata.basicUsedAt
        : null,
    firstPaidBonusGrantedAt:
      trialMetadata && typeof trialMetadata.firstPaidBonusGrantedAt === "string"
        ? trialMetadata.firstPaidBonusGrantedAt
        : null,
  };
}

async function listApprovedOrdersForBasicPlanRules(
  userId: number,
  options?: { excludeOrderId?: number | null },
) {
  const supabase = getSupabaseAdminClientOrThrow();
  let query = supabase
    .from("payment_orders")
    .select(BASIC_PLAN_ELIGIBILITY_SELECT_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("paid_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (typeof options?.excludeOrderId === "number" && Number.isFinite(options.excludeOrderId)) {
    query = query.neq("id", options.excludeOrderId);
  }

  const result = await query;

  if (result.error) {
    throw new Error(
      `Erro ao carregar historico aprovado da conta: ${result.error.message}`,
    );
  }

  return (result.data || []) as ApprovedOrderEligibilityRecord[];
}

export async function getBasicPlanAvailability(
  userId: number,
): Promise<BasicPlanAvailability> {
  const supabase = getSupabaseAdminClientOrThrow();
  const [approvedOrders, planStateResult] = await Promise.all([
    listApprovedOrdersForBasicPlanRules(userId),
    supabase
      .from("auth_user_plan_state")
      .select("metadata")
      .eq("user_id", userId)
      .maybeSingle<UserPlanStateMetadataRecord>(),
  ]);

  if (planStateResult.error) {
    throw new Error(
      `Erro ao carregar elegibilidade do plano Basic: ${planStateResult.error.message}`,
    );
  }

  const trialConsumption = readTrialConsumptionMetadata(planStateResult.data?.metadata || null);
  const hasApprovedBasic = approvedOrders.some(
    (order) =>
      isTrialPaymentMethod(order.payment_method) ||
      (isPlanCode(order.plan_code) && order.plan_code === "basic"),
  );

  if (hasApprovedBasic || trialConsumption.basicUsedAt) {
    return {
      isAvailable: false,
      reason: "already_used",
      unavailableMessage:
        "O plano Basic ja foi usado nesta conta e nao pode ser resgatado novamente.",
      grantedBonusDaysOnFirstPaidPurchase: BASIC_PLAN_FIRST_PURCHASE_BONUS_DAYS,
      approvedOrdersCount: approvedOrders.length,
    };
  }

  const hasApprovedPaidOrder = approvedOrders.some(
    (order) => !isTrialPaymentMethod(order.payment_method),
  );

  if (hasApprovedPaidOrder || trialConsumption.firstPaidBonusGrantedAt) {
    return {
      isAvailable: false,
      reason: "consumed_by_paid_purchase",
      unavailableMessage:
        "O plano Basic ficou indisponivel porque a conta ja iniciou em um plano pago e recebeu os 7 dias de bonus nessa primeira compra.",
      grantedBonusDaysOnFirstPaidPurchase: BASIC_PLAN_FIRST_PURCHASE_BONUS_DAYS,
      approvedOrdersCount: approvedOrders.length,
    };
  }

  return {
    isAvailable: true,
    reason: "available",
    unavailableMessage: null,
    grantedBonusDaysOnFirstPaidPurchase: BASIC_PLAN_FIRST_PURCHASE_BONUS_DAYS,
    approvedOrdersCount: 0,
  };
}

export async function resolveApprovedOrderLicenseExpiresAt(input: {
  order: Pick<
    PaymentOrderPlanRecord,
    | "id"
    | "user_id"
    | "plan_code"
    | "payment_method"
    | "plan_billing_cycle_days"
    | "paid_at"
    | "created_at"
  >;
  paidAtOverride?: string | null;
}) {
  const resolvedPlanCode = isPlanCode(input.order.plan_code)
    ? input.order.plan_code
    : DEFAULT_PLAN_CODE;
  const activatedAt = input.paidAtOverride || input.order.paid_at || input.order.created_at;
  const resolvedBillingCycleDays = resolveEffectivePlanBillingCycleDays({
    billingCycleDays: input.order.plan_billing_cycle_days,
    planCode: input.order.plan_code,
    fallbackPlanCode: resolvedPlanCode,
  });
  const isTrialOrder =
    resolvedPlanCode === "basic" || isTrialPaymentMethod(input.order.payment_method);
  const priorApprovedOrders = isTrialOrder
    ? []
    : await listApprovedOrdersForBasicPlanRules(input.order.user_id, {
        excludeOrderId: input.order.id,
      });
  const shouldGrantFirstPaidBonus =
    !isTrialOrder && priorApprovedOrders.length === 0;
  const effectiveBillingCycleDays = shouldGrantFirstPaidBonus
    ? resolvedBillingCycleDays + BASIC_PLAN_FIRST_PURCHASE_BONUS_DAYS
    : resolvedBillingCycleDays;

  return {
    expiresAt:
      resolvePlanLicenseExpiresAtIso({
        baseTimestamp: activatedAt,
        billingCycleDays: effectiveBillingCycleDays,
        planCode: resolvedPlanCode,
        fallbackPlanCode: resolvedPlanCode,
      }) || null,
    bonusDaysApplied: shouldGrantFirstPaidBonus
      ? BASIC_PLAN_FIRST_PURCHASE_BONUS_DAYS
      : 0,
  };
}

async function resolveApprovedOrderBenefits(input: {
  orderId: number;
  resolvedPlanCode: PlanCode;
  billingPeriodCode: PlanBillingPeriodCode;
  activatedAt: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const providerPayloadResult = await supabase
    .from("payment_orders")
    .select("provider_payload")
    .eq("id", input.orderId)
    .maybeSingle<PaymentOrderProviderPayloadRecord>();

  if (providerPayloadResult.error) {
    throw new Error(
      `Erro ao carregar beneficios do pedido aprovado: ${providerPayloadResult.error.message}`,
    );
  }

  const pricingSnapshot = parsePricingSnapshot(
    providerPayloadResult.data?.provider_payload,
  );
  const [couponResult, giftCardResult] = await Promise.all([
    pricingSnapshot.couponCode
      ? supabase
          .from("payment_coupons")
          .select("id, code, metadata")
          .eq("code", pricingSnapshot.couponCode)
          .maybeSingle<PaymentCouponBenefitRecord>()
      : Promise.resolve({ data: null, error: null }),
    pricingSnapshot.giftCardCode
      ? supabase
          .from("payment_gift_cards")
          .select("id, code, remaining_amount")
          .eq("code", pricingSnapshot.giftCardCode)
          .maybeSingle<PaymentGiftCardBenefitRecord>()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (couponResult.error) {
    throw new Error(
      `Erro ao carregar cupom do pedido aprovado: ${couponResult.error.message}`,
    );
  }

  if (giftCardResult.error) {
    throw new Error(
      `Erro ao carregar gift card do pedido aprovado: ${giftCardResult.error.message}`,
    );
  }

  const couponRecord = couponResult.data;
  const giftCardRecord = giftCardResult.data;
  const couponCode = couponRecord?.code || pricingSnapshot.couponCode;
  const couponMetadata = isRecord(couponRecord?.metadata) ? couponRecord.metadata : null;
  const isBetaCoupon =
    couponCode === BETA_COUPON_CODE ||
    (couponMetadata?.betaProgram === true &&
      canApplyBetaProgramToSelection(
        input.resolvedPlanCode,
        input.billingPeriodCode,
      ));

  return {
    betaMetadata:
      isBetaCoupon &&
      canApplyBetaProgramToSelection(
        input.resolvedPlanCode,
        input.billingPeriodCode,
      )
        ? {
            active: true,
            couponCode: couponCode || BETA_COUPON_CODE,
            pinnedPlanCode: BETA_PINNED_PLAN_CODE,
            pinnedBillingPeriodCode: BETA_PINNED_BILLING_PERIOD_CODE,
            pinnedMonthlyAmount: roundMoney(
              parseUnknownNumeric(
                couponMetadata?.pinnedMonthlyAmount,
                BETA_PINNED_MONTHLY_AMOUNT,
              ),
            ),
            activatedAt: input.activatedAt,
          }
        : null,
    couponRedemption: couponRecord
      ? {
          couponId: couponRecord.id,
          code: couponRecord.code,
          discountAmount: pricingSnapshot.couponAmount,
        }
      : null,
    giftCardRedemption: giftCardRecord
      ? {
          giftCardId: giftCardRecord.id,
          code: giftCardRecord.code,
          redeemedAmount: pricingSnapshot.giftCardAmount,
        }
      : null,
  } satisfies ApprovedOrderBenefits;
}

async function resolveOrderProviderPayload(order: PaymentOrderPlanRecord) {
  if (order.provider_payload !== undefined) {
    return order.provider_payload;
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const providerPayloadResult = await supabase
    .from("payment_orders")
    .select("provider_payload")
    .eq("id", order.id)
    .maybeSingle<PaymentOrderProviderPayloadRecord>();

  if (providerPayloadResult.error) {
    throw new Error(
      `Erro ao carregar payload financeiro do pedido aprovado: ${providerPayloadResult.error.message}`,
    );
  }

  return providerPayloadResult.data?.provider_payload;
}

async function persistApprovedOrderBenefits(input: {
  orderId: number;
  userId: number;
  guildId: string;
  benefits: ApprovedOrderBenefits;
}) {
  const supabase = getSupabaseAdminClientOrThrow();

  if (input.benefits.couponRedemption) {
    const existingCouponRedemptionResult = await supabase
      .from("payment_coupon_redemptions")
      .select("id")
      .eq("coupon_id", input.benefits.couponRedemption.couponId)
      .eq("payment_order_id", input.orderId)
      .limit(1)
      .maybeSingle<{ id: number }>();

    if (existingCouponRedemptionResult.error) {
      throw new Error(existingCouponRedemptionResult.error.message);
    }

    if (!existingCouponRedemptionResult.data) {
      const insertCouponRedemptionResult = await supabase
        .from("payment_coupon_redemptions")
        .insert({
          coupon_id: input.benefits.couponRedemption.couponId,
          payment_order_id: input.orderId,
          guild_id: input.guildId,
          user_id: input.userId,
          discount_amount: input.benefits.couponRedemption.discountAmount,
        });

      if (insertCouponRedemptionResult.error) {
        throw new Error(insertCouponRedemptionResult.error.message);
      }
    }
  }

  if (
    input.benefits.giftCardRedemption &&
    input.benefits.giftCardRedemption.redeemedAmount > 0
  ) {
    const existingGiftCardRedemptionResult = await supabase
      .from("payment_gift_card_redemptions")
      .select("id")
      .eq("gift_card_id", input.benefits.giftCardRedemption.giftCardId)
      .eq("payment_order_id", input.orderId)
      .limit(1)
      .maybeSingle<{ id: number }>();

    if (existingGiftCardRedemptionResult.error) {
      throw new Error(existingGiftCardRedemptionResult.error.message);
    }

    if (!existingGiftCardRedemptionResult.data) {
      const giftCardResult = await supabase
        .from("payment_gift_cards")
        .select("remaining_amount")
        .eq("id", input.benefits.giftCardRedemption.giftCardId)
        .single<Pick<PaymentGiftCardBenefitRecord, "remaining_amount">>();

      if (giftCardResult.error || !giftCardResult.data) {
        throw new Error(
          giftCardResult.error?.message ||
            "Nao foi possivel carregar o saldo atual do gift card.",
        );
      }

      const nextRemainingAmount = Math.max(
        0,
        roundMoney(
          parseNumeric(giftCardResult.data.remaining_amount, 0) -
            input.benefits.giftCardRedemption.redeemedAmount,
        ),
      );

      const insertGiftCardRedemptionResult = await supabase
        .from("payment_gift_card_redemptions")
        .insert({
          gift_card_id: input.benefits.giftCardRedemption.giftCardId,
          payment_order_id: input.orderId,
          guild_id: input.guildId,
          user_id: input.userId,
          redeemed_amount: input.benefits.giftCardRedemption.redeemedAmount,
        });

      if (insertGiftCardRedemptionResult.error) {
        throw new Error(insertGiftCardRedemptionResult.error.message);
      }

      const updateGiftCardResult = await supabase
        .from("payment_gift_cards")
        .update(
          nextRemainingAmount <= 0
            ? {
                remaining_amount: nextRemainingAmount,
                status: "exhausted",
              }
            : {
                remaining_amount: nextRemainingAmount,
              },
        )
        .eq("id", input.benefits.giftCardRedemption.giftCardId);

      if (updateGiftCardResult.error) {
        throw new Error(updateGiftCardResult.error.message);
      }
    }
  }
}

async function persistApprovedOrderTransitionEffects(input: {
  order: PaymentOrderPlanRecord;
  currency: string;
}) {
  const providerPayload = await resolveOrderProviderPayload(input.order);
  const transition = readOrderPlanTransitionPayload(providerPayload);
  if (!transition) {
    return;
  }

  if (transition.flowPointsApplied > 0) {
    await applyFlowPointsEvent({
      userId: input.order.user_id,
      eventType: "plan_change_charge_applied",
      amount: -Math.abs(transition.flowPointsApplied),
      currency: input.currency,
      referenceKey: `payment-order:${input.order.id}:flow-points-consume`,
      paymentOrderId: input.order.id,
      metadata: {
        kind: transition.kind,
        execution: transition.execution,
        currentPlanCode: transition.currentPlanCode,
      },
    });
  }

  if (transition.flowPointsGranted > 0) {
    await applyFlowPointsEvent({
      userId: input.order.user_id,
      eventType: "plan_change_credit_granted",
      amount: Math.abs(transition.flowPointsGranted),
      currency: input.currency,
      referenceKey: `payment-order:${input.order.id}:flow-points-grant`,
      paymentOrderId: input.order.id,
      metadata: {
        kind: transition.kind,
        execution: transition.execution,
        currentPlanCode: transition.currentPlanCode,
      },
    });
  }

  if (typeof transition.scheduledChangeId === "number" && Number.isFinite(transition.scheduledChangeId)) {
    await updateScheduledPlanChangeStatus({
      userId: input.order.user_id,
      scheduledChangeId: transition.scheduledChangeId,
      nextStatus: "applied",
      metadata: {
        paymentOrderId: input.order.id,
        appliedAt: input.order.paid_at || input.order.created_at,
      },
    });
    return;
  }

  if (transition.execution === "pay_now" && transition.kind !== "current") {
    await updateScheduledPlanChangeStatus({
      userId: input.order.user_id,
      nextStatus: "cancelled",
      metadata: {
        paymentOrderId: input.order.id,
        cancelledAt: input.order.paid_at || input.order.created_at,
        reason: "superseded_by_immediate_plan_change",
      },
    });
  }
}

function resolveActivePlanStateStatus(planCode: PlanCode, expiresAt: string | null) {
  if (!expiresAt) {
    return planCode === "basic" ? "trial" : "active";
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return planCode === "basic" ? "trial" : "active";
  }

  if (Date.now() > expiresAtMs) {
    return "expired";
  }

  return planCode === "basic" ? "trial" : "active";
}

async function createPaymentOrderEventSafe(
  paymentOrderId: number,
  eventType: string,
  eventPayload: PaymentOrderEventPayload,
) {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    await supabase.from("payment_order_events").insert({
      payment_order_id: paymentOrderId,
      event_type: eventType,
      event_payload: eventPayload,
    });
  } catch {
    // telemetria nao deve derrubar o fluxo de plano
  }
}

function normalizeValidIso(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export async function getGuildPlanSettingsRecord(userId: number, guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_plan_settings")
    .select(
      "plan_code, monthly_amount, currency, recurring_enabled, recurring_method_id, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .maybeSingle<GuildPlanSettingsRecord>();

  if (result.error) {
    throw new Error(`Erro ao carregar plano salvo do servidor: ${result.error.message}`);
  }

  return result.data || null;
}

export async function getUserPlanState(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const [planStateResult, latestApprovedOrderResult] = await Promise.all([
    supabase
      .from("auth_user_plan_state")
      .select(USER_PLAN_STATE_SELECT_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle<UserPlanStateRecord>(),
    supabase
      .from("payment_orders")
      .select(LATEST_APPROVED_ORDER_FOR_PLAN_STATE_SELECT_COLUMNS)
      .eq("user_id", userId)
      .eq("status", "approved")
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<PaymentOrderPlanRecord>(),
  ]);

  if (planStateResult.error) {
    throw new Error(`Erro ao carregar plano da conta: ${planStateResult.error.message}`);
  }

  if (latestApprovedOrderResult.error) {
    throw new Error(
      `Erro ao carregar o ultimo pagamento aprovado da conta: ${latestApprovedOrderResult.error.message}`,
    );
  }

  const currentPlanState = planStateResult.data || null;
  const latestApprovedOrder = latestApprovedOrderResult.data || null;

  if (!latestApprovedOrder) {
    return currentPlanState;
  }

  const resolvedPlanCode = isPlanCode(latestApprovedOrder.plan_code)
    ? latestApprovedOrder.plan_code
    : DEFAULT_PLAN_CODE;
  const resolvedBillingCycleDays = resolveEffectivePlanBillingCycleDays({
    billingCycleDays: latestApprovedOrder.plan_billing_cycle_days,
    planCode: latestApprovedOrder.plan_code,
    fallbackPlanCode: resolvedPlanCode,
  });
  const expectedActivatedAt =
    latestApprovedOrder.paid_at || latestApprovedOrder.created_at;
  const expectedExpiresAt =
    normalizeValidIso(latestApprovedOrder.expires_at) ||
    resolvePlanLicenseExpiresAtIso({
      baseTimestamp: expectedActivatedAt,
      billingCycleDays: resolvedBillingCycleDays,
      billingPeriodMonths: resolveBillingPeriodMonthsFromCycleDays(resolvedBillingCycleDays),
      planCode: resolvedPlanCode,
      fallbackPlanCode: resolvedPlanCode,
    });

  const shouldResyncPlanState =
    !currentPlanState ||
    currentPlanState.last_payment_order_id !== latestApprovedOrder.id ||
    currentPlanState.plan_code !== resolvedPlanCode ||
    currentPlanState.billing_cycle_days !== resolvedBillingCycleDays ||
    currentPlanState.activated_at !== expectedActivatedAt ||
    currentPlanState.expires_at !== expectedExpiresAt;

  if (shouldResyncPlanState) {
    return syncUserPlanStateFromOrder(latestApprovedOrder);
  }

  return currentPlanState;
}

export async function repairOrphanPlanGuildLinkForUser(input: {
  userId: number;
  source?: string;
  userPlanState?: UserPlanStateRecord | null;
}) {
  const userPlanState =
    input.userPlanState === undefined
      ? await getUserPlanState(input.userId)
      : input.userPlanState;

  const candidateGuildId =
    typeof userPlanState?.last_payment_guild_id === "string"
      ? userPlanState.last_payment_guild_id.trim()
      : "";
  const source = input.source || "plan_state_repair";

  if (
    !candidateGuildId ||
    !userPlanState ||
    (userPlanState.status !== "active" &&
      userPlanState.status !== "trial" &&
      userPlanState.status !== "expired")
  ) {
    return {
      repaired: false,
      detected: false,
      guildId: candidateGuildId || null,
      reason: "no_candidate",
    } as const;
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const [existingGuildLinkResult, candidateOrderResult] = await Promise.all([
    supabase
      .from("auth_user_plan_guilds")
      .select("id, is_active")
      .eq("user_id", input.userId)
      .eq("guild_id", candidateGuildId)
      .maybeSingle<{ id: number; is_active: boolean }>(),
    supabase
      .from("payment_orders")
      .select(
        "id, user_id, guild_id, payment_method, plan_code, plan_name, amount, currency, plan_billing_cycle_days, plan_max_licensed_servers, plan_max_active_tickets, plan_max_automations, plan_max_monthly_actions, paid_at, expires_at, created_at",
      )
      .eq("user_id", input.userId)
      .eq("guild_id", candidateGuildId)
      .eq("status", "approved")
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<PaymentOrderPlanRecord>(),
  ]);

  if (existingGuildLinkResult.error) {
    throw new Error(
      `Erro ao validar vinculo atual do plano: ${existingGuildLinkResult.error.message}`,
    );
  }

  if (candidateOrderResult.error) {
    throw new Error(
      `Erro ao localizar pedido aprovado para reparo de vinculo: ${candidateOrderResult.error.message}`,
    );
  }

  if (existingGuildLinkResult.data?.id) {
    return {
      repaired: false,
      detected: false,
      guildId: candidateGuildId,
      reason: existingGuildLinkResult.data.is_active ? "already_linked" : "already_inactive",
    } as const;
  }

  const candidateOrder = candidateOrderResult.data || null;
  if (!candidateOrder) {
    return {
      repaired: false,
      detected: false,
      guildId: candidateGuildId,
      reason: "approved_order_missing",
    } as const;
  }

  await createPaymentOrderEventSafe(candidateOrder.id, "plan_guild_link_orphan_detected", {
    source,
    guildId: candidateGuildId,
    userId: input.userId,
    planCode: userPlanState.plan_code,
    planStatus: userPlanState.status,
    lastPaymentOrderId: userPlanState.last_payment_order_id,
  });

  const repairResult = await licenseGuildForUser({
    userId: input.userId,
    guildId: candidateGuildId,
    maxLicensedServers: Math.max(userPlanState.max_licensed_servers || 1, 1),
    currentPlanCode: userPlanState.plan_code,
    currentPlanState: userPlanState,
  });

  if (!repairResult.ok) {
    await createPaymentOrderEventSafe(candidateOrder.id, "plan_guild_link_repair_skipped", {
      source,
      guildId: candidateGuildId,
      userId: input.userId,
      reason: repairResult.reason,
    });

    return {
      repaired: false,
      detected: true,
      guildId: candidateGuildId,
      reason: repairResult.reason,
    } as const;
  }

  await createPaymentOrderEventSafe(candidateOrder.id, "plan_guild_link_repaired", {
    source,
    guildId: candidateGuildId,
    userId: input.userId,
    alreadyLicensed: repairResult.alreadyLicensed,
  });

  return {
    repaired: true,
    detected: true,
    guildId: candidateGuildId,
    reason: repairResult.alreadyLicensed ? "already_covered" : "relinked",
  } as const;
}

export async function resolveEffectivePlanSelection(input: {
  userId: number;
  guildId: string;
  preferredPlanCode?: unknown;
  preferredBillingPeriodCode?: unknown;
}) {
  const [guildSettings, userPlanState, basicPlanAvailability, flowPointsBalanceRecord, scheduledChange] = await Promise.all([
    getGuildPlanSettingsRecord(input.userId, input.guildId),
    getUserPlanState(input.userId),
    getBasicPlanAvailability(input.userId),
    getUserPlanFlowPointsBalance(input.userId),
    getUserPlanScheduledChange(input.userId),
  ]);

  const nowMs = Date.now();
  const preferredPlanCode =
    typeof input.preferredPlanCode === "string" && isPlanCode(input.preferredPlanCode)
      ? input.preferredPlanCode
      : null;
  const preferredBillingPeriodCode =
    normalizePlanBillingPeriodCode(
      input.preferredBillingPeriodCode,
      DEFAULT_PLAN_BILLING_PERIOD_CODE,
    ) as PlanBillingPeriodCode;
  const activeAccountPlanCode =
    userPlanState &&
    (userPlanState.status === "active" ||
      userPlanState.status === "trial" ||
      userPlanState.status === "expired")
      ? userPlanState.plan_code
      : null;
  const scheduledChangeEffectiveAtMs = scheduledChange?.effective_at
    ? Date.parse(scheduledChange.effective_at)
    : Number.NaN;
  const shouldPreferScheduledChange =
    !!scheduledChange &&
    Number.isFinite(scheduledChangeEffectiveAtMs) &&
    scheduledChangeEffectiveAtMs <= nowMs &&
    !isCurrentlyActivePlanState(userPlanState);
  const allowCurrentBasicPlanSelection =
    userPlanState?.plan_code === "basic" && isCurrentlyActivePlanState(userPlanState);
  const canSelectBasicPlan =
    basicPlanAvailability.isAvailable || allowCurrentBasicPlanSelection;
  const candidatePlanCodes = [
    preferredPlanCode,
    shouldPreferScheduledChange ? scheduledChange?.target_plan_code || null : null,
    guildSettings?.plan_code || null,
    activeAccountPlanCode,
    DEFAULT_PLAN_CODE,
  ];

  const selectedPlanCode =
    candidatePlanCodes.find(
      (candidate): candidate is PlanCode =>
        Boolean(candidate) && (candidate !== "basic" || canSelectBasicPlan),
    ) || DEFAULT_PLAN_CODE;
  const selectedBillingPeriodCode =
    preferredPlanCode
      ? preferredBillingPeriodCode
      : shouldPreferScheduledChange &&
          scheduledChange?.target_plan_code === selectedPlanCode
        ? scheduledChange.target_billing_period_code
        : preferredBillingPeriodCode;
  const plan = applyUserPlanStatePricingAdjustments(
    resolvePlanPricing(selectedPlanCode, selectedBillingPeriodCode),
    userPlanState,
  );

  return {
    plan,
    guildSettings,
    userPlanState,
    basicPlanAvailability,
    flowPointsBalance: resolveFlowPointsBalanceAmount(flowPointsBalanceRecord),
    scheduledChange,
  };
}

export async function syncUserPlanStateFromOrder(order: PaymentOrderPlanRecord) {
  const supabase = getSupabaseAdminClientOrThrow();
  const resolvedPlanCode = isPlanCode(order.plan_code) ? order.plan_code : DEFAULT_PLAN_CODE;
  const plan = resolvePlanDefinition(resolvedPlanCode);
  const activatedAt = order.paid_at || order.created_at;
  const resolvedBillingCycleDays = resolveEffectivePlanBillingCycleDays({
    billingCycleDays: order.plan_billing_cycle_days,
    planCode: order.plan_code,
    fallbackPlanCode: resolvedPlanCode,
  });
  const resolvedBillingPeriodMonths =
    resolveBillingPeriodMonthsFromCycleDays(resolvedBillingCycleDays);
  const resolvedBillingPeriodCode =
    resolvedBillingPeriodMonths && resolvedBillingPeriodMonths >= 12
      ? ("annual" as const)
      : resolvedBillingPeriodMonths && resolvedBillingPeriodMonths >= 6
        ? ("semiannual" as const)
        : resolvedBillingPeriodMonths && resolvedBillingPeriodMonths >= 3
          ? ("quarterly" as const)
          : ("monthly" as const);
  const [currentPlanStateResult, approvedOrderBenefits, expirationResolution] = await Promise.all([
    supabase
      .from("auth_user_plan_state")
      .select("metadata")
      .eq("user_id", order.user_id)
      .maybeSingle<UserPlanStateMetadataRecord>(),
    resolveApprovedOrderBenefits({
      orderId: order.id,
      resolvedPlanCode,
      billingPeriodCode: resolvedBillingPeriodCode,
      activatedAt,
    }),
    resolveApprovedOrderLicenseExpiresAt({
      order,
      paidAtOverride: activatedAt,
    }),
  ]);

  const expiresAt = normalizeValidIso(order.expires_at) || expirationResolution.expiresAt;

  if (currentPlanStateResult.error) {
    throw new Error(
      currentPlanStateResult.error.message ||
        "Falha ao carregar metadados atuais do plano da conta.",
    );
  }

  const existingMetadata = isRecord(currentPlanStateResult.data?.metadata)
    ? currentPlanStateResult.data.metadata
    : {};
  const nextMetadata: Record<string, unknown> = {
    ...existingMetadata,
    plan: buildPlanMetadata({
      planCode: resolvedPlanCode,
      billingCycleDays: resolvedBillingCycleDays,
      billingPeriodMonths: resolvedBillingPeriodMonths || 0,
    }),
  };

  if (approvedOrderBenefits.betaMetadata) {
    nextMetadata.beta = approvedOrderBenefits.betaMetadata;
  }

  const existingTrialMetadata = isRecord(existingMetadata.trial)
    ? existingMetadata.trial
    : {};
  const nextTrialMetadata: Record<string, unknown> = {
    ...existingTrialMetadata,
  };

  if (resolvedPlanCode === "basic" || isTrialPaymentMethod(order.payment_method)) {
    nextTrialMetadata.basicUsedAt =
      existingTrialMetadata.basicUsedAt || activatedAt;
  }

  if (expirationResolution.bonusDaysApplied > 0) {
    nextTrialMetadata.firstPaidBonusGrantedAt =
      existingTrialMetadata.firstPaidBonusGrantedAt || activatedAt;
    nextTrialMetadata.firstPaidBonusDays =
      existingTrialMetadata.firstPaidBonusDays ||
      expirationResolution.bonusDaysApplied;
  }

  if (Object.keys(nextTrialMetadata).length > 0) {
    nextMetadata.trial = nextTrialMetadata;
  }

  const payload = {
    user_id: order.user_id,
    plan_code: resolvedPlanCode,
    plan_name: order.plan_name || plan.name,
    status: resolveActivePlanStateStatus(resolvedPlanCode, expiresAt),
    amount: parseNumeric(order.amount, plan.price),
    compare_amount: plan.comparePrice,
    currency: (order.currency || plan.currency || "BRL").trim() || "BRL",
    billing_cycle_days: resolvedBillingCycleDays,
    max_licensed_servers: Math.max(
      order.plan_max_licensed_servers || plan.entitlements.maxLicensedServers,
      1,
    ),
    max_active_tickets: Math.max(
      order.plan_max_active_tickets || plan.entitlements.maxActiveTickets,
      0,
    ),
    max_automations: Math.max(
      order.plan_max_automations || plan.entitlements.maxAutomations,
      0,
    ),
    max_monthly_actions: Math.max(
      order.plan_max_monthly_actions || plan.entitlements.maxMonthlyActions,
      0,
    ),
    last_payment_order_id: order.id,
    last_payment_guild_id: order.guild_id,
    activated_at: activatedAt,
    expires_at: expiresAt,
    metadata: nextMetadata,
  };

  const result = await supabase
    .from("auth_user_plan_state")
    .upsert(payload, {
      onConflict: "user_id",
    })
    .select(USER_PLAN_STATE_SELECT_COLUMNS)
    .single<UserPlanStateRecord>();

  if (result.error || !result.data) {
    throw new Error(result.error?.message || "Falha ao sincronizar plano da conta.");
  }

  await persistApprovedOrderBenefits({
    orderId: order.id,
    userId: order.user_id,
    guildId: order.guild_id,
    benefits: approvedOrderBenefits,
  });
  await persistApprovedOrderTransitionEffects({
    order,
    currency: payload.currency,
  });
  await finalizeDowngradeEnforcementAfterApprovedOrder({
    userId: order.user_id,
    paymentOrderId: order.id,
    paidPlanCode: resolvedPlanCode,
    paidMaxLicensedServers: payload.max_licensed_servers,
  });

  if (order.guild_id) {
    try {
      await licenseGuildForUser({
        userId: order.user_id,
        guildId: order.guild_id,
        maxLicensedServers: payload.max_licensed_servers,
        currentPlanCode: payload.plan_code,
        currentPlanState: result.data,
      });
    } catch {
      // O plano da conta ja foi sincronizado. Se o vinculo do servidor falhar aqui,
      // a interface ainda pode corrigir isso pelo fluxo de claim sem perder o pagamento.
    }
  }

  return result.data;
}
