import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { isValidSavedMethodId } from "@/lib/payments/savedMethods";
import {
  isStoredPaymentMethodReusableForRecurring,
  mergeSavedMethodsWithStored,
  toSavedMethodFromStoredRecord,
  type StoredPaymentMethodRecord,
} from "@/lib/payments/userPaymentMethods";
import {
  areCardPaymentsEnabled,
  CARD_RECURRING_DISABLED_MESSAGE,
} from "@/lib/payments/cardAvailability";
import { getLockedGuildLicenseByGuildId } from "@/lib/payments/licenseStatus";
import { ensureSameOriginJsonMutationRequest } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import {
  DEFAULT_PLAN_BILLING_PERIOD_CODE,
  DEFAULT_PLAN_CODE,
  getAllPlanPricingDefinitions,
  getAvailableBillingPeriodsForPlan,
  normalizePlanBillingPeriodCode,
  normalizePlanCode,
  resolvePlanDefinition,
  resolvePlanPricing,
} from "@/lib/plans/catalog";
import {
  getUserPlanFlowPointsBalance,
  getUserPlanScheduledChange,
  resolveFlowPointsBalanceAmount,
  resolvePlanChangePreview,
  type UserPlanScheduledChangeRecord,
} from "@/lib/plans/change";
import {
  applyUserPlanStatePricingAdjustments,
  getBasicPlanAvailability,
  getGuildPlanSettingsRecord,
  getUserPlanState,
  resolveEffectivePlanSelection,
  type BasicPlanAvailability,
  type GuildPlanSettingsRecord,
  type UserPlanStateRecord,
} from "@/lib/plans/state";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
import {
  flowSecureDto,
  FlowSecureDtoError,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type HiddenMethodRecord = {
  method_id: string;
};

type SavedMethodSummary = {
  id: string;
  brand: string | null;
  firstSix: string;
  lastFour: string;
  expMonth: number | null;
  expYear: number | null;
  lastUsedAt: string;
  nickname?: string | null;
};

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function toFiniteAmount(value: string | number) {
  const fallbackAmount = resolvePlanDefinition(DEFAULT_PLAN_CODE).price;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallbackAmount;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallbackAmount;
}

function normalizeRecurringMethodId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (!isValidSavedMethodId(value)) return null;
  if (typeof value !== "string") return null;
  return value.trim();
}

function normalizeRequestedPlanCode(value: unknown) {
  if (typeof value !== "string") return null;
  return normalizePlanCode(value, DEFAULT_PLAN_CODE);
}

function normalizeRequestedBillingPeriodCode(value: unknown) {
  if (typeof value !== "string") return null;
  return normalizePlanBillingPeriodCode(value, DEFAULT_PLAN_BILLING_PERIOD_CODE);
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

async function getAvailableSavedMethodsForUser(userId: number) {
  if (!areCardPaymentsEnabled()) {
    return [];
  }

  const supabase = getSupabaseAdminClientOrThrow();

  const [hiddenMethodsResult, storedMethodsResult] = await Promise.all([
    supabase
      .from("auth_user_hidden_payment_methods")
      .select("method_id")
      .eq("user_id", userId)
      .returns<HiddenMethodRecord[]>(),
    supabase
      .from("auth_user_payment_methods")
      .select(
        "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, is_active, verification_status, verification_status_detail, verification_amount, provider_customer_id, provider_card_id, verified_at, last_context_guild_id, created_at, updated_at",
      )
      .eq("user_id", userId)
      .eq("is_active", true)
      .returns<StoredPaymentMethodRecord[]>(),
  ]);

  if (hiddenMethodsResult.error) {
    throw new Error(`Erro ao carregar metodos ocultos: ${hiddenMethodsResult.error.message}`);
  }

  if (storedMethodsResult.error) {
    throw new Error(`Erro ao carregar metodos salvos: ${storedMethodsResult.error.message}`);
  }

  const hiddenMethodSet = new Set(
    (hiddenMethodsResult.data || []).map((item) => item.method_id),
  );

  const storedRows = (storedMethodsResult.data || []).filter(
    isStoredPaymentMethodReusableForRecurring,
  );
  const storedMethods = storedRows
    .map((row) => toSavedMethodFromStoredRecord(row))
    .filter((method): method is NonNullable<typeof method> => Boolean(method));

  return mergeSavedMethodsWithStored({
    derivedMethods: [],
    storedMethods,
    hiddenMethodSet,
  });
}

function toPlanResponse(input: {
  settings: GuildPlanSettingsRecord | null;
  userPlanState: UserPlanStateRecord | null;
  basicPlanAvailability: BasicPlanAvailability;
  flowPointsBalance: number;
  scheduledChange: UserPlanScheduledChangeRecord | null;
  requestedPlanCode?: string | null;
  requestedBillingPeriodCode?: string | null;
  recurringMethodId: string | null;
  recurringMethod: SavedMethodSummary | null;
  availableMethods: SavedMethodSummary[];
  availableMethodsCount: number;
}) {
  const settings = input.settings;
  const userPlanState = input.userPlanState;
  const cardPaymentsEnabled = areCardPaymentsEnabled();
  const currentPlanExpiresAtMs =
    userPlanState?.expires_at ? Date.parse(userPlanState.expires_at) : Number.NaN;
  const hasActiveAccountPlan =
    !!userPlanState &&
    (userPlanState.status === "active" || userPlanState.status === "trial") &&
    (!Number.isFinite(currentPlanExpiresAtMs) || Date.now() <= currentPlanExpiresAtMs);
  const canKeepCurrentBasicPlan =
    hasActiveAccountPlan && userPlanState?.plan_code === "basic";
  const selectedPlanCode =
    [
      input.requestedPlanCode || null,
      userPlanState?.plan_code || null,
      DEFAULT_PLAN_CODE,
    ].find(
      (planCode) =>
        planCode &&
        planCode !== "basic"
          ? true
          : input.basicPlanAvailability.isAvailable || canKeepCurrentBasicPlan,
    ) || DEFAULT_PLAN_CODE;
  const resolvedPlan = applyUserPlanStatePricingAdjustments(
    resolvePlanPricing(
      selectedPlanCode,
      input.requestedBillingPeriodCode || DEFAULT_PLAN_BILLING_PERIOD_CODE,
    ),
    userPlanState,
  );
  const availablePlans = getAllPlanPricingDefinitions(
    input.requestedBillingPeriodCode || DEFAULT_PLAN_BILLING_PERIOD_CODE,
  ).map((plan) => applyUserPlanStatePricingAdjustments(plan, userPlanState));
  const shouldReuseStoredPlanSettings = Boolean(
    settings && settings.plan_code === resolvedPlan.code,
  );
  const selectedPlanChange = resolvePlanChangePreview({
    userPlanState,
    targetPlan: resolvedPlan,
    flowPointsBalance: input.flowPointsBalance,
    scheduledChange: input.scheduledChange,
  });
  const isActiveBasicPlan =
    resolvedPlan.code === "basic" &&
    !!userPlanState &&
    userPlanState.plan_code === "basic" &&
    hasActiveAccountPlan;
  const isCurrentPlanRepurchaseBlocked =
    selectedPlanChange.isCurrentSelectionBlocked && !resolvedPlan.isTrial;
  const isResolvedPlanAvailable =
    !isCurrentPlanRepurchaseBlocked &&
    (resolvedPlan.code !== "basic" ||
      input.basicPlanAvailability.isAvailable ||
      isActiveBasicPlan);
  const resolvedPlanUnavailableReason = isCurrentPlanRepurchaseBlocked
    ? "Seu plano atual ja esta ativo nesta conta. Escolha outro plano para mudar agora."
    : isResolvedPlanAvailable
      ? null
      : input.basicPlanAvailability.unavailableMessage;

  const checkoutAmount = Math.max(
    0,
    Math.round(
      (selectedPlanChange.execution === "pay_now"
        ? selectedPlanChange.immediateSubtotalAmount
        : 0) * 100,
    ) / 100,
  );

  return {
    planCode: resolvedPlan.code,
    planName: resolvedPlan.name,
    billingPeriodCode: resolvedPlan.billingPeriodCode,
    billingPeriodLabel: resolvedPlan.billingPeriodLabel,
    billingPeriodMonths: resolvedPlan.billingPeriodMonths,
    monthlyAmount: resolvedPlan.monthlyAmount,
    compareMonthlyAmount: resolvedPlan.compareMonthlyAmount,
    baseTotalAmount: resolvedPlan.baseTotalAmount,
    totalAmount: resolvedPlan.totalAmount,
    compareTotalAmount: resolvedPlan.compareTotalAmount,
    checkoutAmount,
    checkoutMode: selectedPlanChange.kind,
    checkoutExecution: selectedPlanChange.execution,
    planChange: {
      kind: selectedPlanChange.kind,
      execution: selectedPlanChange.execution,
      currentPlanCode: selectedPlanChange.currentPlanCode,
      currentBillingCycleDays: selectedPlanChange.currentBillingCycleDays,
      currentExpiresAt: selectedPlanChange.currentExpiresAt,
      currentStatus: selectedPlanChange.currentStatus,
      currentCycleAmount: selectedPlanChange.currentCycleAmount,
      currentConsumedAmount: selectedPlanChange.currentConsumedAmount,
      currentCreditAmount: selectedPlanChange.currentCreditAmount,
      currentCycleTotalDaysExact: selectedPlanChange.currentCycleTotalDaysExact,
      currentCycleUsedDaysExact: selectedPlanChange.currentCycleUsedDaysExact,
      remainingDaysExact: selectedPlanChange.remainingDaysExact,
      creditAppliedToTargetAmount: selectedPlanChange.creditAppliedToTargetAmount,
      surplusCreditAmount: selectedPlanChange.surplusCreditAmount,
      immediateSubtotalAmount: selectedPlanChange.immediateSubtotalAmount,
      payableBeforeDiscountsAmount: selectedPlanChange.immediateSubtotalAmount,
      targetTotalAmount: selectedPlanChange.targetTotalAmount,
      flowPointsBalance: selectedPlanChange.flowPointsBalance,
      flowPointsGrantPreview: selectedPlanChange.flowPointsGrantPreview,
      effectiveAt: selectedPlanChange.effectiveAt,
      scheduledChangeMatchesTarget: selectedPlanChange.scheduledChangeMatchesTarget,
    },
    scheduledChange: input.scheduledChange
      ? {
          id: input.scheduledChange.id,
          guildId: input.scheduledChange.guild_id,
          currentPlanCode: input.scheduledChange.current_plan_code,
          currentBillingCycleDays: input.scheduledChange.current_billing_cycle_days,
          targetPlanCode: input.scheduledChange.target_plan_code,
          targetBillingPeriodCode: input.scheduledChange.target_billing_period_code,
          targetBillingCycleDays: input.scheduledChange.target_billing_cycle_days,
          status: input.scheduledChange.status,
          effectiveAt: input.scheduledChange.effective_at,
        }
      : null,
    currency: shouldReuseStoredPlanSettings
      ? settings?.currency || resolvedPlan.currency
      : resolvedPlan.currency,
    billingCycleDays: resolvedPlan.billingCycleDays,
    billingLabel: resolvedPlan.billingLabel,
    totalLabel: resolvedPlan.totalLabel,
    checkoutPeriodLabel: resolvedPlan.checkoutPeriodLabel,
    renewalLabel: resolvedPlan.renewalLabel,
    cycleDiscountPercent: resolvedPlan.cycleDiscountPercent,
    cycleBadge: resolvedPlan.cycleBadge,
    isTrial: resolvedPlan.isTrial,
    isAvailable: isResolvedPlanAvailable,
    unavailableReason: resolvedPlanUnavailableReason,
    entitlements: {
      ...resolvedPlan.entitlements,
    },
    description: resolvedPlan.description,
    features: resolvedPlan.features,
    recurringEnabled:
      cardPaymentsEnabled && shouldReuseStoredPlanSettings
        ? settings?.recurring_enabled || false
        : false,
    recurringMethodId:
      cardPaymentsEnabled && shouldReuseStoredPlanSettings
        ? input.recurringMethodId
        : null,
    recurringMethod:
      cardPaymentsEnabled &&
      shouldReuseStoredPlanSettings &&
      input.recurringMethod
      ? {
          id: input.recurringMethod.id,
          brand: input.recurringMethod.brand,
          firstSix: input.recurringMethod.firstSix,
          lastFour: input.recurringMethod.lastFour,
          expMonth: input.recurringMethod.expMonth,
          expYear: input.recurringMethod.expYear,
          lastUsedAt: input.recurringMethod.lastUsedAt,
        }
      : null,
    availableMethods: (cardPaymentsEnabled ? input.availableMethods : []).map((method) => ({
      id: method.id,
      brand: method.brand,
      firstSix: method.firstSix,
      lastFour: method.lastFour,
      expMonth: method.expMonth,
      expYear: method.expYear,
      lastUsedAt: method.lastUsedAt,
      nickname: method.nickname || null,
    })),
    availableMethodsCount: cardPaymentsEnabled ? input.availableMethodsCount : 0,
    availablePlans: availablePlans.map((plan) => ({
      code: plan.code,
      name: plan.name,
      badge: plan.badge,
      description: plan.description,
      billingPeriodCode: plan.billingPeriodCode,
      billingPeriodLabel: plan.billingPeriodLabel,
      billingPeriodMonths: plan.billingPeriodMonths,
      monthlyAmount: plan.monthlyAmount,
      compareMonthlyAmount: plan.compareMonthlyAmount,
      baseTotalAmount: plan.baseTotalAmount,
      totalAmount: plan.totalAmount,
      compareTotalAmount: plan.compareTotalAmount,
      currency: plan.currency,
      billingCycleDays: plan.billingCycleDays,
      billingLabel: plan.billingLabel,
      totalLabel: plan.totalLabel,
      checkoutPeriodLabel: plan.checkoutPeriodLabel,
      renewalLabel: plan.renewalLabel,
      cycleDiscountPercent: plan.cycleDiscountPercent,
      cycleBadge: plan.cycleBadge,
      isTrial: plan.isTrial,
      isAvailable: (() => {
        const planChange = resolvePlanChangePreview({
          userPlanState,
          targetPlan: plan,
          flowPointsBalance: input.flowPointsBalance,
          scheduledChange: input.scheduledChange,
        });
        const basicAvailable =
          plan.code !== "basic" ||
          input.basicPlanAvailability.isAvailable ||
          (hasActiveAccountPlan &&
            userPlanState?.plan_code === "basic" &&
            plan.code === "basic");
        return basicAvailable && !planChange.isCurrentSelectionBlocked;
      })(),
      unavailableReason: (() => {
        const planChange = resolvePlanChangePreview({
          userPlanState,
          targetPlan: plan,
          flowPointsBalance: input.flowPointsBalance,
          scheduledChange: input.scheduledChange,
        });
        if (planChange.isCurrentSelectionBlocked && !plan.isTrial) {
          return "Seu plano atual ja esta ativo nesta conta. Escolha outro plano para mudar agora.";
        }

        if (
          plan.code === "basic" &&
          !input.basicPlanAvailability.isAvailable &&
          !(hasActiveAccountPlan && userPlanState?.plan_code === "basic")
        ) {
          return input.basicPlanAvailability.unavailableMessage;
        }

        return null;
      })(),
      entitlements: {
        ...plan.entitlements,
      },
      features: plan.features,
    })),
    availableBillingPeriods: getAvailableBillingPeriodsForPlan(resolvedPlan.code).map(
      (period) => ({
        code: period.code,
        slug: period.slug,
        label: period.label,
        durationLabel: period.durationLabel,
        months: period.months,
        billingCycleDays: period.billingCycleDays,
        extraDiscountPercent: period.extraDiscountPercent,
      }),
    ),
    accountPlan: userPlanState
      ? {
          planCode: userPlanState.plan_code,
          planName: userPlanState.plan_name,
          status: userPlanState.status,
          amount: toFiniteAmount(userPlanState.amount),
          currency: userPlanState.currency,
          billingCycleDays: userPlanState.billing_cycle_days,
          maxLicensedServers: userPlanState.max_licensed_servers,
          maxActiveTickets: userPlanState.max_active_tickets,
          maxAutomations: userPlanState.max_automations,
          maxMonthlyActions: userPlanState.max_monthly_actions,
          activatedAt: userPlanState.activated_at,
          expiresAt: userPlanState.expires_at,
          lastPaymentGuildId: userPlanState.last_payment_guild_id,
        }
      : null,
    createdAt: shouldReuseStoredPlanSettings ? settings?.created_at || null : null,
    updatedAt: shouldReuseStoredPlanSettings ? settings?.updated_at || null : null,
  };
}

export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  try {
    const url = new URL(request.url);
    let query: {
      guildId?: string | null;
      planCode?: string | null;
      billingPeriodCode?: string | null;
      includePaymentMethods?: boolean;
    };
    try {
      query = parseFlowSecureDto(
        {
          guildId: url.searchParams.get("guildId") ?? undefined,
          planCode: url.searchParams.get("planCode") ?? undefined,
          billingPeriodCode:
            url.searchParams.get("billingPeriodCode") ?? undefined,
          includePaymentMethods:
            url.searchParams.get("includePaymentMethods") ?? undefined,
        },
        {
          guildId: flowSecureDto.optional(
            flowSecureDto.nullable(flowSecureDto.discordSnowflake()),
          ),
          planCode: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.string({
                maxLength: 32,
                pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/,
              }),
            ),
          ),
          billingPeriodCode: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.string({
                maxLength: 32,
                pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/,
              }),
            ),
          ),
          includePaymentMethods: flowSecureDto.optional(
            flowSecureDto.looseBoolean(),
          ),
        },
        {
          rejectUnknown: true,
        },
      );
    } catch (error) {
      return attachRequestId(
        NextResponse.json(
          {
            ok: false,
            message:
              error instanceof FlowSecureDtoError
                ? error.issues[0] || error.message
                : "Parametros invalidos.",
          },
          { status: 400 },
        ),
        requestContext.requestId,
      );
    }
    const guildId = normalizeGuildId(query.guildId);
    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return attachRequestId(access.response, requestContext.requestId);

    const userId = access.context.sessionData.authSession.user.id;
    const requestedPlanCode = normalizeRequestedPlanCode(query.planCode);
    const requestedBillingPeriodCode = normalizeRequestedBillingPeriodCode(
      query.billingPeriodCode,
    );
    const includePaymentMethods = query.includePaymentMethods ?? true;
    const [selection, savedMethods] = await Promise.all([
      guildId
        ? resolveEffectivePlanSelection({
            userId,
            guildId,
            preferredPlanCode: requestedPlanCode,
            preferredBillingPeriodCode: requestedBillingPeriodCode,
          })
        : Promise.all([
            getUserPlanState(userId),
            getBasicPlanAvailability(userId),
            getUserPlanFlowPointsBalance(userId),
            getUserPlanScheduledChange(userId),
          ]).then(
            ([
              userPlanState,
              basicPlanAvailability,
              flowPointsBalanceRecord,
              scheduledChange,
            ]) => ({
              plan: null,
              guildSettings: null,
              userPlanState,
              basicPlanAvailability,
              flowPointsBalance: resolveFlowPointsBalanceAmount(
                flowPointsBalanceRecord,
              ),
              scheduledChange,
            }),
          ),
      includePaymentMethods
        ? getAvailableSavedMethodsForUser(userId)
        : Promise.resolve([] as SavedMethodSummary[]),
    ]);
    const settings = selection.guildSettings || null;
    const userPlanState = selection.userPlanState || null;
    const basicPlanAvailability = selection.basicPlanAvailability;

    const recurringMethodId = settings?.recurring_method_id || null;
    const recurringMethod =
      recurringMethodId
        ? savedMethods.find((method) => method.id === recurringMethodId) || null
        : null;

    return attachRequestId(NextResponse.json({
      ok: true,
      guildId: guildId || null,
      plan: toPlanResponse({
        settings,
        userPlanState,
        basicPlanAvailability,
        flowPointsBalance: selection.flowPointsBalance,
        scheduledChange: selection.scheduledChange,
        requestedPlanCode,
        requestedBillingPeriodCode,
        recurringMethodId,
        recurringMethod,
        availableMethods: savedMethods,
        availableMethodsCount: savedMethods.length,
      }),
    }), requestContext.requestId);
  } catch (error) {
    const messageFallback =
      new URL(request.url).searchParams.get("guildId")
        ? "Erro ao carregar plano do servidor."
        : "Erro ao carregar plano da conta.";
    return attachRequestId(NextResponse.json(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          messageFallback,
        ),
      },
      { status: 500 },
    ), requestContext.requestId);
  }
}

export async function POST(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  let auditContext = baseRequestContext;

  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) return attachRequestId(securityResponse, baseRequestContext.requestId);

    let payload: {
      guildId: string;
      planCode?: string | null;
      recurringEnabled: boolean;
      recurringMethodId?: string | null;
    };
    try {
      payload = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.discordSnowflake(),
          planCode: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.string({
                maxLength: 32,
                pattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/,
              }),
            ),
          ),
          recurringEnabled: flowSecureDto.looseBoolean(),
          recurringMethodId: flowSecureDto.optional(
            flowSecureDto.nullable(
              flowSecureDto.string({
                maxLength: 120,
                pattern: /^[A-Za-z0-9:_-]+$/,
              }),
            ),
          ),
        },
        {
          rejectUnknown: true,
        },
      );
    } catch (error) {
      return attachRequestId(NextResponse.json(
        {
          ok: false,
          message:
            error instanceof FlowSecureDtoError
              ? error.issues[0] || error.message
              : "Payload JSON invalido.",
        },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    const guildId = payload.guildId;
    const requestedPlanCode = normalizeRequestedPlanCode(payload.planCode);
    const recurringEnabled = payload.recurringEnabled;
    const recurringMethodId = normalizeRecurringMethodId(payload.recurringMethodId);

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return attachRequestId(access.response, baseRequestContext.requestId);

    auditContext = extendSecurityRequestContext(baseRequestContext, {
      sessionId: access.context.sessionData.authSession.id,
      userId: access.context.sessionData.authSession.user.id,
      guildId,
    });

    const lockedGuildLicense = await getLockedGuildLicenseByGuildId(guildId);
    if (
      lockedGuildLicense &&
      lockedGuildLicense.userId !== access.context.sessionData.authSession.user.id
    ) {
      return attachRequestId(
        NextResponse.json(
          {
            ok: false,
            message:
              "As funcoes financeiras desta area ficam disponiveis apenas para a conta responsavel pelo plano vinculado.",
          },
          { status: 403 },
        ),
        baseRequestContext.requestId,
      );
    }

    const rateLimit = await enforceRequestRateLimit({
      action: "server_plan_post",
      windowMs: 10 * 60 * 1000,
      maxAttempts: 18,
      context: auditContext,
    });
    if (!rateLimit.ok) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "server_plan_post",
        outcome: "blocked",
        metadata: {
          reason: "rate_limit",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
      });
      const response = NextResponse.json(
        {
          ok: false,
          message:
            "Muitas alteracoes de plano em pouco tempo. Aguarde alguns instantes e tente novamente.",
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return attachRequestId(response, baseRequestContext.requestId);
    }

    await logSecurityAuditEventSafe(auditContext, {
      action: "server_plan_post",
      outcome: "started",
      metadata: {
        recurringEnabled,
        recurringMethodId,
      },
    });

    if (recurringEnabled && !areCardPaymentsEnabled()) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "server_plan_post",
        outcome: "blocked",
        metadata: {
          reason: "card_recurring_disabled",
        },
      });

      return attachRequestId(
        NextResponse.json(
          {
            ok: false,
            message: CARD_RECURRING_DISABLED_MESSAGE,
          },
          { status: 503 },
        ),
        baseRequestContext.requestId,
      );
    }

    const userId = access.context.sessionData.authSession.user.id;
    const supabase = getSupabaseAdminClientOrThrow();
    const [existingSettings, savedMethods, userPlanState, basicPlanAvailability] = await Promise.all([
      getGuildPlanSettingsRecord(userId, guildId),
      getAvailableSavedMethodsForUser(userId),
      getUserPlanState(userId),
      getBasicPlanAvailability(userId),
    ]);
    const selection = await resolveEffectivePlanSelection({
      userId,
      guildId,
      preferredPlanCode: requestedPlanCode,
    });

    const savedMethodMap = new Map(savedMethods.map((method) => [method.id, method]));

    const requestedOrStoredPlanCode =
      requestedPlanCode ||
      existingSettings?.plan_code ||
      userPlanState?.plan_code ||
      DEFAULT_PLAN_CODE;
    const resolvedPlan = resolvePlanDefinition(
      requestedOrStoredPlanCode === "basic" && !basicPlanAvailability.isAvailable
        ? DEFAULT_PLAN_CODE
        : requestedOrStoredPlanCode,
    );

    let resolvedRecurringMethodId: string | null =
      existingSettings?.recurring_method_id || null;

    if (recurringEnabled) {
      if (recurringMethodId) {
        if (!savedMethodMap.has(recurringMethodId)) {
          return attachRequestId(NextResponse.json(
            { ok: false, message: "Metodo de pagamento nao encontrado para recorrencia." },
            { status: 400 },
          ), baseRequestContext.requestId);
        }
        resolvedRecurringMethodId = recurringMethodId;
      } else if (
        resolvedRecurringMethodId &&
        savedMethodMap.has(resolvedRecurringMethodId)
      ) {
        // manter metodo atual
      } else {
        resolvedRecurringMethodId = savedMethods[0]?.id || null;
      }

      if (!resolvedRecurringMethodId) {
        return attachRequestId(NextResponse.json(
          {
            ok: false,
            message:
              "Nenhum cartao salvo disponivel. Salve um cartao em Metodos para ativar recorrencia.",
          },
          { status: 400 },
        ), baseRequestContext.requestId);
      }
    } else {
      resolvedRecurringMethodId = null;
    }

    const upsertResult = await supabase
      .from("guild_plan_settings")
      .upsert(
        {
          user_id: userId,
          guild_id: guildId,
          plan_code: resolvedPlan.code,
          monthly_amount: resolvedPlan.price,
          currency: resolvedPlan.currency,
          recurring_enabled: recurringEnabled,
          recurring_method_id: resolvedRecurringMethodId,
        },
        {
          onConflict: "user_id,guild_id",
        },
      )
      .select("plan_code, monthly_amount, currency, recurring_enabled, recurring_method_id, created_at, updated_at")
      .single<GuildPlanSettingsRecord>();

    if (upsertResult.error || !upsertResult.data) {
      throw new Error(upsertResult.error?.message || "Falha ao salvar plano.");
    }

    const recurringMethod =
      resolvedRecurringMethodId
        ? savedMethodMap.get(resolvedRecurringMethodId) || null
        : null;

    await logSecurityAuditEventSafe(auditContext, {
      action: "server_plan_post",
      outcome: "succeeded",
      metadata: {
        recurringEnabled,
        resolvedRecurringMethodId,
      },
    });

    return attachRequestId(NextResponse.json({
      ok: true,
      guildId,
      plan: toPlanResponse({
        settings: upsertResult.data,
        userPlanState,
        basicPlanAvailability,
        flowPointsBalance: selection.flowPointsBalance,
        scheduledChange: selection.scheduledChange,
        requestedPlanCode: upsertResult.data.plan_code,
        recurringMethodId: resolvedRecurringMethodId,
        recurringMethod,
        availableMethods: savedMethods,
        availableMethodsCount: savedMethods.length,
      }),
    }), baseRequestContext.requestId);
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "server_plan_post",
      outcome: "failed",
      metadata: {
        message: extractAuditErrorMessage(error),
      },
    });

    return attachRequestId(NextResponse.json(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao salvar plano do servidor.",
        ),
      },
      { status: 500 },
    ), baseRequestContext.requestId);
  }
}

