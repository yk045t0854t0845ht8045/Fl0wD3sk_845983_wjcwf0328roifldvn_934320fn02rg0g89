"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronDown,
  Gift,
  Infinity,
  PackageSearch,
  Pencil,
  Percent,
  Plus,
  Search,
  Sparkles,
  Tags,
} from "lucide-react";
import {
  ServerButton,
  ServerEmptyState,
  ServerIconFrame,
  ServerSectionHeading,
  ServerSurface,
  ServerTextInput,
  cn,
} from "@/components/servers/ServerUi";

type CampaignKind = "coupon" | "gift_card" | "promotion";
type DiscountMode = "percent" | "fixed";
type AppliesToMode = "all" | "selected";
type ExpirationMode = "never" | "date";
type UsageMode = "unlimited" | "limited";
type CampaignStatus = "active" | "draft" | "paused";

type SalesCouponGift = {
  id: string;
  editorCode?: string;
  code: string;
  title: string;
  kind: CampaignKind;
  status: CampaignStatus;
  discountType: DiscountMode;
  discountValue: number;
  remainingAmount?: number;
  appliesToAllProducts: boolean;
  productIds: string[];
  maxRedemptions: number | null;
  onePerCustomer: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type SalesProductOption = {
  id: string;
  code: string;
  title: string;
  sku: string;
};

type CouponsGiftsResponse = {
  ok: boolean;
  message?: string;
  discounts?: SalesCouponGift[];
  discount?: SalesCouponGift;
};

type ProductsResponse = {
  ok: boolean;
  message?: string;
  products?: SalesProductOption[];
};

type SalesCouponsGiftsPanelProps = {
  guildId: string;
  readOnly?: boolean;
};

const kindLabel: Record<CampaignKind, string> = {
  coupon: "Cupom",
  gift_card: "Gift card",
  promotion: "Promocao",
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function formatDate(value: string | null) {
  if (!value) return "Nao expira";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Nao expira";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function valueLabel(item: SalesCouponGift) {
  if (item.kind === "gift_card") return formatMoney(item.remainingAmount ?? item.discountValue);
  return item.discountType === "percent"
    ? `${item.discountValue}%`
    : formatMoney(item.discountValue);
}

function usageLabel(item: SalesCouponGift) {
  if (item.kind === "gift_card") return "Saldo";
  if (!item.maxRedemptions) return "Ilimitado";
  return `${item.maxRedemptions} usos`;
}

const statusLabel: Record<CampaignStatus, string> = {
  active: "Ativo",
  draft: "Rascunho",
  paused: "Pausado",
};

function getCouponsPath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/coupons-gifts/`;
}

function getCreatePath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/coupons-gifts/create/`;
}

function slugifyCode(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "NOVO-CUPOM"
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

  return (
    <div className={open ? "relative z-[240]" : "relative z-[1]"}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        className="flowdesk-server-button flex h-[42px] w-full items-center justify-between rounded-[14px] border border-[#292929] bg-[#0D0D0D] px-[14px] text-left text-[13px] text-[#EDEDED] transition hover:border-[#444] disabled:cursor-not-allowed disabled:opacity-55"
        aria-expanded={open}
      >
        {options.find(([option]) => option === value)?.[1] || "Selecionar"}
        <ChevronDown
          className={`h-[16px] w-[16px] text-[#777] transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="flowdesk-scale-in-soft absolute left-0 right-0 top-[50px] z-[240] rounded-[18px] border border-[#1E1E1E] bg-[#080808] p-[8px] shadow-[0_24px_70px_rgba(0,0,0,0.48)]">
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

function SegmentButton<T extends string>({
  value,
  current,
  onChange,
  children,
  disabled,
}: {
  value: T;
  current: T;
  onChange: (value: T) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(value)}
      className={cn(
        "h-[36px] rounded-[11px] px-[12px] text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55",
        value === current
          ? "bg-[#F1F1F1] text-[#080808]"
          : "text-[#9A9A9A] hover:bg-[#151515] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

export function SalesCouponsGiftsListPanel({
  guildId,
  readOnly = false,
}: SalesCouponsGiftsPanelProps) {
  const router = useRouter();
  const [items, setItems] = useState<SalesCouponGift[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CampaignStatus>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/auth/me/guilds/sales-coupons-gifts?guildId=${encodeURIComponent(guildId)}`,
        { credentials: "include", cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as CouponsGiftsResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Erro ao carregar cupons e gifts.");
      }
      setItems(payload.discounts || []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao carregar cupons e gifts.");
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!normalized) return true;
      return `${item.title} ${item.code} ${kindLabel[item.kind]}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [items, query, statusFilter]);

  return (
    <div className="space-y-[18px]">
      <ServerSectionHeading
        eyebrow="Vendas"
        title="Cupons e gifts"
        description="Crie descontos, gifts e promocoes com validade, limite de uso e regras de aplicacao por produto."
        action={
          <ServerButton
            disabled={readOnly}
            onClick={() => router.push(getCreatePath(guildId))}
            variant="primary"
            size="lg"
          >
            <Plus className="h-[16px] w-[16px]" />
            Criar Cupom ou Gift
          </ServerButton>
        }
      />

      <ServerSurface className="overflow-visible">
        <div className="flex flex-col gap-[12px] border-b border-[#171717] px-[18px] py-[16px] lg:flex-row lg:items-center lg:justify-between lg:px-[22px]">
          <div className="relative w-full lg:max-w-[420px]">
            <Search className="pointer-events-none absolute left-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#666]" />
            <ServerTextInput
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Pesquisar cupons, gifts ou promocoes"
              className="pl-[40px]"
            />
          </div>
          <div className="min-w-[168px]">
            <SelectMenu
              value={statusFilter}
              options={[
                ["all", "Todos"],
                ["active", "Ativos"],
                ["draft", "Rascunhos"],
                ["paused", "Pausados"],
              ]}
              onChange={setStatusFilter}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-[1px] bg-[#171717]">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center gap-[14px] bg-[#0B0B0B] px-[18px] py-[16px] sm:px-[22px]">
                <div className="h-[48px] w-[48px] animate-pulse rounded-[15px] bg-[#171717]" />
                <div className="min-w-0 flex-1 space-y-[8px]">
                  <div className="h-[12px] w-[180px] animate-pulse rounded-full bg-[#171717]" />
                  <div className="h-[10px] w-[320px] max-w-full animate-pulse rounded-full bg-[#151515]" />
                </div>
              </div>
            ))}
          </div>
        ) : errorMessage ? (
          <ServerEmptyState
            icon={<Gift className="h-[24px] w-[24px]" />}
            title="Nao foi possivel carregar cupons e gifts."
            description={errorMessage}
            action={<ServerButton onClick={() => void loadItems()}>Tentar novamente</ServerButton>}
          />
        ) : filteredItems.length ? (
          <div className="divide-y divide-[#171717]">
            {filteredItems.map((item) => (
              <article
                key={item.id}
                className="flex flex-col gap-[14px] px-[18px] py-[16px] transition hover:bg-[#0E0E0E] sm:px-[22px] lg:flex-row lg:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-[14px]">
                  <ServerIconFrame>
                    {item.kind === "gift_card" ? (
                      <Gift className="h-[20px] w-[20px]" />
                    ) : item.kind === "promotion" ? (
                      <Sparkles className="h-[20px] w-[20px]" />
                    ) : (
                      <Tags className="h-[20px] w-[20px]" />
                    )}
                  </ServerIconFrame>
                  <div className="min-w-0">
                    <h4 className="truncate text-[15px] font-semibold text-[#EDEDED]">
                      {item.title}
                    </h4>
                    <p className="mt-[4px] truncate text-[13px] text-[#777]">
                      {item.code} - {kindLabel[item.kind]} - {item.appliesToAllProducts ? "Todos os produtos" : "Produtos selecionados"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-[8px] sm:flex sm:items-center">
                  <span className="rounded-full border border-[#232323] bg-[#111] px-[10px] py-[6px] text-center text-[12px] text-[#BDBDBD]">
                    {valueLabel(item)}
                  </span>
                  <span className="rounded-full border border-[#232323] bg-[#111] px-[10px] py-[6px] text-center text-[12px] text-[#BDBDBD]">
                    {usageLabel(item)}
                  </span>
                  <span className="rounded-full border border-[#232323] bg-[#111] px-[10px] py-[6px] text-center text-[12px] text-[#BDBDBD]">
                    {formatDate(item.expiresAt)}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-[10px] py-[6px] text-center text-[12px]",
                      item.status === "active"
                        ? "border-[#1F3D2E] bg-[#0D1A13] text-[#7CE2A0]"
                        : "border-[#232323] bg-[#111] text-[#8A8A8A]",
                    )}
                  >
                    {statusLabel[item.status]}
                  </span>
                  <button
                    type="button"
                    aria-label={`Editar ${item.title}`}
                    title="Editar cupom ou gift"
                    disabled={readOnly}
                    className="flowdesk-server-button inline-flex h-[34px] w-[34px] items-center justify-center rounded-[12px] border border-[#242424] bg-[#101010] text-[#DADADA] transition hover:border-[#3A3A3A] hover:bg-[#161616] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Pencil className="h-[15px] w-[15px]" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <ServerEmptyState
            icon={<Gift className="h-[24px] w-[24px]" />}
            title="Nenhum cupom ou gift criado ainda."
            description="Crie a primeira campanha para liberar desconto no checkout do Discord."
          />
        )}
      </ServerSurface>
    </div>
  );
}

export function SalesCouponGiftCreatePanel({
  guildId,
  readOnly = false,
}: SalesCouponsGiftsPanelProps) {
  const router = useRouter();
  const [kind, setKind] = useState<CampaignKind>("coupon");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [discountMode, setDiscountMode] = useState<DiscountMode>("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [appliesToMode, setAppliesToMode] = useState<AppliesToMode>("all");
  const [selectedProducts, setSelectedProducts] = useState("");
  const [productOptions, setProductOptions] = useState<SalesProductOption[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [usageMode, setUsageMode] = useState<UsageMode>("unlimited");
  const [maxUses, setMaxUses] = useState("");
  const [onePerCustomer, setOnePerCustomer] = useState(true);
  const [expirationMode, setExpirationMode] = useState<ExpirationMode>("never");
  const [expiresAt, setExpiresAt] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [minimumOrder, setMinimumOrder] = useState("");
  const [status, setStatus] = useState<CampaignStatus>("active");
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      const response = await fetch(
        `/api/auth/me/guilds/sales-products?guildId=${encodeURIComponent(guildId)}`,
        { credentials: "include", cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as ProductsResponse;
      if (!cancelled && response.ok && payload.ok) {
        setProductOptions(payload.products || []);
      }
    }
    void loadProducts().catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [guildId]);

  const controlsDisabled = readOnly;
  const generatedCode = slugifyCode(code || title || kindLabel[kind]);
  const previewValue =
    discountMode === "percent"
      ? `${discountValue || "0"}%`
      : `R$ ${discountValue || "0,00"}`;

  const filteredProductOptions = useMemo(() => {
    const normalized = selectedProducts.trim().toLowerCase();
    const source = normalized
      ? productOptions.filter((product) =>
          `${product.title} ${product.sku} ${product.code}`.toLowerCase().includes(normalized),
        )
      : productOptions;
    return source.slice(0, 8);
  }, [productOptions, selectedProducts]);

  const handleSave = async () => {
    if (controlsDisabled || isSaving) return;
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/auth/me/guilds/sales-coupons-gifts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          kind,
          title,
          code: generatedCode,
          discountType: discountMode,
          discountValue,
          remainingAmount: discountValue,
          minimumOrderAmount: minimumOrder,
          appliesToAllProducts: appliesToMode === "all",
          productIds: appliesToMode === "all" ? [] : selectedProductIds,
          maxRedemptions: usageMode === "limited" ? maxUses : null,
          onePerCustomer,
          startsAt,
          expiresAt: expirationMode === "date" ? expiresAt : null,
          status,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as CouponsGiftsResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Erro ao salvar campanha.");
      }
      router.push(getCouponsPath(guildId));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Erro ao salvar campanha.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-[18px]">
      <ServerSectionHeading
        eyebrow="Vendas"
        title="Criar cupom ou gift"
        description="Defina tipo, valor, produtos elegiveis, janela de validade e limite de uso antes de publicar no checkout."
        action={
          <ServerButton onClick={() => router.push(getCouponsPath(guildId))} size="lg">
            <ArrowLeft className="h-[16px] w-[16px]" />
            Voltar
          </ServerButton>
        }
      />

      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_398px]">
        <div className="space-y-[18px]">
          <ServerSurface className="p-[18px] sm:p-[22px]">
            <label className="block text-[13px] font-semibold text-[#D8D8D8]">
              Nome da campanha
            </label>
            <ServerTextInput
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="Ex.: Semana gamer, Boas-vindas, Gift VIP"
              className="mt-[10px]"
              disabled={controlsDisabled}
            />

            <div className="mt-[18px] grid gap-[12px] sm:grid-cols-2">
              <div>
                <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                  Codigo
                </label>
                <ServerTextInput
                  value={code}
                  onChange={(event) => setCode(slugifyCode(event.currentTarget.value))}
                  placeholder={generatedCode}
                  disabled={controlsDisabled}
                />
              </div>
              <div>
                <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                  Tipo
                </label>
                <SelectMenu
                  value={kind}
                  options={[
                    ["coupon", "Cupom de desconto"],
                    ["gift_card", "Gift card"],
                    ["promotion", "Promocao automatica"],
                  ]}
                  onChange={setKind}
                  disabled={controlsDisabled}
                />
              </div>
            </div>
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[22px]">
            <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Valor</h4>
            <div className="mt-[14px] grid grid-cols-2 rounded-[14px] border border-[#252525] bg-[#0D0D0D] p-[4px]">
              <SegmentButton value="percent" current={discountMode} onChange={setDiscountMode} disabled={controlsDisabled}>
                Percentual
              </SegmentButton>
              <SegmentButton value="fixed" current={discountMode} onChange={setDiscountMode} disabled={controlsDisabled}>
                Valor fixo
              </SegmentButton>
            </div>
            <div className="mt-[12px] grid gap-[12px] sm:grid-cols-2">
              <ServerTextInput
                value={discountValue}
                onChange={(event) => setDiscountValue(event.currentTarget.value)}
                placeholder={discountMode === "percent" ? "10" : "25,00"}
                disabled={controlsDisabled}
              />
              <ServerTextInput
                value={minimumOrder}
                onChange={(event) => setMinimumOrder(event.currentTarget.value)}
                placeholder="Pedido minimo opcional"
                disabled={controlsDisabled}
              />
            </div>
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[22px]">
            <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Aplicacao</h4>
            <div className="mt-[14px] grid grid-cols-2 rounded-[14px] border border-[#252525] bg-[#0D0D0D] p-[4px]">
              <SegmentButton value="all" current={appliesToMode} onChange={setAppliesToMode} disabled={controlsDisabled}>
                Todos
              </SegmentButton>
              <SegmentButton value="selected" current={appliesToMode} onChange={setAppliesToMode} disabled={controlsDisabled}>
                Produtos
              </SegmentButton>
            </div>
            {appliesToMode === "selected" ? (
              <div className="mt-[12px]">
                <ServerTextInput
                  value={selectedProducts}
                  onChange={(event) => setSelectedProducts(event.currentTarget.value)}
                  placeholder="Buscar produtos por nome, SKU ou codigo"
                  disabled={controlsDisabled}
                />
                <div className="mt-[10px] max-h-[260px] divide-y divide-[#171717] overflow-y-auto rounded-[16px] border border-[#202020]">
                  {filteredProductOptions.length ? filteredProductOptions.map((product) => {
                    const checked = selectedProductIds.includes(product.id);
                    return (
                      <label key={product.id} className="flex cursor-pointer items-center gap-[10px] bg-[#0D0D0D] px-[12px] py-[10px] text-[13px] text-[#DCDCDC] hover:bg-[#111]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedProductIds((current) =>
                              event.currentTarget.checked
                                ? Array.from(new Set([...current, product.id]))
                                : current.filter((id) => id !== product.id),
                            );
                          }}
                          className="h-[15px] w-[15px] accent-[#F1F1F1]"
                          disabled={controlsDisabled}
                        />
                        <span className="min-w-0 flex-1 truncate">{product.title}</span>
                        <span className="text-[12px] text-[#777]">{product.sku || product.code}</span>
                      </label>
                    );
                  }) : (
                    <div className="px-[12px] py-[18px] text-center text-[13px] text-[#777]">
                      Nenhum produto encontrado.
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[22px]">
            <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Uso e validade</h4>
            <div className="mt-[14px] grid gap-[12px] sm:grid-cols-2">
              <div>
                <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                  Usos
                </label>
                <SelectMenu
                  value={usageMode}
                  options={[
                    ["unlimited", "Ilimitado"],
                    ["limited", "Quantidade limitada"],
                  ]}
                  onChange={setUsageMode}
                  disabled={controlsDisabled}
                />
              </div>
              <div>
                <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                  Quantidade
                </label>
                <ServerTextInput
                  value={maxUses}
                  onChange={(event) => setMaxUses(event.currentTarget.value.replace(/\D/g, ""))}
                  placeholder={usageMode === "limited" ? "100" : "Ilimitado"}
                  disabled={controlsDisabled || usageMode === "unlimited"}
                />
              </div>
              <div>
                <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                  Inicio
                </label>
                <ServerTextInput
                  type="date"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.currentTarget.value)}
                  disabled={controlsDisabled}
                />
              </div>
              <div>
                <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                  Expiracao
                </label>
                <SelectMenu
                  value={expirationMode}
                  options={[
                    ["never", "Nao expira"],
                    ["date", "Expira em uma data"],
                  ]}
                  onChange={setExpirationMode}
                  disabled={controlsDisabled}
                />
              </div>
              {expirationMode === "date" ? (
                <div className="sm:col-span-2">
                  <ServerTextInput
                    type="date"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.currentTarget.value)}
                    disabled={controlsDisabled}
                  />
                </div>
              ) : null}
            </div>
            <label className="mt-[14px] flex items-center gap-[10px] text-[13px] text-[#CFCFCF]">
              <input
                type="checkbox"
                checked={onePerCustomer}
                onChange={(event) => setOnePerCustomer(event.currentTarget.checked)}
                className="h-[15px] w-[15px] accent-[#F1F1F1]"
                disabled={controlsDisabled}
              />
              Limitar a um uso por cliente
            </label>
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
                options={[
                  ["active", "Ativo"],
                  ["draft", "Rascunho"],
                  ["paused", "Pausado"],
                ]}
                onChange={setStatus}
                disabled={controlsDisabled}
              />
            </div>
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[20px]">
            <div className="flex items-center justify-between gap-[16px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Resumo</h4>
              {discountMode === "percent" ? (
                <Percent className="h-[17px] w-[17px] text-[#8A8A8A]" />
              ) : (
                <Gift className="h-[17px] w-[17px] text-[#8A8A8A]" />
              )}
            </div>
            <div className="mt-[16px] rounded-[20px] border border-[#242424] bg-[#0F0F0F] p-[16px]">
              <div className="flex items-center gap-[12px]">
                <span className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-[14px] bg-[#F4F4F4] text-[#070707]">
                  {kind === "gift_card" ? <Gift className="h-[18px] w-[18px]" /> : <Tags className="h-[18px] w-[18px]" />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[#F1F1F1]">
                    {title.trim() || "Nova campanha"}
                  </p>
                  <p className="mt-[3px] text-[12px] text-[#7B7B7B]">
                    {generatedCode} - {previewValue}
                  </p>
                </div>
              </div>
              <div className="mt-[14px] grid grid-cols-2 gap-[8px]">
                <span className="inline-flex items-center gap-[6px] rounded-[12px] border border-[#232323] bg-[#111] px-[10px] py-[8px] text-[12px] text-[#BDBDBD]">
                  <PackageSearch className="h-[14px] w-[14px]" />
                  {appliesToMode === "all" ? "Todos" : "Selecionados"}
                </span>
                <span className="inline-flex items-center gap-[6px] rounded-[12px] border border-[#232323] bg-[#111] px-[10px] py-[8px] text-[12px] text-[#BDBDBD]">
                  {usageMode === "unlimited" ? <Infinity className="h-[14px] w-[14px]" /> : <Check className="h-[14px] w-[14px]" />}
                  {usageMode === "unlimited" ? "Ilimitado" : maxUses || "0"}
                </span>
                <span className="col-span-2 inline-flex items-center gap-[6px] rounded-[12px] border border-[#232323] bg-[#111] px-[10px] py-[8px] text-[12px] text-[#BDBDBD]">
                  <Calendar className="h-[14px] w-[14px]" />
                  {expirationMode === "never" ? "Nao expira" : expiresAt || "Defina a data"}
                </span>
              </div>
            </div>
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[20px]">
            <ServerButton
              variant="primary"
              className="w-full"
              disabled={controlsDisabled || isSaving}
              onClick={() => void handleSave()}
            >
              <Check className="h-[15px] w-[15px]" />
              {isSaving ? "Salvando..." : "Salvar campanha"}
            </ServerButton>
            {statusMessage ? (
              <p className="mt-[10px] text-[12px] leading-[1.5] text-[#EFB47B]">
                {statusMessage}
              </p>
            ) : null}
          </ServerSurface>
        </aside>
      </div>
    </div>
  );
}
