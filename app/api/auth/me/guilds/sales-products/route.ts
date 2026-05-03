import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
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
import {
  buildSalesProductDiscordPayload,
  salesProductMessageLooksManaged,
} from "@/lib/servers/salesProductDiscordPayload";

const PRODUCT_TITLE_MAX_LENGTH = 120;
const PRODUCT_DESCRIPTION_MAX_LENGTH = 1800;
const PRODUCT_TEXT_MAX_LENGTH = 120;
const PRODUCT_SELECT =
  "id, guild_id, title, description, category_id, status, media_urls, price_amount, compare_at_price_amount, unit_price_amount, charge_taxes, cost_per_item_amount, inventory_tracked, stock_quantity, sku, barcode, barcode_mode, product_type, manufacturer, tags, theme_model, discord_publication_mode, discord_channel_id, discord_message_id, discord_last_synced_at, discord_sync_status, discord_sync_error, published_virtual_store, published_point_of_sale, published_pinterest, active, created_at, updated_at";
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const DISCORD_RETRY_DELAYS_MS = [180, 420];

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

type DiscordChannelMessage = {
  id?: unknown;
  author?: { bot?: unknown } | null;
  components?: unknown;
};

type ProductCategorySnapshot = {
  id: string;
  title: string;
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

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

function isValidTextChannelType(type?: number) {
  return type === GUILD_TEXT || type === GUILD_ANNOUNCEMENT;
}

function formatProductPrice(value: number | string | null) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

async function requestDiscordWithBot<T>({
  url,
  botToken,
  method = "GET",
  body,
  resourceLabel,
}: {
  url: string;
  botToken: string;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  resourceLabel: string;
}) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= DISCORD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bot ${botToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });

      if (response.status === 404 && method === "GET") {
        return null as T;
      }

      if (!response.ok) {
        const text = await response.text();
        const isRetryable = response.status === 429 || response.status >= 500;

        if (isRetryable && attempt < DISCORD_RETRY_DELAYS_MS.length) {
          await sleep(DISCORD_RETRY_DELAYS_MS[attempt]);
          continue;
        }

        throw new Error(
          `Discord respondeu com erro ao ${resourceLabel}: ${text || response.statusText}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(`Falha ao ${resourceLabel}.`);

      if (attempt < DISCORD_RETRY_DELAYS_MS.length) {
        await sleep(DISCORD_RETRY_DELAYS_MS[attempt]);
        continue;
      }
    }
  }

  throw lastError || new Error(`Falha ao ${resourceLabel}.`);
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

async function resolveCategorySnapshot(
  guildId: string,
  categoryId: string | null,
) {
  if (!categoryId) return null;
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_categories")
    .select("id, title")
    .eq("id", categoryId)
    .eq("guild_id", guildId)
    .maybeSingle();

  if (result.error) throw new Error(result.error.message);
  return (result.data as ProductCategorySnapshot | null) || null;
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

async function syncSalesProductDiscordMessage(input: {
  product: GuildSalesProductRecord;
  category: ProductCategorySnapshot | null;
}) {
  if (input.product.discord_publication_mode !== "channel") {
    return {
      messageId: null,
      status: "idle" as const,
      error: null,
    };
  }

  const channelId = input.product.discord_channel_id;
  if (!channelId) {
    throw new Error("Canal Discord ausente para publicar o produto.");
  }

  const botToken = resolveBotToken();
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado no ambiente do site.");
  }

  const productCode = buildProductCode(input.product.id);
  const payload = buildSalesProductDiscordPayload({
    productCode,
    title: input.product.title,
    description: input.product.description || "",
    priceLabel: formatProductPrice(input.product.price_amount),
    categoryTitle: input.category?.title || null,
    sku: input.product.sku,
    stockQuantity: input.product.stock_quantity,
    mediaUrls: Array.isArray(input.product.media_urls)
      ? input.product.media_urls.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    paymentReady: false,
  });

  const storedMessageId = input.product.discord_message_id || "";
  const storedMessage = storedMessageId
    ? await requestDiscordWithBot<DiscordChannelMessage | null>({
        url: `https://discord.com/api/v10/channels/${channelId}/messages/${storedMessageId}`,
        botToken,
        resourceLabel: "buscar o embed do produto",
      })
    : null;

  const managedMessage =
    storedMessage && salesProductMessageLooksManaged(storedMessage, productCode)
      ? storedMessage
      : null;

  const dispatchedMessage =
    managedMessage && typeof managedMessage.id === "string"
      ? await requestDiscordWithBot<{ id: string }>({
          url: `https://discord.com/api/v10/channels/${channelId}/messages/${managedMessage.id}`,
          method: "PATCH",
          body: payload,
          botToken,
          resourceLabel: "atualizar o embed do produto",
        })
      : await requestDiscordWithBot<{ id: string }>({
          url: `https://discord.com/api/v10/channels/${channelId}/messages`,
          method: "POST",
          body: payload,
          botToken,
          resourceLabel: "enviar o embed do produto",
        });

  return {
    messageId: dispatchedMessage.id,
    status: "synced" as const,
    error: null,
  };
}

async function persistDiscordSyncState(input: {
  productId: string;
  guildId: string;
  mode: "online_only" | "channel";
  messageId: string | null;
  status: "idle" | "synced" | "failed";
  error: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_products")
    .update({
      discord_message_id: input.mode === "channel" ? input.messageId : null,
      discord_last_synced_at:
        input.status === "synced" ? new Date().toISOString() : null,
      discord_sync_status: input.status,
      discord_sync_error: input.error,
    })
    .eq("id", input.productId)
    .eq("guild_id", input.guildId)
    .select(PRODUCT_SELECT)
    .single();

  if (result.error) throw new Error(result.error.message);
  return result.data as GuildSalesProductRecord;
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
        stock_quantity: Math.max(0, Math.floor(Number(rawBody.stockQuantity) || 0)),
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
        published_point_of_sale: rawBody.publishedPointOfSale !== false,
        published_pinterest: rawBody.publishedPinterest === true,
      })
      .eq("id", product.id)
      .eq("guild_id", guildId)
      .select(PRODUCT_SELECT)
      .single();

    if (result.error) throw new Error(result.error.message);
    let savedProduct = result.data as GuildSalesProductRecord;

    if (discordPublicationMode === "channel") {
      try {
        const category = await resolveCategorySnapshot(guildId, safeCategoryId);
        const sync = await syncSalesProductDiscordMessage({
          product: savedProduct,
          category,
        });
        savedProduct = await persistDiscordSyncState({
          productId: savedProduct.id,
          guildId,
          mode: discordPublicationMode,
          messageId: sync.messageId,
          status: sync.status,
          error: null,
        });
      } catch (error) {
        savedProduct = await persistDiscordSyncState({
          productId: savedProduct.id,
          guildId,
          mode: discordPublicationMode,
          messageId: savedProduct.discord_message_id,
          status: "failed",
          error: sanitizeErrorMessage(error, "Erro ao sincronizar embed do produto."),
        });

        return applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              message: sanitizeErrorMessage(
                error,
                "Produto salvo, mas nao foi possivel sincronizar o embed no Discord.",
              ),
              product: buildProductResponse(savedProduct),
            },
            { status: 502 },
          ),
        );
      }
    } else {
      savedProduct = await persistDiscordSyncState({
        productId: savedProduct.id,
        guildId,
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
        stock_quantity: Math.max(0, Math.floor(Number(rawBody.stockQuantity) || 0)),
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
        published_point_of_sale: rawBody.publishedPointOfSale !== false,
        published_pinterest: rawBody.publishedPinterest === true,
        configured_by_user_id: access.context.authUserId,
      })
      .select(PRODUCT_SELECT)
      .single();

    if (result.error) throw new Error(result.error.message);
    let savedProduct = result.data as GuildSalesProductRecord;

    if (discordPublicationMode === "channel") {
      try {
        const category = await resolveCategorySnapshot(guildId, safeCategoryId);
        const sync = await syncSalesProductDiscordMessage({
          product: savedProduct,
          category,
        });
        savedProduct = await persistDiscordSyncState({
          productId: savedProduct.id,
          guildId,
          mode: discordPublicationMode,
          messageId: sync.messageId,
          status: sync.status,
          error: null,
        });
      } catch (error) {
        savedProduct = await persistDiscordSyncState({
          productId: savedProduct.id,
          guildId,
          mode: discordPublicationMode,
          messageId: savedProduct.discord_message_id,
          status: "failed",
          error: sanitizeErrorMessage(error, "Erro ao sincronizar embed do produto."),
        });

        return applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              message: sanitizeErrorMessage(
                error,
                "Produto salvo, mas nao foi possivel enviar o embed no Discord.",
              ),
              product: buildProductResponse(savedProduct),
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
          message: sanitizeErrorMessage(error, "Erro ao salvar produto."),
        },
        { status: 500 },
      ),
    );
  }
}
