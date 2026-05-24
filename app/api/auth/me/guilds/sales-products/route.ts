import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
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
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  markSalesProductDiscordMessageUnavailable,
  persistSalesProductDiscordSyncState,
  syncSalesProductDiscordMessage,
  type SalesProductDiscordSyncStatus,
} from "@/lib/servers/salesProductDiscordSync";

const PRODUCT_TITLE_MAX_LENGTH = 120;
const PRODUCT_DESCRIPTION_MAX_LENGTH = 1800;
const PRODUCT_TEXT_MAX_LENGTH = 120;
const PRODUCT_MEDIA_MAX_ITEMS = 8;
const PRODUCT_MEDIA_MAX_LENGTH = 7_000_000;
const PRODUCT_BASE_SELECT =
  "id, guild_id, title, description, category_id, status, media_urls, price_amount, compare_at_price_amount, unit_price_amount, charge_taxes, cost_per_item_amount, inventory_tracked, stock_quantity, sku, barcode, barcode_mode, product_type, manufacturer, tags, theme_model, published_virtual_store, published_point_of_sale, published_pinterest, active, created_at, updated_at";
const PRODUCT_SELECT = `${PRODUCT_BASE_SELECT}, discord_publication_mode, discord_channel_id, discord_message_id, discord_last_synced_at, discord_sync_status, discord_sync_error`;
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;

type GuildSalesProductRecord = {
  id: string;
  guild_id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  status: string;
  media_urls: unknown;
  price_amount: number | string | null;
  compare_at_price_amount: number | string | null;
  unit_price_amount: number | string | null;
  charge_taxes: boolean;
  cost_per_item_amount: number | string | null;
  inventory_tracked: boolean;
  stock_quantity: number | null;
  sku: string | null;
  barcode: string | null;
  barcode_mode: string | null;
  product_type: string | null;
  manufacturer: string | null;
  tags: string[] | null;
  theme_model: string | null;
  discord_publication_mode: string | null;
  discord_channel_id: string | null;
  discord_message_id: string | null;
  discord_last_synced_at: string | null;
  discord_sync_status: string | null;
  discord_sync_error: string | null;
  published_virtual_store: boolean;
  published_point_of_sale: boolean;
  published_pinterest: boolean;
  active: boolean;
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function toMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Number(value.toFixed(2)));
  }
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/[^\d,.-]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
}

function hasRequiredMoneyInput(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0;
  }
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/[^\d,.-]/g, "").replace(",", ".");
  if (!normalized || !/\d/.test(normalized)) return false;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0;
}

function toOptionalMoney(value: unknown) {
  const amount = toMoney(value);
  return amount > 0 ? amount : null;
}

function normalizeStatus(value: unknown) {
  return value === "draft" || value === "archived" ? value : "active";
}

function normalizeThemeModel(value: unknown) {
  return value === "compact" || value === "featured" ? value : "default";
}

function normalizeDiscordPublicationMode(value: unknown) {
  return value === "channel" ? "channel" : "online_only";
}

function normalizeBarcodeMode(value: unknown) {
  return value === "manual" ? "manual" : "auto";
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => getTrimmedText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeMediaUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => /^https?:\/\//i.test(item) || /^data:image\/[a-z0-9.+-]+;base64,/i.test(item))
    .filter((item) => item.length <= PRODUCT_MEDIA_MAX_LENGTH)
    .slice(0, PRODUCT_MEDIA_MAX_ITEMS);
}

function isMissingSalesProductsTable(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("guild_sales_products") &&
      (message.includes("relation") || message.includes("table")) &&
      (message.includes("does not exist") ||
        message.includes("not found") ||
        message.includes("could not find")))
  );
}

function isMissingSalesProductsColumn(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";
  return (
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("schema cache") ||
    message.includes("column")
  );
}

function resolveSalesProductsErrorMessage(error: unknown, fallback: string) {
  const message = extractAuditErrorMessage(error, fallback);
  const normalized = message.toLowerCase();

  if (
    isMissingSalesProductsTable(error) ||
    isMissingSalesProductsColumn(error) ||
    normalized.includes("schema cache") ||
    normalized.includes("guild_sales_products")
  ) {
    return "Banco de produtos de vendas desatualizado em producao. Aplique as migrations 107, 112 e 113 e tente novamente.";
  }

  if (
    normalized.includes("nao autenticado") ||
    normalized.includes("permissao") ||
    normalized.includes("discord") ||
    normalized.includes("categoria") ||
    normalized.includes("produto")
  ) {
    return message;
  }

  return sanitizeErrorMessage(error, fallback);
}

function buildProductCode(id: string) {
  const digits = id.replace(/\D/g, "");
  const seed =
    digits ||
    Array.from(id).reduce((acc, char) => `${acc}${char.charCodeAt(0)}`, "");
  return `prd-${seed.padEnd(8, "0").slice(0, 8)}`;
}

function isValidTextChannelType(type?: number) {
  return type === GUILD_TEXT || type === GUILD_ANNOUNCEMENT;
}

function normalizeProductCode(value: unknown) {
  if (typeof value !== "string") return "";
  const code = value.trim().toLowerCase();
  return /^prd-[0-9]{8}$/.test(code) ? code : "";
}

function buildProductResponse(record: GuildSalesProductRecord) {
  const mediaUrls = Array.isArray(record.media_urls)
    ? record.media_urls.filter((item): item is string => typeof item === "string")
    : [];

  return {
    id: record.id,
    code: buildProductCode(record.id),
    guildId: record.guild_id,
    title: record.title,
    description: record.description || "",
    categoryId: record.category_id,
    status:
      record.status === "draft" || record.status === "archived"
        ? record.status
        : "active",
    mediaUrls,
    priceAmount: Number(record.price_amount || 0),
    compareAtPriceAmount:
      record.compare_at_price_amount === null
        ? null
        : Number(record.compare_at_price_amount || 0),
    unitPriceAmount:
      record.unit_price_amount === null
        ? null
        : Number(record.unit_price_amount || 0),
    chargeTaxes: record.charge_taxes,
    costPerItemAmount:
      record.cost_per_item_amount === null
        ? null
        : Number(record.cost_per_item_amount || 0),
    inventoryTracked: record.inventory_tracked,
    stockQuantity: record.stock_quantity || 0,
    sku: record.sku || "",
    barcode: record.barcode || "",
    barcodeMode: record.barcode_mode === "manual" ? "manual" : "auto",
    productType: record.product_type || "",
    manufacturer: record.manufacturer || "",
    tags: record.tags || [],
    themeModel:
      record.theme_model === "compact" || record.theme_model === "featured"
        ? record.theme_model
        : "default",
    discordPublicationMode:
      record.discord_publication_mode === "channel" ? "channel" : "online_only",
    discordChannelId: record.discord_channel_id || "",
    discordMessageId: record.discord_message_id || "",
    discordLastSyncedAt: record.discord_last_synced_at,
    discordSyncStatus:
      record.discord_sync_status === "synced" || record.discord_sync_status === "failed"
        ? record.discord_sync_status
        : "idle",
    discordSyncError: record.discord_sync_error || "",
    publishedVirtualStore: record.published_virtual_store,
    publishedPointOfSale: record.published_point_of_sale,
    publishedPinterest: record.published_pinterest,
    active: record.active,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function withProductDefaults(record: Partial<GuildSalesProductRecord>) {
  return {
    ...record,
    description: record.description ?? "",
    media_urls: record.media_urls ?? [],
    price_amount: record.price_amount ?? 0,
    compare_at_price_amount: record.compare_at_price_amount ?? null,
    unit_price_amount: record.unit_price_amount ?? null,
    charge_taxes: record.charge_taxes ?? true,
    cost_per_item_amount: record.cost_per_item_amount ?? null,
    inventory_tracked: record.inventory_tracked ?? true,
    stock_quantity: record.stock_quantity ?? 0,
    sku: record.sku ?? "",
    barcode: record.barcode ?? "",
    barcode_mode: record.barcode_mode ?? "auto",
    product_type: record.product_type ?? "",
    manufacturer: record.manufacturer ?? "",
    tags: record.tags ?? [],
    theme_model: record.theme_model ?? "default",
    discord_publication_mode: record.discord_publication_mode ?? "online_only",
    discord_channel_id: record.discord_channel_id ?? null,
    discord_message_id: record.discord_message_id ?? null,
    discord_last_synced_at: record.discord_last_synced_at ?? null,
    discord_sync_status: record.discord_sync_status ?? "idle",
    discord_sync_error: record.discord_sync_error ?? null,
    published_virtual_store: record.published_virtual_store ?? true,
    published_point_of_sale: record.published_point_of_sale ?? false,
    published_pinterest: record.published_pinterest ?? false,
    active: record.active ?? true,
  } as GuildSalesProductRecord;
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
        { ok: false, message: "Voce nao possui permissao para gerenciar produtos." },
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

async function findProductByCode(guildId: string, productCode: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_products")
    .select(PRODUCT_SELECT)
    .eq("guild_id", guildId)
    .limit(300);

  let data = result.data as Partial<GuildSalesProductRecord>[] | null;
  let error = result.error;

  if (result.error && isMissingSalesProductsColumn(result.error)) {
    const fallback = await supabase
      .from("guild_sales_products")
      .select(PRODUCT_BASE_SELECT)
      .eq("guild_id", guildId)
      .limit(300);
    data = fallback.data as Partial<GuildSalesProductRecord>[] | null;
    error = fallback.error;
  }

  if (error) {
    if (isMissingSalesProductsTable(error)) return null;
    throw new Error(error.message);
  }

  return (data || [])
    .map(withProductDefaults)
    .find((record) => buildProductCode(record.id) === productCode);
}

async function validateProductCategory(
  guildId: string,
  categoryId: string | null,
) {
  if (!categoryId) return null;

  const supabase = getSupabaseAdminClientOrThrow();
  const categoryResult = await supabase
    .from("guild_sales_categories")
    .select("id, title")
    .eq("id", categoryId)
    .eq("guild_id", guildId)
    .maybeSingle();

  if (categoryResult.error) throw new Error(categoryResult.error.message);
  if (!categoryResult.data) {
    return "Categoria selecionada nao foi encontrada.";
  }

  return null;
}

async function refreshCategoryProductCounts(guildId: string, categoryIds: Array<string | null>) {
  const uniqueCategoryIds = Array.from(
    new Set(categoryIds.filter((categoryId): categoryId is string => Boolean(categoryId))),
  );
  if (!uniqueCategoryIds.length) return;

  const supabase = getSupabaseAdminClientOrThrow();
  await Promise.all(
    uniqueCategoryIds.map(async (categoryId) => {
      const countResult = await supabase
        .from("guild_sales_products")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", guildId)
        .eq("category_id", categoryId);

      if (countResult.error) throw new Error(countResult.error.message);

      const updateResult = await supabase
        .from("guild_sales_categories")
        .update({ products_count: countResult.count || 0 })
        .eq("guild_id", guildId)
        .eq("id", categoryId);

      if (updateResult.error) throw new Error(updateResult.error.message);
    }),
  );
}

async function calculateProductAvailableStockQuantity(
  guildId: string,
  productId: string,
  fallbackQuantity = 0,
) {
  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_stock_items")
    .select("quantity")
    .eq("guild_id", guildId)
    .eq("product_id", productId)
    .eq("status", "available");

  if (result.error) {
    const message = result.error.message.toLowerCase();
    if (result.error.code === "42P01" || message.includes("guild_sales_stock_items")) {
      return Math.max(0, Math.floor(Number(fallbackQuantity) || 0));
    }
    throw new Error(result.error.message);
  }

  return (result.data || []).reduce(
    (total, item) => total + Math.max(0, Number(item.quantity || 0)),
    0,
  );
}

async function validateDiscordPublicationInput(input: {
  guildId: string;
  mode: string;
  channelId: string;
}) {
  if (input.mode !== "channel") {
    return {
      ok: true as const,
      channelId: null as string | null,
    };
  }

  if (!isGuildId(input.channelId)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          message:
            "Selecione um canal Discord ou use a opcao Somente online antes de salvar.",
        },
        { status: 400 },
      ),
    };
  }

  const rawChannels = await fetchGuildChannelsByBot(input.guildId);
  if (!rawChannels) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Bot nao possui acesso aos canais deste servidor." },
        { status: 403 },
      ),
    };
  }

  const channel = rawChannels.find((item) => item.id === input.channelId);
  if (!channel || !isValidTextChannelType(channel.type)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          message: "Canal Discord invalido para publicar o embed do produto.",
        },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true as const,
    channelId: input.channelId,
  };
}

async function persistAndApplyDiscordSyncState(input: {
  product: GuildSalesProductRecord;
  mode: "online_only" | "channel";
  messageId: string | null;
  status: SalesProductDiscordSyncStatus;
  error: string | null;
}) {
  const syncedAt = input.status === "synced" ? new Date().toISOString() : null;
  await persistSalesProductDiscordSyncState({
    productId: input.product.id,
    guildId: input.product.guild_id,
    mode: input.mode,
    messageId: input.messageId,
    status: input.status,
    error: input.error,
  });

  return {
    ...input.product,
    discord_message_id: input.mode === "channel" ? input.messageId : null,
    discord_last_synced_at: syncedAt,
    discord_sync_status: input.status,
    discord_sync_error: input.error,
  };
}

function buildDiscordSyncWarning(error: string) {
  return [
    "Produto nao foi salvo porque o Discord recusou a publicacao do embed.",
    error,
    "Confira o canal, as permissoes do bot e tente salvar novamente. Nenhuma alteracao foi mantida no catalogo.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildProductRollbackPayload(product: GuildSalesProductRecord) {
  return {
    title: product.title,
    description: product.description,
    category_id: product.category_id,
    status: product.status,
    media_urls: product.media_urls,
    price_amount: product.price_amount,
    compare_at_price_amount: product.compare_at_price_amount,
    unit_price_amount: product.unit_price_amount,
    charge_taxes: product.charge_taxes,
    cost_per_item_amount: product.cost_per_item_amount,
    inventory_tracked: product.inventory_tracked,
    stock_quantity: product.stock_quantity,
    sku: product.sku,
    barcode: product.barcode,
    barcode_mode: product.barcode_mode,
    product_type: product.product_type,
    manufacturer: product.manufacturer,
    tags: product.tags,
    theme_model: product.theme_model,
    discord_publication_mode: product.discord_publication_mode,
    discord_channel_id: product.discord_channel_id,
    discord_message_id: product.discord_message_id,
    discord_last_synced_at: product.discord_last_synced_at,
    discord_sync_status: product.discord_sync_status,
    discord_sync_error: product.discord_sync_error,
    published_virtual_store: product.published_virtual_store,
    published_point_of_sale: product.published_point_of_sale,
    published_pinterest: product.published_pinterest,
    active: product.active,
  };
}

async function restoreProductAfterFailedSync(product: GuildSalesProductRecord) {
  const result = await getSupabaseAdminClientOrThrow()
    .from("guild_sales_products")
    .update(buildProductRollbackPayload(product))
    .eq("guild_id", product.guild_id)
    .eq("id", product.id);

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function removeCreatedProductAfterFailedSync(product: GuildSalesProductRecord) {
  const supabase = getSupabaseAdminClientOrThrow();
  const hardDelete = await supabase
    .from("guild_sales_products")
    .delete()
    .eq("guild_id", product.guild_id)
    .eq("id", product.id);

  if (!hardDelete.error) {
    return;
  }

  const softDelete = await supabase
    .from("guild_sales_products")
    .update({
      active: false,
      status: "archived",
      discord_publication_mode: "online_only",
      discord_channel_id: null,
      discord_message_id: null,
      discord_last_synced_at: null,
      discord_sync_status: "idle",
      discord_sync_error: null,
    })
    .eq("guild_id", product.guild_id)
    .eq("id", product.id);

  if (softDelete.error) {
    throw new Error(softDelete.error.message);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = (url.searchParams.get("guildId") || "").trim();
    const productCode = normalizeProductCode(url.searchParams.get("productCode"));
    const categoryId = getTrimmedText(url.searchParams.get("categoryId"), 60);

    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Guild ID invalido." },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const supabase = getSupabaseAdminClientOrThrow();
    if (productCode) {
      const product = await findProductByCode(guildId, productCode);
      if (!product) {
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Produto nao encontrado." },
            { status: 404 },
          ),
        );
      }

      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          product: buildProductResponse(product),
        }),
      );
    }

    let query = supabase
      .from("guild_sales_products")
      .select(PRODUCT_SELECT)
      .eq("guild_id", guildId)
      .eq("active", true)
      .order("created_at", { ascending: false });

    if (categoryId && isUuid(categoryId)) {
      query = query.eq("category_id", categoryId);
    }

    const result = await query.limit(200);
    let data = result.data as Partial<GuildSalesProductRecord>[] | null;
    let error = result.error;

    if (error) {
      if (isMissingSalesProductsTable(error)) {
        return applyNoStoreHeaders(NextResponse.json({ ok: true, products: [] }));
      }
      if (isMissingSalesProductsColumn(error)) {
        let fallbackQuery = supabase
          .from("guild_sales_products")
          .select(PRODUCT_BASE_SELECT)
          .eq("guild_id", guildId)
          .order("created_at", { ascending: false });

        if (categoryId && isUuid(categoryId)) {
          fallbackQuery = fallbackQuery.eq("category_id", categoryId);
        }

        const fallback = await fallbackQuery.limit(200);
        data = fallback.data as Partial<GuildSalesProductRecord>[] | null;
        error = fallback.error;
      }
    }

    if (error) {
      if (isMissingSalesProductsTable(error)) {
        return applyNoStoreHeaders(NextResponse.json({ ok: true, products: [] }));
      }
      throw new Error(error.message);
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        products: (data || [])
          .map(withProductDefaults)
          .map(buildProductResponse),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: resolveSalesProductsErrorMessage(error, "Erro ao carregar produtos."),
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
    const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const guildId = getTrimmedText(rawBody.guildId, 32);
    const productCode = normalizeProductCode(rawBody.productCode);

    if (!isGuildId(guildId) || !productCode) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Parametros invalidos." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const product = await findProductByCode(guildId, productCode);
    if (!product) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Produto nao encontrado." }, { status: 404 }),
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    await markSalesProductDiscordMessageUnavailable({
      product: {
        id: product.id,
        guild_id: product.guild_id,
        title: product.title,
        description: product.description,
        media_urls: product.media_urls,
        price_amount: product.price_amount,
        stock_quantity: product.stock_quantity,
        discord_publication_mode: product.discord_publication_mode,
        discord_channel_id: product.discord_channel_id,
        discord_message_id: product.discord_message_id,
      },
    }).catch((error) => {
      console.warn("[sales-products] failed to mark deleted product unavailable on Discord", {
        guildId,
        productId: product.id,
        error: extractAuditErrorMessage(error),
      });
    });

    const hardDelete = await supabase
      .from("guild_sales_products")
      .delete()
      .eq("guild_id", guildId)
      .eq("id", product.id);

    if (hardDelete.error) {
      const softDelete = await supabase
        .from("guild_sales_products")
        .update({
          active: false,
          status: "archived",
          discord_publication_mode: "online_only",
          discord_channel_id: null,
          discord_message_id: null,
          discord_sync_status: "idle",
          discord_sync_error: null,
        })
        .eq("guild_id", guildId)
        .eq("id", product.id);

      if (softDelete.error) throw new Error(softDelete.error.message);
    }

    await refreshCategoryProductCounts(guildId, [product.category_id]);

    return applyNoStoreHeaders(NextResponse.json({ ok: true }));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: resolveSalesProductsErrorMessage(error, "Erro ao excluir produto."),
        },
        { status: 500 },
      ),
    );
  }
}

export async function PATCH(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) {
    return applyNoStoreHeaders(invalidMutationResponse);
  }

  try {
    const rawBody =
      (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const guildId = getTrimmedText(rawBody.guildId, 25);
    const productCode = normalizeProductCode(rawBody.productCode);
    const title = getTrimmedText(rawBody.title, PRODUCT_TITLE_MAX_LENGTH);
    const description = getTrimmedText(
      rawBody.description,
      PRODUCT_DESCRIPTION_MAX_LENGTH,
    );
    const categoryId = getTrimmedText(rawBody.categoryId, 60);
    const mediaUrls = normalizeMediaUrls(rawBody.mediaUrls);
    const tags = normalizeStringArray(rawBody.tags, 12, 36);
    const status = normalizeStatus(rawBody.status);
    const themeModel = normalizeThemeModel(rawBody.themeModel);
    const discordPublicationMode = normalizeDiscordPublicationMode(
      rawBody.discordPublicationMode,
    );
    const discordChannelId = getTrimmedText(rawBody.discordChannelId, 25);
    const barcodeMode = normalizeBarcodeMode(rawBody.barcodeMode);

    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Guild ID invalido." },
          { status: 400 },
        ),
      );
    }

    if (!productCode) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Codigo do produto invalido." },
          { status: 400 },
        ),
      );
    }

    if (title.length < 2) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Informe um titulo com pelo menos 2 caracteres." },
          { status: 400 },
        ),
      );
    }

    const safeCategoryId = categoryId && isUuid(categoryId) ? categoryId : null;
    if (!safeCategoryId) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Escolha uma categoria para salvar o produto." },
          { status: 400 },
        ),
      );
    }
    if (!hasRequiredMoneyInput(rawBody.priceAmount)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Informe um preco valido para salvar o produto. Pode ser 0, mas nao pode ficar vazio.",
          },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const product = await findProductByCode(guildId, productCode);
    if (!product) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Produto nao encontrado." },
          { status: 404 },
        ),
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const categoryError = await validateProductCategory(guildId, safeCategoryId);
    if (categoryError) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: categoryError },
          { status: 400 },
        ),
      );
    }

    const discordPublication = await validateDiscordPublicationInput({
      guildId,
      mode: discordPublicationMode,
      channelId: discordChannelId,
    });
    if (!discordPublication.ok) {
      return applyNoStoreHeaders(discordPublication.response);
    }

    const result = await supabase
      .from("guild_sales_products")
      .update({
        title,
        description,
        category_id: safeCategoryId,
        status,
        media_urls: mediaUrls,
        price_amount: toMoney(rawBody.priceAmount),
        compare_at_price_amount: toOptionalMoney(rawBody.compareAtPriceAmount),
        unit_price_amount: toOptionalMoney(rawBody.unitPriceAmount),
        charge_taxes: rawBody.chargeTaxes !== false,
        cost_per_item_amount: toOptionalMoney(rawBody.costPerItemAmount),
        inventory_tracked: rawBody.inventoryTracked !== false,
        stock_quantity: await calculateProductAvailableStockQuantity(
          guildId,
          product.id,
          product.stock_quantity || 0,
        ),
        sku: getTrimmedText(rawBody.sku, PRODUCT_TEXT_MAX_LENGTH),
        barcode: getTrimmedText(rawBody.barcode, PRODUCT_TEXT_MAX_LENGTH),
        barcode_mode: barcodeMode,
        product_type: getTrimmedText(rawBody.productType, PRODUCT_TEXT_MAX_LENGTH),
        manufacturer: getTrimmedText(rawBody.manufacturer, PRODUCT_TEXT_MAX_LENGTH),
        tags,
        theme_model: themeModel,
        discord_publication_mode: discordPublicationMode,
        discord_channel_id: discordPublication.channelId,
        ...(discordPublicationMode === "channel" &&
        discordPublication.channelId === product.discord_channel_id
          ? {}
          : {
              discord_message_id: null,
              discord_last_synced_at: null,
              discord_sync_status: "idle",
              discord_sync_error: null,
            }),
        published_virtual_store: rawBody.publishedVirtualStore !== false,
        published_point_of_sale: false,
        published_pinterest: false,
      })
      .eq("id", product.id)
      .eq("guild_id", guildId)
      .select(PRODUCT_SELECT)
      .single();

    if (result.error) throw new Error(result.error.message);
    let savedProduct = result.data as GuildSalesProductRecord;
    await refreshCategoryProductCounts(guildId, [product.category_id, safeCategoryId]);

    if (discordPublicationMode === "channel") {
      try {
        const sync = await syncSalesProductDiscordMessage({
          product: savedProduct,
        });
        savedProduct = await persistAndApplyDiscordSyncState({
          product: savedProduct,
          mode: discordPublicationMode,
          messageId: sync.messageId,
          status: sync.status,
          error: null,
        });
      } catch (error) {
        const discordSyncError = extractAuditErrorMessage(
          error,
          "Erro ao sincronizar embed do produto.",
        );
        await restoreProductAfterFailedSync(product);
        await refreshCategoryProductCounts(guildId, [product.category_id, safeCategoryId]);
        console.warn("[sales-products] Discord product embed sync failed", {
          guildId,
          productId: savedProduct.id,
          channelId: savedProduct.discord_channel_id,
          error: extractAuditErrorMessage(error, discordSyncError),
        });

        return applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              code: "DISCORD_PRODUCT_EMBED_SYNC_FAILED",
              message: buildDiscordSyncWarning(discordSyncError),
              discordSync: {
                status: "failed",
                error: discordSyncError,
                channelId: savedProduct.discord_channel_id,
                messageId: savedProduct.discord_message_id,
              },
            },
            { status: 502 },
          ),
        );
      }
    } else {
      savedProduct = await persistAndApplyDiscordSyncState({
        product: savedProduct,
        mode: discordPublicationMode,
        messageId: null,
        status: "idle",
        error: null,
      });
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        product: buildProductResponse(savedProduct),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: resolveSalesProductsErrorMessage(error, "Erro ao atualizar produto."),
        },
        { status: 500 },
      ),
    );
  }
}

export async function POST(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) {
    return applyNoStoreHeaders(invalidMutationResponse);
  }

  try {
    const rawBody =
      (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const guildId = getTrimmedText(rawBody.guildId, 25);
    const title = getTrimmedText(rawBody.title, PRODUCT_TITLE_MAX_LENGTH);
    const description = getTrimmedText(
      rawBody.description,
      PRODUCT_DESCRIPTION_MAX_LENGTH,
    );
    const categoryId = getTrimmedText(rawBody.categoryId, 60);
    const mediaUrls = normalizeMediaUrls(rawBody.mediaUrls);
    const tags = normalizeStringArray(rawBody.tags, 12, 36);
    const status = normalizeStatus(rawBody.status);
    const themeModel = normalizeThemeModel(rawBody.themeModel);
    const discordPublicationMode = normalizeDiscordPublicationMode(
      rawBody.discordPublicationMode,
    );
    const discordChannelId = getTrimmedText(rawBody.discordChannelId, 25);
    const barcodeMode = normalizeBarcodeMode(rawBody.barcodeMode);

    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Guild ID invalido." },
          { status: 400 },
        ),
      );
    }

    if (title.length < 2) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Informe um titulo com pelo menos 2 caracteres." },
          { status: 400 },
        ),
      );
    }

    const safeCategoryId = categoryId && isUuid(categoryId) ? categoryId : null;
    if (!safeCategoryId) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Escolha uma categoria para salvar o produto." },
          { status: 400 },
        ),
      );
    }
    if (!hasRequiredMoneyInput(rawBody.priceAmount)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Informe um preco valido para salvar o produto. Pode ser 0, mas nao pode ficar vazio.",
          },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const supabase = getSupabaseAdminClientOrThrow();
    const categoryError = await validateProductCategory(guildId, safeCategoryId);
    if (categoryError) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: categoryError },
          { status: 400 },
        ),
      );
    }

    const discordPublication = await validateDiscordPublicationInput({
      guildId,
      mode: discordPublicationMode,
      channelId: discordChannelId,
    });
    if (!discordPublication.ok) {
      return applyNoStoreHeaders(discordPublication.response);
    }

    const result = await supabase
      .from("guild_sales_products")
      .insert({
        guild_id: guildId,
        title,
        description,
        category_id: safeCategoryId,
        status,
        media_urls: mediaUrls,
        price_amount: toMoney(rawBody.priceAmount),
        compare_at_price_amount: toOptionalMoney(rawBody.compareAtPriceAmount),
        unit_price_amount: toOptionalMoney(rawBody.unitPriceAmount),
        charge_taxes: rawBody.chargeTaxes !== false,
        cost_per_item_amount: toOptionalMoney(rawBody.costPerItemAmount),
        inventory_tracked: rawBody.inventoryTracked !== false,
        stock_quantity: 0,
        sku: getTrimmedText(rawBody.sku, PRODUCT_TEXT_MAX_LENGTH),
        barcode: getTrimmedText(rawBody.barcode, PRODUCT_TEXT_MAX_LENGTH),
        barcode_mode: barcodeMode,
        product_type: getTrimmedText(rawBody.productType, PRODUCT_TEXT_MAX_LENGTH),
        manufacturer: getTrimmedText(rawBody.manufacturer, PRODUCT_TEXT_MAX_LENGTH),
        tags,
        theme_model: themeModel,
        discord_publication_mode: discordPublicationMode,
        discord_channel_id: discordPublication.channelId,
        discord_message_id: null,
        discord_last_synced_at: null,
        discord_sync_status: "idle",
        discord_sync_error: null,
        published_virtual_store: rawBody.publishedVirtualStore !== false,
        published_point_of_sale: false,
        published_pinterest: false,
        configured_by_user_id: access.context.authUserId,
      })
      .select(PRODUCT_SELECT)
      .single();

    if (result.error) throw new Error(result.error.message);
    let savedProduct = result.data as GuildSalesProductRecord;
    await refreshCategoryProductCounts(guildId, [safeCategoryId]);

    if (discordPublicationMode === "channel") {
      try {
        const sync = await syncSalesProductDiscordMessage({
          product: savedProduct,
        });
        savedProduct = await persistAndApplyDiscordSyncState({
          product: savedProduct,
          mode: discordPublicationMode,
          messageId: sync.messageId,
          status: sync.status,
          error: null,
        });
      } catch (error) {
        const discordSyncError = extractAuditErrorMessage(
          error,
          "Erro ao sincronizar embed do produto.",
        );
        await removeCreatedProductAfterFailedSync(savedProduct);
        await refreshCategoryProductCounts(guildId, [safeCategoryId]);
        console.warn("[sales-products] Discord product embed send failed", {
          guildId,
          productId: savedProduct.id,
          channelId: savedProduct.discord_channel_id,
          error: extractAuditErrorMessage(error, discordSyncError),
        });

        return applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              code: "DISCORD_PRODUCT_EMBED_SYNC_FAILED",
              message: buildDiscordSyncWarning(discordSyncError),
              discordSync: {
                status: "failed",
                error: discordSyncError,
                channelId: savedProduct.discord_channel_id,
                messageId: savedProduct.discord_message_id,
              },
            },
            { status: 502 },
          ),
        );
      }
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        product: buildProductResponse(savedProduct),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: resolveSalesProductsErrorMessage(error, "Erro ao salvar produto."),
        },
        { status: 500 },
      ),
    );
  }
}
