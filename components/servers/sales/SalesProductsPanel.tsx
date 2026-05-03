"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Barcode,
  Check,
  ChevronDown,
  CircleDollarSign,
  Hash,
  ImagePlus,
  Package,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
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

function InlineSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className="flowdesk-server-button inline-flex items-center gap-[10px] text-[13px] text-[#AFAFAF] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {label}
      <span
        className={`flex h-[22px] w-[40px] items-center rounded-full border p-[2px] transition ${
          checked ? "border-[#EDEDED] bg-[#EDEDED]" : "border-[#303030] bg-[#151515]"
        }`}
      >
        <span
          className={`h-[16px] w-[16px] rounded-full transition ${
            checked ? "translate-x-[16px] bg-[#070707]" : "translate-x-0 bg-[#777]"
          }`}
        />
      </span>
    </button>
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
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        className="flowdesk-server-button flex h-[42px] w-full items-center justify-between rounded-[14px] border border-[#292929] bg-[#0D0D0D] px-[14px] text-left text-[13px] text-[#EDEDED] transition hover:border-[#444] disabled:cursor-not-allowed disabled:opacity-55"
      >
        {options.find(([option]) => option === value)?.[1] || "Selecionar"}
        <ChevronDown
          className={`h-[16px] w-[16px] text-[#777] transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="flowdesk-scale-in-soft absolute left-0 right-0 top-[50px] z-[120] rounded-[18px] border border-[#1E1E1E] bg-[#080808] p-[8px] shadow-[0_24px_70px_rgba(0,0,0,0.48)]">
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

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/auth/me/guilds/sales-products?guildId=${encodeURIComponent(guildId)}`,
        { credentials: "include", cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as ProductsResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Erro ao carregar produtos.");
      }
      setProducts(payload.products || []);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Erro ao carregar produtos.",
      );
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
  const [isLoadingProduct, setIsLoadingProduct] = useState(mode === "edit");
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProductStatus>("active");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [priceAmount, setPriceAmount] = useState("");
  const [compareAtPriceAmount, setCompareAtPriceAmount] = useState("");
  const [unitPriceAmount, setUnitPriceAmount] = useState("");
  const [chargeTaxes, setChargeTaxes] = useState(true);
  const [costPerItemAmount, setCostPerItemAmount] = useState("");
  const [inventoryTracked, setInventoryTracked] = useState(true);
  const [stockQuantity, setStockQuantity] = useState("0");
  const [sku, setSku] = useState("");
  const [skuEdited, setSkuEdited] = useState(false);
  const [barcodeMode, setBarcodeMode] = useState<"auto" | "manual">("auto");
  const [barcode, setBarcode] = useState(generateBarcode("flowdesk"));
  const [productType, setProductType] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [discordPublicationMode, setDiscordPublicationMode] =
    useState<ProductDiscordPublicationMode>("online_only");
  const [discordChannelId, setDiscordChannelId] = useState("");
  const [publishedVirtualStore, setPublishedVirtualStore] = useState(true);
  const [publishedPointOfSale, setPublishedPointOfSale] = useState(true);
  const [publishedPinterest, setPublishedPinterest] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const mediaUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      setIsLoadingCategories(true);
      try {
        const response = await fetch(
          `/api/auth/me/guilds/sales-categories?guildId=${encodeURIComponent(guildId)}`,
          { credentials: "include", cache: "no-store" },
        );
        const payload = (await response.json().catch(() => ({}))) as CategoriesResponse;
        if (!cancelled && response.ok && payload.ok) {
          setCategories(payload.categories || []);
        }
      } catch {
        if (!cancelled) setCategories([]);
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

    async function loadChannels() {
      setIsLoadingChannels(true);
      try {
        const response = await fetch(
          `/api/auth/me/guilds/channels?guildId=${encodeURIComponent(guildId)}`,
          { credentials: "include", cache: "no-store" },
        );
        const payload = (await response.json().catch(() => ({}))) as ChannelsResponse;
        if (!cancelled && response.ok && payload.ok) {
          setDiscordChannels(payload.channels?.text || []);
        }
      } catch {
        if (!cancelled) setDiscordChannels([]);
      } finally {
        if (!cancelled) setIsLoadingChannels(false);
      }
    }

    void loadChannels();
    return () => {
      cancelled = true;
    };
  }, [guildId]);

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
      setIsLoadingProduct(true);
      setStatusMessage(null);

      try {
        const response = await fetch(
          `/api/auth/me/guilds/sales-products?guildId=${encodeURIComponent(guildId)}&productCode=${encodeURIComponent(safeProductCode)}`,
          { credentials: "include", cache: "no-store" },
        );
        const payload = (await response.json().catch(() => ({}))) as ProductsResponse;

        if (!response.ok || !payload.ok || !payload.product) {
          throw new Error(payload.message || "Produto nao encontrado.");
        }

        if (cancelled) return;

        const product = payload.product;
        setTitle(product.title);
        setDescription(product.description || "");
        setStatus(product.status);
        setCategoryId(product.categoryId || "");
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
        setTagsText((product.tags || []).join(", "));
        setDiscordPublicationMode(
          product.discordPublicationMode === "channel" ? "channel" : "online_only",
        );
        setDiscordChannelId(product.discordChannelId || "");
        setPublishedVirtualStore(product.publishedVirtualStore !== false);
        setPublishedPointOfSale(product.publishedPointOfSale !== false);
        setPublishedPinterest(product.publishedPinterest === true);
      } catch (error) {
        if (cancelled) return;
        setStatusMessage(
          error instanceof Error ? error.message : "Erro ao carregar produto.",
        );
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
    () =>
      [["", "Escolha uma categoria de produto"], ...categories.map((item) => [item.id, item.title])] as Array<
        [string, string]
      >,
    [categories],
  );
  const discordChannelOptions = useMemo(
    () =>
      [["", "Escolha um canal Discord"], ...discordChannels.map((item) => [item.id, `#${item.name}`])] as Array<
        [string, string]
      >,
    [discordChannels],
  );

  const isEditMode = mode === "edit";
  const isFormLoading = isLoadingProduct || isLoadingCategories || isLoadingChannels;
  const controlsDisabled = isFormLoading || isSaving || readOnly;
  const hasDiscordPublicationTarget =
    discordPublicationMode === "online_only" || Boolean(discordChannelId);
  const canSave =
    title.trim().length >= 2 &&
    hasDiscordPublicationTarget &&
    !isSaving &&
    !isFormLoading &&
    !readOnly;

  const goBack = useCallback(() => {
    router.push(getProductsPath(guildId));
  }, [guildId, router]);

  const addMediaFiles = useCallback((files: FileList | null | undefined) => {
    const imageFiles = Array.from(files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!imageFiles.length) return;

    setMediaUrls((current) => {
      const next = [
        ...current,
        ...imageFiles.map((file) => URL.createObjectURL(file)),
      ].slice(0, 8);
      return next;
    });
    setStatusMessage(null);
  }, []);

  const removeMedia = useCallback((url: string) => {
    setMediaUrls((current) => current.filter((item) => item !== url));
    revokeObjectUrl(url);
  }, []);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      setStatusMessage(
        title.trim().length < 2
          ? "Informe um titulo para salvar o produto."
          : "Escolha Somente online ou selecione um canal Discord antes de salvar.",
      );
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
          mediaUrls: [],
          priceAmount,
          compareAtPriceAmount,
          unitPriceAmount,
          chargeTaxes,
          costPerItemAmount,
          inventoryTracked,
          stockQuantity,
          sku,
          barcode,
          barcodeMode,
          productType,
          manufacturer,
          tags: tagsText
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          themeModel: "default",
          discordPublicationMode,
          discordChannelId:
            discordPublicationMode === "channel" ? discordChannelId : null,
          publishedVirtualStore,
          publishedPointOfSale,
          publishedPinterest,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ProductsResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Erro ao salvar produto.");
      }
      router.push(getProductsPath(guildId));
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
    chargeTaxes,
    compareAtPriceAmount,
    costPerItemAmount,
    description,
    discordChannelId,
    discordPublicationMode,
    guildId,
    inventoryTracked,
    isEditMode,
    manufacturer,
    priceAmount,
    productType,
    productCode,
    publishedPinterest,
    publishedPointOfSale,
    publishedVirtualStore,
    router,
    sku,
    status,
    stockQuantity,
    tagsText,
    title,
    unitPriceAmount,
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
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Midias</h4>
              <input
                ref={mediaInputRef}
                type="file"
                accept="image/*"
                multiple
                disabled={controlsDisabled}
                className="hidden"
                onChange={(event) => addMediaFiles(event.target.files)}
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
                    addMediaFiles(event.dataTransfer.files);
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
                Define filtros, colecoes e organizacao para canais de venda.
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
            </div>
            <div className="flex flex-wrap items-center gap-[10px] border-t border-[#171717] p-[18px] sm:p-[20px]">
              <ServerTextInput
                value={unitPriceAmount}
                onChange={(event) => setUnitPriceAmount(event.target.value)}
                placeholder="Preco unitario"
                className="h-[38px] max-w-[180px] text-[13px]"
                disabled={controlsDisabled}
              />
              <PillToggle
                active={chargeTaxes}
                onClick={() => setChargeTaxes((current) => !current)}
                disabled={controlsDisabled}
              >
                Cobrar tributos {chargeTaxes ? "Sim" : "Nao"}
              </PillToggle>
              <ServerTextInput
                value={costPerItemAmount}
                onChange={(event) => setCostPerItemAmount(event.target.value)}
                placeholder="Custo por item"
                className="h-[38px] max-w-[170px] text-[13px]"
                disabled={controlsDisabled}
              />
              <CircleDollarSign className="ml-auto h-[17px] w-[17px] text-[#777]" />
            </div>
          </ServerSurface>

          <ServerSurface className="overflow-hidden">
            <div className="flex items-center justify-between gap-[16px] p-[18px] sm:p-[22px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Estoque</h4>
              <InlineSwitch
                checked={inventoryTracked}
                onChange={() => setInventoryTracked((current) => !current)}
                label="Estoque rastreado"
                disabled={controlsDisabled}
              />
            </div>
            <div className="mx-[18px] mb-[18px] overflow-hidden rounded-[18px] border border-[#202020] sm:mx-[22px] sm:mb-[20px]">
              <div className="grid grid-cols-2 bg-[#101010] px-[14px] py-[10px] text-[12px] font-semibold text-[#BDBDBD]">
                <span>Quantidade</span>
                <span className="text-right">Quantidade</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-[12px] px-[14px] py-[12px]">
                <span className="truncate text-[14px] text-[#EDEDED]">
                  Estoque principal
                </span>
                <ServerTextInput
                  value={stockQuantity}
                  onChange={(event) => setStockQuantity(event.target.value)}
                  inputMode="numeric"
                  className="h-[40px]"
                  disabled={controlsDisabled}
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
              <PillToggle
                active={publishedPointOfSale}
                onClick={() => setPublishedPointOfSale((current) => !current)}
                disabled={controlsDisabled}
              >
                Ponto de venda
              </PillToggle>
              <PillToggle
                active={publishedPinterest}
                onClick={() => setPublishedPinterest((current) => !current)}
                disabled={controlsDisabled}
              >
                Pinterest
              </PillToggle>
            </div>
          </ServerSurface>

          <ServerSurface className="relative z-[20] p-[18px] sm:p-[20px]">
            <div className="flex items-center gap-[8px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
                Organizacao do produto
              </h4>
              <BadgeCheck className="h-[16px] w-[16px] text-[#8A8A8A]" />
            </div>
            <div className="mt-[16px] space-y-[12px]">
              <ServerTextInput
                value={productType}
                onChange={(event) => setProductType(event.target.value)}
                placeholder="Tipo"
                className="h-[42px]"
                disabled={controlsDisabled}
              />
              <ServerTextInput
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
                placeholder="Fabricante"
                className="h-[42px]"
                disabled={controlsDisabled}
              />
              <ServerTextInput
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="Tags separadas por virgula"
                className="h-[42px]"
                disabled={controlsDisabled}
              />
            </div>
          </ServerSurface>

          <ServerSurface className="relative z-[70] p-[18px] sm:p-[20px]">
            <div className="flex items-center justify-between gap-[12px]">
              <label className="block text-[14px] font-semibold text-[#E2E2E2]">
                Canal Discord
              </label>
              <Hash className="h-[16px] w-[16px] text-[#8A8A8A]" />
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
                  disabled={controlsDisabled}
                />
                <p className="mt-[9px] text-[12px] leading-[1.45] text-[#8A8A8A]">
                  Ao criar ou atualizar, o painel envia ou edita o embed nesse canal automaticamente.
                </p>
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
