import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isDiscordRelinkRequiredError,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  getEffectiveDashboardPermissions,
  type TeamRolePermission,
} from "@/lib/teams/userTeams";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const DISCOUNT_SELECT =
  "id, guild_id, kind, code, title, description, status, discount_type, discount_value, initial_amount, remaining_amount, minimum_order_amount, applies_to_all_products, product_ids, max_redemptions, one_per_customer, starts_at, expires_at, created_at, updated_at";
const DISCOUNT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISCOUNT_CODE_PATTERN = /^[A-Za-z0-9_-]{2,64}$/;

type DiscountKind = "coupon" | "gift_card" | "promotion";
type DiscountStatus = "draft" | "active" | "paused" | "expired";
type DiscountType = "fixed" | "percent";

type GuildSalesDiscountRecord = {
  id: string;
  guild_id: string;
  kind: DiscountKind;
  code: string;
  title: string;
  description: string;
  status: DiscountStatus;
  discount_type: DiscountType;
  discount_value: string | number;
  initial_amount: string | number;
  remaining_amount: string | number;
  minimum_order_amount: string | number;
  applies_to_all_products: boolean;
  product_ids: string[] | null;
  max_redemptions: number | null;
  one_per_customer: boolean;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function buildDiscordRelinkResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "DISCORD_RELINK_REQUIRED",
      reauthRequired: true,
      message:
        "Sua conexao com o Discord expirou ou foi revogada. Revincule sua conta Discord para continuar.",
    },
    { status: 401 },
  );
}

function getTrimmedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildInvalidPayloadResponse(error: FlowSecureDtoError) {
  return applyNoStoreHeaders(
    NextResponse.json(
      { ok: false, message: error.issues[0] || error.message },
      { status: error.statusCode },
    ),
  );
}

function readDiscountPayload(payload: unknown, input?: { includeLookupFields?: boolean }) {
  return parseFlowSecureDto(
    payload,
    {
      guildId: flowSecureDto.discordSnowflake(),
      ...(input?.includeLookupFields
        ? {
            discountId: flowSecureDto.optional(
              flowSecureDto.string({
                maxLength: 64,
                allowEmpty: true,
                pattern: /^$|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
                disallowAngleBrackets: true,
                rejectThreatPatterns: false,
              }),
            ),
            discountCode: flowSecureDto.optional(
              flowSecureDto.string({
                maxLength: 80,
                allowEmpty: true,
                pattern: /^$|(?:dsc-[0-9]{8}|[A-Za-z0-9_-]{2,64})$/i,
                disallowAngleBrackets: true,
                rejectThreatPatterns: false,
              }),
            ),
          }
        : {}),
      kind: flowSecureDto.optional(
        flowSecureDto.enum(["coupon", "gift_card", "promotion"] as const),
      ),
      code: flowSecureDto.optional(
        flowSecureDto.string({
          minLength: 2,
          maxLength: 64,
          pattern: DISCOUNT_CODE_PATTERN,
          disallowAngleBrackets: true,
          rejectThreatPatterns: false,
        }),
      ),
      title: flowSecureDto.optional(
        flowSecureDto.string({
          minLength: 2,
          maxLength: 120,
          normalizeWhitespace: true,
        }),
      ),
      description: flowSecureDto.optional(
        flowSecureDto.string({
          maxLength: 800,
          allowEmpty: true,
          normalizeWhitespace: true,
        }),
      ),
      status: flowSecureDto.optional(
        flowSecureDto.enum(["draft", "active", "paused", "expired"] as const),
      ),
      discountType: flowSecureDto.optional(flowSecureDto.enum(["fixed", "percent"] as const)),
      discountValue: flowSecureDto.optional(flowSecureDto.unknown()),
      remainingAmount: flowSecureDto.optional(flowSecureDto.unknown()),
      minimumOrderAmount: flowSecureDto.optional(flowSecureDto.unknown()),
      appliesToAllProducts: flowSecureDto.optional(flowSecureDto.boolean()),
      productIds: flowSecureDto.optional(
        flowSecureDto.array(
          flowSecureDto.string({
            maxLength: 60,
            pattern: DISCOUNT_ID_PATTERN,
            disallowAngleBrackets: true,
            rejectThreatPatterns: false,
          }),
          { maxLength: 500 },
        ),
      ),
      maxRedemptions: flowSecureDto.optional(flowSecureDto.unknown()),
      onePerCustomer: flowSecureDto.optional(flowSecureDto.boolean()),
      startsAt: flowSecureDto.optional(
        flowSecureDto.string({
          maxLength: 40,
          allowEmpty: true,
          disallowAngleBrackets: true,
        }),
      ),
      expiresAt: flowSecureDto.optional(
        flowSecureDto.string({
          maxLength: 40,
          allowEmpty: true,
          disallowAngleBrackets: true,
        }),
      ),
    },
    { rejectUnknown: true },
  );
}

function readDiscountDeletePayload(payload: unknown) {
  return parseFlowSecureDto(
    payload,
    {
      guildId: flowSecureDto.discordSnowflake(),
      discountId: flowSecureDto.optional(
        flowSecureDto.string({
          maxLength: 80,
          allowEmpty: true,
          pattern: /^$|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          disallowAngleBrackets: true,
          rejectThreatPatterns: false,
        }),
      ),
      discountCode: flowSecureDto.optional(
        flowSecureDto.string({
          maxLength: 80,
          allowEmpty: true,
          pattern: /^$|(?:dsc-[0-9]{8}|[A-Za-z0-9_-]{2,64})$/i,
          disallowAngleBrackets: true,
          rejectThreatPatterns: false,
        }),
      ),
    },
    { rejectUnknown: true },
  );
}

function normalizeCode(value: unknown) {
  return getTrimmedText(value, 64)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeKind(value: unknown): DiscountKind {
  return value === "gift_card" || value === "promotion" ? value : "coupon";
}

function normalizeStatus(value: unknown): DiscountStatus {
  return value === "draft" || value === "paused" || value === "expired"
    ? value
    : "active";
}

function normalizeDiscountType(value: unknown): DiscountType {
  return value === "fixed" ? "fixed" : "percent";
}

function toMoney(value: unknown) {
  const normalized =
    typeof value === "string"
      ? value.replace(/[^\d,.-]/g, "").replace(",", ".")
      : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : 0;
}

function toPositiveIntOrNull(value: unknown) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value: unknown) {
  const text = getTrimmedText(value, 40);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeProductIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        item,
      ),
    )
    .slice(0, 500);
}

function buildDiscountCode(id: string) {
  const digits = id.replace(/\D/g, "");
  const seed =
    digits ||
    Array.from(id).reduce((acc, char) => `${acc}${char.charCodeAt(0)}`, "");
  return `dsc-${seed.padEnd(8, "0").slice(0, 8)}`;
}

function buildDiscountResponse(record: GuildSalesDiscountRecord) {
  return {
    id: record.id,
    editorCode: buildDiscountCode(record.id),
    guildId: record.guild_id,
    kind: record.kind,
    code: record.code,
    title: record.title,
    description: record.description || "",
    status: record.status,
    discountType: record.discount_type,
    discountValue: Number(record.discount_value || 0),
    initialAmount: Number(record.initial_amount || 0),
    remainingAmount: Number(record.remaining_amount || 0),
    minimumOrderAmount: Number(record.minimum_order_amount || 0),
    appliesToAllProducts: record.applies_to_all_products,
    productIds: Array.isArray(record.product_ids) ? record.product_ids : [],
    maxRedemptions: record.max_redemptions,
    onePerCustomer: record.one_per_customer,
    startsAt: record.starts_at,
    expiresAt: record.expires_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

async function ensureGuildAccess(
  guildId: string,
  requiredPermission: TeamRolePermission,
) {
  let sessionData;
  try {
    sessionData = await resolveSessionAccessToken();
  } catch (error) {
    if (isDiscordRelinkRequiredError(error)) {
      return { ok: false as const, response: buildDiscordRelinkResponse() };
    }
    throw error;
  }
  if (!sessionData?.authSession || !sessionData.accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    };
  }

  const { permissions: dashboardPerms, isTeamServer } =
    await getEffectiveDashboardPermissions({
      authUserId: sessionData.authSession.user.id,
      guildId,
    });

  let accessibleGuild;
  try {
    accessibleGuild = await assertUserAdminInGuildOrNull(
      {
        authSession: sessionData.authSession,
        accessToken: sessionData.accessToken,
      },
      guildId,
    );
  } catch (error) {
    if (isDiscordRelinkRequiredError(error)) {
      return { ok: false as const, response: buildDiscordRelinkResponse() };
    }
    throw error;
  }

  const hasFullAccess = dashboardPerms === "full";
  const hasSpecificPerm =
    dashboardPerms instanceof Set && dashboardPerms.has(requiredPermission);
  const canManage =
    hasFullAccess || hasSpecificPerm || (!isTeamServer && accessibleGuild);

  if (!canManage) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Voce nao possui permissao para gerenciar cupons." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    context: { authUserId: sessionData.authSession.user.id },
  };
}

function isMissingDiscountsTable(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";
  return code === "42P01" || message.includes("guild_sales_discounts");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = (url.searchParams.get("guildId") || "").trim();
    const discountCode = (url.searchParams.get("discountCode") || "").trim();
    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Guild ID invalido." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const result = await getSupabaseAdminClientOrThrow()
      .from("guild_sales_discounts")
      .select(DISCOUNT_SELECT)
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false })
      .returns<GuildSalesDiscountRecord[]>();

    if (result.error) {
      if (isMissingDiscountsTable(result.error)) {
        return applyNoStoreHeaders(
          NextResponse.json(
            discountCode
              ? { ok: false, message: "Cupom ou gift nao encontrado." }
              : { ok: true, discounts: [] },
            { status: discountCode ? 404 : 200 },
          ),
        );
      }
      throw new Error(result.error.message);
    }

    if (discountCode) {
      const discount = (result.data || []).find(
        (record) =>
          buildDiscountCode(record.id) === discountCode ||
          record.code.toLowerCase() === discountCode.toLowerCase(),
      );

      if (!discount) {
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Cupom ou gift nao encontrado." },
            { status: 404 },
          ),
        );
      }

      return applyNoStoreHeaders(
        NextResponse.json({ ok: true, discount: buildDiscountResponse(discount) }),
      );
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        discounts: (result.data || []).map(buildDiscountResponse),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Erro ao carregar cupons e gifts."),
        },
        { status: 500 },
      ),
    );
  }
}

export async function PATCH(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) return applyNoStoreHeaders(invalidMutationResponse);

  try {
    let rawBody;
    try {
      rawBody = readDiscountPayload(await request.json().catch(() => ({})), {
        includeLookupFields: true,
      });
    } catch (error) {
      if (error instanceof FlowSecureDtoError) {
        return buildInvalidPayloadResponse(error);
      }
      throw error;
    }
    const guildId = getTrimmedText(rawBody.guildId, 25);
    const discountId = getTrimmedText(rawBody.discountId, 64);
    const editorCode = getTrimmedText(rawBody.discountCode, 64);
    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Guild ID invalido." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    let existing: GuildSalesDiscountRecord | null = null;
    if (discountId) {
      const existingResult = await getSupabaseAdminClientOrThrow()
        .from("guild_sales_discounts")
        .select(DISCOUNT_SELECT)
        .eq("guild_id", guildId)
        .eq("id", discountId)
        .maybeSingle<GuildSalesDiscountRecord>();
      if (existingResult.error) throw new Error(existingResult.error.message);
      existing = existingResult.data || null;
    } else if (editorCode) {
      const listResult = await getSupabaseAdminClientOrThrow()
        .from("guild_sales_discounts")
        .select(DISCOUNT_SELECT)
        .eq("guild_id", guildId)
        .returns<GuildSalesDiscountRecord[]>();
      if (listResult.error) throw new Error(listResult.error.message);
      existing =
        (listResult.data || []).find(
          (record) =>
            buildDiscountCode(record.id) === editorCode ||
            record.code.toLowerCase() === editorCode.toLowerCase(),
        ) || null;
    }

    if (!existing) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Cupom ou gift nao encontrado." },
          { status: 404 },
        ),
      );
    }

    const kind = normalizeKind(rawBody.kind);
    const code = normalizeCode(rawBody.code);
    const title = getTrimmedText(rawBody.title, 120);
    const discountType = normalizeDiscountType(rawBody.discountType);
    const discountValue = toMoney(rawBody.discountValue);
    const initialAmount = kind === "gift_card" ? discountValue : 0;
    const remainingAmount =
      kind === "gift_card" ? toMoney(rawBody.remainingAmount || discountValue) : 0;
    const appliesToAllProducts = rawBody.appliesToAllProducts !== false;
    const productIds = appliesToAllProducts ? [] : normalizeProductIds(rawBody.productIds);

    if (!code || code.length < 2) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Informe um codigo valido." }, { status: 400 }),
      );
    }
    if (title.length < 2) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Informe um nome valido." }, { status: 400 }),
      );
    }
    if (discountValue <= 0) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Informe um valor maior que zero." }, { status: 400 }),
      );
    }
    if (discountType === "percent" && discountValue > 100) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Percentual nao pode passar de 100%." }, { status: 400 }),
      );
    }
    if (!appliesToAllProducts && !productIds.length) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Selecione ao menos um produto." }, { status: 400 }),
      );
    }

    const result = await getSupabaseAdminClientOrThrow()
      .from("guild_sales_discounts")
      .update({
        kind,
        code,
        title,
        description: getTrimmedText(rawBody.description, 800),
        status: normalizeStatus(rawBody.status),
        discount_type: kind === "gift_card" ? "fixed" : discountType,
        discount_value: discountValue,
        initial_amount: initialAmount,
        remaining_amount: remainingAmount,
        minimum_order_amount: toMoney(rawBody.minimumOrderAmount),
        applies_to_all_products: appliesToAllProducts,
        product_ids: productIds,
        max_redemptions: toPositiveIntOrNull(rawBody.maxRedemptions),
        one_per_customer: rawBody.onePerCustomer !== false,
        starts_at: normalizeDate(rawBody.startsAt),
        expires_at: normalizeDate(rawBody.expiresAt),
      })
      .eq("guild_id", guildId)
      .eq("id", existing.id)
      .select(DISCOUNT_SELECT)
      .single<GuildSalesDiscountRecord>();

    if (result.error) throw new Error(result.error.message);

    return applyNoStoreHeaders(
      NextResponse.json({ ok: true, discount: buildDiscountResponse(result.data) }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Erro ao atualizar cupom ou gift."),
        },
        { status: 500 },
      ),
    );
  }
}

export async function DELETE(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) return applyNoStoreHeaders(invalidMutationResponse);

  try {
    let rawBody;
    try {
      rawBody = readDiscountDeletePayload(await request.json().catch(() => ({})));
    } catch (error) {
      if (error instanceof FlowSecureDtoError) {
        return buildInvalidPayloadResponse(error);
      }
      throw error;
    }
    const guildId = getTrimmedText(rawBody.guildId, 32);
    const discountId = getTrimmedText(rawBody.discountId, 80);
    const discountCode = getTrimmedText(rawBody.discountCode, 80);

    if (!isGuildId(guildId) || (!discountId && !discountCode)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Parametros invalidos." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    let query = getSupabaseAdminClientOrThrow()
      .from("guild_sales_discounts")
      .delete()
      .eq("guild_id", guildId);

    if (discountId) {
      query = query.eq("id", discountId);
    } else {
      query = query.eq("code", discountCode.toUpperCase());
    }

    const result = await query.select("id").maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Cupom ou gift nao encontrado." }, { status: 404 }),
      );
    }

    return applyNoStoreHeaders(NextResponse.json({ ok: true }));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Erro ao excluir cupom ou gift."),
        },
        { status: 500 },
      ),
    );
  }
}

export async function POST(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) return applyNoStoreHeaders(invalidMutationResponse);

  try {
    let rawBody;
    try {
      rawBody = readDiscountPayload(await request.json().catch(() => ({})));
    } catch (error) {
      if (error instanceof FlowSecureDtoError) {
        return buildInvalidPayloadResponse(error);
      }
      throw error;
    }
    const guildId = getTrimmedText(rawBody.guildId, 25);
    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Guild ID invalido." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const kind = normalizeKind(rawBody.kind);
    const code = normalizeCode(rawBody.code);
    const title = getTrimmedText(rawBody.title, 120);
    const discountType = normalizeDiscountType(rawBody.discountType);
    const discountValue = toMoney(rawBody.discountValue);
    const initialAmount = kind === "gift_card" ? discountValue : 0;
    const remainingAmount =
      kind === "gift_card" ? toMoney(rawBody.remainingAmount || discountValue) : 0;
    const appliesToAllProducts = rawBody.appliesToAllProducts !== false;
    const productIds = appliesToAllProducts ? [] : normalizeProductIds(rawBody.productIds);

    if (!code || code.length < 2) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Informe um codigo valido." }, { status: 400 }),
      );
    }
    if (title.length < 2) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Informe um nome valido." }, { status: 400 }),
      );
    }
    if (discountValue <= 0) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Informe um valor maior que zero." }, { status: 400 }),
      );
    }
    if (discountType === "percent" && discountValue > 100) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Percentual nao pode passar de 100%." }, { status: 400 }),
      );
    }
    if (!appliesToAllProducts && !productIds.length) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Selecione ao menos um produto." }, { status: 400 }),
      );
    }

    const result = await getSupabaseAdminClientOrThrow()
      .from("guild_sales_discounts")
      .insert({
        guild_id: guildId,
        kind,
        code,
        title,
        description: getTrimmedText(rawBody.description, 800),
        status: normalizeStatus(rawBody.status),
        discount_type: kind === "gift_card" ? "fixed" : discountType,
        discount_value: discountValue,
        initial_amount: initialAmount,
        remaining_amount: remainingAmount,
        minimum_order_amount: toMoney(rawBody.minimumOrderAmount),
        applies_to_all_products: appliesToAllProducts,
        product_ids: productIds,
        max_redemptions: toPositiveIntOrNull(rawBody.maxRedemptions),
        one_per_customer: rawBody.onePerCustomer !== false,
        starts_at: normalizeDate(rawBody.startsAt),
        expires_at: normalizeDate(rawBody.expiresAt),
        configured_by_user_id: access.context.authUserId,
      })
      .select(DISCOUNT_SELECT)
      .single<GuildSalesDiscountRecord>();

    if (result.error) throw new Error(result.error.message);

    return applyNoStoreHeaders(
      NextResponse.json({ ok: true, discount: buildDiscountResponse(result.data) }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Erro ao salvar cupom ou gift."),
        },
        { status: 500 },
      ),
    );
  }
}
