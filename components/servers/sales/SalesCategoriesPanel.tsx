"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
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
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  ServerButton,
  ServerEmptyState,
  ServerIconFrame,
  ServerSectionHeading,
  ServerSurface,
  ServerTextInput,
} from "@/components/servers/ServerUi";

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
const themeModelOptions = Object.entries(themeModelLabel) as Array<
  [SalesCategory["themeModel"], string]
>;
const productSortOptions = ["Mais relevantes", "Mais recentes", "A-Z"] as const;

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
      className="flowdesk-server-button inline-flex h-[36px] w-[36px] items-center justify-center rounded-[12px] border border-[#202020] bg-[#101010] text-[#BDBDBD] transition hover:border-[#353535] hover:bg-[#161616] disabled:cursor-not-allowed disabled:opacity-45"
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

export function SalesCategoryCreatePanel({
  guildId,
  readOnly = false,
}: SalesCategoriesPanelProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
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
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isDescriptionPreviewOpen, setIsDescriptionPreviewOpen] = useState(false);
  const [productSortIndex, setProductSortIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (!isThemeMenuOpen) return;

    function handleOutsideClick(event: MouseEvent) {
      if (
        themeMenuRef.current &&
        event.target instanceof Node &&
        !themeMenuRef.current.contains(event.target)
      ) {
        setIsThemeMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsThemeMenuOpen(false);
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isThemeMenuOpen]);

  const goBack = useCallback(() => {
    router.push(getCategoriesPath(guildId));
  }, [guildId, router]);

  const canSave = title.trim().length >= 2 && !isSaving && !readOnly;

  const applyDescriptionFormat = useCallback(
    (
      format:
        | "paragraph"
        | "bold"
        | "italic"
        | "link"
        | "image"
        | "code",
    ) => {
      const textarea = descriptionRef.current;
      const start = textarea?.selectionStart ?? description.length;
      const end = textarea?.selectionEnd ?? description.length;
      const selected = description.slice(start, end);
      const fallbackText =
        format === "link"
          ? "texto do link"
          : format === "image"
            ? "descricao da imagem"
            : format === "code"
              ? "codigo"
              : "texto";
      const value = selected || fallbackText;
      let replacement = value;

      if (format === "paragraph") {
        replacement = value
          .replace(/^#{1,6}\s+/gm, "")
          .replace(/^>\s+/gm, "")
          .replace(/^[-*]\s+/gm, "");
      } else if (format === "bold") {
        replacement = `**${value}**`;
      } else if (format === "italic") {
        replacement = `_${value}_`;
      } else if (format === "link") {
        replacement = `[${value}](https://exemplo.com)`;
      } else if (format === "image") {
        replacement = `![${value}](https://exemplo.com/imagem.png)`;
      } else if (format === "code") {
        replacement = value.includes("\n") ? `\`\`\`\n${value}\n\`\`\`` : `\`${value}\``;
      }

      const nextDescription =
        description.slice(0, start) + replacement + description.slice(end);
      setDescription(nextDescription.slice(0, 1200));
      setStatusMessage(null);

      window.requestAnimationFrame(() => {
        descriptionRef.current?.focus();
        const selectionStart = start;
        const selectionEnd = start + replacement.length;
        descriptionRef.current?.setSelectionRange(selectionStart, selectionEnd);
      });
    },
    [description],
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
        if (current) URL.revokeObjectURL(current);
        return nextPreviewUrl;
      });
      setImageName(file.name);
      setStatusMessage(null);
    },
    [],
  );

  const clearImagePreview = useCallback(() => {
    setImagePreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setImageName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleProductSearch = useCallback(() => {
    const normalizedQuery = productQuery.trim();
    setStatusMessage(
      normalizedQuery
        ? `Ainda nao ha produtos com "${normalizedQuery}" nesta colecao.`
        : "Digite o nome de um produto para pesquisar nesta colecao.",
    );
  }, [productQuery]);

  const cycleProductSort = useCallback(() => {
    setProductSortIndex((current) => (current + 1) % productSortOptions.length);
  }, []);

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
              Adicionar categoria
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
            disabled={readOnly || title.trim().length < 2 || isSaving}
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
              maxLength={90}
              placeholder="Ex.: Acessos, Contas, Passes, Robux"
              className="mt-[10px]"
            />

            <label className="mt-[20px] block text-[13px] font-semibold text-[#D8D8D8]">
              Descricao
            </label>
            <div className="mt-[10px] overflow-hidden rounded-[16px] border border-[#252525] bg-[#0D0D0D]">
              <div className="flex flex-wrap items-center gap-[6px] border-b border-[#202020] bg-[#111] px-[10px] py-[8px] text-[#BDBDBD]">
                <button
                  type="button"
                  onClick={() => applyDescriptionFormat("paragraph")}
                  className="flowdesk-server-button rounded-[10px] px-[10px] py-[7px] text-[13px] text-[#CFCFCF] transition hover:bg-[#191919]"
                >
                  Paragrafo <ChevronDown className="ml-[6px] inline h-[14px] w-[14px]" />
                </button>
                <IconButton label="Negrito" onClick={() => applyDescriptionFormat("bold")}>
                  <Bold className="h-[16px] w-[16px]" />
                </IconButton>
                <IconButton label="Italico" onClick={() => applyDescriptionFormat("italic")}>
                  <Italic className="h-[16px] w-[16px]" />
                </IconButton>
                <IconButton label="Link" onClick={() => applyDescriptionFormat("link")}>
                  <Link2 className="h-[16px] w-[16px]" />
                </IconButton>
                <IconButton label="Imagem" onClick={() => applyDescriptionFormat("image")}>
                  <ImagePlus className="h-[16px] w-[16px]" />
                </IconButton>
                <IconButton label="Codigo" onClick={() => applyDescriptionFormat("code")}>
                  <Code2 className="h-[16px] w-[16px]" />
                </IconButton>
                <IconButton
                  label={isDescriptionPreviewOpen ? "Ocultar previa" : "Mostrar previa"}
                  onClick={() => setIsDescriptionPreviewOpen((current) => !current)}
                >
                  <MoreHorizontal className="h-[16px] w-[16px]" />
                </IconButton>
              </div>
              <textarea
                ref={descriptionRef}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={1200}
                rows={9}
                placeholder="Descreva como essa categoria aparece para clientes e equipe."
                className="min-h-[224px] w-full resize-y bg-transparent px-[14px] py-[14px] text-[14px] leading-[1.65] text-[#EDEDED] outline-none placeholder:text-[#5D5D5D]"
              />
              {isDescriptionPreviewOpen ? (
                <div className="border-t border-[#202020] bg-[#0A0A0A] px-[14px] py-[14px]">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[#666]">
                    Previa da descricao
                  </p>
                  <p className="mt-[8px] whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-[#CFCFCF]">
                    {description.trim() || "A descricao aparecera aqui conforme voce digitar."}
                  </p>
                </div>
              ) : null}
            </div>
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
            <div className="max-h-[320px] overflow-y-auto border-t border-[#171717] px-[22px] py-[42px] text-center">
              <PackageSearch className="mx-auto h-[42px] w-[42px] text-[#4E4E4E]" />
              <p className="mt-[18px] text-[14px] font-medium text-[#D9D9D9]">
                Nao ha produtos nesta colecao.
              </p>
              <p className="mt-[5px] text-[13px] text-[#777]">
                Pesquise ou navegue para adicionar produtos.
              </p>
            </div>
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
          <ServerSurface className="p-[18px] sm:p-[20px]">
            <div className="flex items-center justify-between gap-[16px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
                Publicacao
              </h4>
              <button
                type="button"
                onClick={() => {
                  setPublishedVirtualStore(true);
                  setPublishedPointOfSale(true);
                  setStatusMessage("Categoria marcada para todos os canais de venda.");
                }}
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
          </ServerSurface>

          <ServerSurface className="p-[18px] sm:p-[20px]">
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

          <ServerSurface className="p-[18px] sm:p-[20px]">
            <label className="block text-[14px] font-semibold text-[#E2E2E2]">
              Modelo de tema
            </label>
            <div ref={themeMenuRef} className="relative mt-[12px]">
              <button
                type="button"
                onClick={() => setIsThemeMenuOpen((current) => !current)}
                className="flowdesk-server-button flex h-[42px] w-full items-center justify-between rounded-[14px] border border-[#292929] bg-[#0D0D0D] px-[14px] text-left text-[13px] text-[#EDEDED] outline-none transition hover:border-[#4A4A4A]"
                aria-expanded={isThemeMenuOpen}
              >
                {themeModelLabel[themeModel]}
                <ChevronDown
                  className={`h-[16px] w-[16px] text-[#777] transition ${isThemeMenuOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isThemeMenuOpen ? (
                <div className="flowdesk-scale-in-soft absolute left-0 right-0 top-[50px] z-[40] rounded-[18px] border border-[#1E1E1E] bg-[#080808] p-[8px] shadow-[0_24px_70px_rgba(0,0,0,0.48)]">
                  {themeModelOptions.map(([value, label]) => {
                    const isSelected = value === themeModel;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setThemeModel(value);
                          setIsThemeMenuOpen(false);
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
          </ServerSurface>

          <ServerSurface className="overflow-hidden">
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
    </div>
  );
}
