import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { isValidSavedMethodId, parseSavedMethodId } from "@/lib/payments/savedMethods";
import {
  buildMethodIdFromStoredInput,
  normalizePaymentMethodNickname,
  normalizeStoredMethodShape,
} from "@/lib/payments/userPaymentMethods";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type DeleteMethodBody = {
  guildId?: unknown;
  methodId?: unknown;
};

type AddMethodBody = {
  guildId?: unknown;
  nickname?: unknown;
  brand?: unknown;
  firstSix?: unknown;
  lastFour?: unknown;
  expMonth?: unknown;
  expYear?: unknown;
};

type UpdateMethodBody = {
  guildId?: unknown;
  methodId?: unknown;
  nickname?: unknown;
};

type GuildPlanSettingsRecord = {
  recurring_enabled: boolean;
  recurring_method_id: string | null;
};

type StoredPaymentMethodRecord = {
  method_id: string;
  nickname: string | null;
  brand: string | null;
  first_six: string;
  last_four: string;
  exp_month: number | null;
  exp_year: number | null;
  updated_at: string;
};

type AccessContext =
  | {
      ok: true;
      context: {
        userId: number;
      };
    }
  | {
      ok: false;
      response: NextResponse;
    };

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const guildId = value.trim();
  return isGuildId(guildId) ? guildId : null;
}

function normalizeMethodId(value: unknown) {
  if (!isValidSavedMethodId(value)) return null;
  if (typeof value !== "string") return null;
  return value.trim();
}

function normalizeStringDigits(value: unknown, length: number) {
  if (typeof value !== "string") return null;
  const digits = value.trim();
  if (!new RegExp(`^\\d{${length}}$`).test(digits)) return null;
  return digits;
}

function normalizeNullableInteger(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return null;
  return numeric;
}

function toApiMethod(method: StoredPaymentMethodRecord) {
  return {
    id: method.method_id,
    brand: method.brand,
    firstSix: method.first_six,
    lastFour: method.last_four,
    expMonth: method.exp_month,
    expYear: method.exp_year,
    lastUsedAt: method.updated_at,
    timesUsed: 0,
    nickname: method.nickname || null,
  };
}

async function ensureGuildAccess(guildId: string): Promise<AccessContext> {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    };
  }

  if (!sessionData.accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      ),
    };
  }

  if (sessionData.authSession.activeGuildId === guildId) {
    return {
      ok: true,
      context: {
        userId: sessionData.authSession.user.id,
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
      ok: false,
      response: NextResponse.json(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    context: {
      userId: sessionData.authSession.user.id,
    },
  };
}

export async function POST(request: Request) {
  try {
    let body: AddMethodBody = {};
    try {
      body = (await request.json()) as AddMethodBody;
    } catch {
      return NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    if (!guildId) {
      return NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return access.response;

    const nickname = normalizePaymentMethodNickname(body.nickname);
    const normalized = normalizeStoredMethodShape({
      brand: typeof body.brand === "string" ? body.brand : null,
      firstSix: normalizeStringDigits(body.firstSix, 6),
      lastFour: normalizeStringDigits(body.lastFour, 4),
      expMonth: normalizeNullableInteger(body.expMonth),
      expYear: normalizeNullableInteger(body.expYear),
    });

    if (!normalized.firstSix || !normalized.lastFour) {
      return NextResponse.json(
        { ok: false, message: "Dados do cartao invalidos para salvar metodo." },
        { status: 400 },
      );
    }

    const methodId = buildMethodIdFromStoredInput(normalized);
    if (!methodId || !isValidSavedMethodId(methodId)) {
      return NextResponse.json(
        { ok: false, message: "Metodo de pagamento invalido." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const upsertResult = await supabase
      .from("auth_user_payment_methods")
      .upsert(
        {
          user_id: access.context.userId,
          method_id: methodId,
          nickname: nickname || null,
          brand: normalized.brand,
          first_six: normalized.firstSix,
          last_four: normalized.lastFour,
          exp_month: normalized.expMonth,
          exp_year: normalized.expYear,
          is_active: true,
        },
        {
          onConflict: "user_id,method_id",
        },
      )
      .select(
        "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, updated_at",
      )
      .single<StoredPaymentMethodRecord>();

    if (upsertResult.error || !upsertResult.data) {
      throw new Error(upsertResult.error?.message || "Falha ao salvar metodo.");
    }

    await supabase
      .from("auth_user_hidden_payment_methods")
      .delete()
      .eq("user_id", access.context.userId)
      .eq("method_id", methodId);

    return NextResponse.json({
      ok: true,
      guildId,
      method: toApiMethod(upsertResult.data),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao adicionar metodo de pagamento.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    let body: UpdateMethodBody = {};
    try {
      body = (await request.json()) as UpdateMethodBody;
    } catch {
      return NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const methodId = normalizeMethodId(body.methodId);
    if (!guildId) {
      return NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      );
    }
    if (!methodId) {
      return NextResponse.json(
        { ok: false, message: "Metodo de pagamento invalido." },
        { status: 400 },
      );
    }

    if (body.nickname !== undefined) {
      const isValidNickname =
        normalizePaymentMethodNickname(body.nickname) !== null ||
        body.nickname === "" ||
        body.nickname === null;
      if (!isValidNickname) {
        return NextResponse.json(
          { ok: false, message: "Apelido do cartao invalido." },
          { status: 400 },
        );
      }
    }

    const nickname = normalizePaymentMethodNickname(body.nickname);
    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return access.response;

    const parsed = parseSavedMethodId(methodId);
    if (!parsed || !parsed.firstSix || !parsed.lastFour) {
      return NextResponse.json(
        { ok: false, message: "Metodo de pagamento invalido para apelido." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const upsertResult = await supabase
      .from("auth_user_payment_methods")
      .upsert(
        {
          user_id: access.context.userId,
          method_id: methodId,
          nickname: nickname || null,
          brand: parsed.brand,
          first_six: parsed.firstSix,
          last_four: parsed.lastFour,
          exp_month: parsed.expMonth,
          exp_year: parsed.expYear,
          is_active: true,
        },
        {
          onConflict: "user_id,method_id",
        },
      )
      .select(
        "method_id, nickname, brand, first_six, last_four, exp_month, exp_year, updated_at",
      )
      .single<StoredPaymentMethodRecord>();

    if (upsertResult.error || !upsertResult.data) {
      throw new Error(upsertResult.error?.message || "Falha ao salvar apelido.");
    }

    await supabase
      .from("auth_user_hidden_payment_methods")
      .delete()
      .eq("user_id", access.context.userId)
      .eq("method_id", methodId);

    return NextResponse.json({
      ok: true,
      guildId,
      method: toApiMethod(upsertResult.data),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao atualizar apelido do metodo.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    let body: DeleteMethodBody = {};
    try {
      body = (await request.json()) as DeleteMethodBody;
    } catch {
      return NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(body.guildId);
    const methodId = normalizeMethodId(body.methodId);

    if (!guildId) {
      return NextResponse.json(
        { ok: false, message: "Guild ID invalido." },
        { status: 400 },
      );
    }

    if (!methodId) {
      return NextResponse.json(
        { ok: false, message: "Metodo de pagamento invalido." },
        { status: 400 },
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) return access.response;

    const userId = access.context.userId;
    const supabase = getSupabaseAdminClientOrThrow();

    const planSettingsResult = await supabase
      .from("guild_plan_settings")
      .select("recurring_enabled, recurring_method_id")
      .eq("user_id", userId)
      .eq("guild_id", guildId)
      .maybeSingle<GuildPlanSettingsRecord>();

    if (planSettingsResult.error) {
      throw new Error(planSettingsResult.error.message);
    }

    const planSettings = planSettingsResult.data || null;
    if (
      planSettings?.recurring_enabled &&
      planSettings.recurring_method_id === methodId
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Nao e possivel remover este cartao enquanto a cobranca recorrente deste servidor estiver ativa.",
        },
        { status: 409 },
      );
    }

    const [hideResult, softDeleteResult] = await Promise.all([
      supabase
        .from("auth_user_hidden_payment_methods")
        .upsert(
          {
            user_id: userId,
            method_id: methodId,
            deleted_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id,method_id",
          },
        )
        .select("id")
        .single<{ id: number }>(),
      supabase
        .from("auth_user_payment_methods")
        .update({ is_active: false })
        .eq("user_id", userId)
        .eq("method_id", methodId),
    ]);

    if (hideResult.error || !hideResult.data) {
      throw new Error(hideResult.error?.message || "Falha ao remover metodo.");
    }
    if (softDeleteResult.error) {
      throw new Error(softDeleteResult.error.message);
    }

    return NextResponse.json({
      ok: true,
      guildId,
      methodId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao remover metodo de pagamento.",
      },
      { status: 500 },
    );
  }
}

