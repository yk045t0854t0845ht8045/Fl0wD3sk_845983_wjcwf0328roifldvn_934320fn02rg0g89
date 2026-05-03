"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bold,
  Check,
  ChevronDown,
  Code2,
  Globe2,
  ImagePlus,
  Italic,
  LayoutGrid,
  Link2,
  ListFilter,
  MoreHorizontal,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Tag,
  Upload,
  X,
} from "lucide-react";

type SalesCategory = {
  id: string;
  title: string;
  description: string;
  collectionType: "manual" | "smart";
  themeModel: "default" | "compact" | "featured";
  publishedVirtualStore: boolean;
  publishedPointOfSale: boolean;
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

type SalesCategoriesPanelProps = {
  guildId: string;
  readOnly?: boolean;
};

const themeModelLabel: Record<SalesCategory["themeModel"], string> = {
  default: "Colecao padrao",
  compact: "Grade compacta",
  featured: "Destaque editorial",
};

function getCategoriesPath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/categories/`;
}

function getCreatePath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/categories/create/`;
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

function CardShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[24px] border border-[#171717] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] shadow-[0_24px_80px_rgba(0,0,0,0.22)] ${className}`.trim()}
    >
      {children}
    </section>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-[36px] w-[36px] items-center justify-center rounded-[12px] border border-[#202020] bg-[#101010] text-[#BDBDBD] transition hover:border-[#353535] hover:bg-[#161616] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
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
    setIsLoading(true);
    setErrorMessage(null);

    try {
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
      setCategories(payload.categories || []);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Erro ao carregar categorias.",
      );
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
      <CardShell className="px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
        <div className="flex flex-col gap-[16px] lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">
              Vendas
            </p>
            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#E4E4E4]">
              Categorias da loja
            </h3>
            <p className="mt-[10px] max-w-[760px] text-[14px] leading-[1.6] text-[#7B7B7B]">
              Organize acessos, contas, passes, robux e qualquer colecao que
              depois tambem pode virar vitrine web.
            </p>
          </div>

          <button
            type="button"
            disabled={createDisabled}
            onClick={() => router.push(getCreatePath(guildId))}
            className="inline-flex h-[44px] items-center justify-center gap-[9px] rounded-[14px] bg-[#F5F5F5] px-[16px] text-[13px] font-semibold text-[#080808] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus className="h-[16px] w-[16px]" />
            Adicionar Categoria
          </button>
        </div>
      </CardShell>

      <CardShell className="overflow-hidden">
        <div className="flex flex-col gap-[12px] border-b border-[#171717] px-[18px] py-[16px] sm:flex-row sm:items-center sm:justify-between sm:px-[22px]">
          <div className="relative w-full sm:max-w-[360px]">
            <Search className="pointer-events-none absolute left-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#666]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar categorias"
              className="h-[42px] w-full rounded-[14px] border border-[#202020] bg-[#0D0D0D] pl-[40px] pr-[14px] text-[13px] text-[#E8E8E8] outline-none transition placeholder:text-[#595959] focus:border-[#3A3A3A]"
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
            <button
              type="button"
              onClick={() => void loadCategories()}
              className="mt-[16px] inline-flex h-[40px] items-center justify-center rounded-[13px] border border-[#252525] px-[14px] text-[13px] font-semibold text-[#E7E7E7] transition hover:border-[#3A3A3A] hover:bg-[#121212]"
            >
              Tentar novamente
            </button>
          </div>
        ) : filteredCategories.length ? (
          <div className="divide-y divide-[#171717]">
            {filteredCategories.map((category) => (
              <article
                key={category.id}
                className="flex flex-col gap-[14px] px-[18px] py-[16px] transition hover:bg-[#0E0E0E] sm:px-[22px] lg:flex-row lg:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-[14px]">
                  <div className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[15px] border border-[#232323] bg-[#111] text-[#EAEAEA]">
                    <Tag className="h-[20px] w-[20px]" />
                  </div>
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
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="px-[22px] py-[44px] text-center">
            <div className="mx-auto flex h-[58px] w-[58px] items-center justify-center rounded-[18px] border border-[#232323] bg-[#101010] text-[#E7E7E7]">
              <ShoppingBag className="h-[24px] w-[24px]" />
            </div>
            <h4 className="mt-[18px] text-[16px] font-semibold text-[#EDEDED]">
              Nenhuma categoria criada ainda.
            </h4>
            <p className="mx-auto mt-[8px] max-w-[420px] text-[13px] leading-[1.6] text-[#777]">
              Crie a primeira categoria para separar produtos no bot e deixar a
              estrutura pronta para uma futura loja web.
            </p>
          </div>
        )}
      </CardShell>
    </div>
  );
}

export function SalesCategoryCreatePanel({
  guildId,
  readOnly = false,
}: SalesCategoriesPanelProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [collectionType, setCollectionType] =
    useState<SalesCategory["collectionType"]>("manual");
  const [themeModel, setThemeModel] =
    useState<SalesCategory["themeModel"]>("default");
  const [publishedVirtualStore, setPublishedVirtualStore] = useState(true);
  const [publishedPointOfSale, setPublishedPointOfSale] = useState(false);
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [imageName, setImageName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const goBack = useCallback(() => {
    router.push(getCategoriesPath(guildId));
  }, [guildId, router]);

  const canSave = title.trim().length >= 2 && !isSaving && !readOnly;

  const handleSave = useCallback(async () => {
    if (!canSave) {
      setStatusMessage("Informe um titulo para salvar a categoria.");
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/auth/me/guilds/sales-categories", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guildId,
          title,
          description,
          collectionType,
          themeModel,
          publishedVirtualStore,
          publishedPointOfSale,
          seoTitle,
          seoDescription,
          imageUrl: null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as SalesCategoryCreateResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Erro ao salvar categoria.");
      }

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
    collectionType,
    description,
    guildId,
    publishedPointOfSale,
    publishedVirtualStore,
    router,
    seoDescription,
    seoTitle,
    themeModel,
    title,
  ]);

  return (
    <div className="space-y-[18px]">
      <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-[8px] text-[13px] font-medium text-[#8F8F8F] transition hover:text-[#F1F1F1]"
          >
            <ArrowLeft className="h-[16px] w-[16px]" />
            Categorias
          </button>
          <div className="mt-[10px] flex items-center gap-[10px]">
            <Tag className="h-[18px] w-[18px] text-[#A5A5A5]" />
            <h3 className="text-[24px] font-semibold tracking-[-0.05em] text-[#EFEFEF]">
              Adicionar categoria
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-[10px]">
          <button
            type="button"
            onClick={goBack}
            className="h-[42px] rounded-[14px] border border-[#242424] px-[15px] text-[13px] font-semibold text-[#E6E6E6] transition hover:border-[#3A3A3A] hover:bg-[#121212]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void handleSave()}
            className="inline-flex h-[42px] items-center justify-center gap-[8px] rounded-[14px] bg-[#F5F5F5] px-[16px] text-[13px] font-semibold text-[#080808] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check className="h-[16px] w-[16px]" />
            {isSaving ? "Salvando..." : "Salvar categoria"}
          </button>
        </div>
      </div>

      {statusMessage ? (
        <div className="rounded-[18px] border border-[#3A2A1E] bg-[#170F09] px-[14px] py-[12px] text-[13px] text-[#F2B27D]">
          {statusMessage}
        </div>
      ) : null}

      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_398px]">
        <div className="space-y-[18px]">
          <CardShell className="p-[18px] sm:p-[22px]">
            <label className="block text-[13px] font-semibold text-[#D8D8D8]">
              Titulo
            </label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={90}
              placeholder="Ex.: Acessos, Contas, Passes, Robux"
              className="mt-[10px] h-[44px] w-full rounded-[14px] border border-[#252525] bg-[#0D0D0D] px-[14px] text-[14px] text-[#F1F1F1] outline-none transition placeholder:text-[#646464] focus:border-[#4A4A4A]"
            />

            <label className="mt-[20px] block text-[13px] font-semibold text-[#D8D8D8]">
              Descricao
            </label>
            <div className="mt-[10px] overflow-hidden rounded-[16px] border border-[#252525] bg-[#0D0D0D]">
              <div className="flex flex-wrap items-center gap-[6px] border-b border-[#202020] bg-[#111] px-[10px] py-[8px] text-[#BDBDBD]">
                <button type="button" className="rounded-[10px] px-[10px] py-[7px] text-[13px] text-[#CFCFCF] transition hover:bg-[#191919]">
                  Paragrafo <ChevronDown className="ml-[6px] inline h-[14px] w-[14px]" />
                </button>
                <IconButton label="Negrito">
                  <Bold className="h-[16px] w-[16px]" />
                </IconButton>
                <IconButton label="Italico">
                  <Italic className="h-[16px] w-[16px]" />
                </IconButton>
                <IconButton label="Link">
                  <Link2 className="h-[16px] w-[16px]" />
                </IconButton>
                <IconButton label="Imagem">
                  <ImagePlus className="h-[16px] w-[16px]" />
                </IconButton>
                <IconButton label="Codigo">
                  <Code2 className="h-[16px] w-[16px]" />
                </IconButton>
                <IconButton label="Mais">
                  <MoreHorizontal className="h-[16px] w-[16px]" />
                </IconButton>
              </div>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={1200}
                rows={9}
                placeholder="Descreva como essa categoria aparece para clientes e equipe."
                className="min-h-[224px] w-full resize-y bg-transparent px-[14px] py-[14px] text-[14px] leading-[1.65] text-[#EDEDED] outline-none placeholder:text-[#5D5D5D]"
              />
            </div>
          </CardShell>

          <CardShell className="p-[18px] sm:p-[22px]">
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
                  className="flex w-full items-start gap-[12px] rounded-[16px] border border-transparent p-[2px] text-left transition hover:border-[#222]"
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
          </CardShell>

          <CardShell className="overflow-hidden">
            <div className="p-[18px] sm:p-[22px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Produtos</h4>
              <div className="mt-[16px] flex flex-col gap-[10px] lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#666]" />
                  <input
                    value={productQuery}
                    onChange={(event) => setProductQuery(event.target.value)}
                    placeholder="Pesquisar produtos"
                    className="h-[42px] w-full rounded-[14px] border border-[#252525] bg-[#0D0D0D] pl-[40px] pr-[14px] text-[14px] text-[#F1F1F1] outline-none placeholder:text-[#646464] focus:border-[#4A4A4A]"
                  />
                </div>
                <button
                  type="button"
                  className="h-[42px] rounded-[14px] border border-[#252525] px-[15px] text-[13px] font-semibold text-[#E8E8E8] transition hover:border-[#3A3A3A] hover:bg-[#121212]"
                >
                  Procurar
                </button>
                <button
                  type="button"
                  className="inline-flex h-[42px] items-center justify-between gap-[16px] rounded-[14px] border border-[#252525] px-[15px] text-[13px] text-[#BDBDBD] transition hover:border-[#3A3A3A] hover:bg-[#121212]"
                >
                  Classificar: Mais relevantes
                  <ChevronDown className="h-[15px] w-[15px]" />
                </button>
              </div>
            </div>
            <div className="max-h-[320px] overflow-y-auto border-t border-[#171717] px-[22px] py-[42px] text-center">
              <PackageSearch className="mx-auto h-[42px] w-[42px] text-[#4E4E4E]" />
              <p className="mt-[18px] text-[14px] font-medium text-[#D9D9D9]">
                Nao ha produtos nesta colecao.
              </p>
              <p className="mt-[5px] text-[13px] text-[#777]">
                Pesquise ou navegue para adicionar produtos.
              </p>
            </div>
          </CardShell>

          <CardShell className="p-[18px] sm:p-[22px]">
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
              <input
                value={seoTitle}
                onChange={(event) => setSeoTitle(event.target.value)}
                maxLength={90}
                placeholder="Titulo para busca"
                className="h-[42px] rounded-[14px] border border-[#252525] bg-[#0D0D0D] px-[14px] text-[13px] text-[#F1F1F1] outline-none placeholder:text-[#646464] focus:border-[#4A4A4A]"
              />
              <input
                value={seoDescription}
                onChange={(event) => setSeoDescription(event.target.value)}
                maxLength={180}
                placeholder="Descricao para busca"
                className="h-[42px] rounded-[14px] border border-[#252525] bg-[#0D0D0D] px-[14px] text-[13px] text-[#F1F1F1] outline-none placeholder:text-[#646464] focus:border-[#4A4A4A]"
              />
            </div>
          </CardShell>
        </div>

        <aside className="space-y-[18px]">
          <CardShell className="p-[18px] sm:p-[20px]">
            <div className="flex items-center justify-between gap-[16px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
                Publicacao
              </h4>
              <button
                type="button"
                className="text-[13px] font-semibold text-[#F1F1F1] transition hover:text-white"
              >
                Gerenciar
              </button>
            </div>
            <div className="mt-[18px] space-y-[12px]">
              <label className="flex items-center gap-[10px] text-[14px] text-[#CFCFCF]">
                <input
                  type="checkbox"
                  checked={publishedVirtualStore}
                  onChange={(event) => setPublishedVirtualStore(event.target.checked)}
                  className="h-[15px] w-[15px] accent-[#F1F1F1]"
                />
                Loja virtual
                <Globe2 className="ml-auto h-[16px] w-[16px] text-[#747474]" />
              </label>
              <label className="flex items-center gap-[10px] text-[14px] text-[#CFCFCF]">
                <input
                  type="checkbox"
                  checked={publishedPointOfSale}
                  onChange={(event) => setPublishedPointOfSale(event.target.checked)}
                  className="h-[15px] w-[15px] accent-[#F1F1F1]"
                />
                Ponto de venda e Pinterest
              </label>
            </div>
          </CardShell>

          <CardShell className="p-[18px] sm:p-[20px]">
            <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Imagem</h4>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) =>
                setImageName(event.target.files?.[0]?.name || null)
              }
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-[18px] flex min-h-[166px] w-full flex-col items-center justify-center rounded-[18px] border border-dashed border-[#363636] bg-[#0D0D0D] px-[16px] text-center transition hover:border-[#585858] hover:bg-[#111]"
            >
              <Upload className="h-[22px] w-[22px] text-[#E8E8E8]" />
              <span className="mt-[12px] rounded-[12px] border border-[#2C2C2C] bg-[#141414] px-[13px] py-[8px] text-[13px] font-semibold text-[#F0F0F0]">
                Adicionar imagem
              </span>
              <span className="mt-[10px] text-[13px] leading-[1.35] text-[#7E7E7E]">
                {imageName || "ou solte uma imagem para fazer upload"}
              </span>
            </button>
          </CardShell>

          <CardShell className="p-[18px] sm:p-[20px]">
            <label className="block text-[14px] font-semibold text-[#E2E2E2]">
              Modelo de tema
            </label>
            <div className="relative mt-[12px]">
              <select
                value={themeModel}
                onChange={(event) =>
                  setThemeModel(event.target.value as SalesCategory["themeModel"])
                }
                className="h-[42px] w-full appearance-none rounded-[14px] border border-[#292929] bg-[#0D0D0D] px-[14px] pr-[38px] text-[13px] text-[#EDEDED] outline-none focus:border-[#4A4A4A]"
              >
                {Object.entries(themeModelLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-[13px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#777]" />
            </div>
          </CardShell>

          <CardShell className="overflow-hidden">
            <div className="border-b border-[#171717] p-[18px] sm:p-[20px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
                Previa rapida
              </h4>
            </div>
            <div className="p-[18px] sm:p-[20px]">
              <div className="rounded-[20px] border border-[#242424] bg-[#0F0F0F] p-[16px]">
                <div className="flex items-center gap-[12px]">
                  <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[14px] bg-[#F4F4F4] text-[#070707]">
                    <LayoutGrid className="h-[19px] w-[19px]" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-[#F1F1F1]">
                      {title.trim() || "Nova categoria"}
                    </p>
                    <p className="mt-[3px] text-[12px] text-[#7B7B7B]">
                      {collectionType === "smart" ? "Automatica" : "Manual"} · 0 produtos
                    </p>
                  </div>
                  <X className="ml-auto h-[15px] w-[15px] text-[#666]" />
                </div>
              </div>
            </div>
          </CardShell>
        </aside>
      </div>
    </div>
  );
}
