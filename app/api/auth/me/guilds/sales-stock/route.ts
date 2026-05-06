import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
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
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

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

function getTrimmedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
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

async function ensureGuildAccess(guildId: string, requiredPermission: TeamPermission) {
  const sessionData = await resolveSessionAccessToken();
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

  const accessibleGuild = await assertUserAdminInGuildOrNull(
    {
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    },
    guildId,
  );

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

async function assertProductBelongsToGuild(guildId: string, productId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("guild_sales_products")
    .select("id, title")
    .eq("guild_id", guildId)
    .eq("id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);
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
    const { data, error } = await supabase
      .from("guild_sales_stock_items")
      .select(STOCK_SELECT)
      .eq("guild_id", guildId)
      .eq("product_id", productId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        items: ((data || []) as unknown as StockRecord[]).map(buildStockResponse),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: sanitizeErrorMessage(error, "Erro ao carregar estoque.") },
        { status: 500 },
      ),
    );
  }
}

export async function POST(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) return applyNoStoreHeaders(invalidMutationResponse);

  try {
    const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const guildId = getTrimmedText(rawBody.guildId, 25);
    const productId = getTrimmedText(rawBody.productId, 60);

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
    const fields = readTextFields(rawBody);
    const supabase = getSupabaseAdminClientOrThrow();
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
    const stockQuantity = await syncProductStockQuantity(guildId, productId);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        item: buildStockResponse(data as unknown as StockRecord),
        stockQuantity,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: sanitizeErrorMessage(error, "Erro ao salvar estoque.") },
        { status: 500 },
      ),
    );
  }
}

export async function PATCH(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) return applyNoStoreHeaders(invalidMutationResponse);

  try {
    const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
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
    const fields = readTextFields(rawBody);
    const supabase = getSupabaseAdminClientOrThrow();
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

    const stockQuantity = await syncProductStockQuantity(guildId, productId);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        item: buildStockResponse(data as unknown as StockRecord),
        stockQuantity,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: sanitizeErrorMessage(error, "Erro ao atualizar estoque.") },
        { status: 500 },
      ),
    );
  }
}

export async function DELETE(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) return applyNoStoreHeaders(invalidMutationResponse);

  try {
    const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
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

    const supabase = getSupabaseAdminClientOrThrow();
    const { error } = await supabase
      .from("guild_sales_stock_items")
      .delete()
      .eq("guild_id", guildId)
      .eq("product_id", productId)
      .eq("id", itemId);

    if (error) throw new Error(error.message);
    const stockQuantity = await syncProductStockQuantity(guildId, productId);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        stockQuantity,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: sanitizeErrorMessage(error, "Erro ao excluir estoque.") },
        { status: 500 },
      ),
    );
  }
}
