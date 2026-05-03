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

const PRODUCT_TITLE_MAX_LENGTH = 120;
const PRODUCT_DESCRIPTION_MAX_LENGTH = 1800;
const PRODUCT_TEXT_MAX_LENGTH = 120;
const PRODUCT_SELECT =
  "id, guild_id, title, description, category_id, status, media_urls, price_amount, compare_at_price_amount, unit_price_amount, charge_taxes, cost_per_item_amount, inventory_tracked, stock_quantity, sku, barcode, barcode_mode, product_type, manufacturer, tags, theme_model, published_virtual_store, published_point_of_sale, published_pinterest, active, created_at, updated_at";

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
  published_virtual_store: boolean;
  published_point_of_sale: boolean;
  published_pinterest: boolean;
  active: boolean;
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

function toMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Number(value.toFixed(2)));
  }
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/[^\d,.-]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
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

function isMissingSalesProductsTable(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";
  return code === "42P01" || message.includes("guild_sales_products");
}

function buildProductCode(id: string) {
  const digits = id.replace(/\D/g, "");
  const seed =
    digits ||
    Array.from(id).reduce((acc, char) => `${acc}${char.charCodeAt(0)}`, "");
  return `prd-${seed.padEnd(8, "0").slice(0, 8)}`;
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
    publishedVirtualStore: record.published_virtual_store,
    publishedPointOfSale: record.published_point_of_sale,
    publishedPinterest: record.published_pinterest,
    active: record.active,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

async function ensureGuildAccess(
  guildId: string,
  requiredPermission: TeamRolePermission,
) {
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

  if (result.error) throw new Error(result.error.message);

  return ((result.data || []) as GuildSalesProductRecord[]).find(
    (record) => buildProductCode(record.id) === productCode,
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = (url.searchParams.get("guildId") || "").trim();
    const productCode = normalizeProductCode(url.searchParams.get("productCode"));

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

    const result = await supabase
      .from("guild_sales_products")
      .select(PRODUCT_SELECT)
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (result.error) {
      if (isMissingSalesProductsTable(result.error)) {
        return applyNoStoreHeaders(NextResponse.json({ ok: true, products: [] }));
      }
      throw new Error(result.error.message);
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        products: ((result.data || []) as GuildSalesProductRecord[]).map(
          buildProductResponse,
        ),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Erro ao carregar produtos."),
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
    const mediaUrls = normalizeStringArray(rawBody.mediaUrls, 8, 700);
    const tags = normalizeStringArray(rawBody.tags, 12, 36);
    const status = normalizeStatus(rawBody.status);
    const themeModel = normalizeThemeModel(rawBody.themeModel);
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
    if (safeCategoryId) {
      const categoryResult = await supabase
        .from("guild_sales_categories")
        .select("id")
        .eq("id", safeCategoryId)
        .eq("guild_id", guildId)
        .maybeSingle();

      if (categoryResult.error) throw new Error(categoryResult.error.message);
      if (!categoryResult.data) {
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Categoria selecionada nao foi encontrada." },
            { status: 400 },
          ),
        );
      }
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
        stock_quantity: Math.max(0, Math.floor(Number(rawBody.stockQuantity) || 0)),
        sku: getTrimmedText(rawBody.sku, PRODUCT_TEXT_MAX_LENGTH),
        barcode: getTrimmedText(rawBody.barcode, PRODUCT_TEXT_MAX_LENGTH),
        barcode_mode: barcodeMode,
        product_type: getTrimmedText(rawBody.productType, PRODUCT_TEXT_MAX_LENGTH),
        manufacturer: getTrimmedText(rawBody.manufacturer, PRODUCT_TEXT_MAX_LENGTH),
        tags,
        theme_model: themeModel,
        published_virtual_store: rawBody.publishedVirtualStore !== false,
        published_point_of_sale: rawBody.publishedPointOfSale !== false,
        published_pinterest: rawBody.publishedPinterest === true,
      })
      .eq("id", product.id)
      .eq("guild_id", guildId)
      .select(PRODUCT_SELECT)
      .single();

    if (result.error) throw new Error(result.error.message);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        product: buildProductResponse(result.data as GuildSalesProductRecord),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Erro ao atualizar produto."),
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
    const mediaUrls = normalizeStringArray(rawBody.mediaUrls, 8, 700);
    const tags = normalizeStringArray(rawBody.tags, 12, 36);
    const status = normalizeStatus(rawBody.status);
    const themeModel = normalizeThemeModel(rawBody.themeModel);
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
    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const supabase = getSupabaseAdminClientOrThrow();
    if (safeCategoryId) {
      const categoryResult = await supabase
        .from("guild_sales_categories")
        .select("id")
        .eq("id", safeCategoryId)
        .eq("guild_id", guildId)
        .maybeSingle();

      if (categoryResult.error) throw new Error(categoryResult.error.message);
      if (!categoryResult.data) {
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Categoria selecionada nao foi encontrada." },
            { status: 400 },
          ),
        );
      }
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
        stock_quantity: Math.max(0, Math.floor(Number(rawBody.stockQuantity) || 0)),
        sku: getTrimmedText(rawBody.sku, PRODUCT_TEXT_MAX_LENGTH),
        barcode: getTrimmedText(rawBody.barcode, PRODUCT_TEXT_MAX_LENGTH),
        barcode_mode: barcodeMode,
        product_type: getTrimmedText(rawBody.productType, PRODUCT_TEXT_MAX_LENGTH),
        manufacturer: getTrimmedText(rawBody.manufacturer, PRODUCT_TEXT_MAX_LENGTH),
        tags,
        theme_model: themeModel,
        published_virtual_store: rawBody.publishedVirtualStore !== false,
        published_point_of_sale: rawBody.publishedPointOfSale !== false,
        published_pinterest: rawBody.publishedPinterest === true,
        configured_by_user_id: access.context.authUserId,
      })
      .select(PRODUCT_SELECT)
      .single();

    if (result.error) throw new Error(result.error.message);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        product: buildProductResponse(result.data as GuildSalesProductRecord),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Erro ao salvar produto."),
        },
        { status: 500 },
      ),
    );
  }
}
