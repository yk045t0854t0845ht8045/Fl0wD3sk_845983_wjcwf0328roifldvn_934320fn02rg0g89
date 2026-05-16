"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Barcode,
  Check,
  ChevronDown,
  CirclePlus,
  FileImage,
  Grid2X2,
  ImagePlus,
  List,
  Search as SearchIcon,
  Package,
  PackageSearch,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  WandSparkles,
  Tag,
  Upload,
  X,
} from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  ServerButton,
  ServerDangerZone,
  ServerDiscordRelinkState,
  ServerDeleteConfirmModal,
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
import { useBodyScrollLock } from "@/lib/ui/useBodyScrollLock";

type ProductStatus = "active" | "draft" | "archived";
type ProductDiscordPublicationMode = "online_only" | "channel";

type SalesProduct = {
  id: string;
  code: string;
  title: string;
  description: string;
  categoryId: string | null;
  status: ProductStatus;
  mediaUrls: string[];
  priceAmount: number;
  compareAtPriceAmount?: number | null;
  unitPriceAmount?: number | null;
  chargeTaxes?: boolean;
  costPerItemAmount?: number | null;
  inventoryTracked: boolean;
  stockQuantity: number;
  sku: string;
  barcode: string;
  barcodeMode?: "auto" | "manual";
  productType?: string;
  manufacturer?: string;
  tags?: string[];
  discordPublicationMode?: ProductDiscordPublicationMode;
  discordChannelId?: string;
  discordMessageId?: string;
  discordLastSyncedAt?: string | null;
  discordSyncStatus?: "idle" | "synced" | "failed";
  discordSyncError?: string;
  publishedVirtualStore?: boolean;
  publishedPointOfSale?: boolean;
  publishedPinterest?: boolean;
  createdAt: string;
};

type SalesCategory = {
  id: string;
  code: string;
  title: string;
};

type DiscordChannel = {
  id: string;
  name: string;
  type: number;
};

type ProductsResponse = {
  ok: boolean;
  code?: string;
  reauthRequired?: boolean;
  message?: string;
  products?: SalesProduct[];
  product?: SalesProduct;
};

type CategoriesResponse = {
  ok: boolean;
  message?: string;
  categories?: SalesCategory[];
};

type ChannelsResponse = {
  ok: boolean;
  message?: string;
  channels?: {
    text?: DiscordChannel[];
  };
};

type SalesProductsPanelProps = {
  guildId: string;
  readOnly?: boolean;
};

const statusLabel: Record<ProductStatus, string> = {
  active: "Ativo",
  draft: "Rascunho",
  archived: "Arquivado",
};

const discordPublicationLabel: Record<ProductDiscordPublicationMode, string> = {
  online_only: "Somente online",
  channel: "Canal Discord",
};
const SALES_PRODUCTS_CACHE_TTL_MS = 5 * 60_000;
const SALES_PRODUCTS_STALE_TTL_MS = 24 * 60 * 60_000;

type CacheEntry<T> = {
  expiresAt: number;
  data: T;
};

type ProductOrganizationUsage = {
  productTypes: Record<string, number>;
  manufacturers: Record<string, number>;
  tags: Record<string, number>;
};

const productsListCache = new Map<string, CacheEntry<SalesProduct[]>>();
const productDetailCache = new Map<string, CacheEntry<SalesProduct>>();
const categoriesCache = new Map<string, CacheEntry<SalesCategory[]>>();
const channelsCache = new Map<string, CacheEntry<DiscordChannel[]>>();

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
  cache.set(key, { data, expiresAt: Date.now() + SALES_PRODUCTS_CACHE_TTL_MS });
}

function invalidateProductCaches(guildId: string) {
  productsListCache.delete(guildId);
  for (const key of productDetailCache.keys()) {
    if (key.startsWith(`${guildId}:`)) productDetailCache.delete(key);
  }
  invalidateClientCache(`flowdesk_sales_products:${guildId}`);
  invalidateClientCache(`flowdesk_sales_product:${guildId}:`);
  invalidateClientCache(`flowdesk_sales_categories:${guildId}`);
  invalidateClientCache(`flowdesk_sales_category:${guildId}:`);
  invalidateClientCache(`flowdesk_sales_product_categories:${guildId}`);
}

function getProductsCacheKey(guildId: string) {
  return `flowdesk_sales_products:${guildId}`;
}

function getProductCacheKey(guildId: string, productCode: string) {
  return `flowdesk_sales_product:${guildId}:${productCode}`;
}

function getCategoriesCacheKey(guildId: string) {
  return `flowdesk_sales_product_categories:${guildId}`;
}

function getChannelsCacheKey(guildId: string) {
  return `flowdesk_sales_channels:${guildId}`;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchDiscordTextChannelsWithRetry(guildId: string, attempts = 3) {
  let lastMessage = "Erro ao carregar canais Discord.";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(
      `/api/auth/me/guilds/channels?guildId=${encodeURIComponent(guildId)}&fresh=1&t=${Date.now()}&attempt=${attempt + 1}`,
      { credentials: "include", cache: "no-store" },
    );
    const payload = (await response.json().catch(() => ({}))) as ChannelsResponse;

    if (!response.ok || !payload.ok) {
      lastMessage = payload.message || lastMessage;
    } else {
      const channels = payload.channels?.text || [];
      if (channels.length || attempt === attempts - 1) return channels;
      lastMessage = "Nenhum canal de texto encontrado.";
    }

    if (attempt < attempts - 1) {
      await wait(450 + attempt * 500);
    }
  }

  throw new Error(lastMessage);
}

function getOrganizationUsageKey(guildId: string) {
  return `flowdesk_sales_product_organization:${guildId}`;
}

function emptyOrganizationUsage(): ProductOrganizationUsage {
  return {
    productTypes: {},
    manufacturers: {},
    tags: {},
  };
}

function getProductsPath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/products/`;
}

function getCreatePath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/products/create/`;
}

function getEditPath(guildId: string, productCode: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/products/edit/${encodeURIComponent(productCode)}/`;
}

function getProductCodeFromPath(pathname: string | null) {
  const match = pathname?.match(/\/sales\/products\/edit\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function parseMoneyInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^\d,.-]/g, "").replace(",", ".");
  if (!/\d/.test(normalized)) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sanitizeSku(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

function generateSku(title: string) {
  const base = sanitizeSku(title).slice(0, 16) || "FLOW-PROD";
  const checksum = Array.from(title || base).reduce(
    (acc, char) => acc + char.charCodeAt(0),
    0,
  );
  return `${base}-${String(checksum % 10000).padStart(4, "0")}`;
}

function generateBarcode(seed: string) {
  const raw = Array.from(seed || "flowdesk")
    .reduce((acc, char) => acc + char.charCodeAt(0), 789000000000)
    .toString();
  return raw.slice(0, 13).padEnd(13, "0");
}

function revokeObjectUrl(url: string | null) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => reject(new Error("Nao foi possivel ler a imagem."));
    reader.readAsDataURL(file);
  });
}

function slugifyProductPath(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "novo-produto"
  );
}

function plainTextPreview(value: string, maxLength = 156) {
  const plain = value
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*_`#>|-]+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "Descricao do produto aparecera aqui conforme os dados forem preenchidos.";
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 3).trim()}...` : plain;
}

const MEDIA_FILE_MAX_BYTES = 3 * 1024 * 1024;

type MediaLibraryItem = {
  id: string;
  url: string;
  name: string;
  typeLabel: string;
  sizeLabel: string;
  sizeBucket: "small" | "medium" | "large" | "unknown";
  usedCount: number;
  productNames: string[];
};

function getMediaTypeLabel(url: string) {
  const dataMatch = url.match(/^data:image\/([^;]+);/i);
  if (dataMatch?.[1]) return dataMatch[1].toUpperCase().replace("JPEG", "JPG");
  const extensionMatch = url.split(/[?#]/)[0]?.match(/\.([a-z0-9]+)$/i);
  return extensionMatch?.[1]?.toUpperCase() || "IMG";
}

function estimateDataUrlBytes(url: string) {
  const base64 = url.includes(",") ? url.slice(url.indexOf(",") + 1) : "";
  if (!base64) return null;
  return Math.max(0, Math.floor((base64.length * 3) / 4));
}

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes <= 0) return "Tamanho n/d";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function getSizeBucket(bytes: number | null): MediaLibraryItem["sizeBucket"] {
  if (!bytes) return "unknown";
  if (bytes < 512 * 1024) return "small";
  if (bytes <= MEDIA_FILE_MAX_BYTES) return "medium";
  return "large";
}

function buildMediaLibraryItems(
  products: SalesProduct[],
  currentMediaUrls: string[],
) {
  const items = new Map<string, MediaLibraryItem>();

  const addUrl = (url: string, productName: string | null, index: number) => {
    if (!url) return;
    const bytes = estimateDataUrlBytes(url);
    const existing = items.get(url);
    if (existing) {
      existing.usedCount += productName ? 1 : 0;
      if (productName && !existing.productNames.includes(productName)) {
        existing.productNames.push(productName);
      }
      return;
    }

    const typeLabel = getMediaTypeLabel(url);
    const productNames = productName ? [productName] : [];
    items.set(url, {
      id: `${index}-${url.slice(0, 42)}`,
      url,
      name: productName ? `${productName} ${index + 1}` : `Midia atual ${index + 1}`,
      typeLabel,
      sizeLabel: formatFileSize(bytes),
      sizeBucket: getSizeBucket(bytes),
      usedCount: productName ? 1 : 0,
      productNames,
    });
  };

  products.forEach((product) => {
    product.mediaUrls?.forEach((url, index) => addUrl(url, product.title, index));
  });
  currentMediaUrls.forEach((url, index) => addUrl(url, null, index));

  return Array.from(items.values()).sort(
    (left, right) => right.usedCount - left.usedCount || left.name.localeCompare(right.name, "pt-BR"),
  );
}

function PillToggle({
  active,
  children,
  onClick,
  disabled,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flowdesk-server-button rounded-[12px] px-[11px] py-[8px] text-[13px] transition ${
        active
          ? "bg-[#F1F1F1] text-[#080808]"
          : "bg-[#171717] text-[#BDBDBD] hover:bg-[#202020] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  disabled,
  maxVisibleItems,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  disabled?: boolean;
  maxVisibleItems?: number;
}) {
  const [open, setOpen] = useState(false);
  const [openDirection, setOpenDirection] = useState<"down" | "up">("down");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const resolveOpenDirection = useCallback(() => {
    const bounds = menuRef.current?.getBoundingClientRect();
    if (!bounds) return "down";
    const availableBelow = window.innerHeight - bounds.bottom;
    const availableAbove = bounds.top;
    const estimatedHeight =
      Math.min(options.length, maxVisibleItems || options.length) * 42 + 16;
    return availableBelow < estimatedHeight && availableAbove > availableBelow
      ? "up"
      : "down";
  }, [maxVisibleItems, options.length]);

  useEffect(() => {
    if (!open) return;

    function handlePointer(event: MouseEvent) {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  return (
    <div ref={menuRef} className={open ? "relative z-[220]" : "relative z-[1]"}>
      <button
        type="button"
        onClick={() => {
          if (!open) setOpenDirection(resolveOpenDirection());
          setOpen((current) => !current);
        }}
        disabled={disabled}
        className="flowdesk-server-button flex h-[42px] w-full items-center justify-between rounded-[14px] border border-[#292929] bg-[#0D0D0D] px-[14px] text-left text-[13px] text-[#EDEDED] transition hover:border-[#444] disabled:cursor-not-allowed disabled:opacity-55"
      >
        {options.find(([option]) => option === value)?.[1] || "Selecionar"}
        <ChevronDown
          strokeWidth={1.9}
          className={`h-[16px] w-[16px] shrink-0 bg-transparent text-[#9A9A9A] transition ${open ? "rotate-180 text-[#DADADA]" : ""}`}
        />
      </button>
      {open ? (
        <div
          className={`flowdesk-scale-in-soft absolute left-0 right-0 z-[120] rounded-[18px] border border-[#1E1E1E] bg-[#080808] p-[8px] shadow-[0_24px_70px_rgba(0,0,0,0.48)] ${
            openDirection === "up" ? "bottom-[50px]" : "top-[50px]"
          }`}
        >
          <div
            className="thin-scrollbar overflow-y-auto pr-[2px]"
            style={
              maxVisibleItems
                ? { maxHeight: `${maxVisibleItems * 42 + 10}px` }
                : undefined
            }
          >
          {options.map(([option, label]) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-[13px] px-[12px] py-[10px] text-left text-[13px] transition ${
                option === value
                  ? "bg-[#151515] text-[#F1F1F1]"
                  : "text-[#AFAFAF] hover:bg-[#111] hover:text-white"
              }`}
            >
              {label}
              {option === value ? <Check className="h-[15px] w-[15px]" /> : null}
            </button>
          ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SalesProductsListPanel({
  guildId,
  readOnly = false,
}: SalesProductsPanelProps) {
  const router = useRouter();
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [needsDiscordRelink, setNeedsDiscordRelink] = useState(false);

  const loadProducts = useCallback(async () => {
    const cached = readCache(productsListCache, guildId);
    const persistentCached =
      cached || readClientCache<SalesProduct[]>(getProductsCacheKey(guildId), SALES_PRODUCTS_STALE_TTL_MS);
    if (persistentCached) {
      setProducts(persistentCached);
      writeCache(productsListCache, guildId, persistentCached);
      setIsLoading(false);
      setErrorMessage(null);
    } else {
      setIsLoading(true);
    }
    setErrorMessage(null);
    setNeedsDiscordRelink(false);

    try {
      const nextProducts = await coalescedClientFetch(
        getProductsCacheKey(guildId),
        async () => {
          const response = await fetch(
            `/api/auth/me/guilds/sales-products?guildId=${encodeURIComponent(guildId)}`,
            { credentials: "include", cache: "no-store" },
          );
          const payload = (await response.json().catch(() => ({}))) as ProductsResponse;
          if (!response.ok || !payload.ok) {
            if (payload.reauthRequired || payload.code === "DISCORD_RELINK_REQUIRED") {
              setNeedsDiscordRelink(true);
            }
            throw new Error(payload.message || "Erro ao carregar produtos.");
          }
          return payload.products || [];
        },
      );
      setProducts(nextProducts);
      writeCache(productsListCache, guildId, nextProducts);
      writeClientCache(getProductsCacheKey(guildId), nextProducts);
      nextProducts.forEach((product) => {
        writeCache(productDetailCache, `${guildId}:${product.code}`, product);
        writeClientCache(getProductCacheKey(guildId, product.code), product);
      });
    } catch (error) {
      if (!persistentCached) {
        setErrorMessage(
          error instanceof Error ? error.message : "Erro ao carregar produtos.",
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return products;
    return products.filter((product) =>
      `${product.title} ${product.description} ${product.sku}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [products, query]);

  return (
    <div className="space-y-[18px]">
      <ServerSectionHeading
        eyebrow="Vendas"
        title="Produtos da loja"
        description="Cadastre itens com midias, preco, estoque e publicacao para o Discord e para a futura vitrine web."
        action={
          <ServerButton
            disabled={readOnly}
            onClick={() => router.push(getCreatePath(guildId))}
            variant="primary"
            size="lg"
          >
            <Plus className="h-[16px] w-[16px]" />
            Adicionar Produto
          </ServerButton>
        }
      />

      <ServerSurface className="overflow-hidden">
        <div className="flex flex-col gap-[12px] border-b border-[#171717] px-[18px] py-[16px] sm:flex-row sm:items-center sm:justify-between sm:px-[22px]">
          <div className="relative w-full sm:max-w-[380px]">
            <Search className="pointer-events-none absolute left-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#666]" />
            <ServerTextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar produtos"
              className="h-[42px] pl-[40px] text-[13px]"
            />
          </div>
          <div className="inline-flex items-center gap-[8px] rounded-[14px] border border-[#202020] bg-[#0D0D0D] px-[12px] py-[10px] text-[12px] text-[#8C8C8C]">
            <Package className="h-[15px] w-[15px]" />
            Lista de catalogo
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
                  <div className="h-[12px] w-[190px] animate-pulse rounded-full bg-[#171717]" />
                  <div className="h-[10px] w-[300px] max-w-full animate-pulse rounded-full bg-[#151515]" />
                </div>
              </div>
            ))}
          </div>
        ) : needsDiscordRelink ? (
          <ServerDiscordRelinkState />
        ) : errorMessage ? (
          <div className="px-[22px] py-[32px] text-center">
            <p className="text-[14px] font-medium text-[#E5E5E5]">
              Nao foi possivel carregar produtos.
            </p>
            <p className="mt-[8px] text-[13px] text-[#7B7B7B]">{errorMessage}</p>
            <ServerButton
              onClick={() => void loadProducts()}
              className="mt-[16px]"
            >
              Tentar novamente
            </ServerButton>
          </div>
        ) : filteredProducts.length ? (
          <div className="divide-y divide-[#171717]">
            {filteredProducts.map((product) => (
              <article
                key={product.id}
                className="flex flex-col gap-[14px] px-[18px] py-[16px] transition hover:bg-[#0E0E0E] sm:px-[22px] lg:flex-row lg:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-[14px]">
                  <ServerIconFrame>
                    <Package className="h-[20px] w-[20px]" />
                  </ServerIconFrame>
                  <div className="min-w-0">
                    <h4 className="truncate text-[15px] font-semibold text-[#EDEDED]">
                      {product.title}
                    </h4>
                    <p className="mt-[4px] line-clamp-1 text-[13px] text-[#777]">
                      {product.sku || product.description || "Sem SKU cadastrado."}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-[8px] sm:flex sm:items-center">
                  <span className="rounded-full border border-[#232323] bg-[#111] px-[10px] py-[6px] text-center text-[12px] text-[#BDBDBD]">
                    {formatMoney(product.priceAmount)}
                  </span>
                  <span className="rounded-full border border-[#232323] bg-[#111] px-[10px] py-[6px] text-center text-[12px] text-[#BDBDBD]">
                    {product.inventoryTracked
                      ? `${product.stockQuantity} em estoque`
                      : "Sem rastreio"}
                  </span>
                  <span className="rounded-full border border-[#1F3D2E] bg-[#0D1A13] px-[10px] py-[6px] text-center text-[12px] text-[#7CE2A0]">
                    {statusLabel[product.status]}
                  </span>
                  <button
                    type="button"
                    aria-label={`Editar ${product.title}`}
                    title="Editar produto"
                    onClick={() => router.push(getEditPath(guildId, product.code))}
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
            icon={<PackageSearch className="h-[24px] w-[24px]" />}
            title="Nenhum produto cadastrado ainda."
            description="Crie o primeiro produto com preco, midias e estoque para preparar a loja do servidor."
            action={
              <ServerButton
                disabled={readOnly}
                onClick={() => router.push(getCreatePath(guildId))}
                variant="primary"
              >
                <Plus className="h-[16px] w-[16px]" />
                Adicionar Produto
              </ServerButton>
            }
          />
        )}
      </ServerSurface>
    </div>
  );
}

function ProductEditorSkeleton() {
  return (
    <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_398px]">
      <div className="space-y-[18px]">
        {Array.from({ length: 3 }).map((_, sectionIndex) => (
          <ServerSurface key={sectionIndex} className="p-[18px] sm:p-[22px]">
            <div className="h-[14px] w-[140px] animate-pulse rounded-full bg-[#1A1A1A]" />
            <div className="mt-[14px] h-[44px] w-full animate-pulse rounded-[14px] bg-[#111]" />
            <div className="mt-[18px] grid gap-[10px] sm:grid-cols-2">
              <div className="h-[42px] animate-pulse rounded-[14px] bg-[#111]" />
              <div className="h-[42px] animate-pulse rounded-[14px] bg-[#111]" />
            </div>
            <div className="mt-[18px] h-[118px] animate-pulse rounded-[16px] bg-[#101010]" />
          </ServerSurface>
        ))}
      </div>
      <aside className="space-y-[18px]">
        {Array.from({ length: 5 }).map((_, sectionIndex) => (
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

function normalizeTag(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 32);
}

function sameTag(left: string, right: string) {
  return left.localeCompare(right, "pt-BR", { sensitivity: "base" }) === 0;
}

function readOrganizationUsage(guildId: string): ProductOrganizationUsage {
  if (typeof window === "undefined") return emptyOrganizationUsage();

  try {
    const raw = window.localStorage.getItem(getOrganizationUsageKey(guildId));
    if (!raw) return emptyOrganizationUsage();
    const parsed = JSON.parse(raw) as Partial<ProductOrganizationUsage>;
    return {
      productTypes: parsed.productTypes || {},
      manufacturers: parsed.manufacturers || {},
      tags: parsed.tags || {},
    };
  } catch {
    return emptyOrganizationUsage();
  }
}

function writeOrganizationUsage(guildId: string, usage: ProductOrganizationUsage) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(getOrganizationUsageKey(guildId), JSON.stringify(usage));
  } catch {
    // Best-effort local intelligence; product saving must never depend on storage.
  }
}

function incrementOrganizationValues(
  usage: ProductOrganizationUsage,
  bucket: keyof ProductOrganizationUsage,
  values: string[],
) {
  const nextBucket = { ...usage[bucket] };
  values.forEach((value) => {
    const normalized = normalizeTag(value);
    if (!normalized) return;
    const existingKey =
      Object.keys(nextBucket).find((item) => sameTag(item, normalized)) || normalized;
    nextBucket[existingKey] = (nextBucket[existingKey] || 0) + 1;
  });

  return {
    ...usage,
    [bucket]: nextBucket,
  };
}

function addSuggestionCount(
  counts: Map<string, number>,
  value: string | null | undefined,
  weight = 1,
) {
  const normalized = normalizeTag(value || "");
  if (!normalized) return;
  const existingKey =
    Array.from(counts.keys()).find((item) => sameTag(item, normalized)) || normalized;
  counts.set(existingKey, (counts.get(existingKey) || 0) + weight);
}

function buildOrganizationSuggestions(
  usageBucket: Record<string, number>,
  productValues: Array<string | null | undefined>,
  currentValues: string[],
) {
  const counts = new Map<string, number>();
  Object.entries(usageBucket).forEach(([value, count]) => {
    addSuggestionCount(counts, value, Math.max(1, count) * 4);
  });
  productValues.forEach((value) => addSuggestionCount(counts, value, 2));
  currentValues.forEach((value) => addSuggestionCount(counts, value, 8));

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "pt-BR"))
    .map(([item]) => item);
}

function ProductTagsInput({
  value,
  onChange,
  suggestions,
  disabled,
  onAddTags,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  disabled?: boolean;
  onAddTags?: (tags: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addTag = useCallback(
    (rawTag: string) => {
      const nextTag = normalizeTag(rawTag);
      if (!nextTag || value.some((tag) => sameTag(tag, nextTag))) {
        setQuery("");
        return;
      }
      onChange([...value, nextTag]);
      onAddTags?.([nextTag]);
      setQuery("");
      setOpen(true);
    },
    [onAddTags, onChange, value],
  );

  useEffect(() => {
    if (!open) return;

    function handlePointer(event: MouseEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        const nextTag = normalizeTag(query);
        if (nextTag) addTag(nextTag);
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [addTag, open, query]);

  const removeTag = useCallback(
    (tagToRemove: string) => {
      onChange(value.filter((tag) => !sameTag(tag, tagToRemove)));
    },
    [onChange, value],
  );

  const availableSuggestions = useMemo(
    () =>
      suggestions
        .filter((tag) => !value.some((selected) => sameTag(selected, tag)))
        .filter((tag, index, list) => list.findIndex((item) => sameTag(item, tag)) === index),
    [suggestions, value],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSuggestions = useMemo(
    () =>
      normalizedQuery
        ? availableSuggestions.filter((tag) => tag.toLowerCase().includes(normalizedQuery))
        : availableSuggestions,
    [availableSuggestions, normalizedQuery],
  );
  const frequentSuggestions = filteredSuggestions.slice(0, 6);
  const otherSuggestions = filteredSuggestions.slice(6);
  const canAddQuery =
    Boolean(normalizeTag(query)) &&
    !value.some((tag) => sameTag(tag, query)) &&
    !availableSuggestions.some((tag) => sameTag(tag, query));

  return (
    <div ref={rootRef} className={open ? "relative z-[260]" : "relative"}>
      <div className="mb-[8px] flex items-center justify-between">
        <label className="text-[12px] font-semibold text-[#AFAFAF]">Tags</label>
        <button
          type="button"
          onClick={() => {
            if (!disabled) {
              setOpen(true);
              window.requestAnimationFrame(() => inputRef.current?.focus());
            }
          }}
          disabled={disabled}
          aria-label="Adicionar tag"
          className="flowdesk-server-button inline-flex h-[24px] w-[24px] items-center justify-center rounded-[8px] text-[#9A9A9A] transition hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          <CirclePlus className="h-[16px] w-[16px]" />
        </button>
      </div>
      <div
        className={`flowdesk-product-organization-input min-h-[44px] cursor-text rounded-[14px] border border-[#252525] bg-[#0D0D0D] px-[14px] py-[9px] transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-[#4A4A4A] ${
          open ? "border-[#4A4A4A]" : ""
        } ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
        onClick={() => {
          if (!disabled) {
            setOpen(true);
            inputRef.current?.focus();
          }
        }}
      >
        <div className="flex flex-wrap items-center gap-[6px]">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex max-w-full items-center gap-[6px] rounded-[10px] bg-[#202020] px-[9px] py-[5px] text-[12px] leading-none text-[#DADADA]"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="max-w-[170px] truncate">{tag}</span>
              <button
                type="button"
                aria-label={`Remover tag ${tag}`}
                onClick={() => removeTag(tag)}
                disabled={disabled}
                className="text-[#8A8A8A] transition hover:text-white disabled:cursor-not-allowed"
              >
                <X className="h-[12px] w-[12px]" />
              </button>
            </span>
          ))}
          <span className="flex min-w-[150px] flex-1 items-center gap-[8px]">
          {!value.length ? <SearchIcon className="h-[15px] w-[15px] text-[#777]" /> : null}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addTag(query);
              } else if (event.key === "Backspace" && !query && value.length) {
                event.preventDefault();
                removeTag(value[value.length - 1]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            onBlur={() => {
              window.setTimeout(() => {
                if (rootRef.current?.contains(document.activeElement)) return;
                const nextTag = normalizeTag(query);
                if (nextTag) addTag(nextTag);
                setOpen(false);
              }, 120);
            }}
            disabled={disabled}
            placeholder={value.length ? "Adicionar tag" : "Pesquisar ou adicionar tags"}
            className="flowdesk-server-input-plain h-[24px] min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent text-[14px] text-[#F1F1F1] outline-none placeholder:text-[#646464] focus:bg-transparent active:bg-transparent"
          />
          </span>
        </div>
      </div>
      {open && !disabled ? (
        <div className="flowdesk-scale-in-soft absolute left-0 right-0 top-[calc(100%+8px)] z-[320] overflow-hidden rounded-[18px] border border-[#222] bg-[#080808] shadow-[0_24px_70px_rgba(0,0,0,0.52)]">
          <div className="thin-scrollbar max-h-[318px] overflow-y-auto p-[8px]">
            {canAddQuery ? (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(query)}
                className="flex w-full items-center gap-[9px] rounded-[13px] px-[11px] py-[10px] text-left text-[13px] font-semibold text-[#F1F1F1] transition hover:bg-[#141414]"
              >
                <CirclePlus className="h-[16px] w-[16px]" />
                Adicionar &quot;{normalizeTag(query)}&quot;
              </button>
            ) : null}
            {!canAddQuery && !filteredSuggestions.length ? (
              <p className="px-[11px] py-[10px] text-[13px] text-[#777]">0 resultado</p>
            ) : null}
            {frequentSuggestions.length ? (
              <div className={canAddQuery ? "mt-[8px]" : ""}>
                <p className="px-[11px] pb-[6px] pt-[4px] text-[12px] font-semibold text-[#8A8A8A]">
                  Mais usados
                </p>
                {frequentSuggestions.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addTag(tag)}
                    className="flex w-full items-center gap-[9px] rounded-[13px] px-[11px] py-[9px] text-left text-[13px] text-[#D8D8D8] transition hover:bg-[#141414]"
                  >
                    <span className="h-[18px] w-[18px] rounded-[5px] border border-[#666]" />
                    {tag}
                  </button>
                ))}
              </div>
            ) : null}
            {otherSuggestions.length ? (
              <div className="mt-[8px]">
                <p className="px-[11px] pb-[6px] pt-[4px] text-[12px] font-semibold text-[#8A8A8A]">
                  Outros
                </p>
                {otherSuggestions.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addTag(tag)}
                    className="flex w-full items-center gap-[9px] rounded-[13px] px-[11px] py-[9px] text-left text-[13px] text-[#D8D8D8] transition hover:bg-[#141414]"
                  >
                    <span className="h-[18px] w-[18px] rounded-[5px] border border-[#666]" />
                    {tag}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SmartTextPicker({
  label,
  value,
  onChange,
  suggestions,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;

    function handlePointer(event: MouseEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        const nextValue = normalizeTag(query);
        if (nextValue) onChange(nextValue);
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [onChange, open, query]);

  const normalizedQuery = query.trim().toLowerCase();
  const cleanSuggestions = useMemo(
    () =>
      suggestions
        .map(normalizeTag)
        .filter(Boolean)
        .filter((item, index, list) => list.findIndex((entry) => sameTag(entry, item)) === index),
    [suggestions],
  );
  const filteredSuggestions = useMemo(
    () =>
      normalizedQuery
        ? cleanSuggestions.filter((item) => item.toLowerCase().includes(normalizedQuery))
        : cleanSuggestions.slice(0, 8),
    [cleanSuggestions, normalizedQuery],
  );
  const frequentSuggestions = filteredSuggestions.slice(0, 6);
  const otherSuggestions = filteredSuggestions.slice(6);
  const canAddQuery =
    Boolean(normalizeTag(query)) &&
    !cleanSuggestions.some((item) => sameTag(item, query));

  const commitValue = useCallback(
    (nextValue: string) => {
      const normalized = normalizeTag(nextValue);
      onChange(normalized);
      setQuery(normalized);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div ref={rootRef} className={open ? "relative z-[260]" : "relative"}>
      <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
        {label}
      </label>
      <div
        className={`flowdesk-product-organization-input flex h-[44px] items-center gap-[8px] rounded-[14px] border border-[#252525] bg-[#0D0D0D] px-[14px] transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-[#4A4A4A] ${
          open ? "border-[#4A4A4A]" : ""
        } ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
      >
        <SearchIcon className="h-[15px] w-[15px] text-[#777]" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitValue(query);
            }
            if (event.key === "Escape") setOpen(false);
          }}
          disabled={disabled}
          placeholder={label}
          className="flowdesk-server-input-plain min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent text-[14px] text-[#F1F1F1] outline-none placeholder:text-[#646464] focus:bg-transparent active:bg-transparent"
        />
        {query ? (
          <button
            type="button"
            aria-label={`Limpar ${label}`}
            onClick={() => {
              setQuery("");
              onChange("");
              setOpen(false);
            }}
            disabled={disabled}
            className="text-[#888] transition hover:text-white"
          >
            <X className="h-[15px] w-[15px]" />
          </button>
        ) : null}
      </div>
      {open && !disabled ? (
        <div className="flowdesk-scale-in-soft absolute left-0 right-0 top-[calc(100%+8px)] z-[320] overflow-hidden rounded-[16px] border border-[#222] bg-[#080808] shadow-[0_22px_64px_rgba(0,0,0,0.5)]">
          <div className="p-[7px]">
            {frequentSuggestions.length ? (
              <div>
                <p className="px-[10px] pb-[6px] pt-[3px] text-[12px] font-semibold text-[#8A8A8A]">
                  Mais usados
                </p>
                {frequentSuggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commitValue(item)}
                    className="flex w-full items-center gap-[9px] rounded-[12px] px-[10px] py-[9px] text-left text-[13px] font-semibold text-[#DCDCDC] transition hover:bg-[#141414]"
                  >
                    <Check className="h-[15px] w-[15px] text-[#CFCFCF]" />
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
            {otherSuggestions.length ? (
              <div className="mt-[7px] border-t border-[#171717] pt-[7px]">
                <p className="px-[10px] pb-[6px] pt-[3px] text-[12px] font-semibold text-[#8A8A8A]">
                  Outros
                </p>
                {otherSuggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commitValue(item)}
                    className="flex w-full items-center gap-[9px] rounded-[12px] px-[10px] py-[9px] text-left text-[13px] font-semibold text-[#DCDCDC] transition hover:bg-[#141414]"
                  >
                    <Check className="h-[15px] w-[15px] text-[#CFCFCF]" />
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
            {!frequentSuggestions.length && !canAddQuery ? (
              <p className="px-[10px] py-[9px] text-[13px] text-[#777]">0 resultado</p>
            ) : null}
            {canAddQuery ? (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commitValue(query)}
                className="mt-[3px] flex w-full items-center gap-[9px] rounded-[12px] px-[10px] py-[9px] text-left text-[13px] font-semibold text-[#EDEDED] transition hover:bg-[#141414]"
              >
                <CirclePlus className="h-[15px] w-[15px]" />
                Adicionar &quot;{normalizeTag(query)}&quot;
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProductMediaLibraryModal({
  open,
  items,
  selectedUrls,
  onClose,
  onConfirm,
  onUpload,
  disabled,
}: {
  open: boolean;
  items: MediaLibraryItem[];
  selectedUrls: string[];
  onClose: () => void;
  onConfirm: (urls: string[]) => void;
  onUpload: (files: FileList | null | undefined) => Promise<void>;
  disabled?: boolean;
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [usedFilter, setUsedFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [draftSelection, setDraftSelection] = useState<string[]>([]);

  useBodyScrollLock(open);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsMounted(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setDraftSelection([]);
      setQuery("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  const selectedSet = useMemo(() => new Set(selectedUrls), [selectedUrls]);
  const draftSet = useMemo(() => new Set(draftSelection), [draftSelection]);
  const typeOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.typeLabel))).sort(),
    [items],
  );
  const productOptions = useMemo(
    () =>
      Array.from(new Set(items.flatMap((item) => item.productNames))).sort((left, right) =>
        left.localeCompare(right, "pt-BR"),
      ),
    [items],
  );
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== "all" && item.typeLabel !== typeFilter) return false;
      if (sizeFilter !== "all" && item.sizeBucket !== sizeFilter) return false;
      if (usedFilter === "used" && item.usedCount <= 0) return false;
      if (usedFilter === "unused" && item.usedCount > 0) return false;
      if (productFilter !== "all" && !item.productNames.includes(productFilter)) return false;
      if (!normalizedQuery) return true;
      return `${item.name} ${item.typeLabel} ${item.productNames.join(" ")}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [items, productFilter, query, sizeFilter, typeFilter, usedFilter]);

  const toggleUrl = useCallback((url: string) => {
    setDraftSelection((current) =>
      current.includes(url) ? current.filter((item) => item !== url) : [...current, url],
    );
  }, []);

  const confirmSelection = useCallback(() => {
    const nextUrls = draftSelection.filter((url) => !selectedSet.has(url));
    onConfirm(nextUrls);
  }, [draftSelection, onConfirm, selectedSet]);

  if (!open || !isMounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-[rgba(0,0,0,0.68)] backdrop-blur-[3px]">
      <button
        type="button"
        aria-label="Fechar seletor de midias"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-media-library-title"
        className="flowdesk-scale-in-soft absolute left-1/2 top-1/2 flex h-[min(88vh,780px)] w-[min(1180px,calc(100vw-28px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] border border-[#202020] bg-[#090909] shadow-[0_34px_120px_rgba(0,0,0,0.62)]"
      >
        <div className="flex items-center justify-between gap-[16px] border-b border-[#171717] px-[20px] py-[18px] sm:px-[24px]">
          <div className="min-w-0">
            <h3 id="product-media-library-title" className="text-[18px] font-semibold text-[#F1F1F1]">
              Selecionar arquivo
            </h3>
            <p className="mt-[5px] text-[12px] text-[#777]">
              Reutilize midias ja enviadas ou adicione novas imagens ate 3 MB.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="flowdesk-server-button flex h-[38px] w-[38px] items-center justify-center rounded-[13px] text-[#8A8A8A] transition hover:bg-[#111] hover:text-white"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="border-b border-[#151515] px-[20px] py-[16px] sm:px-[24px]">
          <div className="flex flex-col gap-[12px] lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-[560px]">
              <SearchIcon className="pointer-events-none absolute left-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#777]" />
              <ServerTextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar arquivos"
                className="h-[42px] pl-[40px] text-[13px]"
              />
            </div>
            <div className="flex flex-wrap items-center gap-[8px]">
              <ServerButton size="sm" className="h-[38px]">
                Classificar
              </ServerButton>
              <div className="inline-flex rounded-[13px] border border-[#242424] bg-[#0D0D0D] p-[3px]">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  aria-label="Visualizar em grade"
                  className={`flex h-[30px] w-[34px] items-center justify-center rounded-[10px] transition ${
                    viewMode === "grid" ? "bg-[#1A1A1A] text-white" : "text-[#777] hover:text-white"
                  }`}
                >
                  <Grid2X2 className="h-[15px] w-[15px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  aria-label="Visualizar em lista"
                  className={`flex h-[30px] w-[34px] items-center justify-center rounded-[10px] transition ${
                    viewMode === "list" ? "bg-[#1A1A1A] text-white" : "text-[#777] hover:text-white"
                  }`}
                >
                  <List className="h-[15px] w-[15px]" />
                </button>
              </div>
            </div>
          </div>
          <div className="mt-[12px] flex flex-wrap gap-[8px]">
            <div className="min-w-[150px]">
              <SelectMenu
                value={typeFilter}
                onChange={setTypeFilter}
                maxVisibleItems={6}
                options={[["all", "Tipo de arquivo"], ...typeOptions.map((type) => [type, type] as [string, string])]}
              />
            </div>
            <div className="min-w-[160px]">
              <SelectMenu
                value={sizeFilter}
                onChange={setSizeFilter}
                maxVisibleItems={5}
                options={[
                  ["all", "Tamanho do arquivo"],
                  ["small", "Ate 512 KB"],
                  ["medium", "Ate 3 MB"],
                  ["large", "Acima de 3 MB"],
                  ["unknown", "Sem tamanho"],
                ]}
              />
            </div>
            <div className="min-w-[128px]">
              <SelectMenu
                value={usedFilter}
                onChange={setUsedFilter}
                maxVisibleItems={4}
                options={[
                  ["all", "Usado em"],
                  ["used", "Usado"],
                  ["unused", "Nao usado"],
                ]}
              />
            </div>
            <div className="min-w-[150px]">
              <SelectMenu
                value={productFilter}
                onChange={setProductFilter}
                maxVisibleItems={6}
                options={[["all", "Produto"], ...productOptions.map((product) => [product, product] as [string, string])]}
              />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[20px] py-[18px] thin-scrollbar sm:px-[24px]">
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => void onUpload(event.target.files)}
          />
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void onUpload(event.dataTransfer.files);
            }}
            className="flex min-h-[142px] flex-col items-center justify-center rounded-[18px] border border-dashed border-[#343434] bg-[#0C0C0C] px-[16px] text-center"
          >
            <div className="flex flex-wrap items-center justify-center gap-[10px]">
              <ServerButton onClick={() => uploadInputRef.current?.click()} disabled={disabled}>
                <Upload className="h-[15px] w-[15px]" />
                Adicionar midia
              </ServerButton>
              <ServerButton disabled title="Em breve" className="border-[#2D2440] text-[#8F79FF]">
                <WandSparkles className="h-[15px] w-[15px]" />
                Gerar imagem
              </ServerButton>
            </div>
            <p className="mt-[12px] text-[13px] text-[#777]">
              Arraste e solte imagens aqui ou selecione arquivos do seu computador.
            </p>
          </div>

          {filteredItems.length ? (
            viewMode === "grid" ? (
              <div className="mt-[22px] grid grid-cols-2 gap-x-[18px] gap-y-[22px] sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {filteredItems.map((item) => {
                  const isSelected = draftSet.has(item.url);
                  const isAlreadyUsed = selectedSet.has(item.url);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (!isAlreadyUsed) toggleUrl(item.url);
                      }}
                      disabled={isAlreadyUsed}
                      className={`group text-center transition ${isAlreadyUsed ? "opacity-45" : ""}`}
                    >
                      <span className={`relative block aspect-square overflow-hidden rounded-[16px] border bg-[#101010] p-[6px] transition ${
                        isSelected ? "border-[#EDEDED]" : "border-[#242424] group-hover:border-[#454545]"
                      }`}>
                        <span className={`absolute left-[9px] top-[9px] z-10 h-[18px] w-[18px] rounded-[5px] border ${
                          isSelected ? "border-white bg-white" : "border-[#D8D8D8] bg-[rgba(0,0,0,0.35)]"
                        }`}>
                          {isSelected ? <Check className="h-[16px] w-[16px] text-[#080808]" /> : null}
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element -- Media picker previews can be blob/data URLs from local uploads. */}
                        <img src={item.url} alt="" className="h-full w-full rounded-[12px] object-cover" />
                      </span>
                      <span className="mt-[9px] block truncate text-[13px] text-[#DCDCDC]">{item.name}</span>
                      <span className="mt-[3px] block text-[12px] text-[#777]">{item.typeLabel} - {item.sizeLabel}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-[18px] overflow-hidden rounded-[18px] border border-[#1D1D1D]">
                {filteredItems.map((item) => {
                  const isSelected = draftSet.has(item.url);
                  const isAlreadyUsed = selectedSet.has(item.url);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (!isAlreadyUsed) toggleUrl(item.url);
                      }}
                      disabled={isAlreadyUsed}
                      className="flex w-full items-center gap-[12px] border-b border-[#151515] bg-[#0B0B0B] px-[14px] py-[12px] text-left last:border-b-0 hover:bg-[#101010] disabled:opacity-45"
                    >
                      <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border ${isSelected ? "border-white bg-white" : "border-[#777]"}`}>
                        {isSelected ? <Check className="h-[15px] w-[15px] text-[#080808]" /> : null}
                      </span>
                      {/* eslint-disable-next-line @next/next/no-img-element -- Media picker previews can be blob/data URLs from local uploads. */}
                      <img src={item.url} alt="" className="h-[48px] w-[48px] rounded-[12px] object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[#EDEDED]">{item.name}</span>
                        <span className="mt-[4px] block truncate text-[12px] text-[#777]">
                          {item.productNames.join(", ") || "Sem produto vinculado"}
                        </span>
                      </span>
                      <span className="text-[12px] text-[#AFAFAF]">{item.typeLabel}</span>
                      <span className="hidden text-[12px] text-[#777] sm:block">{item.sizeLabel}</span>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <div className="px-[22px] py-[46px] text-center">
              <FileImage className="mx-auto h-[42px] w-[42px] text-[#444]" />
              <p className="mt-[16px] text-[14px] font-semibold text-[#DCDCDC]">Nenhuma midia encontrada.</p>
              <p className="mt-[6px] text-[13px] text-[#777]">Envie uma imagem ou ajuste os filtros para continuar.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-[10px] border-t border-[#171717] px-[20px] py-[16px] sm:px-[24px]">
          <ServerButton onClick={onClose}>Cancelar</ServerButton>
          <ServerButton
            variant="primary"
            onClick={confirmSelection}
            disabled={!draftSelection.some((url) => !selectedSet.has(url))}
          >
            Concluido
          </ServerButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SalesProductCreatePanel({
  guildId,
  readOnly = false,
  mode = "create",
  productCode = "",
}: SalesProductsPanelProps & {
  mode?: "create" | "edit";
  productCode?: string;
}) {
  const router = useRouter();
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const [categories, setCategories] = useState<SalesCategory[]>([]);
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [libraryProducts, setLibraryProducts] = useState<SalesProduct[]>([]);
  const [isLoadingProduct, setIsLoadingProduct] = useState(mode === "edit");
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [channelsMessage, setChannelsMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProductStatus>("active");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [priceAmount, setPriceAmount] = useState("");
  const [compareAtPriceAmount, setCompareAtPriceAmount] = useState("");
  const [, setUnitPriceAmount] = useState("");
  const [, setChargeTaxes] = useState(true);
  const [, setCostPerItemAmount] = useState("");
  const [, setInventoryTracked] = useState(true);
  const [stockQuantity, setStockQuantity] = useState("0");
  const [sku, setSku] = useState("");
  const [skuEdited, setSkuEdited] = useState(false);
  const [barcodeMode, setBarcodeMode] = useState<"auto" | "manual">("auto");
  const [barcode, setBarcode] = useState(generateBarcode("flowdesk"));
  const [productType, setProductType] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [discordPublicationMode, setDiscordPublicationMode] =
    useState<ProductDiscordPublicationMode>("online_only");
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [publishedVirtualStore, setPublishedVirtualStore] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [organizationUsage, setOrganizationUsage] = useState<ProductOrganizationUsage>(() =>
    emptyOrganizationUsage(),
  );
  const mediaUrlsRef = useRef<string[]>([]);

  const rememberOrganizationValues = useCallback(
    (bucket: keyof ProductOrganizationUsage, values: string[]) => {
      const cleanValues = values.map(normalizeTag).filter(Boolean);
      if (!cleanValues.length) return;
      setOrganizationUsage((current) => {
        const nextUsage = incrementOrganizationValues(current, bucket, cleanValues);
        writeOrganizationUsage(guildId, nextUsage);
        return nextUsage;
      });
    },
    [guildId],
  );

  useEffect(() => {
    setOrganizationUsage(readOrganizationUsage(guildId));
  }, [guildId]);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      const cached = readCache(categoriesCache, guildId);
      const persistentCached =
        cached ||
        readClientCache<SalesCategory[]>(getCategoriesCacheKey(guildId), SALES_PRODUCTS_STALE_TTL_MS);
      if (persistentCached) {
        setCategories(persistentCached);
        writeCache(categoriesCache, guildId, persistentCached);
        setIsLoadingCategories(false);
      }

      if (!persistentCached) setIsLoadingCategories(true);
      try {
        const nextCategories = await coalescedClientFetch(
          getCategoriesCacheKey(guildId),
          async () => {
            const response = await fetch(
              `/api/auth/me/guilds/sales-categories?guildId=${encodeURIComponent(guildId)}`,
              { credentials: "include", cache: "no-store" },
            );
            const payload = (await response.json().catch(() => ({}))) as CategoriesResponse;
            if (!response.ok || !payload.ok) {
              throw new Error(payload.message || "Erro ao carregar categorias.");
            }
            return payload.categories || [];
          },
        );
        if (!cancelled) {
          setCategories(nextCategories);
          writeCache(categoriesCache, guildId, nextCategories);
          writeClientCache(getCategoriesCacheKey(guildId), nextCategories);
        }
      } catch (error) {
        if (!cancelled && !persistentCached) {
          setCategories([]);
          setStatusMessage(
            error instanceof Error ? error.message : "Erro ao carregar categorias.",
          );
        }
      } finally {
        if (!cancelled) setIsLoadingCategories(false);
      }
    }

    void loadCategories();
    return () => {
      cancelled = true;
    };
  }, [guildId]);

  useEffect(() => {
    let cancelled = false;

    async function loadOrganizationProducts() {
      const cached =
        readCache(productsListCache, guildId) ||
        readClientCache<SalesProduct[]>(getProductsCacheKey(guildId), SALES_PRODUCTS_STALE_TTL_MS);
      if (cached) {
        setLibraryProducts(cached);
        writeCache(productsListCache, guildId, cached);
      }

      try {
        const nextProducts = await coalescedClientFetch(
          getProductsCacheKey(guildId),
          async () => {
            const response = await fetch(
              `/api/auth/me/guilds/sales-products?guildId=${encodeURIComponent(guildId)}`,
              { credentials: "include", cache: "no-store" },
            );
            const payload = (await response.json().catch(() => ({}))) as ProductsResponse;
            if (!response.ok || !payload.ok) {
              throw new Error(payload.message || "Erro ao carregar organizacao dos produtos.");
            }
            return payload.products || [];
          },
        );
        if (cancelled) return;
        setLibraryProducts(nextProducts);
        writeCache(productsListCache, guildId, nextProducts);
        writeClientCache(getProductsCacheKey(guildId), nextProducts);
      } catch {
        if (!cancelled && !cached) setLibraryProducts([]);
      }
    }

    void loadOrganizationProducts();
    return () => {
      cancelled = true;
    };
  }, [guildId]);

  const loadDiscordChannels = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const persistentCached =
        readCache(channelsCache, guildId) ||
        readClientCache<DiscordChannel[]>(getChannelsCacheKey(guildId), SALES_PRODUCTS_STALE_TTL_MS);

      if (persistentCached?.length && !force) {
        setDiscordChannels(persistentCached);
        writeCache(channelsCache, guildId, persistentCached);
        setIsLoadingChannels(false);
      } else {
        setIsLoadingChannels(true);
      }

      setChannelsMessage(null);
      try {
        const nextChannels = await fetchDiscordTextChannelsWithRetry(guildId);
        setDiscordChannels(nextChannels);

        if (nextChannels.length) {
          writeCache(channelsCache, guildId, nextChannels);
          writeClientCache(getChannelsCacheKey(guildId), nextChannels);
          setChannelsMessage(null);
        } else {
          channelsCache.delete(guildId);
          invalidateClientCache(getChannelsCacheKey(guildId));
          setChannelsMessage("Nenhum canal de texto foi encontrado neste servidor.");
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro ao carregar canais Discord.";
        if (!persistentCached?.length || force) {
          setDiscordChannels([]);
        }
        setChannelsMessage(message);
      } finally {
        setIsLoadingChannels(false);
      }
    },
    [guildId],
  );

  useEffect(() => {
    let active = true;

    async function run() {
      await loadDiscordChannels();
      if (!active) return;
    }

    void run();
    return () => {
      active = false;
    };
  }, [loadDiscordChannels]);

  useEffect(() => {
    if (mode !== "edit") return;

    const safeProductCode = productCode.trim().toLowerCase();
    if (!safeProductCode) {
      setStatusMessage("Codigo do produto invalido.");
      setIsLoadingProduct(false);
      return;
    }

    let cancelled = false;

    async function loadProduct() {
      const cacheKey = `${guildId}:${safeProductCode}`;
      const cached =
        readCache(productDetailCache, cacheKey) ||
        readClientCache<SalesProduct>(
          getProductCacheKey(guildId, safeProductCode),
          SALES_PRODUCTS_STALE_TTL_MS,
        );
      if (cached) {
        setTitle(cached.title);
        setDescription(cached.description || "");
        setStatus(cached.status);
        setCategoryId(cached.categoryId || "");
        setMediaUrls(cached.mediaUrls || []);
        setPriceAmount(String(cached.priceAmount || ""));
        setCompareAtPriceAmount(
          cached.compareAtPriceAmount ? String(cached.compareAtPriceAmount) : "",
        );
        setUnitPriceAmount(cached.unitPriceAmount ? String(cached.unitPriceAmount) : "");
        setChargeTaxes(cached.chargeTaxes !== false);
        setCostPerItemAmount(
          cached.costPerItemAmount ? String(cached.costPerItemAmount) : "",
        );
        setInventoryTracked(cached.inventoryTracked);
        setStockQuantity(String(cached.stockQuantity || 0));
        setSku(cached.sku || "");
        setSkuEdited(true);
        setBarcodeMode(cached.barcodeMode === "manual" ? "manual" : "auto");
        setBarcode(cached.barcode || generateBarcode(cached.title));
        setProductType(cached.productType || "");
        setManufacturer(cached.manufacturer || "");
        setTags(cached.tags || []);
        setDiscordPublicationMode(
          cached.discordPublicationMode === "channel" ? "channel" : "online_only",
        );
        setDiscordChannelId(cached.discordChannelId || "");
        setPublishedVirtualStore(cached.publishedVirtualStore !== false);
        writeCache(productDetailCache, cacheKey, cached);
        setIsLoadingProduct(false);
      }

      if (!cached) setIsLoadingProduct(true);
      setStatusMessage(null);

      try {
        const product = await coalescedClientFetch(
          getProductCacheKey(guildId, safeProductCode),
          async () => {
            const response = await fetch(
              `/api/auth/me/guilds/sales-products?guildId=${encodeURIComponent(guildId)}&productCode=${encodeURIComponent(safeProductCode)}`,
              { credentials: "include", cache: "no-store" },
            );
            const payload = (await response.json().catch(() => ({}))) as ProductsResponse;

            if (!response.ok || !payload.ok || !payload.product) {
              throw new Error(payload.message || "Produto nao encontrado.");
            }

            return payload.product;
          },
        );

        if (cancelled) return;

        setTitle(product.title);
        setDescription(product.description || "");
        setStatus(product.status);
        setCategoryId(product.categoryId || "");
        setMediaUrls(product.mediaUrls || []);
        setPriceAmount(String(product.priceAmount || ""));
        setCompareAtPriceAmount(
          product.compareAtPriceAmount ? String(product.compareAtPriceAmount) : "",
        );
        setUnitPriceAmount(product.unitPriceAmount ? String(product.unitPriceAmount) : "");
        setChargeTaxes(product.chargeTaxes !== false);
        setCostPerItemAmount(
          product.costPerItemAmount ? String(product.costPerItemAmount) : "",
        );
        setInventoryTracked(product.inventoryTracked);
        setStockQuantity(String(product.stockQuantity || 0));
        setSku(product.sku || "");
        setSkuEdited(true);
        setBarcodeMode(product.barcodeMode === "manual" ? "manual" : "auto");
        setBarcode(product.barcode || generateBarcode(product.title));
        setProductType(product.productType || "");
        setManufacturer(product.manufacturer || "");
        setTags(product.tags || []);
        setDiscordPublicationMode(
          product.discordPublicationMode === "channel" ? "channel" : "online_only",
        );
        setDiscordChannelId(product.discordChannelId || "");
        setPublishedVirtualStore(product.publishedVirtualStore !== false);
        writeCache(productDetailCache, `${guildId}:${safeProductCode}`, product);
        writeClientCache(getProductCacheKey(guildId, safeProductCode), product);
      } catch (error) {
        if (cancelled) return;
        if (!cached) {
          setStatusMessage(
            error instanceof Error ? error.message : "Erro ao carregar produto.",
          );
        }
      } finally {
        if (!cancelled) setIsLoadingProduct(false);
      }
    }

    void loadProduct();

    return () => {
      cancelled = true;
    };
  }, [guildId, mode, productCode]);

  useEffect(() => {
    if (!isMediaLibraryOpen) return;
    let cancelled = false;

    async function loadMediaLibraryProducts() {
      const cached =
        readCache(productsListCache, guildId) ||
        readClientCache<SalesProduct[]>(getProductsCacheKey(guildId), SALES_PRODUCTS_STALE_TTL_MS);
      if (cached) {
        setLibraryProducts(cached);
        writeCache(productsListCache, guildId, cached);
      }

      try {
        const nextProducts = await coalescedClientFetch(
          getProductsCacheKey(guildId),
          async () => {
            const response = await fetch(
              `/api/auth/me/guilds/sales-products?guildId=${encodeURIComponent(guildId)}`,
              { credentials: "include", cache: "no-store" },
            );
            const payload = (await response.json().catch(() => ({}))) as ProductsResponse;
            if (!response.ok || !payload.ok) {
              throw new Error(payload.message || "Erro ao carregar midias existentes.");
            }
            return payload.products || [];
          },
        );
        if (cancelled) return;
        setLibraryProducts(nextProducts);
        writeCache(productsListCache, guildId, nextProducts);
        writeClientCache(getProductsCacheKey(guildId), nextProducts);
      } catch (error) {
        if (!cancelled && !cached) {
          setStatusMessage(
            error instanceof Error ? error.message : "Erro ao carregar midias existentes.",
          );
        }
      }
    }

    void loadMediaLibraryProducts();
    return () => {
      cancelled = true;
    };
  }, [guildId, isMediaLibraryOpen]);

  useEffect(() => {
    mediaUrlsRef.current = mediaUrls;
  }, [mediaUrls]);

  useEffect(() => {
    return () => {
      mediaUrlsRef.current.forEach(revokeObjectUrl);
    };
  }, []);

  useEffect(() => {
    if (!title.trim()) return;
    if (!skuEdited) setSku(generateSku(title));
    if (barcodeMode === "auto") setBarcode(generateBarcode(title));
  }, [barcodeMode, skuEdited, title]);

  const categoryOptions = useMemo(
    () => {
      const options = [
        ["", isLoadingCategories ? "Carregando categorias..." : "Escolha uma categoria de produto"],
        ...categories.map((item) => [item.id, item.title]),
      ] as Array<[string, string]>;

      if (categoryId && !options.some(([value]) => value === categoryId)) {
        options.push([categoryId, "Categoria atual"]);
      }

      return options;
    },
    [categories, categoryId, isLoadingCategories],
  );
  const discordChannelOptions = useMemo(
    () => {
      const placeholder = isLoadingChannels
        ? "Carregando canais..."
        : channelsMessage
          ? "Atualize para carregar canais"
          : "Escolha um canal Discord";
      const options = [
        ["", placeholder],
        ...discordChannels.map((item) => [item.id, `#${item.name}`]),
      ] as Array<[string, string]>;

      if (discordChannelId && !options.some(([value]) => value === discordChannelId)) {
        options.push([discordChannelId, "Canal atual"]);
      }

      return options;
    },
    [channelsMessage, discordChannelId, discordChannels, isLoadingChannels],
  );
  const tagSuggestions = useMemo(() => {
    const productTags = libraryProducts.flatMap((product) => product.tags || []);
    return buildOrganizationSuggestions(organizationUsage.tags, productTags, tags);
  }, [libraryProducts, organizationUsage.tags, tags]);
  const productTypeSuggestions = useMemo(() => {
    return buildOrganizationSuggestions(
      organizationUsage.productTypes,
      libraryProducts.map((product) => product.productType),
      productType ? [productType] : [],
    );
  }, [libraryProducts, organizationUsage.productTypes, productType]);
  const manufacturerSuggestions = useMemo(() => {
    return buildOrganizationSuggestions(
      organizationUsage.manufacturers,
      libraryProducts.map((product) => product.manufacturer),
      manufacturer ? [manufacturer] : [],
    );
  }, [libraryProducts, manufacturer, organizationUsage.manufacturers]);
  const mediaLibraryItems = useMemo(
    () => buildMediaLibraryItems(libraryProducts, mediaUrls),
    [libraryProducts, mediaUrls],
  );
  const searchPreview = useMemo(() => {
    const displayTitle = title.trim() || "Novo produto";
    const brand = manufacturer.trim() || "flowdesk.store";
    const slugSource = [title, productType, tags.join(" ")].filter(Boolean).join(" ");
    return {
      brand,
      title: displayTitle,
      url: `https://shop.flwdesk.com/products/${slugifyProductPath(slugSource || displayTitle)}`,
      description: plainTextPreview(description),
      price: `${formatMoney(Number(priceAmount.replace(",", ".")) || 0)} BRL`,
    };
  }, [description, manufacturer, priceAmount, productType, tags, title]);

  const isEditMode = mode === "edit";
  const isFormLoading = isLoadingProduct || isLoadingCategories;
  const controlsDisabled = isFormLoading || isSaving || readOnly;
  const hasDiscordPublicationTarget =
    discordPublicationMode === "online_only" || Boolean(discordChannelId);
  const hasRequiredCategory = Boolean(categoryId);
  const parsedPriceAmount = parseMoneyInput(priceAmount);
  const hasRequiredPrice = parsedPriceAmount !== null;
  const canSave =
    title.trim().length >= 2 &&
    hasRequiredCategory &&
    hasRequiredPrice &&
    hasDiscordPublicationTarget &&
    !isSaving &&
    !isFormLoading &&
    !readOnly;

  const goBack = useCallback(() => {
    router.push(getProductsPath(guildId));
  }, [guildId, router]);

  const addMediaFiles = useCallback(async (files: FileList | null | undefined) => {
    const imageFiles = Array.from(files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!imageFiles.length) return;
    const oversizedFile = imageFiles.find((file) => file.size > MEDIA_FILE_MAX_BYTES);
    if (oversizedFile) {
      setStatusMessage(`A imagem ${oversizedFile.name} ultrapassa o limite de 3 MB.`);
      return;
    }

    try {
      const encodedImages = await Promise.all(imageFiles.map(fileToDataUrl));
      setMediaUrls((current) => [...current, ...encodedImages.filter(Boolean)].slice(0, 8));
      setStatusMessage(null);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Nao foi possivel carregar a imagem.",
      );
    }
  }, []);

  const addExistingMedia = useCallback((urls: string[]) => {
    if (!urls.length) return;
    setMediaUrls((current) => {
      const next = [...current];
      urls.forEach((url) => {
        if (url && !next.includes(url)) next.push(url);
      });
      return next.slice(0, 8);
    });
    setStatusMessage(null);
    setIsMediaLibraryOpen(false);
  }, []);

  const removeMedia = useCallback((url: string) => {
    setMediaUrls((current) => current.filter((item) => item !== url));
    revokeObjectUrl(url);
  }, []);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      if (title.trim().length < 2) {
        setStatusMessage("Informe um titulo para salvar o produto.");
      } else if (!hasRequiredCategory) {
        setStatusMessage("Escolha uma categoria para salvar o produto.");
      } else if (!hasRequiredPrice) {
        setStatusMessage("Informe um preco valido para salvar o produto. Pode ser 0, mas nao pode ficar vazio.");
      } else {
        setStatusMessage(
          "Escolha Somente online ou selecione um canal Discord antes de salvar.",
        );
      }
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/auth/me/guilds/sales-products", {
        method: isEditMode ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          productCode: isEditMode ? productCode : undefined,
          title,
          description,
          categoryId: categoryId || null,
          status,
          mediaUrls,
          priceAmount,
          compareAtPriceAmount,
          unitPriceAmount: null,
          chargeTaxes: false,
          costPerItemAmount: null,
          inventoryTracked: true,
          sku,
          barcode,
          barcodeMode,
          productType,
          manufacturer,
          tags,
          themeModel: "default",
          discordPublicationMode,
          discordChannelId:
            discordPublicationMode === "channel" ? discordChannelId : null,
          publishedVirtualStore,
          publishedPointOfSale: false,
          publishedPinterest: false,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ProductsResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Erro ao salvar produto.");
      }
      rememberOrganizationValues("productTypes", [productType]);
      rememberOrganizationValues("manufacturers", [manufacturer]);
      rememberOrganizationValues("tags", tags);
      router.push(getProductsPath(guildId));
      invalidateProductCaches(guildId);
      router.refresh();
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Erro ao salvar produto.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    barcode,
    barcodeMode,
    canSave,
    categoryId,
    compareAtPriceAmount,
    description,
    discordChannelId,
    discordPublicationMode,
    guildId,
    hasRequiredCategory,
    hasRequiredPrice,
    isEditMode,
    manufacturer,
    mediaUrls,
    priceAmount,
    productType,
    productCode,
    publishedVirtualStore,
    rememberOrganizationValues,
    router,
    sku,
    status,
    tags,
    title,
  ]);

  const handleDeleteProduct = useCallback(async () => {
    if (!isEditMode || !productCode || readOnly || isDeleting) return;
    setIsDeleting(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/auth/me/guilds/sales-products", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId, productCode }),
      });
      const payload = (await response.json().catch(() => ({}))) as ProductsResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Erro ao excluir produto.");
      }
      invalidateProductCaches(guildId);
      setIsDeleteModalOpen(false);
      router.push(getProductsPath(guildId));
      router.refresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Erro ao excluir produto.");
    } finally {
      setIsDeleting(false);
    }
  }, [guildId, isDeleting, isEditMode, productCode, readOnly, router]);

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
            Produtos
          </ServerButton>
          <div className="mt-[10px] flex items-center gap-[10px]">
            <Package className="h-[18px] w-[18px] text-[#A5A5A5]" />
            <h3 className="text-[24px] font-semibold tracking-[-0.05em] text-[#EFEFEF]">
              {isEditMode ? "Editar produto" : "Adicionar produto"}
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-[10px]">
          <ServerButton onClick={goBack}>Cancelar</ServerButton>
          <ServerButton
            aria-busy={isSaving}
            disabled={!canSave}
            onClick={() => void handleSave()}
            variant="primary"
            className="min-w-[158px]"
          >
            {isSaving ? (
              <ButtonLoader size={16} colorClassName="text-[#080808]" />
            ) : (
              <>
                <Check className="h-[16px] w-[16px]" />
                {isEditMode ? "Salvar alteracoes" : "Salvar produto"}
              </>
            )}
          </ServerButton>
        </div>
      </div>

      {statusMessage ? (
        <div className="rounded-[18px] border border-[#3A2A1E] bg-[#170F09] px-[14px] py-[12px] text-[13px] text-[#F2B27D]">
          {statusMessage}
        </div>
      ) : null}

      {isFormLoading ? (
        <ProductEditorSkeleton />
      ) : (
      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_398px]">
        <div className="space-y-[18px]">
          <ServerSurface className="relative z-[60] p-[18px] sm:p-[22px]">
            <label className="block text-[13px] font-semibold text-[#D8D8D8]">
              Titulo
            </label>
            <ServerTextInput
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="Ex.: Camiseta de manga curta"
              className="mt-[10px]"
              disabled={controlsDisabled}
            />

            <label className="mt-[20px] block text-[13px] font-semibold text-[#D8D8D8]">
              Descricao
            </label>
            <SalesDescriptionEditor
              guildId={guildId}
              kind="product"
              scopeId={mode === "edit" && productCode ? `product:${productCode}` : undefined}
              title={title}
              value={description}
              onChange={(nextDescription) => {
                setDescription(nextDescription);
                setStatusMessage(null);
              }}
              disabled={controlsDisabled}
              maxLength={1800}
              placeholder="Descreva beneficios, prazo de entrega e regras do produto."
            />

            <div className="mt-[22px]">
              <div className="flex flex-col gap-[10px] sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Midias</h4>
                <ServerButton
                  onClick={() => setIsMediaLibraryOpen(true)}
                  disabled={controlsDisabled}
                  size="sm"
                  className="h-[38px] self-start sm:self-auto"
                >
                  <FileImage className="h-[15px] w-[15px]" />
                  Selecionar existente
                </ServerButton>
              </div>
              <input
                ref={mediaInputRef}
                type="file"
                accept="image/*"
                multiple
                disabled={controlsDisabled}
                className="hidden"
                onChange={(event) => void addMediaFiles(event.target.files)}
              />
              {mediaUrls.length ? (
                <div className="mt-[14px] grid grid-cols-2 gap-[10px] sm:grid-cols-3 lg:grid-cols-4">
                  {mediaUrls.map((url) => (
                    <div
                      key={url}
                      className="group relative aspect-square overflow-hidden rounded-[16px] border border-[#252525] bg-[#0D0D0D]"
                    >
                      <Image
                        src={url}
                        alt="Midia do produto"
                        fill
                        unoptimized
                        className="object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeMedia(url)}
                        disabled={controlsDisabled}
                        className="absolute right-[8px] top-[8px] inline-flex h-[28px] w-[28px] items-center justify-center rounded-[10px] bg-[rgba(0,0,0,0.65)] text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <X className="h-[14px] w-[14px]" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => mediaInputRef.current?.click()}
                    disabled={controlsDisabled}
                    className="flowdesk-server-button aspect-square rounded-[16px] border border-dashed border-[#363636] bg-[#0D0D0D] text-[#DCDCDC] transition hover:border-[#585858] hover:bg-[#111]"
                  >
                    <Plus className="mx-auto h-[22px] w-[22px]" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => mediaInputRef.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void addMediaFiles(event.dataTransfer.files);
                  }}
                  className="flowdesk-server-button mt-[14px] flex min-h-[150px] w-full flex-col items-center justify-center rounded-[18px] border border-dashed border-[#363636] bg-[#0D0D0D] px-[16px] text-center transition hover:border-[#585858] hover:bg-[#111]"
                  disabled={controlsDisabled}
                >
                  <Upload className="h-[22px] w-[22px] text-[#E8E8E8]" />
                  <span className="mt-[12px] rounded-[12px] border border-[#2C2C2C] bg-[#141414] px-[13px] py-[8px] text-[13px] font-semibold text-[#F0F0F0]">
                    Fazer upload
                  </span>
                  <span className="mt-[10px] text-[13px] text-[#7E7E7E]">
                    Aceita imagens e cria previa instantanea.
                  </span>
                </button>
              )}
            </div>

            <div className="mt-[22px]">
              <label className="block text-[13px] font-semibold text-[#D8D8D8]">
                Categoria
              </label>
              <div className="mt-[10px]">
                <SelectMenu
                  value={categoryId}
                  options={categoryOptions}
                  onChange={setCategoryId}
                  disabled={controlsDisabled}
                />
              </div>
              <p className="mt-[9px] text-[13px] leading-[1.45] text-[#7B7B7B]">
                Obrigatoria para organizar o produto e permitir a publicacao correta.
              </p>
            </div>
          </ServerSurface>

          <ServerSurface className="overflow-hidden">
            <div className="p-[18px] sm:p-[22px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Preco</h4>
              <div className="mt-[14px] grid gap-[10px] sm:grid-cols-2">
                <ServerTextInput
                  value={priceAmount}
                  onChange={(event) => setPriceAmount(event.target.value)}
                  placeholder="R$ 0,00"
                  disabled={controlsDisabled}
                />
                <ServerTextInput
                  value={compareAtPriceAmount}
                  onChange={(event) => setCompareAtPriceAmount(event.target.value)}
                  placeholder="Preco de comparacao"
                  disabled={controlsDisabled}
                />
              </div>
              <p className="mt-[10px] text-[12px] leading-[1.45] text-[#7B7B7B]">
                Obrigatorio. Use 0 quando o produto nao tiver cobranca imediata.
              </p>
            </div>
          </ServerSurface>

          <ServerSurface className="overflow-hidden">
            <div className="p-[18px] sm:p-[22px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Estoque</h4>
              <p className="mt-[8px] text-[12px] leading-[1.45] text-[#7B7B7B]">
                Quantidade calculada pelo modulo Estoque. Adicione, edite ou remova entregas digitais por la.
              </p>
            </div>
            <div className="mx-[18px] mb-[18px] overflow-hidden rounded-[18px] border border-[#202020] sm:mx-[22px] sm:mb-[20px]">
              <div className="grid grid-cols-2 bg-[#101010] px-[14px] py-[10px] text-[12px] font-semibold text-[#BDBDBD]">
                <span>Origem</span>
                <span className="text-right">Disponivel</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-[12px] px-[14px] py-[12px]">
                <span className="truncate text-[14px] text-[#EDEDED]">
                  Estoque principal
                </span>
                <ServerTextInput
                  value={stockQuantity}
                  inputMode="numeric"
                  className="h-[40px]"
                  disabled
                  aria-label="Quantidade disponivel calculada pelo estoque"
                />
              </div>
            </div>
            <div className="grid gap-[10px] border-t border-[#171717] p-[18px] sm:grid-cols-2 sm:p-[20px]">
              <div>
                <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                  SKU
                </label>
                <ServerTextInput
                  value={sku}
                  onChange={(event) => {
                    setSkuEdited(true);
                    setSku(sanitizeSku(event.target.value));
                  }}
                  placeholder="Gerado automaticamente"
                  className="h-[40px] text-[13px]"
                  disabled={controlsDisabled}
                />
              </div>
              <div>
                <div className="mb-[8px] flex items-center justify-between">
                  <label className="text-[12px] font-semibold text-[#AFAFAF]">
                    Codigo de barras
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const nextMode = barcodeMode === "auto" ? "manual" : "auto";
                      setBarcodeMode(nextMode);
                      if (nextMode === "auto") setBarcode(generateBarcode(title));
                    }}
                    className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8A8A8A] transition hover:text-white"
                    disabled={controlsDisabled}
                  >
                    {barcodeMode === "auto" ? "Auto" : "Manual"}
                  </button>
                </div>
                <ServerTextInput
                  value={barcode}
                  onChange={(event) => {
                    setBarcodeMode("manual");
                    setBarcode(event.target.value.replace(/\D/g, "").slice(0, 18));
                  }}
                  placeholder="Codigo de barras"
                  className="h-[40px] text-[13px]"
                  disabled={controlsDisabled}
                />
              </div>
            </div>
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[22px]">
            <div className="flex items-start justify-between gap-[16px]">
              <div>
                <h4 className="text-[15px] font-semibold text-[#E7E7E7]">
                  Listagem em mecanismos de pesquisa
                </h4>
                <p className="mt-[8px] text-[12px] leading-[1.5] text-[#777]">
                  Previa aproximada de como o produto pode aparecer em buscas da loja.
                </p>
              </div>
              <Pencil className="h-[17px] w-[17px] shrink-0 text-[#8A8A8A]" />
            </div>
            <div className="mt-[18px] rounded-[18px] border border-[#202020] bg-[#0C0C0C] p-[16px]">
              <p className="truncate text-[13px] text-[#D8D8D8]">{searchPreview.brand}</p>
              <p className="mt-[5px] truncate text-[13px] text-[#8A8A8A]">
                {searchPreview.url.replace("https://", "").split("/").join(" › ")}
              </p>
              <p className="mt-[12px] text-[20px] leading-[1.25] font-medium text-[#8AB6FF]">
                {searchPreview.title}
              </p>
              <p className="mt-[10px] line-clamp-2 text-[14px] leading-[1.55] text-[#BDBDBD]">
                {searchPreview.description}
              </p>
              <p className="mt-[10px] text-[14px] font-semibold text-[#DCDCDC]">
                {searchPreview.price}
              </p>
            </div>
          </ServerSurface>

          {isEditMode ? (
            <ServerDangerZone
              title="Excluir produto"
              description="Remove o produto da loja e do painel. Se ja existir historico de pedidos, ele sera arquivado fora do catalogo para preservar auditoria."
              actionLabel="Excluir produto"
              disabled={controlsDisabled || isDeleting}
              onAction={() => setIsDeleteModalOpen(true)}
            />
          ) : null}
        </div>

        <aside className="space-y-[18px]">
          <ServerSurface className="relative z-[80] p-[18px] sm:p-[20px]">
            <label className="block text-[14px] font-semibold text-[#E2E2E2]">
              Status
            </label>
            <div className="mt-[12px]">
              <SelectMenu
                value={status}
                options={Object.entries(statusLabel) as Array<[ProductStatus, string]>}
                onChange={setStatus}
                disabled={controlsDisabled}
              />
            </div>
          </ServerSurface>

          <ServerSurface className="relative z-[30] p-[18px] sm:p-[20px]">
            <div className="flex items-center justify-between gap-[16px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
                Publicacao
              </h4>
              <SlidersHorizontal className="h-[17px] w-[17px] text-[#8A8A8A]" />
            </div>
            <div className="mt-[16px] flex flex-wrap gap-[8px]">
              <PillToggle
                active={publishedVirtualStore}
                onClick={() => setPublishedVirtualStore((current) => !current)}
                disabled={controlsDisabled}
              >
                Loja virtual
              </PillToggle>
            </div>
          </ServerSurface>

          <ServerSurface className="flowdesk-product-organization relative z-[180] p-[18px] sm:p-[20px]">
            <div className="flex items-center gap-[8px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
                Organizacao do produto
              </h4>
              <BadgeCheck className="h-[16px] w-[16px] text-[#8A8A8A]" />
            </div>
            <div className="mt-[16px] space-y-[12px]">
              <SmartTextPicker
                label="Tipo"
                value={productType}
                onChange={(nextValue) => {
                  setProductType(nextValue);
                  rememberOrganizationValues("productTypes", [nextValue]);
                  setStatusMessage(null);
                }}
                suggestions={productTypeSuggestions}
                disabled={controlsDisabled}
              />
              <SmartTextPicker
                label="Fabricante"
                value={manufacturer}
                onChange={(nextValue) => {
                  setManufacturer(nextValue);
                  rememberOrganizationValues("manufacturers", [nextValue]);
                  setStatusMessage(null);
                }}
                suggestions={manufacturerSuggestions}
                disabled={controlsDisabled}
              />
              <ProductTagsInput
                value={tags}
                onChange={(nextTags) => {
                  setTags(nextTags);
                  setStatusMessage(null);
                }}
                onAddTags={(nextTags) => rememberOrganizationValues("tags", nextTags)}
                suggestions={tagSuggestions}
                disabled={controlsDisabled}
              />
            </div>
          </ServerSurface>

          <ServerSurface className="relative z-[70] p-[18px] sm:p-[20px]">
            <div className="flex items-center justify-between gap-[12px]">
              <label className="block text-[14px] font-semibold text-[#E2E2E2]">
                Canal Discord
              </label>
              <button
                type="button"
                onClick={() => void loadDiscordChannels({ force: true })}
                disabled={controlsDisabled || isLoadingChannels}
                className="flowdesk-server-button inline-flex h-[30px] w-[30px] items-center justify-center rounded-[10px] text-[#8A8A8A] transition hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                aria-label="Atualizar canais Discord"
                title="Atualizar canais Discord"
              >
                {isLoadingChannels ? (
                  <ButtonLoader size={14} />
                ) : (
                  <RefreshCw className="h-[15px] w-[15px]" />
                )}
              </button>
            </div>
            <p className="mt-[10px] text-[13px] leading-[1.5] text-[#7B7B7B]">
              O bot publica um embed Component V2 com nome, descricao, valor e o botao Adicionar ao carrinho.
            </p>
            <div className="mt-[14px]">
              <SelectMenu
                value={discordPublicationMode}
                options={
                  Object.entries(discordPublicationLabel) as Array<
                    [ProductDiscordPublicationMode, string]
                  >
                }
                onChange={(nextMode) => {
                  setDiscordPublicationMode(nextMode);
                  if (nextMode === "online_only") setDiscordChannelId("");
                  setStatusMessage(null);
                }}
                disabled={controlsDisabled}
              />
            </div>
            {discordPublicationMode === "channel" ? (
              <div className="mt-[10px]">
                <SelectMenu
                  value={discordChannelId}
                  options={discordChannelOptions}
                  onChange={(nextChannelId) => {
                    setDiscordChannelId(nextChannelId);
                    setStatusMessage(null);
                  }}
                  disabled={controlsDisabled || isLoadingChannels || (!discordChannels.length && Boolean(channelsMessage))}
                  maxVisibleItems={6}
                />
                {channelsMessage ? (
                  <p className="mt-[9px] text-[12px] leading-[1.45] text-[#EFB47B]">
                    {channelsMessage} Clique em atualizar para tentar novamente.
                  </p>
                ) : (
                  <p className="mt-[9px] text-[12px] leading-[1.45] text-[#8A8A8A]">
                    {isLoadingChannels
                      ? "Buscando canais em tempo real no Discord..."
                      : "Ao criar ou atualizar, o painel envia ou edita o embed nesse canal automaticamente."}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-[9px] text-[12px] leading-[1.45] text-[#8A8A8A]">
                Nao envia embed no Discord; o produto fica preparado apenas para a loja online.
              </p>
            )}
          </ServerSurface>

          <ServerSurface className="relative z-0 p-[18px] sm:p-[20px]">
            <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
              Resumo
            </h4>
            <div className="mt-[14px] rounded-[18px] border border-[#242424] bg-[#0F0F0F] p-[14px]">
              <div className="flex items-center gap-[12px]">
                <span className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-[14px] bg-[#F4F4F4] text-[#070707]">
                  {mediaUrls.length ? (
                    <ImagePlus className="h-[18px] w-[18px]" />
                  ) : (
                    <Tag className="h-[18px] w-[18px]" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[#F1F1F1]">
                    {title.trim() || "Novo produto"}
                  </p>
                  <p className="mt-[3px] text-[12px] text-[#7B7B7B]">
                    {formatMoney(Number(priceAmount.replace(",", ".")) || 0)} - {sku || "SKU automatico"}
                  </p>
                </div>
                <Barcode className="ml-auto h-[16px] w-[16px] text-[#777]" />
              </div>
            </div>
          </ServerSurface>
        </aside>
      </div>
      )}
      <ProductMediaLibraryModal
        open={isMediaLibraryOpen}
        items={mediaLibraryItems}
        selectedUrls={mediaUrls}
        onClose={() => setIsMediaLibraryOpen(false)}
        onConfirm={addExistingMedia}
        onUpload={addMediaFiles}
        disabled={controlsDisabled}
      />
      <ServerDeleteConfirmModal
        open={isDeleteModalOpen}
        title="Excluir produto?"
        description={`Esta acao remove "${title.trim() || "este produto"}" das listagens. Estoques vinculados podem ser removidos junto quando nao houver historico bloqueando a exclusao.`}
        confirmLabel="Excluir produto"
        isDeleting={isDeleting}
        onCancel={() => setIsDeleteModalOpen(false)}
        onConfirm={() => void handleDeleteProduct()}
      />
    </div>
  );
}

export function SalesProductEditPanel(props: SalesProductsPanelProps) {
  const pathname = usePathname();
  const productCode = getProductCodeFromPath(pathname);

  return (
    <SalesProductCreatePanel
      {...props}
      mode="edit"
      productCode={productCode}
    />
  );
}
