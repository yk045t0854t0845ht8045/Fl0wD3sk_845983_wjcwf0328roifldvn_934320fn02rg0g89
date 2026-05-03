"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Barcode,
  Check,
  ChevronDown,
  CircleDollarSign,
  ImagePlus,
  Package,
  PackageSearch,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
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

type ProductStatus = "active" | "draft" | "archived";
type ProductTheme = "default" | "compact" | "featured";

type SalesProduct = {
  id: string;
  code: string;
  title: string;
  description: string;
  categoryId: string | null;
  status: ProductStatus;
  mediaUrls: string[];
  priceAmount: number;
  inventoryTracked: boolean;
  stockQuantity: number;
  sku: string;
  barcode: string;
  createdAt: string;
};

type SalesCategory = {
  id: string;
  code: string;
  title: string;
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

type SalesProductsPanelProps = {
  guildId: string;
  readOnly?: boolean;
};

const statusLabel: Record<ProductStatus, string> = {
  active: "Ativo",
  draft: "Rascunho",
  archived: "Arquivado",
};

const themeLabel: Record<ProductTheme, string> = {
  default: "Produto padrao",
  compact: "Produto compacto",
  featured: "Produto em destaque",
};

function getProductsPath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/products/`;
}

function getCreatePath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/products/create/`;
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

function buildAiDescription(title: string) {
  const cleanTitle = title.trim();
  return [
    `**${cleanTitle}** foi preparado para entregas rapidas e organizadas pelo Flowdesk.`,
    "Ideal para clientes que buscam uma compra simples, segura e com comprovante claro.",
    "Use esta descricao como base e ajuste beneficios, prazo de entrega e regras do produto.",
  ].join("\n\n");
}

function InlineSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flowdesk-server-button inline-flex items-center gap-[10px] text-[13px] text-[#AFAFAF]"
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
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
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
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flowdesk-server-button flex h-[42px] w-full items-center justify-between rounded-[14px] border border-[#292929] bg-[#0D0D0D] px-[14px] text-left text-[13px] text-[#EDEDED] transition hover:border-[#444]"
      >
        {options.find(([option]) => option === value)?.[1] || "Selecionar"}
        <ChevronDown
          className={`h-[16px] w-[16px] text-[#777] transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="flowdesk-scale-in-soft absolute left-0 right-0 top-[50px] z-[50] rounded-[18px] border border-[#1E1E1E] bg-[#080808] p-[8px] shadow-[0_24px_70px_rgba(0,0,0,0.48)]">
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

export function SalesProductCreatePanel({
  guildId,
  readOnly = false,
}: SalesProductsPanelProps) {
  const router = useRouter();
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const [categories, setCategories] = useState<SalesCategory[]>([]);
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
  const [themeModel, setThemeModel] = useState<ProductTheme>("default");
  const [publishedVirtualStore, setPublishedVirtualStore] = useState(true);
  const [publishedPointOfSale, setPublishedPointOfSale] = useState(true);
  const [publishedPinterest, setPublishedPinterest] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const mediaUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
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
      }
    }

    void loadCategories();
    return () => {
      cancelled = true;
    };
  }, [guildId]);

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

  const canSave = title.trim().length >= 2 && !isSaving && !readOnly;

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

  const handleGenerateDescription = useCallback(() => {
    if (!title.trim()) return;
    setIsGeneratingDescription(true);
    window.setTimeout(() => {
      setDescription(buildAiDescription(title));
      setIsGeneratingDescription(false);
    }, 260);
  }, [title]);

  const handleSave = useCallback(async () => {
    if (!canSave) {
      setStatusMessage("Informe um titulo para salvar o produto.");
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/auth/me/guilds/sales-products", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
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
          themeModel,
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
    guildId,
    inventoryTracked,
    manufacturer,
    priceAmount,
    productType,
    publishedPinterest,
    publishedPointOfSale,
    publishedVirtualStore,
    router,
    sku,
    status,
    stockQuantity,
    tagsText,
    themeModel,
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
              Adicionar produto
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
                Salvar produto
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

      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_398px]">
        <div className="space-y-[18px]">
          <ServerSurface className="p-[18px] sm:p-[22px]">
            <label className="block text-[13px] font-semibold text-[#D8D8D8]">
              Titulo
            </label>
            <ServerTextInput
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="Ex.: Camiseta de manga curta"
              className="mt-[10px]"
            />

            <div className="mt-[20px] flex items-center justify-between gap-[12px]">
              <label className="block text-[13px] font-semibold text-[#D8D8D8]">
                Descricao
              </label>
              <ServerButton
                onClick={handleGenerateDescription}
                disabled={!title.trim() || isGeneratingDescription}
                size="sm"
                className="h-[34px]"
              >
                {isGeneratingDescription ? (
                  <ButtonLoader size={14} />
                ) : (
                  <Sparkles className="h-[15px] w-[15px]" />
                )}
                IA
              </ServerButton>
            </div>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, 1800))}
              rows={9}
              placeholder="Descreva beneficios, prazo de entrega e regras do produto."
              className="mt-[10px] min-h-[224px] w-full resize-y rounded-[16px] border border-[#252525] bg-[#0D0D0D] px-[14px] py-[14px] text-[14px] leading-[1.65] text-[#EDEDED] outline-none transition focus:border-[#4A4A4A] placeholder:text-[#5D5D5D]"
            />

            <div className="mt-[22px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Midias</h4>
              <input
                ref={mediaInputRef}
                type="file"
                accept="image/*"
                multiple
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
                        className="absolute right-[8px] top-[8px] inline-flex h-[28px] w-[28px] items-center justify-center rounded-[10px] bg-[rgba(0,0,0,0.65)] text-white opacity-0 transition group-hover:opacity-100"
                      >
                        <X className="h-[14px] w-[14px]" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => mediaInputRef.current?.click()}
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
                />
                <ServerTextInput
                  value={compareAtPriceAmount}
                  onChange={(event) => setCompareAtPriceAmount(event.target.value)}
                  placeholder="Preco de comparacao"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-[10px] border-t border-[#171717] p-[18px] sm:p-[20px]">
              <ServerTextInput
                value={unitPriceAmount}
                onChange={(event) => setUnitPriceAmount(event.target.value)}
                placeholder="Preco unitario"
                className="h-[38px] max-w-[180px] text-[13px]"
              />
              <PillToggle
                active={chargeTaxes}
                onClick={() => setChargeTaxes((current) => !current)}
              >
                Cobrar tributos {chargeTaxes ? "Sim" : "Nao"}
              </PillToggle>
              <ServerTextInput
                value={costPerItemAmount}
                onChange={(event) => setCostPerItemAmount(event.target.value)}
                placeholder="Custo por item"
                className="h-[38px] max-w-[170px] text-[13px]"
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
              />
            </div>
            <div className="mx-[18px] overflow-hidden rounded-[18px] border border-[#202020] sm:mx-[22px]">
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
                />
              </div>
            </div>
          </ServerSurface>
        </div>

        <aside className="space-y-[18px]">
          <ServerSurface className="p-[18px] sm:p-[20px]">
            <label className="block text-[14px] font-semibold text-[#E2E2E2]">
              Status
            </label>
            <div className="mt-[12px]">
              <SelectMenu
                value={status}
                options={Object.entries(statusLabel) as Array<[ProductStatus, string]>}
                onChange={setStatus}
              />
            </div>
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[20px]">
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
              >
                Loja virtual
              </PillToggle>
              <PillToggle
                active={publishedPointOfSale}
                onClick={() => setPublishedPointOfSale((current) => !current)}
              >
                Ponto de venda
              </PillToggle>
              <PillToggle
                active={publishedPinterest}
                onClick={() => setPublishedPinterest((current) => !current)}
              >
                Pinterest
              </PillToggle>
            </div>
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[20px]">
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
              />
              <ServerTextInput
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
                placeholder="Fabricante"
                className="h-[42px]"
              />
              <ServerTextInput
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="Tags separadas por virgula"
                className="h-[42px]"
              />
            </div>
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[20px]">
            <label className="block text-[14px] font-semibold text-[#E2E2E2]">
              Modelo de tema
            </label>
            <div className="mt-[12px]">
              <SelectMenu
                value={themeModel}
                options={Object.entries(themeLabel) as Array<[ProductTheme, string]>}
                onChange={setThemeModel}
              />
            </div>
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[20px]">
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
    </div>
  );
}
