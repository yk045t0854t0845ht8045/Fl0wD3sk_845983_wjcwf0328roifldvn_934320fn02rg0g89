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

const CATEGORY_TITLE_MAX_LENGTH = 90;
const CATEGORY_DESCRIPTION_MAX_LENGTH = 1200;
const SEO_TITLE_MAX_LENGTH = 90;
const SEO_DESCRIPTION_MAX_LENGTH = 180;

type GuildSalesCategoryRecord = {
  id: string;
  guild_id: string;
  title: string;
  description: string | null;
  collection_type: string;
  image_url: string | null;
  theme_model: string;
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

function normalizeCollectionType(value: unknown) {
  return value === "smart" ? "smart" : "manual";
}

function normalizeThemeModel(value: unknown) {
  return value === "compact" || value === "featured" ? value : "default";
}

function isMissingSalesCategoriesTable(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : "";
  const message =
    typeof record.message === "string" ? record.message.toLowerCase() : "";
  return code === "42P01" || message.includes("guild_sales_categories");
}

function buildCategoryResponse(record: GuildSalesCategoryRecord) {
  return {
    id: record.id,
    guildId: record.guild_id,
    title: record.title,
    description: record.description || "",
    collectionType: record.collection_type === "smart" ? "smart" : "manual",
    imageUrl: record.image_url,
    themeModel:
      record.theme_model === "compact" || record.theme_model === "featured"
        ? record.theme_model
        : "default",
    publishedVirtualStore: record.published_virtual_store,
    publishedPointOfSale: record.published_point_of_sale,
    seoTitle: record.seo_title || "",
    seoDescription: record.seo_description || "",
    productsCount: record.products_count || 0,
    active: record.active,
    sortOrder: record.sort_order || 0,
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = (url.searchParams.get("guildId") || "").trim();

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
    const result = await supabase
      .from("guild_sales_categories")
      .select(
        "id, guild_id, title, description, collection_type, image_url, theme_model, published_virtual_store, published_point_of_sale, seo_title, seo_description, products_count, active, sort_order, created_at, updated_at",
      )
      .eq("guild_id", guildId)
      .order("active", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (result.error) {
      if (isMissingSalesCategoriesTable(result.error)) {
        return applyNoStoreHeaders(NextResponse.json({ ok: true, categories: [] }));
      }
      throw new Error(result.error.message);
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        categories: ((result.data || []) as GuildSalesCategoryRecord[]).map(
          buildCategoryResponse,
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

export async function POST(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) {
    return applyNoStoreHeaders(invalidMutationResponse);
  }

  try {
    const rawBody =
      (await request.json().catch(() => ({}))) as Record<string, unknown>;
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
    const imageUrl = getTrimmedText(rawBody.imageUrl, 500) || null;
    const publishedVirtualStore = rawBody.publishedVirtualStore !== false;
    const publishedPointOfSale = rawBody.publishedPointOfSale === true;

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
        published_virtual_store: publishedVirtualStore,
        published_point_of_sale: publishedPointOfSale,
        seo_title: seoTitle || title,
        seo_description: seoDescription,
        configured_by_user_id: access.context.authUserId,
      })
      .select(
        "id, guild_id, title, description, collection_type, image_url, theme_model, published_virtual_store, published_point_of_sale, seo_title, seo_description, products_count, active, sort_order, created_at, updated_at",
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
