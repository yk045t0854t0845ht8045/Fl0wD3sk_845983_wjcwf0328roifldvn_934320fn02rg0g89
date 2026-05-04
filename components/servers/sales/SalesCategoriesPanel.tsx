"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Globe2,
  Hash,
  LayoutGrid,
  ListFilter,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Tag,
  Upload,
  X,
} from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  ServerButton,
  ServerEmptyState,
  ServerIconFrame,
  ServerSectionHeading,
  ServerSurface,
  ServerTextInput,
} from "@/components/servers/ServerUi";
import { SalesDescriptionEditor } from "@/components/servers/sales/SalesDescriptionEditor";
import {
  coalescedClientFetch,
  invalidateClientCache,
  readClientCache,
  writeClientCache,
} from "@/lib/sales/clientCache";

type SalesCategory = {
  id: string;
  code: string;
  title: string;
  description: string;
  collectionType: "manual" | "smart";
  imageUrl?: string | null;
  themeModel: "default" | "compact" | "featured";
  discordPublicationMode?: "online_only" | "channel";
  discordChannelId?: string;
  publishedVirtualStore: boolean;
  publishedPointOfSale: boolean;
  seoTitle?: string;
  seoDescription?: string;
  productsCount: number;
  active: boolean;
  createdAt: string;
};

type SalesCategoriesResponse = {
  ok: boolean;
  message?: string;
  categories?: SalesCategory[];
};

type SalesCategoryCreateResponse = {
  ok: boolean;
  message?: string;
  category?: SalesCategory;
};

type SalesCategoryProduct = {
  id: string;
  code: string;
  title: string;
  description: string;
  mediaUrls: string[];
  priceAmount: number;
  stockQuantity: number;
  sku: string;
  status: "active" | "draft" | "archived";
};

type SalesCategoryProductsResponse = {
  ok: boolean;
  message?: string;
  products?: SalesCategoryProduct[];
};

type SalesCategoriesPanelProps = {
  guildId: string;
  readOnly?: boolean;
};

type DiscordChannel = {
  id: string;
  name: string;
  type: number;
};

type ChannelsResponse = {
  ok: boolean;
  message?: string;
  channels?: {
    text?: DiscordChannel[];
  };
};

const discordPublicationLabel = {
  online_only: "Somente online",
  channel: "Categoria Discord",
} as const;
const productSortOptions = ["Mais relevantes", "Mais recentes", "A-Z"] as const;
const CATEGORY_PRODUCTS_CACHE_TTL_MS = 5 * 60_000;
const CATEGORY_STALE_TTL_MS = 24 * 60 * 60_000;

type CacheEntry<T> = {
  expiresAt: number;
  data: T;
};

const categoryProductsCache = new Map<string, CacheEntry<SalesCategoryProduct[]>>();
const categoryChannelsCache = new Map<string, CacheEntry<DiscordChannel[]>>();
const categoriesListCache = new Map<string, CacheEntry<SalesCategory[]>>();
const categoryDetailCache = new Map<string, CacheEntry<SalesCategory>>();

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T) {
  cache.set(key, { data, expiresAt: Date.now() + CATEGORY_PRODUCTS_CACHE_TTL_MS });
}

function getCategoriesCacheKey(guildId: string) {
  return `flowdesk_sales_categories:${guildId}`;
}

function getCategoryCacheKey(guildId: string, categoryCode: string) {
  return `flowdesk_sales_category:${guildId}:${categoryCode}`;
}

function getCategoryProductsCacheKey(guildId: string, categoryId: string) {
  return `flowdesk_sales_category_products:${guildId}:${categoryId}`;
}

function getChannelsCacheKey(guildId: string) {
  return `flowdesk_sales_channels:${guildId}`;
}

function invalidateCategoryCaches(guildId: string) {
  categoriesListCache.delete(guildId);
  for (const key of categoryDetailCache.keys()) {
    if (key.startsWith(`${guildId}:`)) categoryDetailCache.delete(key);
  }
  invalidateClientCache(`flowdesk_sales_categories:${guildId}`);
  invalidateClientCache(`flowdesk_sales_category:${guildId}:`);
}

function getCategoriesPath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/categories/`;
}

function getCreatePath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/categories/create/`;
}

function getEditPath(guildId: string, categoryCode: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/categories/edit/${encodeURIComponent(categoryCode)}/`;
}

function getCategoryCodeFromPath(pathname: string | null) {
  const match = pathname?.match(/\/sales\/categories\/edit\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function revokeObjectUrl(url: string | null) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Agora";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function SalesCategoriesListPanel({
  guildId,
  readOnly = false,
}: SalesCategoriesPanelProps) {
  const router = useRouter();
  const [categories, setCategories] = useState<SalesCategory[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    const cached =
      readCache(categoriesListCache, guildId) ||
      readClientCache<SalesCategory[]>(getCategoriesCacheKey(guildId), CATEGORY_STALE_TTL_MS);
    if (cached) {
      setCategories(cached);
      writeCache(categoriesListCache, guildId, cached);
      setIsLoading(false);
      setErrorMessage(null);
    } else {
      setIsLoading(true);
    }
    setErrorMessage(null);

    try {
      const nextCategories = await coalescedClientFetch(
        getCategoriesCacheKey(guildId),
        async () => {
          const response = await fetch(
            `/api/auth/me/guilds/sales-categories?guildId=${encodeURIComponent(guildId)}`,
            {
              credentials: "include",
              cache: "no-store",
            },
          );
          const payload = (await response.json().catch(() => ({}))) as SalesCategoriesResponse;
          if (!response.ok || !payload.ok) {
            throw new Error(payload.message || "Erro ao carregar categorias.");
          }
          return payload.categories || [];
        },
      );
      setCategories(nextCategories);
      writeCache(categoriesListCache, guildId, nextCategories);
      writeClientCache(getCategoriesCacheKey(guildId), nextCategories);
      nextCategories.forEach((category) => {
        writeCache(categoryDetailCache, `${guildId}:${category.code}`, category);
        writeClientCache(getCategoryCacheKey(guildId, category.code), category);
      });
    } catch (error) {
      if (!cached) {
        setErrorMessage(
          error instanceof Error ? error.message : "Erro ao carregar categorias.",
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const filteredCategories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return categories;
    return categories.filter((category) =>
      `${category.title} ${category.description}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [categories, query]);

  const createDisabled = readOnly;

  return (
    <div className="space-y-[18px]">
      <ServerSectionHeading
        eyebrow="Vendas"
        title="Categorias da loja"
        description="Organize acessos, contas, passes, robux e qualquer colecao que depois tambem pode virar vitrine web."
        action={
          <ServerButton
            disabled={createDisabled}
            onClick={() => router.push(getCreatePath(guildId))}
            variant="primary"
            size="lg"
          >
            <Plus className="h-[16px] w-[16px]" />
            Adicionar Categoria
          </ServerButton>
        }
      />

      <ServerSurface className="overflow-hidden">
        <div className="flex flex-col gap-[12px] border-b border-[#171717] px-[18px] py-[16px] sm:flex-row sm:items-center sm:justify-between sm:px-[22px]">
          <div className="relative w-full sm:max-w-[360px]">
            <Search className="pointer-events-none absolute left-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#666]" />
            <ServerTextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar categorias"
              className="h-[42px] border-[#202020] pl-[40px] text-[13px]"
            />
          </div>
          <div className="inline-flex items-center gap-[8px] rounded-[14px] border border-[#202020] bg-[#0D0D0D] px-[12px] py-[10px] text-[12px] text-[#8C8C8C]">
            <ListFilter className="h-[15px] w-[15px]" />
            Lista unica
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-[1px] bg-[#171717]">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center gap-[14px] bg-[#0B0B0B] px-[18px] py-[16px] sm:px-[22px]"
              >
                <div className="h-[46px] w-[46px] animate-pulse rounded-[14px] bg-[#171717]" />
                <div className="min-w-0 flex-1 space-y-[8px]">
                  <div className="h-[12px] w-[180px] animate-pulse rounded-full bg-[#171717]" />
                  <div className="h-[10px] w-[320px] max-w-full animate-pulse rounded-full bg-[#151515]" />
                </div>
              </div>
            ))}
          </div>
        ) : errorMessage ? (
          <div className="px-[22px] py-[32px] text-center">
            <p className="text-[14px] font-medium text-[#E5E5E5]">
              Nao foi possivel carregar categorias.
            </p>
            <p className="mt-[8px] text-[13px] text-[#7B7B7B]">{errorMessage}</p>
            <ServerButton
              onClick={() => void loadCategories()}
              className="mt-[16px]"
            >
              Tentar novamente
            </ServerButton>
          </div>
        ) : filteredCategories.length ? (
          <div className="divide-y divide-[#171717]">
            {filteredCategories.map((category) => (
              <article
                key={category.id}
                className="flex flex-col gap-[14px] px-[18px] py-[16px] transition hover:bg-[#0E0E0E] sm:px-[22px] lg:flex-row lg:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-[14px]">
                  <ServerIconFrame>
                    <Tag className="h-[20px] w-[20px]" />
                  </ServerIconFrame>
                  <div className="min-w-0">
                    <h4 className="truncate text-[15px] font-semibold text-[#EDEDED]">
                      {category.title}
                    </h4>
                    <p className="mt-[4px] line-clamp-1 text-[13px] text-[#777]">
                      {category.description || "Sem descricao personalizada."}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-[8px] sm:flex sm:items-center">
                  <span className="rounded-full border border-[#232323] bg-[#111] px-[10px] py-[6px] text-center text-[12px] text-[#BDBDBD]">
                    {category.collectionType === "smart" ? "Inteligente" : "Manual"}
                  </span>
                  <span className="rounded-full border border-[#232323] bg-[#111] px-[10px] py-[6px] text-center text-[12px] text-[#BDBDBD]">
                    {category.productsCount} produtos
                  </span>
                  <span className="rounded-full border border-[#232323] bg-[#111] px-[10px] py-[6px] text-center text-[12px] text-[#BDBDBD]">
                    {formatDate(category.createdAt)}
                  </span>
                  <span className="rounded-full border border-[#1F3D2E] bg-[#0D1A13] px-[10px] py-[6px] text-center text-[12px] text-[#7CE2A0]">
                    {category.active ? "Ativa" : "Pausada"}
                  </span>
                  <button
                    type="button"
                    aria-label={`Editar ${category.title}`}
                    title="Editar categoria"
                    onClick={() => router.push(getEditPath(guildId, category.code))}
                    className="flowdesk-server-button inline-flex h-[34px] w-[34px] items-center justify-center rounded-[12px] border border-[#242424] bg-[#101010] text-[#DADADA] transition hover:border-[#3A3A3A] hover:bg-[#161616] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={readOnly}
                  >
                    <Pencil className="h-[15px] w-[15px]" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <ServerEmptyState
            icon={<ShoppingBag className="h-[24px] w-[24px]" />}
            title="Nenhuma categoria criada ainda."
            description="Crie a primeira categoria para separar produtos no bot e deixar a estrutura pronta para uma futura loja web."
          />
        )}
      </ServerSurface>
    </div>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function CategoryEditorSkeleton() {
  return (
    <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_398px]">
      <div className="space-y-[18px]">
        <ServerSurface className="p-[18px] sm:p-[22px]">
          <div className="h-[14px] w-[118px] animate-pulse rounded-full bg-[#1A1A1A]" />
          <div className="mt-[14px] h-[44px] animate-pulse rounded-[14px] bg-[#111]" />
          <div className="mt-[22px] h-[14px] w-[138px] animate-pulse rounded-full bg-[#1A1A1A]" />
          <div className="mt-[12px] h-[44px] animate-pulse rounded-[14px] bg-[#111]" />
          <div className="mt-[10px] h-[168px] animate-pulse rounded-[16px] bg-[#101010]" />
          <div className="mt-[10px] flex gap-[8px]">
            <div className="h-[34px] w-[96px] animate-pulse rounded-[12px] bg-[#141414]" />
            <div className="h-[34px] w-[86px] animate-pulse rounded-[12px] bg-[#141414]" />
            <div className="h-[34px] w-[72px] animate-pulse rounded-[12px] bg-[#141414]" />
          </div>
        </ServerSurface>
        <ServerSurface className="p-[18px] sm:p-[22px]">
          <div className="h-[14px] w-[156px] animate-pulse rounded-full bg-[#1A1A1A]" />
          <div className="mt-[18px] space-y-[14px]">
            <div className="h-[72px] animate-pulse rounded-[16px] bg-[#101010]" />
            <div className="h-[72px] animate-pulse rounded-[16px] bg-[#101010]" />
          </div>
        </ServerSurface>
        <ServerSurface className="p-[18px] sm:p-[22px]">
          <div className="h-[14px] w-[128px] animate-pulse rounded-full bg-[#1A1A1A]" />
          <div className="mt-[16px] h-[42px] animate-pulse rounded-[14px] bg-[#111]" />
          <div className="mt-[18px] h-[128px] animate-pulse rounded-[16px] bg-[#101010]" />
        </ServerSurface>
      </div>
      <aside className="space-y-[18px]">
        {Array.from({ length: 4 }).map((_, sectionIndex) => (
          <ServerSurface key={sectionIndex} className="p-[18px] sm:p-[20px]">
            <div className="h-[14px] w-[130px] animate-pulse rounded-full bg-[#1A1A1A]" />
            <div className="mt-[14px] h-[42px] animate-pulse rounded-[14px] bg-[#111]" />
            <div className="mt-[12px] h-[42px] animate-pulse rounded-[14px] bg-[#101010]" />
          </ServerSurface>
        ))}
      </aside>
    </div>
  );
}

export function SalesCategoryCreatePanel({
  guildId,
  readOnly = false,
  mode = "create",
  categoryCode = "",
}: SalesCategoriesPanelProps & {
  mode?: "create" | "edit";
  categoryCode?: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const discordMenuRef = useRef<HTMLDivElement | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [collectionType, setCollectionType] =
    useState<SalesCategory["collectionType"]>("manual");
  const [discordPublicationMode, setDiscordPublicationMode] =
    useState<"online_only" | "channel">("online_only");
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [publishedVirtualStore, setPublishedVirtualStore] = useState(true);
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [categoryProducts, setCategoryProducts] = useState<SalesCategoryProduct[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [imageName, setImageName] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isLoadingCategory, setIsLoadingCategory] = useState(mode === "edit");
  const [isLoadingCategoryProducts, setIsLoadingCategoryProducts] = useState(mode === "edit");
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [isDiscordMenuOpen, setIsDiscordMenuOpen] = useState(false);
  const [productSortIndex, setProductSortIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      revokeObjectUrl(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (mode !== "edit") return;

    const safeCategoryCode = categoryCode.trim().toLowerCase();
    if (!safeCategoryCode) {
      setStatusMessage("Codigo da categoria invalido.");
      setIsLoadingCategory(false);
      return;
    }

    let cancelled = false;

    async function loadCategory() {
      const cacheKey = `${guildId}:${safeCategoryCode}`;
      const cached =
        readCache(categoryDetailCache, cacheKey) ||
        readClientCache<SalesCategory>(
          getCategoryCacheKey(guildId, safeCategoryCode),
          CATEGORY_STALE_TTL_MS,
        );
      if (cached) {
        setSelectedCategoryId(cached.id);
        setTitle(cached.title);
        setDescription(cached.description || "");
        setCollectionType(cached.collectionType);
        setDiscordPublicationMode(
          cached.discordPublicationMode === "channel" ? "channel" : "online_only",
        );
        setDiscordChannelId(cached.discordChannelId || "");
        setPublishedVirtualStore(cached.publishedVirtualStore);
        setSeoTitle(cached.seoTitle || cached.title);
        setSeoDescription(cached.seoDescription || "");
        setImagePreviewUrl(cached.imageUrl || null);
        setImageName(cached.imageUrl ? "Imagem atual" : null);
        writeCache(categoryDetailCache, cacheKey, cached);
        setIsLoadingCategory(false);
      } else {
        setIsLoadingCategory(true);
      }
      setStatusMessage(null);

      try {
        const category = await coalescedClientFetch(
          getCategoryCacheKey(guildId, safeCategoryCode),
          async () => {
            const response = await fetch(
              `/api/auth/me/guilds/sales-categories?guildId=${encodeURIComponent(guildId)}&categoryCode=${encodeURIComponent(safeCategoryCode)}`,
              {
                credentials: "include",
                cache: "no-store",
              },
            );
            const payload = (await response.json().catch(() => ({}))) as SalesCategoryCreateResponse;

            if (!response.ok || !payload.ok || !payload.category) {
              throw new Error(payload.message || "Categoria nao encontrada.");
            }

            return payload.category;
          },
        );

        if (cancelled) return;

        setSelectedCategoryId(category.id);
        setTitle(category.title);
        setDescription(category.description || "");
        setCollectionType(category.collectionType);
        setDiscordPublicationMode(
          category.discordPublicationMode === "channel" ? "channel" : "online_only",
        );
        setDiscordChannelId(category.discordChannelId || "");
        setPublishedVirtualStore(category.publishedVirtualStore);
        setSeoTitle(category.seoTitle || category.title);
        setSeoDescription(category.seoDescription || "");
        setImagePreviewUrl(category.imageUrl || null);
        setImageName(category.imageUrl ? "Imagem atual" : null);
        writeCache(categoryDetailCache, cacheKey, category);
        writeClientCache(getCategoryCacheKey(guildId, safeCategoryCode), category);
      } catch (error) {
        if (cancelled) return;
        if (!cached) {
          setStatusMessage(
            error instanceof Error ? error.message : "Erro ao carregar categoria.",
          );
        }
      } finally {
        if (!cancelled) setIsLoadingCategory(false);
      }
    }

    void loadCategory();

    return () => {
      cancelled = true;
    };
  }, [categoryCode, guildId, mode]);

  useEffect(() => {
    if (mode !== "edit" || !selectedCategoryId) {
      setIsLoadingCategoryProducts(false);
      return;
    }

    const cacheKey = `${guildId}:${selectedCategoryId}`;
    const persistentKey = getCategoryProductsCacheKey(guildId, selectedCategoryId);
    const cached =
      readCache(categoryProductsCache, cacheKey) ||
      readClientCache<SalesCategoryProduct[]>(persistentKey, CATEGORY_STALE_TTL_MS);
    if (cached) {
      setCategoryProducts(cached);
      writeCache(categoryProductsCache, cacheKey, cached);
      setIsLoadingCategoryProducts(false);
    }

    let cancelled = false;

    async function loadCategoryProducts() {
      if (!cached) setIsLoadingCategoryProducts(true);
      try {
        const nextProducts = await coalescedClientFetch(
          persistentKey,
          async () => {
            const response = await fetch(
              `/api/auth/me/guilds/sales-products?guildId=${encodeURIComponent(guildId)}&categoryId=${encodeURIComponent(selectedCategoryId)}`,
              { credentials: "include", cache: "no-store" },
            );
            const payload = (await response.json().catch(() => ({}))) as SalesCategoryProductsResponse;
            if (!response.ok || !payload.ok) {
              throw new Error(payload.message || "Erro ao carregar produtos da categoria.");
            }
            return payload.products || [];
          },
        );
        if (cancelled) return;
        setCategoryProducts(nextProducts);
        writeCache(categoryProductsCache, cacheKey, nextProducts);
        writeClientCache(persistentKey, nextProducts);
      } catch (error) {
        if (cancelled) return;
        if (!cached) {
          setStatusMessage(
            error instanceof Error
              ? error.message
              : "Erro ao carregar produtos da categoria.",
          );
          setCategoryProducts([]);
        }
      } finally {
        if (!cancelled) setIsLoadingCategoryProducts(false);
      }
    }

    void loadCategoryProducts();

    return () => {
      cancelled = true;
    };
  }, [guildId, mode, selectedCategoryId]);

  useEffect(() => {
    if (!isDiscordMenuOpen) return;

    function handleOutsideClick(event: MouseEvent) {
      if (
        discordMenuRef.current &&
        event.target instanceof Node &&
        !discordMenuRef.current.contains(event.target)
      ) {
        setIsDiscordMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsDiscordMenuOpen(false);
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isDiscordMenuOpen]);

  useEffect(() => {
    const cached =
      readCache(categoryChannelsCache, guildId) ||
      readClientCache<DiscordChannel[]>(getChannelsCacheKey(guildId), CATEGORY_STALE_TTL_MS);
    if (cached) {
      setDiscordChannels(cached);
      writeCache(categoryChannelsCache, guildId, cached);
      setIsLoadingChannels(false);
    }

    let cancelled = false;

    async function loadChannels() {
      if (!cached) setIsLoadingChannels(true);
      try {
        const nextChannels = await coalescedClientFetch(
          getChannelsCacheKey(guildId),
          async () => {
            const response = await fetch(
              `/api/auth/me/guilds/channels?guildId=${encodeURIComponent(guildId)}`,
              { credentials: "include", cache: "no-store" },
            );
            const payload = (await response.json().catch(() => ({}))) as ChannelsResponse;
            if (!response.ok || !payload.ok) return [];
            return payload.channels?.text || [];
          },
        );
        if (!cancelled) {
          setDiscordChannels(nextChannels);
          writeCache(categoryChannelsCache, guildId, nextChannels);
          writeClientCache(getChannelsCacheKey(guildId), nextChannels);
        }
      } catch {
        if (!cancelled && !cached) setDiscordChannels([]);
      } finally {
        if (!cancelled) setIsLoadingChannels(false);
      }
    }

    void loadChannels();
    return () => {
      cancelled = true;
    };
  }, [guildId]);

  const goBack = useCallback(() => {
    router.push(getCategoriesPath(guildId));
  }, [guildId, router]);

  const isEditMode = mode === "edit";
  const hasDiscordPublicationTarget =
    discordPublicationMode === "online_only" || Boolean(discordChannelId);
  const canSave =
    title.trim().length >= 2 &&
    hasDiscordPublicationTarget &&
    !isSaving &&
    !isLoadingCategory &&
    !readOnly;
  const discordChannelOptions = useMemo(
    () => [["", "Escolha um canal Discord"], ...discordChannels.map((channel) => [channel.id, `#${channel.name}`])] as Array<[string, string]>,
    [discordChannels],
  );

  const handleImageFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setStatusMessage("Envie uma imagem valida para a categoria.");
        return;
      }

      const nextPreviewUrl = URL.createObjectURL(file);
      setImagePreviewUrl((current) => {
        revokeObjectUrl(current);
        return nextPreviewUrl;
      });
      setImageName(file.name);
      setStatusMessage(null);
    },
    [],
  );

  const clearImagePreview = useCallback(() => {
    setImagePreviewUrl((current) => {
      revokeObjectUrl(current);
      return null;
    });
    setImageName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const filteredCategoryProducts = useMemo(() => {
    const normalizedQuery = productQuery.trim().toLowerCase();
    const sortedProducts = [...categoryProducts].sort((a, b) => {
      if (productSortIndex === 1) return b.id.localeCompare(a.id);
      if (productSortIndex === 2) return a.title.localeCompare(b.title, "pt-BR");
      return Number(b.status === "active") - Number(a.status === "active");
    });
    if (!normalizedQuery) return sortedProducts;
    return sortedProducts.filter((product) =>
      `${product.title} ${product.description} ${product.sku}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [categoryProducts, productQuery, productSortIndex]);

  const handleProductSearch = useCallback(() => {
    if (!productQuery.trim()) return;
    setStatusMessage(null);
  }, [productQuery]);

  const cycleProductSort = useCallback(() => {
    setProductSortIndex((current) => (current + 1) % productSortOptions.length);
  }, []);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      setStatusMessage(
        title.trim().length < 2
          ? "Informe um titulo para salvar a categoria."
          : "Escolha Somente online ou selecione um canal Discord antes de salvar.",
      );
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/auth/me/guilds/sales-categories", {
        method: isEditMode ? "PATCH" : "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guildId,
          categoryCode: isEditMode ? categoryCode : undefined,
          title,
          description,
          collectionType,
          themeModel: "default",
          discordPublicationMode,
          discordChannelId:
            discordPublicationMode === "channel" ? discordChannelId : null,
          publishedVirtualStore,
          publishedPointOfSale: false,
          seoTitle,
          seoDescription,
          imageUrl:
            imagePreviewUrl && !imagePreviewUrl.startsWith("blob:")
              ? imagePreviewUrl
              : null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as SalesCategoryCreateResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Erro ao salvar categoria.");
      }

      invalidateCategoryCaches(guildId);
      router.push(getCategoriesPath(guildId));
      router.refresh();
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Erro ao salvar categoria.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    canSave,
    categoryCode,
    collectionType,
    description,
    discordChannelId,
    discordPublicationMode,
    guildId,
    imagePreviewUrl,
    isEditMode,
    publishedVirtualStore,
    router,
    seoDescription,
    seoTitle,
    title,
  ]);

  return (
    <div className="space-y-[18px]">
      <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <ServerButton
            onClick={goBack}
            variant="ghost"
            size="sm"
            className="px-[10px]"
          >
            <ArrowLeft className="h-[16px] w-[16px]" />
            Categorias
          </ServerButton>
          <div className="mt-[10px] flex items-center gap-[10px]">
            <Tag className="h-[18px] w-[18px] text-[#A5A5A5]" />
            <h3 className="text-[24px] font-semibold tracking-[-0.05em] text-[#EFEFEF]">
              {isEditMode ? "Editar categoria" : "Adicionar categoria"}
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-[10px]">
          <ServerButton
            onClick={goBack}
          >
            Cancelar
          </ServerButton>
          <ServerButton
            aria-busy={isSaving}
            disabled={!canSave}
            onClick={() => void handleSave()}
            variant="primary"
            className="min-w-[172px]"
          >
            {isSaving ? (
              <ButtonLoader size={16} colorClassName="text-[#080808]" />
            ) : (
              <>
                <Check className="h-[16px] w-[16px]" />
                Salvar categoria
              </>
            )}
          </ServerButton>
        </div>
      </div>

      {!isLoadingCategory && statusMessage ? (
        <div className="rounded-[18px] border border-[#3A2A1E] bg-[#170F09] px-[14px] py-[12px] text-[13px] text-[#F2B27D]">
          {statusMessage}
        </div>
      ) : null}

      {isLoadingCategory ? (
        <CategoryEditorSkeleton />
      ) : (
      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_398px]">
        <div className="space-y-[18px]">
          <ServerSurface className="p-[18px] sm:p-[22px]">
            <label className="block text-[13px] font-semibold text-[#D8D8D8]">
              Titulo
            </label>
            <ServerTextInput
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={90}
              placeholder="Ex.: Acessos, Contas, Passes, Robux"
              className="mt-[10px]"
            />

            <label className="mt-[20px] block text-[13px] font-semibold text-[#D8D8D8]">
              Descricao
            </label>
            <SalesDescriptionEditor
              guildId={guildId}
              kind="category"
              title={title}
              value={description}
              onChange={(nextDescription) => {
                setDescription(nextDescription);
                setStatusMessage(null);
              }}
              disabled={isLoadingCategory || isSaving || readOnly}
              maxLength={1200}
              placeholder="Descreva como essa categoria aparece para clientes e equipe."
            />
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[22px]">
            <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
              Tipo de categoria
            </h4>
            <div className="mt-[18px] space-y-[14px]">
              {[
                {
                  id: "manual" as const,
                  title: "Manual",
                  description:
                    "Adicione produtos a esta categoria um por um quando o modulo de produtos estiver ativo.",
                },
                {
                  id: "smart" as const,
                  title: "Inteligente",
                  description:
                    "Produtos existentes e futuros poderao entrar por regras automaticas em uma proxima etapa.",
                },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setCollectionType(option.id)}
                  className="flowdesk-server-button flex w-full items-start gap-[12px] rounded-[16px] border border-transparent p-[2px] text-left transition hover:border-[#222]"
                >
                  <span
                    className={`mt-[3px] flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border ${
                      collectionType === option.id
                        ? "border-[#EDEDED] bg-[#EDEDED]"
                        : "border-[#5E5E5E]"
                    }`}
                  >
                    {collectionType === option.id ? (
                      <span className="h-[7px] w-[7px] rounded-full bg-[#080808]" />
                    ) : null}
                  </span>
                  <span>
                    <span className="block text-[14px] font-semibold text-[#E4E4E4]">
                      {option.title}
                    </span>
                    <span className="mt-[5px] block text-[13px] leading-[1.55] text-[#7B7B7B]">
                      {option.description}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </ServerSurface>

          <ServerSurface className="overflow-hidden">
            <div className="p-[18px] sm:p-[22px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Produtos</h4>
              <div className="mt-[16px] flex flex-col gap-[10px] lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#666]" />
                  <ServerTextInput
                    value={productQuery}
                    onChange={(event) => setProductQuery(event.target.value)}
                    placeholder="Pesquisar produtos"
                    className="h-[42px] pl-[40px]"
                  />
                </div>
                <ServerButton onClick={handleProductSearch}>
                  Procurar
                </ServerButton>
                <ServerButton
                  onClick={cycleProductSort}
                  className="inline-flex h-[42px] items-center justify-between gap-[16px] rounded-[14px] border border-[#252525] px-[15px] text-[13px] text-[#BDBDBD] transition hover:border-[#3A3A3A] hover:bg-[#121212]"
                >
                  Classificar: {productSortOptions[productSortIndex]}
                  <ChevronDown className="h-[15px] w-[15px]" />
                </ServerButton>
              </div>
            </div>
            {isLoadingCategoryProducts ? (
              <div className="space-y-[1px] border-t border-[#171717] bg-[#171717]">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-[12px] bg-[#0B0B0B] px-[18px] py-[14px] sm:px-[22px]"
                  >
                    <div className="h-[42px] w-[42px] animate-pulse rounded-[14px] bg-[#171717]" />
                    <div className="min-w-0 flex-1 space-y-[8px]">
                      <div className="h-[12px] w-[180px] animate-pulse rounded-full bg-[#171717]" />
                      <div className="h-[10px] w-[260px] max-w-full animate-pulse rounded-full bg-[#151515]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredCategoryProducts.length ? (
              <div className="max-h-[340px] divide-y divide-[#171717] overflow-y-auto border-t border-[#171717] thin-scrollbar">
                {filteredCategoryProducts.map((product) => (
                  <article
                    key={product.id}
                    className="flex items-center gap-[12px] px-[18px] py-[14px] transition hover:bg-[#0E0E0E] sm:px-[22px]"
                  >
                    {product.mediaUrls[0] ? (
                      <Image
                        src={product.mediaUrls[0]}
                        alt=""
                        width={72}
                        height={72}
                        unoptimized
                        className="h-[42px] w-[42px] shrink-0 rounded-[14px] object-cover"
                      />
                    ) : (
                      <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] bg-[#F4F4F4] text-[#070707]">
                        <ShoppingBag className="h-[18px] w-[18px]" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-[#F1F1F1]">
                        {product.title}
                      </p>
                      <p className="mt-[4px] truncate text-[12px] text-[#777]">
                        {formatMoney(product.priceAmount)} - {product.sku || "SKU automatico"}
                      </p>
                    </div>
                    <span className="rounded-full border border-[#232323] bg-[#111] px-[9px] py-[6px] text-[11px] text-[#BDBDBD]">
                      {product.stockQuantity} un.
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="max-h-[320px] overflow-y-auto border-t border-[#171717] px-[22px] py-[42px] text-center">
                <PackageSearch className="mx-auto h-[42px] w-[42px] text-[#4E4E4E]" />
                <p className="mt-[18px] text-[14px] font-medium text-[#D9D9D9]">
                  {categoryProducts.length
                    ? "Nenhum produto encontrado."
                    : "Nao ha produtos nesta colecao."}
                </p>
                <p className="mt-[5px] text-[13px] text-[#777]">
                  {categoryProducts.length
                    ? "Ajuste a pesquisa para ver os produtos vinculados."
                    : "Ao vincular produtos a esta categoria, eles aparecem aqui."}
                </p>
              </div>
            )}
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[22px]">
            <div className="flex items-start justify-between gap-[16px]">
              <div>
                <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
                  Listagem em mecanismos de pesquisa
                </h4>
                <p className="mt-[12px] max-w-[680px] text-[13px] leading-[1.6] text-[#8A8A8A]">
                  Adicione um titulo e uma descricao para preparar como esta
                  categoria pode aparecer em buscas da futura loja web.
                </p>
              </div>
              <Pencil className="h-[18px] w-[18px] shrink-0 text-[#8B8B8B]" />
            </div>
            <div className="mt-[16px] grid gap-[10px] lg:grid-cols-2">
              <ServerTextInput
                value={seoTitle}
                onChange={(event) => setSeoTitle(event.target.value)}
                maxLength={90}
                placeholder="Titulo para busca"
                className="h-[42px] text-[13px]"
              />
              <ServerTextInput
                value={seoDescription}
                onChange={(event) => setSeoDescription(event.target.value)}
                maxLength={180}
                placeholder="Descricao para busca"
                className="h-[42px] text-[13px]"
              />
            </div>
          </ServerSurface>
        </div>

        <aside className="space-y-[18px]">
          <ServerSurface className="relative z-[30] p-[18px] sm:p-[20px]">
            <div className="flex items-center justify-between gap-[16px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
                Publicacao
              </h4>
              <Globe2 className="h-[17px] w-[17px] text-[#8A8A8A]" />
            </div>
            <label className="mt-[16px] flex items-center gap-[10px] text-[14px] text-[#CFCFCF]">
              <input
                type="checkbox"
                checked={publishedVirtualStore}
                onChange={(event) => setPublishedVirtualStore(event.target.checked)}
                className="h-[15px] w-[15px] accent-[#F1F1F1]"
              />
              Loja virtual
            </label>
          </ServerSurface>

          <ServerSurface className="relative z-[40] p-[18px] sm:p-[20px]">
            <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Imagem</h4>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => handleImageFile(event.target.files?.[0])}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleImageFile(event.dataTransfer.files?.[0]);
              }}
              className="flowdesk-server-button relative mt-[18px] flex min-h-[166px] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[18px] border border-dashed border-[#363636] bg-[#0D0D0D] px-[16px] text-center transition hover:border-[#585858] hover:bg-[#111]"
            >
              {imagePreviewUrl ? (
                <>
                  <Image
                    src={imagePreviewUrl}
                    alt={imageName || "Previa da categoria"}
                    width={720}
                    height={320}
                    unoptimized
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.72)_100%)]" />
                  <span className="relative z-10 mt-auto rounded-[12px] border border-[rgba(255,255,255,0.18)] bg-[rgba(0,0,0,0.48)] px-[12px] py-[7px] text-[12px] font-semibold text-white backdrop-blur-[8px]">
                    Trocar imagem
                  </span>
                </>
              ) : (
                <>
                  <Upload className="h-[22px] w-[22px] text-[#E8E8E8]" />
                  <span className="mt-[12px] rounded-[12px] border border-[#2C2C2C] bg-[#141414] px-[13px] py-[8px] text-[13px] font-semibold text-[#F0F0F0]">
                    Adicionar imagem
                  </span>
                  <span className="mt-[10px] text-[13px] leading-[1.35] text-[#7E7E7E]">
                    ou solte uma imagem para fazer upload
                  </span>
                </>
              )}
            </div>
            {imagePreviewUrl ? (
              <button
                type="button"
                onClick={clearImagePreview}
                className="mt-[10px] text-[12px] font-semibold text-[#AFAFAF] transition hover:text-white"
              >
                Remover imagem
              </button>
            ) : null}
          </ServerSurface>

          <ServerSurface className="relative z-[140] p-[18px] sm:p-[20px]">
            <div className="flex items-center justify-between gap-[12px]">
              <label className="block text-[14px] font-semibold text-[#E2E2E2]">
                Categoria Discord
              </label>
              <Hash className="h-[16px] w-[16px] text-[#8A8A8A]" />
            </div>
            <p className="mt-[10px] text-[13px] leading-[1.5] text-[#7B7B7B]">
              Escolha se essa categoria fica apenas online ou vinculada a um canal Discord.
            </p>
            <div ref={discordMenuRef} className="relative mt-[12px]">
              <button
                type="button"
                onClick={() => setIsDiscordMenuOpen((current) => !current)}
                className="flowdesk-server-button flex h-[42px] w-full items-center justify-between rounded-[14px] border border-[#292929] bg-[#0D0D0D] px-[14px] text-left text-[13px] text-[#EDEDED] outline-none transition hover:border-[#4A4A4A]"
                aria-expanded={isDiscordMenuOpen}
              >
                {discordPublicationLabel[discordPublicationMode]}
                <ChevronDown
                  className={`h-[16px] w-[16px] text-[#777] transition ${isDiscordMenuOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isDiscordMenuOpen ? (
                <div className="flowdesk-scale-in-soft absolute left-0 right-0 top-[50px] z-[260] rounded-[18px] border border-[#1E1E1E] bg-[#080808] p-[8px] shadow-[0_24px_70px_rgba(0,0,0,0.48)]">
                  {(Object.entries(discordPublicationLabel) as Array<["online_only" | "channel", string]>).map(([value, label]) => {
                    const isSelected = value === discordPublicationMode;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setDiscordPublicationMode(value);
                          if (value === "online_only") setDiscordChannelId("");
                          setIsDiscordMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-[13px] px-[12px] py-[10px] text-left text-[13px] transition ${
                          isSelected
                            ? "bg-[#151515] text-[#F1F1F1]"
                            : "text-[#AFAFAF] hover:bg-[#111] hover:text-white"
                        }`}
                      >
                        {label}
                        {isSelected ? <Check className="h-[15px] w-[15px]" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            {discordPublicationMode === "channel" ? (
              <div className="mt-[10px]">
                <div className="relative">
                  <select
                    value={discordChannelId}
                    onChange={(event) => setDiscordChannelId(event.target.value)}
                    disabled={isLoadingChannels || readOnly || isSaving}
                    className="h-[42px] w-full rounded-[14px] border border-[#292929] bg-[#0D0D0D] px-[14px] text-[13px] text-[#EDEDED] outline-none disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {discordChannelOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
          </ServerSurface>

          <ServerSurface className="relative z-0 overflow-hidden">
            <div className="border-b border-[#171717] p-[18px] sm:p-[20px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
                Previa rapida
              </h4>
            </div>
            <div className="p-[18px] sm:p-[20px]">
              <div className="rounded-[20px] border border-[#242424] bg-[#0F0F0F] p-[16px]">
                <div className="flex items-center gap-[12px]">
                  {imagePreviewUrl ? (
                    <Image
                      src={imagePreviewUrl}
                      alt=""
                      width={84}
                      height={84}
                      unoptimized
                      className="h-[42px] w-[42px] rounded-[14px] object-cover"
                    />
                  ) : (
                    <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[14px] bg-[#F4F4F4] text-[#070707]">
                      <LayoutGrid className="h-[19px] w-[19px]" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-[#F1F1F1]">
                      {title.trim() || "Nova categoria"}
                    </p>
                    <p className="mt-[3px] text-[12px] text-[#7B7B7B]">
                      {collectionType === "smart" ? "Automatica" : "Manual"} - 0 produtos
                    </p>
                  </div>
                  <X className="ml-auto h-[15px] w-[15px] text-[#666]" />
                </div>
              </div>
            </div>
          </ServerSurface>
        </aside>
      </div>
      )}
    </div>
  );
}

export function SalesCategoryEditPanel(props: SalesCategoriesPanelProps) {
  const pathname = usePathname();
  const categoryCode = getCategoryCodeFromPath(pathname);

  return (
    <SalesCategoryCreatePanel
      {...props}
      mode="edit"
      categoryCode={categoryCode}
    />
  );
}
