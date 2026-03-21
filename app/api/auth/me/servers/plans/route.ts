import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { buildSavedMethods, isValidSavedMethodId } from "@/lib/payments/savedMethods";
import {
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
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type GuildPlanSettingsRecord = {
  plan_code: string;
  monthly_amount: string | number;
  currency: string;
  recurring_enabled: boolean;
  recurring_method_id: string | null;
  created_at: string;
  updated_at: string;
};

type HiddenMethodRecord = {
  method_id: string;
};

type PaymentOrderForMethod = {
  payment_method: "pix" | "card";
  provider_payload: unknown;
  created_at: string;
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

type UpdatePlanBody = {
  guildId?: unknown;
  recurringEnabled?: unknown;
  recurringMethodId?: unknown;
};

const DEFAULT_PLAN_CODE = "pro";
const DEFAULT_MONTHLY_AMOUNT = 9.99;
const DEFAULT_CURRENCY = "BRL";

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function toFiniteAmount(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : DEFAULT_MONTHLY_AMOUNT;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MONTHLY_AMOUNT;
}

function normalizeRecurringEnabled(value: unknown) {
  if (typeof value !== "boolean") return null;
  return value;
}

function normalizeRecurringMethodId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (!isValidSavedMethodId(value)) return null;
  if (typeof value !== "string") return null;
  return value.trim();
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

  if (!accessibleGuild && sessionData.authSession.activeGuildId !== guildId) {
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
  const supabase = getSupabaseAdminClientOrThrow();

  const [ordersResult, hiddenMethodsResult, storedMethodsResult] = await Promise.all([
    supabase
      .from("payment_orders")
      .select("payment_method, provider_payload, created_at")
      .eq("user_id", userId)
      .eq("payment_method", "card")
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<PaymentOrderForMethod[]>(),
    supabase
      .from("auth_user_hidden_payment_methods")
      .select("method_id")
      .eq("user_id", userId)
      .returns<HiddenMethodRecord[]>(),
    supabase
      .from("auth_user_payment_methods")
      .select(
        "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, is_active, verification_status, verification_status_detail, verification_amount, verified_at, last_context_guild_id, created_at, updated_at",
      )
      .eq("user_id", userId)
      .eq("is_active", true)
      .returns<StoredPaymentMethodRecord[]>(),
  ]);

  if (ordersResult.error) {
    throw new Error(`Erro ao carregar metodos de pagamento: ${ordersResult.error.message}`);
  }

  if (hiddenMethodsResult.error) {
    throw new Error(`Erro ao carregar metodos ocultos: ${hiddenMethodsResult.error.message}`);
  }

  if (storedMethodsResult.error) {
    throw new Error(`Erro ao carregar metodos salvos: ${storedMethodsResult.error.message}`);
  }

  const hiddenMethodSet = new Set(
    (hiddenMethodsResult.data || []).map((item) => item.method_id),
  );

  const derivedMethods = buildSavedMethods(ordersResult.data || []);
  const storedMethods = (storedMethodsResult.data || [])
    .map((row) => toSavedMethodFromStoredRecord(row))
    .filter((method): method is NonNullable<typeof method> => Boolean(method));

  return mergeSavedMethodsWithStored({
    derivedMethods,
    storedMethods: storedMethods.filter(
      (method) => method.verificationStatus === "verified",
    ),
    hiddenMethodSet,
  });
}

async function getGuildPlanSettings(userId: number, guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_plan_settings")
    .select("plan_code, monthly_amount, currency, recurring_enabled, recurring_method_id, created_at, updated_at")
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .maybeSingle<GuildPlanSettingsRecord>();

  if (result.error) {
    throw new Error(`Erro ao carregar plano do servidor: ${result.error.message}`);
  }

  return result.data || null;
}

function toPlanResponse(input: {
  settings: GuildPlanSettingsRecord | null;
  recurringMethodId: string | null;
  recurringMethod: SavedMethodSummary | null;
  availableMethods: SavedMethodSummary[];
  availableMethodsCount: number;
}) {
  const settings = input.settings;
  return {
    planCode: settings?.plan_code || DEFAULT_PLAN_CODE,
    monthlyAmount: settings ? toFiniteAmount(settings.monthly_amount) : DEFAULT_MONTHLY_AMOUNT,
    currency: settings?.currency || DEFAULT_CURRENCY,
    recurringEnabled: settings?.recurring_enabled || false,
    recurringMethodId: input.recurringMethodId,
    recurringMethod: input.recurringMethod
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
    availableMethods: input.availableMethods.map((method) => ({
      id: method.id,
      brand: method.brand,
      firstSix: method.firstSix,
      lastFour: method.lastFour,
      expMonth: method.expMonth,
      expYear: method.expYear,
      lastUsedAt: method.lastUsedAt,
      nickname: method.nickname || null,
    })),
    availableMethodsCount: input.availableMethodsCount,
    createdAt: settings?.created_at || null,
    updatedAt: settings?.updated_at || null,
  };
}

export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  try {
    const url = new URL(request.url);
    const guildId = normalizeGuildId(url.searchParams.get("guildId"));
    if (!guildId) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      ), requestContext.requestId);
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return attachRequestId(access.response, requestContext.requestId);

    const userId = access.context.sessionData.authSession.user.id;
    const [settings, savedMethods] = await Promise.all([
      getGuildPlanSettings(userId, guildId),
      getAvailableSavedMethodsForUser(userId),
    ]);

    const recurringMethodId = settings?.recurring_method_id || null;
    const recurringMethod =
      recurringMethodId
        ? savedMethods.find((method) => method.id === recurringMethodId) || null
        : null;

    return attachRequestId(NextResponse.json({
      ok: true,
      guildId,
      plan: toPlanResponse({
        settings,
        recurringMethodId,
        recurringMethod,
        availableMethods: savedMethods,
        availableMethodsCount: savedMethods.length,
      }),
    }), requestContext.requestId);
  } catch (error) {
    return attachRequestId(NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao carregar plano do servidor.",
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

    let body: UpdatePlanBody = {};
    try {
      body = (await request.json()) as UpdatePlanBody;
    } catch {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    const guildId = normalizeGuildId(body.guildId);
    const recurringEnabled = normalizeRecurringEnabled(body.recurringEnabled);
    const recurringMethodId = normalizeRecurringMethodId(body.recurringMethodId);

    if (!guildId) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

    if (recurringEnabled === null) {
      return attachRequestId(NextResponse.json(
        { ok: false, message: "Flag de recorrencia invalida." },
        { status: 400 },
      ), baseRequestContext.requestId);
    }

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
              "As funcoes financeiras deste servidor ficam disponiveis apenas para a conta responsavel pela licenca ativa.",
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
    const [existingSettings, savedMethods] = await Promise.all([
      getGuildPlanSettings(userId, guildId),
      getAvailableSavedMethodsForUser(userId),
    ]);

    const savedMethodMap = new Map(savedMethods.map((method) => [method.id, method]));

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
          plan_code: DEFAULT_PLAN_CODE,
          monthly_amount: DEFAULT_MONTHLY_AMOUNT,
          currency: DEFAULT_CURRENCY,
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
        message: error instanceof Error ? error.message : "unknown_error",
      },
    });

    return attachRequestId(NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao salvar plano do servidor.",
      },
      { status: 500 },
    ), baseRequestContext.requestId);
  }
}
