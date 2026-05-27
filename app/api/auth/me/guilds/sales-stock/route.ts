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
import { extractAuditErrorMessage, sanitizeErrorMessage } from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  markSalesProductDiscordSyncFailedById,
  syncSalesProductDiscordMessageById,
  type SalesProductDiscordSyncStatus,
} from "@/lib/servers/salesProductDiscordSync";

const STOCK_SELECT = [
  "id",
  "guild_id",
  "product_id",
  "product_name",
  "item_type",
  "delivery_method",
  "status",
  "category",
  "platform",
  "provider",
  "email",
  "login",
  "password",
  "access_type",
  "recovery",
  "gift_card_name",
  "redemption_value",
  "redemption_code",
  "access_link",
  "link_password",
  "region",
  "validity",
  "quantity",
  "server",
  "buyer_required_id",
  "delivery_deadline",
  "service_type",
  "required_buyer_info",
  "discord_product_type",
  "server_or_bot_link",
  "token_or_key",
  "required_permissions",
  "tool_name",
  "automation_type",
  "software_name",
  "software_version",
  "operating_system",
  "license_key",
  "download_link",
  "subscription_duration",
  "account_type",
  "course_name",
  "item_name",
  "instructions",
  "observations",
  "payload",
  "created_at",
  "updated_at",
].join(", ");
const STOCK_BASE_SELECT = [
  "id",
  "guild_id",
  "product_id",
  "product_name",
  "item_type",
  "delivery_method",
  "status",
  "quantity",
  "payload",
  "created_at",
  "updated_at",
].join(", ");
const STOCK_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STOCK_ITEM_TYPES = [
  "accounts_access",
  "emails",
  "gift_cards_codes",
  "virtual_currency",
  "game_items",
  "game_services",
  "premium_subscriptions",
  "artificial_intelligence",
  "discord_bots",
  "social_networks",
  "software_licenses",
  "courses_training",
  "digital_links",
  "digital_services",
  "freelancer",
  "other",
] as const;

type TeamPermission = TeamRolePermission;

type StockRecord = Record<string, unknown> & {
  id: string;
  product_id: string;
  item_type: string;
  delivery_method: string;
  status: string;
  quantity: number | null;
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
        "Sua conexao com o Discord expirou ou foi revogada. Revincule sua conta Discord para continuar gerenciando este servidor.",
    },
    { status: 401 },
  );
}

function getTrimmedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function isUuid(value: string) {
  return STOCK_UUID_PATTERN.test(value);
}

function buildInvalidPayloadResponse(error: FlowSecureDtoError) {
  return applyNoStoreHeaders(
    NextResponse.json(
      { ok: false, message: error.issues[0] || error.message },
      { status: error.statusCode },
    ),
  );
}

function optionalSafeText(maxLength: number) {
  return flowSecureDto.optional(
    flowSecureDto.string({
      maxLength,
      allowEmpty: true,
      normalizeWhitespace: maxLength <= 220,
      disallowAngleBrackets: true,
      rejectThreatPatterns: false,
    }),
  );
}

function readStockMutationPayload(payload: unknown) {
  return parseFlowSecureDto(
    payload,
    {
      guildId: flowSecureDto.discordSnowflake(),
      productId: flowSecureDto.string({
        maxLength: 60,
        pattern: STOCK_UUID_PATTERN,
        disallowAngleBrackets: true,
        rejectThreatPatterns: false,
      }),
      itemId: flowSecureDto.optional(
        flowSecureDto.nullable(
          flowSecureDto.string({
            maxLength: 60,
            allowEmpty: true,
            pattern: /^$|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            disallowAngleBrackets: true,
            rejectThreatPatterns: false,
          }),
        ),
      ),
      duplicateItemId: flowSecureDto.optional(
        flowSecureDto.nullable(
          flowSecureDto.string({
            maxLength: 60,
            allowEmpty: true,
            pattern: /^$|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            disallowAngleBrackets: true,
            rejectThreatPatterns: false,
          }),
        ),
      ),
      duplicateCount: flowSecureDto.optional(
        flowSecureDto.number({ integer: true, min: 1, max: 10 }),
      ),
      quantity: flowSecureDto.optional(
        flowSecureDto.number({ integer: true, min: 0, max: 1_000_000 }),
      ),
      patchMode: flowSecureDto.optional(flowSecureDto.enum(["quantity"] as const)),
      deleteAllForProduct: flowSecureDto.optional(flowSecureDto.boolean()),
      itemType: flowSecureDto.optional(flowSecureDto.enum(STOCK_ITEM_TYPES)),
      deliveryMethod: flowSecureDto.optional(
        flowSecureDto.enum(["email", "discord_dm", "flowdesk_link"] as const),
      ),
      status: flowSecureDto.optional(
        flowSecureDto.enum(["available", "reserved", "delivered", "disabled"] as const),
      ),
      productName: optionalSafeText(160),
      category: optionalSafeText(80),
      platform: optionalSafeText(160),
      provider: optionalSafeText(160),
      email: optionalSafeText(220),
      login: optionalSafeText(220),
      password: optionalSafeText(500),
      accessType: optionalSafeText(160),
      recovery: optionalSafeText(500),
      giftCardName: optionalSafeText(160),
      redemptionValue: optionalSafeText(80),
      redemptionCode: optionalSafeText(500),
      accessLink: optionalSafeText(800),
      linkPassword: optionalSafeText(220),
      region: optionalSafeText(120),
      validity: optionalSafeText(120),
      server: optionalSafeText(160),
      buyerRequiredId: optionalSafeText(220),
      deliveryDeadline: optionalSafeText(160),
      serviceType: optionalSafeText(160),
      requiredBuyerInfo: optionalSafeText(1200),
      discordProductType: optionalSafeText(160),
      serverOrBotLink: optionalSafeText(800),
      tokenOrKey: optionalSafeText(700),
      requiredPermissions: optionalSafeText(700),
      toolName: optionalSafeText(160),
      automationType: optionalSafeText(160),
      softwareName: optionalSafeText(160),
      softwareVersion: optionalSafeText(80),
      operatingSystem: optionalSafeText(120),
      licenseKey: optionalSafeText(700),
      downloadLink: optionalSafeText(800),
      subscriptionDuration: optionalSafeText(120),
      accountType: optionalSafeText(160),
      courseName: optionalSafeText(160),
      itemName: optionalSafeText(160),
      instructions: optionalSafeText(1800),
      observations: optionalSafeText(1200),
      payload: flowSecureDto.optional(flowSecureDto.record()),
    },
    { rejectUnknown: true },
  );
}

function getSupabaseErrorInfo(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  return {
    code: typeof record.code === "string" ? record.code : "",
    message: typeof record.message === "string" ? record.message.toLowerCase() : "",
  };
}

function isMissingStockItemsTable(error: unknown) {
  const { code, message } = getSupabaseErrorInfo(error);
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("guild_sales_stock_items") &&
      (message.includes("relation") || message.includes("table")) &&
      (message.includes("does not exist") ||
        message.includes("not found") ||
        message.includes("could not find")))
  );
}

function isMissingStockItemsColumn(error: unknown) {
  const { code, message } = getSupabaseErrorInfo(error);
  return (
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("schema cache") ||
    message.includes("column")
  );
}

function resolveStockErrorMessage(error: unknown, fallback: string) {
  const message = extractAuditErrorMessage(error, fallback);
  const normalized = message.toLowerCase();

  if (isMissingStockItemsTable(error)) {
    return "Tabela de estoque digital ausente em producao. Aplique a migration 114 e tente novamente.";
  }

  if (
    normalized.includes("nao autenticado") ||
    normalized.includes("permissao") ||
    normalized.includes("discord") ||
    normalized.includes("produto") ||
    normalized.includes("estoque")
  ) {
    return message;
  }

  return sanitizeErrorMessage(error, fallback);
}

function readStockIdentity(rawBody: Record<string, unknown>) {
  return {
    guildId: getTrimmedText(rawBody.guildId, 25),
    productId: getTrimmedText(rawBody.productId, 60),
    itemId: getTrimmedText(rawBody.itemId, 60),
  };
}

function normalizeItemType(value: unknown) {
  const allowed = new Set([
    "accounts_access",
    "emails",
    "gift_cards_codes",
    "virtual_currency",
    "game_items",
    "game_services",
    "premium_subscriptions",
    "artificial_intelligence",
    "discord_bots",
    "social_networks",
    "software_licenses",
    "courses_training",
    "digital_links",
    "digital_services",
    "freelancer",
    "other",
  ]);
  return typeof value === "string" && allowed.has(value) ? value : "digital_services";
}

function normalizeDeliveryMethod(value: unknown) {
  return value === "email" || value === "discord_dm" || value === "flowdesk_link"
    ? value
    : "flowdesk_link";
}

function normalizeStatus(value: unknown) {
  return value === "reserved" || value === "delivered" || value === "disabled"
    ? value
    : "available";
}

function readTextFields(rawBody: Record<string, unknown>) {
  return {
    product_name: getTrimmedText(rawBody.productName, 160),
    category: getTrimmedText(rawBody.category, 80),
    platform: getTrimmedText(rawBody.platform, 160),
    provider: getTrimmedText(rawBody.provider, 160),
    email: getTrimmedText(rawBody.email, 220),
    login: getTrimmedText(rawBody.login, 220),
    password: getTrimmedText(rawBody.password, 500),
    access_type: getTrimmedText(rawBody.accessType, 160),
    recovery: getTrimmedText(rawBody.recovery, 500),
    gift_card_name: getTrimmedText(rawBody.giftCardName, 160),
    redemption_value: getTrimmedText(rawBody.redemptionValue, 80),
    redemption_code: getTrimmedText(rawBody.redemptionCode, 500),
    access_link: getTrimmedText(rawBody.accessLink, 800),
    link_password: getTrimmedText(rawBody.linkPassword, 220),
    region: getTrimmedText(rawBody.region, 120),
    validity: getTrimmedText(rawBody.validity, 120),
    server: getTrimmedText(rawBody.server, 160),
    buyer_required_id: getTrimmedText(rawBody.buyerRequiredId, 220),
    delivery_deadline: getTrimmedText(rawBody.deliveryDeadline, 160),
    service_type: getTrimmedText(rawBody.serviceType, 160),
    required_buyer_info: getTrimmedText(rawBody.requiredBuyerInfo, 1200),
    discord_product_type: getTrimmedText(rawBody.discordProductType, 160),
    server_or_bot_link: getTrimmedText(rawBody.serverOrBotLink, 800),
    token_or_key: getTrimmedText(rawBody.tokenOrKey, 700),
    required_permissions: getTrimmedText(rawBody.requiredPermissions, 700),
    tool_name: getTrimmedText(rawBody.toolName, 160),
    automation_type: getTrimmedText(rawBody.automationType, 160),
    software_name: getTrimmedText(rawBody.softwareName, 160),
    software_version: getTrimmedText(rawBody.softwareVersion, 80),
    operating_system: getTrimmedText(rawBody.operatingSystem, 120),
    license_key: getTrimmedText(rawBody.licenseKey, 700),
    download_link: getTrimmedText(rawBody.downloadLink, 800),
    subscription_duration: getTrimmedText(rawBody.subscriptionDuration, 120),
    account_type: getTrimmedText(rawBody.accountType, 160),
    course_name: getTrimmedText(rawBody.courseName, 160),
    item_name: getTrimmedText(rawBody.itemName, 160),
    instructions: getTrimmedText(rawBody.instructions, 1800),
    observations: getTrimmedText(rawBody.observations, 1200),
  };
}

function buildStockResponse(record: StockRecord) {
  return {
    id: record.id,
    productId: record.product_id,
    productName: record.product_name || "",
    itemType: record.item_type,
    deliveryMethod: record.delivery_method,
    status: record.status,
    category: record.category || "",
    platform: record.platform || "",
    provider: record.provider || "",
    email: record.email || "",
    login: record.login || "",
    password: record.password || "",
    accessType: record.access_type || "",
    recovery: record.recovery || "",
    giftCardName: record.gift_card_name || "",
    redemptionValue: record.redemption_value || "",
    redemptionCode: record.redemption_code || "",
    accessLink: record.access_link || "",
    linkPassword: record.link_password || "",
    region: record.region || "",
    validity: record.validity || "",
    quantity: Number(record.quantity || 0),
    server: record.server || "",
    buyerRequiredId: record.buyer_required_id || "",
    deliveryDeadline: record.delivery_deadline || "",
    serviceType: record.service_type || "",
    requiredBuyerInfo: record.required_buyer_info || "",
    discordProductType: record.discord_product_type || "",
    serverOrBotLink: record.server_or_bot_link || "",
    tokenOrKey: record.token_or_key || "",
    requiredPermissions: record.required_permissions || "",
    toolName: record.tool_name || "",
    automationType: record.automation_type || "",
    softwareName: record.software_name || "",
    softwareVersion: record.software_version || "",
    operatingSystem: record.operating_system || "",
    licenseKey: record.license_key || "",
    downloadLink: record.download_link || "",
    subscriptionDuration: record.subscription_duration || "",
    accountType: record.account_type || "",
    courseName: record.course_name || "",
    itemName: record.item_name || "",
    instructions: record.instructions || "",
    observations: record.observations || "",
    payload: record.payload || {},
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function withStockDefaults(record: Partial<StockRecord>) {
  return {
    ...record,
    product_name: record.product_name || "",
    item_type: record.item_type || "digital_services",
    delivery_method: record.delivery_method || "flowdesk_link",
    status: record.status || "available",
    category: record.category || "",
    platform: record.platform || "",
    provider: record.provider || "",
    email: record.email || "",
    login: record.login || "",
    password: record.password || "",
    access_type: record.access_type || "",
    recovery: record.recovery || "",
    gift_card_name: record.gift_card_name || "",
    redemption_value: record.redemption_value || "",
    redemption_code: record.redemption_code || "",
    access_link: record.access_link || "",
    link_password: record.link_password || "",
    region: record.region || "",
    validity: record.validity || "",
    quantity: record.quantity ?? 0,
    server: record.server || "",
    buyer_required_id: record.buyer_required_id || "",
    delivery_deadline: record.delivery_deadline || "",
    service_type: record.service_type || "",
    required_buyer_info: record.required_buyer_info || "",
    discord_product_type: record.discord_product_type || "",
    server_or_bot_link: record.server_or_bot_link || "",
    token_or_key: record.token_or_key || "",
    required_permissions: record.required_permissions || "",
    tool_name: record.tool_name || "",
    automation_type: record.automation_type || "",
    software_name: record.software_name || "",
    software_version: record.software_version || "",
    operating_system: record.operating_system || "",
    license_key: record.license_key || "",
    download_link: record.download_link || "",
    subscription_duration: record.subscription_duration || "",
    account_type: record.account_type || "",
    course_name: record.course_name || "",
    item_name: record.item_name || "",
    instructions: record.instructions || "",
    observations: record.observations || "",
    payload: record.payload || {},
    created_at: record.created_at || new Date(0).toISOString(),
    updated_at: record.updated_at || record.created_at || new Date(0).toISOString(),
  } as StockRecord;
}

async function ensureGuildAccess(guildId: string, requiredPermission: TeamPermission) {
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
      response: NextResponse.json({ ok: false, message: "Nao autenticado." }, { status: 401 }),
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
        { ok: false, message: "Voce nao possui permissao para gerenciar estoque." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    context: {
      authUserId: sessionData.authSession.user.id,
    },
  };
}

async function syncProductStockQuantity(guildId: string, productId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const rpcResult = await supabase.rpc("sync_guild_sales_product_stock_quantity", {
    p_guild_id: guildId,
    p_product_id: productId,
  });

  if (!rpcResult.error && Number.isFinite(Number(rpcResult.data))) {
    return Math.max(0, Number(rpcResult.data || 0));
  }

  const rpcMessage = rpcResult.error?.message?.toLowerCase() || "";
  if (
    rpcResult.error &&
    rpcResult.error.code !== "42883" &&
    !rpcMessage.includes("sync_guild_sales_product_stock_quantity")
  ) {
    throw new Error(rpcResult.error.message);
  }

  const { data, error } = await supabase
    .from("guild_sales_stock_items")
    .select("quantity")
    .eq("guild_id", guildId)
    .eq("product_id", productId)
    .eq("status", "available");

  if (error) throw new Error(error.message);
  const quantity = (data || []).reduce(
    (total, item) => total + Math.max(0, Number(item.quantity || 0)),
    0,
  );

  const update = await supabase
    .from("guild_sales_products")
    .update({ stock_quantity: quantity })
    .eq("guild_id", guildId)
    .eq("id", productId);

  if (update.error) throw new Error(update.error.message);
  return quantity;
}

function resolveQuantityPatchStatus(
  currentStatus: StockRecord["status"],
  quantity: number,
) {
  if (quantity > 0 && currentStatus === "delivered") return "available";
  if (quantity === 0 && currentStatus === "available") return "delivered";
  return currentStatus;
}

async function syncProductStockQuantityAndDiscordEmbed(
  guildId: string,
  productId: string,
) {
  const stockQuantity = await syncProductStockQuantity(guildId, productId);
  let discordSyncStatus: SalesProductDiscordSyncStatus = "idle";
  let discordSyncError = "";

  try {
    const sync = await syncSalesProductDiscordMessageById({ guildId, productId });
    discordSyncStatus = sync?.status || "idle";
    discordSyncError = sync?.error || "";
  } catch (error) {
    discordSyncStatus = "failed";
    discordSyncError = sanitizeErrorMessage(
      error,
      "Estoque salvo, mas nao foi possivel atualizar o embed do produto no Discord.",
    );
    await markSalesProductDiscordSyncFailedById({
      guildId,
      productId,
      error: discordSyncError,
    }).catch((markError) => {
      console.warn("[sales-stock] failed to mark Discord sync error", markError);
    });
  }

  return {
    stockQuantity,
    discordSyncStatus,
    discordSyncError,
  };
}

async function assertProductBelongsToGuild(guildId: string, productId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("guild_sales_products")
    .select("id, title")
    .eq("guild_id", guildId)
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    if (isMissingStockItemsTable(error)) return null;
    throw new Error(error.message);
  }
  return data as { id: string; title: string } | null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = getTrimmedText(url.searchParams.get("guildId"), 25);
    const productId = getTrimmedText(url.searchParams.get("productId"), 60);

    if (!isGuildId(guildId) || !isUuid(productId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Parametros invalidos." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const product = await assertProductBelongsToGuild(guildId, productId);
    if (!product) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Produto nao encontrado." }, { status: 404 }),
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase
      .from("guild_sales_stock_items")
      .select(STOCK_SELECT)
      .eq("guild_id", guildId)
      .eq("product_id", productId)
      .order("created_at", { ascending: false });
    let data = result.data;
    let error = result.error;

    if (error) {
      if (isMissingStockItemsTable(error)) {
        return applyNoStoreHeaders(
          NextResponse.json({
            ok: true,
            items: [],
            requiresMigration: true,
            message:
              "Tabela de estoque digital ausente em producao. Aplique a migration 114.",
          }),
        );
      }
      if (isMissingStockItemsColumn(error)) {
        const fallback = await supabase
          .from("guild_sales_stock_items")
          .select(STOCK_BASE_SELECT)
          .eq("guild_id", guildId)
          .eq("product_id", productId)
          .order("created_at", { ascending: false });
        data = fallback.data;
        error = fallback.error;
      }
    }

    if (error) {
      throw new Error(error.message);
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        items: ((data || []) as unknown as Partial<StockRecord>[])
          .map(withStockDefaults)
          .map(buildStockResponse),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: resolveStockErrorMessage(error, "Erro ao carregar estoque.") },
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
      rawBody = readStockMutationPayload(await request.json().catch(() => ({})));
    } catch (error) {
      if (error instanceof FlowSecureDtoError) {
        return buildInvalidPayloadResponse(error);
      }
      throw error;
    }
    const guildId = getTrimmedText(rawBody.guildId, 25);
    const productId = getTrimmedText(rawBody.productId, 60);
    const duplicateItemId = getTrimmedText(rawBody.duplicateItemId, 60);

    if (!isGuildId(guildId) || !isUuid(productId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Parametros invalidos." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const product = await assertProductBelongsToGuild(guildId, productId);
    if (!product) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Produto nao encontrado." }, { status: 404 }),
      );
    }

    const quantity = Math.max(0, Math.floor(Number(rawBody.quantity) || 1));
    const supabase = getSupabaseAdminClientOrThrow();
    if (duplicateItemId) {
      if (!isUuid(duplicateItemId)) {
        return applyNoStoreHeaders(
          NextResponse.json({ ok: false, message: "Estoque de origem invalido." }, { status: 400 }),
        );
      }
      const duplicateCount = Math.min(
        10,
        Math.max(1, Math.floor(Number(rawBody.duplicateCount) || 1)),
      );
      const sourceResult = await supabase
        .from("guild_sales_stock_items")
        .select(STOCK_SELECT)
        .eq("guild_id", guildId)
        .eq("product_id", productId)
        .eq("id", duplicateItemId)
        .maybeSingle();
      if (sourceResult.error) throw new Error(sourceResult.error.message);
      if (!sourceResult.data) {
        return applyNoStoreHeaders(
          NextResponse.json({ ok: false, message: "Estoque de origem nao encontrado." }, { status: 404 }),
        );
      }

      const source = withStockDefaults(sourceResult.data as unknown as Partial<StockRecord>);
      const rows = Array.from({ length: duplicateCount }).map(() => ({
        guild_id: guildId,
        product_id: productId,
        product_name: source.product_name || product.title,
        item_type: normalizeItemType(source.item_type),
        delivery_method: normalizeDeliveryMethod(source.delivery_method),
        status: "available",
        quantity: Math.max(1, Math.floor(Number(source.quantity || 1))),
        category: source.category || "",
        platform: source.platform || "",
        provider: source.provider || "",
        email: source.email || "",
        login: source.login || "",
        password: source.password || "",
        access_type: source.access_type || "",
        recovery: source.recovery || "",
        gift_card_name: source.gift_card_name || "",
        redemption_value: source.redemption_value || "",
        redemption_code: source.redemption_code || "",
        access_link: source.access_link || "",
        link_password: source.link_password || "",
        region: source.region || "",
        validity: source.validity || "",
        server: source.server || "",
        buyer_required_id: source.buyer_required_id || "",
        delivery_deadline: source.delivery_deadline || "",
        service_type: source.service_type || "",
        required_buyer_info: source.required_buyer_info || "",
        discord_product_type: source.discord_product_type || "",
        server_or_bot_link: source.server_or_bot_link || "",
        token_or_key: source.token_or_key || "",
        required_permissions: source.required_permissions || "",
        tool_name: source.tool_name || "",
        automation_type: source.automation_type || "",
        software_name: source.software_name || "",
        software_version: source.software_version || "",
        operating_system: source.operating_system || "",
        license_key: source.license_key || "",
        download_link: source.download_link || "",
        subscription_duration: source.subscription_duration || "",
        account_type: source.account_type || "",
        course_name: source.course_name || "",
        item_name: source.item_name || "",
        instructions: source.instructions || "",
        observations: source.observations || "",
        payload: source.payload || {},
        configured_by_user_id: access.context.authUserId,
      }));

      const duplicateResult = await supabase
        .from("guild_sales_stock_items")
        .insert(rows)
        .select(STOCK_SELECT);
      if (duplicateResult.error) throw new Error(duplicateResult.error.message);
      const stockSync = await syncProductStockQuantityAndDiscordEmbed(guildId, productId);

      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          items: ((duplicateResult.data || []) as unknown as StockRecord[]).map(buildStockResponse),
          ...stockSync,
        }),
      );
    }

    const fields = readTextFields(rawBody);
    const { data, error } = await supabase
      .from("guild_sales_stock_items")
      .insert({
        guild_id: guildId,
        product_id: productId,
        item_type: normalizeItemType(rawBody.itemType),
        delivery_method: normalizeDeliveryMethod(rawBody.deliveryMethod),
        status: normalizeStatus(rawBody.status),
        quantity,
        ...fields,
        product_name: fields.product_name || product.title,
        payload: rawBody.payload && typeof rawBody.payload === "object" ? rawBody.payload : {},
        configured_by_user_id: access.context.authUserId,
      })
      .select(STOCK_SELECT)
      .single();

    if (error) throw new Error(error.message);
    const stockSync = await syncProductStockQuantityAndDiscordEmbed(guildId, productId);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        item: buildStockResponse(data as unknown as StockRecord),
        ...stockSync,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: resolveStockErrorMessage(error, "Erro ao salvar estoque.") },
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
      rawBody = readStockMutationPayload(await request.json().catch(() => ({})));
    } catch (error) {
      if (error instanceof FlowSecureDtoError) {
        return buildInvalidPayloadResponse(error);
      }
      throw error;
    }
    const { guildId, productId, itemId } = readStockIdentity(rawBody);

    if (!isGuildId(guildId) || !isUuid(productId) || !isUuid(itemId)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Parametros invalidos." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const product = await assertProductBelongsToGuild(guildId, productId);
    if (!product) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Produto nao encontrado." }, { status: 404 }),
      );
    }

    const quantity = Math.max(0, Math.floor(Number(rawBody.quantity) || 0));
    const supabase = getSupabaseAdminClientOrThrow();
    if (rawBody.patchMode === "quantity") {
      const currentResult = await supabase
        .from("guild_sales_stock_items")
        .select("status")
        .eq("guild_id", guildId)
        .eq("product_id", productId)
        .eq("id", itemId)
        .maybeSingle();

      if (currentResult.error) throw new Error(currentResult.error.message);
      if (!currentResult.data) {
        return applyNoStoreHeaders(
          NextResponse.json({ ok: false, message: "Entrega nao encontrada." }, { status: 404 }),
        );
      }

      const nextStatus = resolveQuantityPatchStatus(
        String(currentResult.data.status || "available") as StockRecord["status"],
        quantity,
      );
      const { data, error } = await supabase
        .from("guild_sales_stock_items")
        .update({ quantity, status: nextStatus })
        .eq("guild_id", guildId)
        .eq("product_id", productId)
        .eq("id", itemId)
        .select(STOCK_SELECT)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) {
        return applyNoStoreHeaders(
          NextResponse.json({ ok: false, message: "Entrega nao encontrada." }, { status: 404 }),
        );
      }

      const stockSync = await syncProductStockQuantityAndDiscordEmbed(guildId, productId);

      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          item: buildStockResponse(data as unknown as StockRecord),
          ...stockSync,
        }),
      );
    }

    const fields = readTextFields(rawBody);
    const { data, error } = await supabase
      .from("guild_sales_stock_items")
      .update({
        item_type: normalizeItemType(rawBody.itemType),
        delivery_method: normalizeDeliveryMethod(rawBody.deliveryMethod),
        status: normalizeStatus(rawBody.status),
        quantity,
        ...fields,
        product_name: fields.product_name || product.title,
        payload: rawBody.payload && typeof rawBody.payload === "object" ? rawBody.payload : {},
      })
      .eq("guild_id", guildId)
      .eq("product_id", productId)
      .eq("id", itemId)
      .select(STOCK_SELECT)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Entrega nao encontrada." }, { status: 404 }),
      );
    }

    const stockSync = await syncProductStockQuantityAndDiscordEmbed(guildId, productId);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        item: buildStockResponse(data as unknown as StockRecord),
        ...stockSync,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: resolveStockErrorMessage(error, "Erro ao atualizar estoque.") },
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
      rawBody = readStockMutationPayload(await request.json().catch(() => ({})));
    } catch (error) {
      if (error instanceof FlowSecureDtoError) {
        return buildInvalidPayloadResponse(error);
      }
      throw error;
    }
    const { guildId, productId, itemId } = readStockIdentity(rawBody);
    const deleteAllForProduct = rawBody.deleteAllForProduct === true;

    if (!isGuildId(guildId) || !isUuid(productId) || (!deleteAllForProduct && !isUuid(itemId))) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Parametros invalidos." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const product = await assertProductBelongsToGuild(guildId, productId);
    if (!product) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Produto nao encontrado." }, { status: 404 }),
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    let deleteQuery = supabase
      .from("guild_sales_stock_items")
      .delete()
      .eq("guild_id", guildId)
      .eq("product_id", productId);

    if (!deleteAllForProduct) {
      deleteQuery = deleteQuery.eq("id", itemId);
    }

    const { error } = await deleteQuery;

    if (error) throw new Error(error.message);
    const stockSync = await syncProductStockQuantityAndDiscordEmbed(guildId, productId);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        ...stockSync,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: resolveStockErrorMessage(error, "Erro ao excluir estoque.") },
        { status: 500 },
      ),
    );
  }
}
