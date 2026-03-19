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
        "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, is_active, created_at, updated_at",
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
    storedMethods,
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
  try {
    const url = new URL(request.url);
    const guildId = normalizeGuildId(url.searchParams.get("guildId"));
    if (!guildId) {
      return NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return access.response;

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

    return NextResponse.json({
      ok: true,
      guildId,
      plan: toPlanResponse({
        settings,
        recurringMethodId,
        recurringMethod,
        availableMethods: savedMethods,
        availableMethodsCount: savedMethods.length,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao carregar plano do servidor.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    let body: UpdatePlanBody = {};
    try {
      body = (await request.json()) as UpdatePlanBody;
    } catch {
      return NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const recurringEnabled = normalizeRecurringEnabled(body.recurringEnabled);
    const recurringMethodId = normalizeRecurringMethodId(body.recurringMethodId);

    if (!guildId) {
      return NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      );
    }

    if (recurringEnabled === null) {
      return NextResponse.json(
        { ok: false, message: "Flag de recorrencia invalida." },
        { status: 400 },
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return access.response;

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
          return NextResponse.json(
            { ok: false, message: "Metodo de pagamento nao encontrado para recorrencia." },
            { status: 400 },
          );
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
        return NextResponse.json(
          {
            ok: false,
            message:
              "Nenhum cartao salvo disponivel. Salve um cartao em Metodos para ativar recorrencia.",
          },
          { status: 400 },
        );
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

    return NextResponse.json({
      ok: true,
      guildId,
      plan: toPlanResponse({
        settings: upsertResult.data,
        recurringMethodId: resolvedRecurringMethodId,
        recurringMethod,
        availableMethods: savedMethods,
        availableMethodsCount: savedMethods.length,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao salvar plano do servidor.",
      },
      { status: 500 },
    );
  }
}
