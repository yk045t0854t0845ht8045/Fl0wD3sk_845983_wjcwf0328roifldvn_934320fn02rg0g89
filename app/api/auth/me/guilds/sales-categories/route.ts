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
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const CATEGORY_TITLE_MAX_LENGTH = 90;
const CATEGORY_DESCRIPTION_MAX_LENGTH = 1200;
const SEO_TITLE_MAX_LENGTH = 90;
const SEO_DESCRIPTION_MAX_LENGTH = 180;
const CATEGORY_IMAGE_MAX_LENGTH = 4_500_000;
const CATEGORY_CODE_PATTERN = /^flw-[0-9]{8}$/i;
const SAFE_CATEGORY_IMAGE_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;
const CATEGORY_SELECT =
  "id, guild_id, title, description, collection_type, image_url, theme_model, discord_publication_mode, discord_channel_id, published_virtual_store, published_point_of_sale, seo_title, seo_description, products_count, active, sort_order, created_at, updated_at";
const GUILD_CATEGORY = 4;

type GuildSalesCategoryRecord = {
  id: string;
  guild_id: string;
  title: string;
  description: string | null;
  collection_type: string;
  image_url: string | null;
  theme_model: string;
  discord_publication_mode: string | null;
  discord_channel_id: string | null;
  published_virtual_store: boolean;
  published_point_of_sale: boolean;
  seo_title: string | null;
  seo_description: string | null;
  products_count: number | null;
  active: boolean;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

function getTrimmedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeImageUrl(value: unknown) {
  const imageUrl = getTrimmedText(value, CATEGORY_IMAGE_MAX_LENGTH);
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl) || SAFE_CATEGORY_IMAGE_DATA_URL_PATTERN.test(imageUrl)) {
    return imageUrl;
  }
  return null;
}

function normalizeCollectionType(value: unknown) {
  return value === "smart" ? "smart" : "manual";
}

function normalizeThemeModel(value: unknown) {
  return value === "compact" || value === "featured" ? value : "default";
}

function normalizeDiscordPublicationMode(value: unknown) {
  return value === "channel" ? "channel" : "online_only";
}

function isValidCategoryChannelType(type?: number) {
  return type === GUILD_CATEGORY;
}

function isMissingSalesCategoriesTable(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";
  return code === "42P01" || message.includes("guild_sales_categories");
}

function buildCategoryCode(id: string) {
  const digits = id.replace(/\D/g, "");
  const seed =
    digits ||
    Array.from(id).reduce((acc, char) => `${acc}${char.charCodeAt(0)}`, "");
  return `flw-${seed.padEnd(8, "0").slice(0, 8)}`;
}

function normalizeCategoryCode(value: unknown) {
  if (typeof value !== "string") return "";
  const code = value.trim().toLowerCase();
  return CATEGORY_CODE_PATTERN.test(code) ? code : "";
}

function buildInvalidPayloadResponse(error: FlowSecureDtoError) {
  return applyNoStoreHeaders(
    NextResponse.json(
      { ok: false, message: error.issues[0] || error.message },
      { status: error.statusCode },
    ),
  );
}

function readCategoryBody(payload: unknown, input?: { requireCategoryCode?: boolean }) {
  return parseFlowSecureDto(
    payload,
    {
      guildId: flowSecureDto.discordSnowflake(),
      ...(input?.requireCategoryCode
        ? {
            categoryCode: flowSecureDto.string({
              maxLength: 12,
              pattern: CATEGORY_CODE_PATTERN,
              disallowAngleBrackets: true,
              rejectThreatPatterns: false,
            }),
          }
        : {}),
      title: flowSecureDto.string({
        minLength: 2,
        maxLength: CATEGORY_TITLE_MAX_LENGTH,
        normalizeWhitespace: true,
      }),
      description: flowSecureDto.optional(
        flowSecureDto.string({
          maxLength: CATEGORY_DESCRIPTION_MAX_LENGTH,
          allowEmpty: true,
          normalizeWhitespace: true,
        }),
      ),
      seoTitle: flowSecureDto.optional(
        flowSecureDto.string({
          maxLength: SEO_TITLE_MAX_LENGTH,
          allowEmpty: true,
          normalizeWhitespace: true,
        }),
      ),
      seoDescription: flowSecureDto.optional(
        flowSecureDto.string({
          maxLength: SEO_DESCRIPTION_MAX_LENGTH,
          allowEmpty: true,
          normalizeWhitespace: true,
        }),
      ),
      collectionType: flowSecureDto.optional(flowSecureDto.enum(["manual", "smart"] as const)),
      themeModel: flowSecureDto.optional(
        flowSecureDto.enum(["default", "compact", "featured"] as const),
      ),
      discordPublicationMode: flowSecureDto.optional(
        flowSecureDto.enum(["online_only", "channel"] as const),
      ),
      discordChannelId: flowSecureDto.optional(
        flowSecureDto.nullable(
          flowSecureDto.string({
            maxLength: 25,
            allowEmpty: true,
            pattern: /^(\d{17,20})?$/,
            disallowAngleBrackets: true,
            rejectThreatPatterns: false,
          }),
        ),
      ),
      imageUrl: flowSecureDto.optional(
        flowSecureDto.nullable(
          flowSecureDto.string({
            maxLength: CATEGORY_IMAGE_MAX_LENGTH,
            allowEmpty: true,
            disallowAngleBrackets: true,
            rejectThreatPatterns: false,
          }),
        ),
      ),
      publishedVirtualStore: flowSecureDto.optional(flowSecureDto.boolean()),
      publishedPointOfSale: flowSecureDto.optional(flowSecureDto.boolean()),
    },
    { rejectUnknown: true },
  );
}

function buildCategoryResponse(
  record: GuildSalesCategoryRecord,
  productsCountOverride?: number,
) {
  return {
    id: record.id,
    code: buildCategoryCode(record.id),
    guildId: record.guild_id,
    title: record.title,
    description: record.description || "",
    collectionType: record.collection_type === "smart" ? "smart" : "manual",
    imageUrl: record.image_url,
    themeModel:
      record.theme_model === "compact" || record.theme_model === "featured"
        ? record.theme_model
        : "default",
    discordPublicationMode:
      record.discord_publication_mode === "channel" ? "channel" : "online_only",
    discordChannelId: record.discord_channel_id || "",
    publishedVirtualStore: record.published_virtual_store,
    publishedPointOfSale: record.published_point_of_sale,
    seoTitle: record.seo_title || "",
    seoDescription: record.seo_description || "",
    productsCount: productsCountOverride ?? record.products_count ?? 0,
    active: record.active,
    sortOrder: record.sort_order || 0,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

async function loadCategoryProductCounts(guildId: string, categoryIds: string[]) {
  const uniqueCategoryIds = Array.from(new Set(categoryIds.filter(Boolean)));
  if (!uniqueCategoryIds.length) return new Map<string, number>();

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_products")
    .select("category_id")
    .eq("guild_id", guildId)
    .in("category_id", uniqueCategoryIds)
    .limit(10_000);

  if (result.error) {
    if (isMissingSalesProductsTable(result.error)) return new Map<string, number>();
    throw new Error(result.error.message);
  }

  const counts = new Map<string, number>();
  (result.data || []).forEach((row) => {
    const categoryId =
      row && typeof row === "object" && typeof row.category_id === "string"
        ? row.category_id
        : "";
    if (categoryId) counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
  });
  return counts;
}

function isMissingSalesProductsTable(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";
  return code === "42P01" || message.includes("guild_sales_products");
}

async function findCategoryByCode(guildId: string, categoryCode: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_sales_categories")
    .select(CATEGORY_SELECT)
    .eq("guild_id", guildId)
    .limit(300);

  if (result.error) throw new Error(result.error.message);

  return ((result.data || []) as GuildSalesCategoryRecord[]).find(
    (record) => buildCategoryCode(record.id) === categoryCode,
  );
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
        { ok: false, message: "Voce nao possui permissao para gerenciar categorias." },
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
            "Selecione uma categoria Discord ou use a opcao Somente online antes de salvar.",
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
  if (!channel || !isValidCategoryChannelType(channel.type)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Categoria Discord invalida para a categoria da loja." },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true as const,
    channelId: input.channelId,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = (url.searchParams.get("guildId") || "").trim();
    const categoryCode = normalizeCategoryCode(url.searchParams.get("categoryCode"));

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
    if (categoryCode) {
      const category = await findCategoryByCode(guildId, categoryCode);
      if (!category) {
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Categoria nao encontrada." },
            { status: 404 },
          ),
        );
      }

      const counts = await loadCategoryProductCounts(guildId, [category.id]);
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          category: buildCategoryResponse(category, counts.get(category.id) || 0),
        }),
      );
    }

    const result = await supabase
      .from("guild_sales_categories")
      .select(CATEGORY_SELECT)
      .eq("guild_id", guildId)
      .eq("active", true)
      .order("active", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (result.error) {
      if (isMissingSalesCategoriesTable(result.error)) {
        return applyNoStoreHeaders(NextResponse.json({ ok: true, categories: [] }));
      }
      throw new Error(result.error.message);
    }

    const categories = (result.data || []) as GuildSalesCategoryRecord[];
    const counts = await loadCategoryProductCounts(
      guildId,
      categories.map((category) => category.id),
    );

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        categories: categories.map((category) =>
          buildCategoryResponse(category, counts.get(category.id) || 0),
        ),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao carregar categorias de vendas.",
          ),
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
      rawBody = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.discordSnowflake(),
          categoryCode: flowSecureDto.string({
            maxLength: 12,
            pattern: CATEGORY_CODE_PATTERN,
            disallowAngleBrackets: true,
            rejectThreatPatterns: false,
          }),
        },
        { rejectUnknown: true },
      );
    } catch (error) {
      if (error instanceof FlowSecureDtoError) {
        return buildInvalidPayloadResponse(error);
      }
      throw error;
    }
    const guildId = getTrimmedText(rawBody.guildId, 32);
    const categoryCode = normalizeCategoryCode(rawBody.categoryCode);

    if (!isGuildId(guildId) || !categoryCode) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Parametros invalidos." }, { status: 400 }),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const category = await findCategoryByCode(guildId, categoryCode);
    if (!category) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Categoria nao encontrada." }, { status: 404 }),
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase
      .from("guild_sales_categories")
      .delete()
      .eq("guild_id", guildId)
      .eq("id", category.id);

    if (result.error) throw new Error(result.error.message);

    return applyNoStoreHeaders(NextResponse.json({ ok: true }));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Erro ao excluir categoria de vendas."),
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
    let rawBody;
    try {
      rawBody = readCategoryBody(await request.json().catch(() => ({})));
    } catch (error) {
      if (error instanceof FlowSecureDtoError) {
        return buildInvalidPayloadResponse(error);
      }
      throw error;
    }
    const guildId = getTrimmedText(rawBody.guildId, 25);
    const title = getTrimmedText(rawBody.title, CATEGORY_TITLE_MAX_LENGTH);
    const description = getTrimmedText(
      rawBody.description,
      CATEGORY_DESCRIPTION_MAX_LENGTH,
    );
    const seoTitle = getTrimmedText(rawBody.seoTitle, SEO_TITLE_MAX_LENGTH);
    const seoDescription = getTrimmedText(
      rawBody.seoDescription,
      SEO_DESCRIPTION_MAX_LENGTH,
    );
    const collectionType = normalizeCollectionType(rawBody.collectionType);
    const themeModel = normalizeThemeModel(rawBody.themeModel);
    const discordPublicationMode = normalizeDiscordPublicationMode(
      rawBody.discordPublicationMode,
    );
    const discordChannelId = getTrimmedText(rawBody.discordChannelId, 25);
    const imageUrl = normalizeImageUrl(rawBody.imageUrl);
    const publishedVirtualStore = rawBody.publishedVirtualStore !== false;
    const publishedPointOfSale = false;

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

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const discordPublication = await validateDiscordPublicationInput({
      guildId,
      mode: discordPublicationMode,
      channelId: discordChannelId,
    });
    if (!discordPublication.ok) {
      return applyNoStoreHeaders(discordPublication.response);
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase
      .from("guild_sales_categories")
      .insert({
        guild_id: guildId,
        title,
        description,
        collection_type: collectionType,
        image_url: imageUrl,
        theme_model: themeModel,
        discord_publication_mode: discordPublicationMode,
        discord_channel_id: discordPublication.channelId,
        published_virtual_store: publishedVirtualStore,
        published_point_of_sale: publishedPointOfSale,
        seo_title: seoTitle || title,
        seo_description: seoDescription,
        configured_by_user_id: access.context.authUserId,
      })
      .select(
        CATEGORY_SELECT,
      )
      .single();

    if (result.error) throw new Error(result.error.message);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        category: buildCategoryResponse(result.data as GuildSalesCategoryRecord),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao salvar categoria de vendas.",
          ),
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
    let rawBody;
    try {
      rawBody = readCategoryBody(await request.json().catch(() => ({})), {
        requireCategoryCode: true,
      });
    } catch (error) {
      if (error instanceof FlowSecureDtoError) {
        return buildInvalidPayloadResponse(error);
      }
      throw error;
    }
    const guildId = getTrimmedText(rawBody.guildId, 25);
    const categoryCode = normalizeCategoryCode(rawBody.categoryCode);
    const title = getTrimmedText(rawBody.title, CATEGORY_TITLE_MAX_LENGTH);
    const description = getTrimmedText(
      rawBody.description,
      CATEGORY_DESCRIPTION_MAX_LENGTH,
    );
    const seoTitle = getTrimmedText(rawBody.seoTitle, SEO_TITLE_MAX_LENGTH);
    const seoDescription = getTrimmedText(
      rawBody.seoDescription,
      SEO_DESCRIPTION_MAX_LENGTH,
    );
    const collectionType = normalizeCollectionType(rawBody.collectionType);
    const themeModel = normalizeThemeModel(rawBody.themeModel);
    const discordPublicationMode = normalizeDiscordPublicationMode(
      rawBody.discordPublicationMode,
    );
    const discordChannelId = getTrimmedText(rawBody.discordChannelId, 25);
    const imageUrl = normalizeImageUrl(rawBody.imageUrl);
    const publishedVirtualStore = rawBody.publishedVirtualStore !== false;
    const publishedPointOfSale = false;

    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Guild ID invalido." },
          { status: 400 },
        ),
      );
    }

    if (!categoryCode) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Codigo da categoria invalido." },
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

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const category = await findCategoryByCode(guildId, categoryCode);
    if (!category) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Categoria nao encontrada." },
          { status: 404 },
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

    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase
      .from("guild_sales_categories")
      .update({
        title,
        description,
        collection_type: collectionType,
        image_url: imageUrl,
        theme_model: themeModel,
        discord_publication_mode: discordPublicationMode,
        discord_channel_id: discordPublication.channelId,
        published_virtual_store: publishedVirtualStore,
        published_point_of_sale: publishedPointOfSale,
        seo_title: seoTitle || title,
        seo_description: seoDescription,
      })
      .eq("id", category.id)
      .eq("guild_id", guildId)
      .select(CATEGORY_SELECT)
      .single();

    if (result.error) throw new Error(result.error.message);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        category: buildCategoryResponse(result.data as GuildSalesCategoryRecord),
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao atualizar categoria de vendas.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
