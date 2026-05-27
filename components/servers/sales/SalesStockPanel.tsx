"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Boxes,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { useNotifications } from "@/components/notifications/NotificationsProvider";
import {
  ServerButton,
  ServerDiscordRelinkState,
  ServerEmptyState,
  ServerIconFrame,
  ServerSectionHeading,
  ServerSurface,
  ServerTextInput,
} from "@/components/servers/ServerUi";
import { useBodyScrollLock } from "@/lib/ui/useBodyScrollLock";

type StockDeliveryMethod = "email" | "discord_dm" | "flowdesk_link";
type StockItemType =
  | "accounts_access"
  | "emails"
  | "gift_cards_codes"
  | "virtual_currency"
  | "game_items"
  | "game_services"
  | "premium_subscriptions"
  | "artificial_intelligence"
  | "discord_bots"
  | "social_networks"
  | "software_licenses"
  | "courses_training"
  | "digital_links"
  | "digital_services"
  | "freelancer"
  | "other";

type SalesProduct = {
  id: string;
  code: string;
  title: string;
  description: string;
  status: "active" | "draft" | "archived";
  mediaUrls: string[];
  priceAmount: number;
  stockQuantity: number;
  sku: string;
  categoryId: string | null;
  productType?: string;
  manufacturer?: string;
  tags?: string[];
  createdAt: string;
};

type StockItem = StockFormState & {
  id: string;
  status: "available" | "reserved" | "delivered" | "disabled";
  createdAt: string;
  updatedAt: string;
};

type ProductsResponse = {
  ok: boolean;
  code?: string;
  reauthRequired?: boolean;
  message?: string;
  products?: SalesProduct[];
};

type StockResponse = {
  ok: boolean;
  code?: string;
  reauthRequired?: boolean;
  message?: string;
  items?: StockItem[];
  item?: StockItem;
  stockQuantity?: number;
  discordSyncStatus?: "idle" | "synced" | "failed";
  discordSyncError?: string;
};

type FieldDefinition = {
  key: keyof StockFormState;
  label: string;
  placeholder?: string;
  multiline?: boolean;
};

type StockFormState = {
  productId: string;
  productName: string;
  itemType: StockItemType;
  deliveryMethod: StockDeliveryMethod;
  category: string;
  platform: string;
  provider: string;
  email: string;
  login: string;
  password: string;
  accessType: string;
  recovery: string;
  giftCardName: string;
  redemptionValue: string;
  redemptionCode: string;
  accessLink: string;
  linkPassword: string;
  region: string;
  validity: string;
  quantity: number;
  server: string;
  buyerRequiredId: string;
  deliveryDeadline: string;
  serviceType: string;
  requiredBuyerInfo: string;
  discordProductType: string;
  serverOrBotLink: string;
  tokenOrKey: string;
  requiredPermissions: string;
  toolName: string;
  automationType: string;
  softwareName: string;
  softwareVersion: string;
  operatingSystem: string;
  licenseKey: string;
  downloadLink: string;
  subscriptionDuration: string;
  accountType: string;
  courseName: string;
  itemName: string;
  instructions: string;
  observations: string;
};

const itemTypeOptions: Array<[StockItemType, string]> = [
  ["accounts_access", "Contas e acessos"],
  ["emails", "Emails"],
  ["gift_cards_codes", "Gift cards e codigos"],
  ["virtual_currency", "Moedas virtuais e gold"],
  ["game_items", "Itens digitais de jogos"],
  ["game_services", "Servicos em jogos"],
  ["premium_subscriptions", "Assinaturas e Premium"],
  ["artificial_intelligence", "Inteligencia Artificial"],
  ["discord_bots", "Discord e Bots"],
  ["social_networks", "Redes sociais"],
  ["software_licenses", "Softwares e licencas"],
  ["courses_training", "Cursos e treinamentos"],
  ["digital_links", "Links digitais"],
  ["digital_services", "Servicos digitais gerais"],
  ["freelancer", "Freelancer"],
  ["other", "Outras"],
];

const deliveryOptions: Array<[StockDeliveryMethod, string]> = [
  ["flowdesk_link", "Website Link Flowdesk"],
  ["email", "Email do comprador"],
  ["discord_dm", "DM do Discord"],
];

const stockStatusOptions: Array<[StockItem["status"], string]> = [
  ["available", "Disponivel"],
  ["reserved", "Reservado"],
  ["delivered", "Entregue"],
  ["disabled", "Desativado"],
];

const deliveryCopy: Record<StockDeliveryMethod, string> = {
  flowdesk_link:
    "Mostra os dados em uma pagina segura da Flowdesk, estilo central de acesso do comprador.",
  email: "Envia a entrega organizada para o email informado no pedido aprovado.",
  discord_dm: "Envia a entrega por DM no Discord quando o comprador estiver vinculado.",
};

const fieldTemplates: Record<StockItemType, FieldDefinition[]> = {
  accounts_access: [
    { key: "platform", label: "Plataforma", placeholder: "Netflix, Steam, Roblox..." },
    { key: "email", label: "Email/Login" },
    { key: "password", label: "Senha" },
    { key: "accessType", label: "Tipo de acesso", placeholder: "Conta completa, perfil, painel..." },
    { key: "instructions", label: "Instrucoes de uso", multiline: true },
    { key: "observations", label: "Observacoes", multiline: true },
  ],
  emails: [
    { key: "provider", label: "Provedor", placeholder: "Gmail, Outlook, Yahoo..." },
    { key: "email", label: "Email" },
    { key: "password", label: "Senha" },
    { key: "recovery", label: "Recuperacao/opcional" },
    { key: "observations", label: "Observacoes", multiline: true },
  ],
  gift_cards_codes: [
    { key: "giftCardName", label: "Nome do gift card" },
    { key: "redemptionValue", label: "Valor" },
    { key: "region", label: "Regiao/Pais" },
    { key: "redemptionCode", label: "Codigo de resgate" },
    { key: "validity", label: "Validade" },
    { key: "instructions", label: "Instrucoes de ativacao", multiline: true },
  ],
  digital_links: [
    { key: "itemName", label: "Titulo do produto" },
    { key: "accessLink", label: "URL/link de acesso" },
    { key: "linkPassword", label: "Senha do link" },
    { key: "validity", label: "Validade do link" },
    { key: "instructions", label: "Instrucoes para o comprador", multiline: true },
  ],
  game_items: [
    { key: "platform", label: "Jogo/plataforma" },
    { key: "itemName", label: "Nome do item" },
    { key: "quantity", label: "Quantidade" },
    { key: "server", label: "Servidor/regiao" },
    { key: "deliveryDeadline", label: "Metodo/prazo de entrega" },
    { key: "observations", label: "Observacoes", multiline: true },
  ],
  virtual_currency: [
    { key: "platform", label: "Jogo/plataforma" },
    { key: "quantity", label: "Quantidade" },
    { key: "server", label: "Servidor" },
    { key: "buyerRequiredId", label: "Nickname/ID necessario" },
    { key: "instructions", label: "Instrucoes", multiline: true },
  ],
  digital_services: [
    { key: "serviceType", label: "Tipo de servico" },
    { key: "deliveryDeadline", label: "Prazo de entrega" },
    { key: "requiredBuyerInfo", label: "Informacoes necessarias do comprador", multiline: true },
    { key: "instructions", label: "Descricao do servico", multiline: true },
    { key: "observations", label: "Observacoes", multiline: true },
  ],
  game_services: [
    { key: "serviceType", label: "Tipo de servico em jogo" },
    { key: "platform", label: "Jogo/plataforma" },
    { key: "server", label: "Servidor/regiao" },
    { key: "buyerRequiredId", label: "Nickname/ID necessario" },
    { key: "deliveryDeadline", label: "Prazo de entrega" },
    { key: "instructions", label: "Instrucoes", multiline: true },
  ],
  discord_bots: [
    { key: "discordProductType", label: "Tipo de produto" },
    { key: "serverOrBotLink", label: "Link do servidor/bot" },
    { key: "tokenOrKey", label: "Token ou chave" },
    { key: "requiredPermissions", label: "Permissoes necessarias", multiline: true },
    { key: "instructions", label: "Instrucoes de instalacao", multiline: true },
    { key: "observations", label: "Observacoes", multiline: true },
  ],
  artificial_intelligence: [
    { key: "toolName", label: "Ferramenta/automacao" },
    { key: "automationType", label: "Tipo de acesso" },
    { key: "tokenOrKey", label: "Chave API/login" },
    { key: "instructions", label: "Instrucoes de uso", multiline: true },
    { key: "observations", label: "Requisitos/observacoes", multiline: true },
  ],
  software_licenses: [
    { key: "softwareName", label: "Nome do software" },
    { key: "softwareVersion", label: "Versao" },
    { key: "operatingSystem", label: "Sistema operacional" },
    { key: "licenseKey", label: "Chave/licenca" },
    { key: "downloadLink", label: "Link de download" },
    { key: "instructions", label: "Instrucoes de ativacao", multiline: true },
  ],
  premium_subscriptions: [
    { key: "platform", label: "Plataforma" },
    { key: "email", label: "Email/login" },
    { key: "password", label: "Senha ou codigo de acesso" },
    { key: "subscriptionDuration", label: "Duracao do plano" },
    { key: "accountType", label: "Tipo de conta" },
    { key: "observations", label: "Observacoes", multiline: true },
  ],
  courses_training: [
    { key: "courseName", label: "Nome do curso" },
    { key: "platform", label: "Plataforma" },
    { key: "email", label: "Email/login ou link" },
    { key: "password", label: "Senha" },
    { key: "subscriptionDuration", label: "Duracao do acesso" },
    { key: "instructions", label: "Instrucoes", multiline: true },
  ],
  social_networks: [
    { key: "platform", label: "Rede social/plataforma" },
    { key: "serviceType", label: "Tipo de produto" },
    { key: "login", label: "Login/acesso" },
    { key: "password", label: "Senha/codigo" },
    { key: "instructions", label: "Instrucoes", multiline: true },
  ],
  freelancer: [
    { key: "serviceType", label: "Tipo de freelancer" },
    { key: "deliveryDeadline", label: "Prazo" },
    { key: "requiredBuyerInfo", label: "Briefing necessario", multiline: true },
    { key: "instructions", label: "Escopo da entrega", multiline: true },
  ],
  other: [
    { key: "itemName", label: "Nome do item" },
    { key: "accessLink", label: "Link/acesso" },
    { key: "redemptionCode", label: "Codigo/chave" },
    { key: "instructions", label: "Instrucoes", multiline: true },
    { key: "observations", label: "Observacoes", multiline: true },
  ],
};

function createEmptyForm(product?: SalesProduct | null): StockFormState {
  return {
    productId: product?.id || "",
    productName: product?.title || "",
    itemType: "digital_services",
    deliveryMethod: "flowdesk_link",
    category: product?.productType || "",
    platform: "",
    provider: "",
    email: "",
    login: "",
    password: "",
    accessType: "",
    recovery: "",
    giftCardName: "",
    redemptionValue: "",
    redemptionCode: "",
    accessLink: "",
    linkPassword: "",
    region: "",
    validity: "",
    quantity: 1,
    server: "",
    buyerRequiredId: "",
    deliveryDeadline: "",
    serviceType: "",
    requiredBuyerInfo: "",
    discordProductType: "",
    serverOrBotLink: "",
    tokenOrKey: "",
    requiredPermissions: "",
    toolName: "",
    automationType: "",
    softwareName: "",
    softwareVersion: "",
    operatingSystem: "",
    licenseKey: "",
    downloadLink: "",
    subscriptionDuration: "",
    accountType: "",
    courseName: "",
    itemName: "",
    instructions: "",
    observations: "",
  };
}

function normalizeStockForm(form: StockFormState, status: StockItem["status"]) {
  return {
    ...form,
    productId: (form.productId || "").trim(),
    productName: (form.productName || "").trim(),
    quantity: Math.max(1, Math.floor(Number(form.quantity) || 1)),
    status,
  };
}

function areStockFormSnapshotsEqual(
  left: ReturnType<typeof normalizeStockForm> | null,
  right: ReturnType<typeof normalizeStockForm>,
) {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function getStockPath(guildId: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/stock/`;
}

function getStockEditPath(guildId: string, productCode: string) {
  return `/servers/${encodeURIComponent(guildId)}/sales/stock/edit/${encodeURIComponent(productCode)}/`;
}

function getStockProductCodeFromPath(pathname: string | null) {
  const match = pathname?.match(/\/sales\/stock\/edit\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
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

    function handlePointer(event: MouseEvent | TouchEvent) {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
    };
  }, [open]);

  return (
    <div ref={menuRef} className={open ? "relative z-[220]" : "relative z-[1]"}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!open) setOpenDirection(resolveOpenDirection());
          setOpen((current) => !current);
        }}
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
            className="flowdesk-selectmenu-scrollbar overflow-y-auto pr-[2px]"
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

function formatStockDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponivel";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function StockEditorSkeleton() {
  return (
    <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-[18px]">
        <ServerSurface className="overflow-hidden">
          <div className="p-[18px] sm:p-[22px]">
            <div className="flex flex-col gap-[10px] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="h-[14px] w-[146px] animate-pulse rounded-full bg-[#1A1A1A]" />
                <div className="mt-[10px] h-[12px] w-[min(320px,78vw)] max-w-full animate-pulse rounded-full bg-[#111]" />
              </div>
              <div className="h-[30px] w-[96px] animate-pulse rounded-full bg-[#101010]" />
            </div>
            <div className="mt-[16px] h-[42px] w-full max-w-[420px] animate-pulse rounded-[14px] bg-[#111]" />
          </div>

          <div className="mx-[18px] mb-[18px] overflow-hidden rounded-[18px] border border-[#202020] sm:mx-[22px] sm:mb-[20px]">
            <div className="grid grid-cols-[minmax(0,1fr)_96px_110px_44px] items-center gap-[12px] bg-[#101010] px-[14px] py-[10px] max-sm:grid-cols-[minmax(0,1fr)_64px_40px]">
              <div className="h-[12px] w-[90px] animate-pulse rounded-full bg-[#1A1A1A]" />
              <div className="ml-auto h-[12px] w-[34px] animate-pulse rounded-full bg-[#1A1A1A]" />
              <div className="ml-auto h-[12px] w-[54px] animate-pulse rounded-full bg-[#1A1A1A] max-sm:hidden" />
              <div className="ml-auto h-[12px] w-[28px] animate-pulse rounded-full bg-[#1A1A1A]" />
            </div>
            <div className="divide-y divide-[#171717]">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_96px_110px_44px] items-center gap-[12px] px-[14px] py-[13px] max-sm:grid-cols-[minmax(0,1fr)_64px_40px]"
                >
                  <div className="min-w-0">
                    <div className="h-[14px] w-[min(260px,58vw)] max-w-full animate-pulse rounded-full bg-[#151515]" />
                    <div className="mt-[8px] h-[11px] w-[min(360px,64vw)] max-w-full animate-pulse rounded-full bg-[#101010]" />
                  </div>
                  <div className="ml-auto h-[13px] w-[34px] animate-pulse rounded-full bg-[#151515]" />
                  <div className="ml-auto h-[13px] w-[72px] animate-pulse rounded-full bg-[#151515] max-sm:hidden" />
                  <div className="ml-auto h-[32px] w-[32px] animate-pulse rounded-[11px] bg-[#101010]" />
                </div>
              ))}
            </div>
          </div>
        </ServerSurface>
      </div>

      <aside className="space-y-[18px]">
        <ServerSurface className="p-[18px] sm:p-[20px]">
          <div className="h-[14px] w-[86px] animate-pulse rounded-full bg-[#1A1A1A]" />
          <div className="mt-[14px] grid grid-cols-2 gap-[10px]">
            <div className="h-[96px] animate-pulse rounded-[16px] bg-[#101010]" />
            <div className="h-[96px] animate-pulse rounded-[16px] bg-[#101010]" />
          </div>
        </ServerSurface>
      </aside>
    </div>
  );
}

function getItemMainLabel(item: StockItem) {
  return (
    item.itemName ||
    item.giftCardName ||
    item.courseName ||
    item.softwareName ||
    item.platform ||
    item.serviceType ||
    item.email ||
    item.login ||
    "Entrega cadastrada"
  );
}

function StockItemActionsModal({
  item,
  duplicating,
  onClose,
  onEdit,
  onDuplicate,
}: {
  item: StockItem | null;
  duplicating: boolean;
  onClose: () => void;
  onEdit: (item: StockItem) => void;
  onDuplicate: (item: StockItem, count: number) => void;
}) {
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(1);
  useBodyScrollLock(Boolean(item));

  useEffect(() => {
    if (!item) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (!portalTarget) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[2600] isolate overflow-y-auto overscroll-contain">
      <button
        type="button"
        aria-label="Fechar modal"
        className="absolute inset-0 bg-[rgba(0,0,0,0.84)] backdrop-blur-[7px]"
        onClick={onClose}
      />

      <div className="relative z-[10] min-h-full px-[18px] py-[28px] md:px-6">
        <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[720px] items-center justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Acoes do estoque ${getItemMainLabel(item)}`}
            className="flowdesk-stage-fade relative w-full overflow-hidden rounded-[32px] bg-transparent px-[22px] py-[22px] shadow-[0_34px_110px_rgba(0,0,0,0.52)] sm:px-[28px] sm:py-[28px]"
          >
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[32px] border border-[#0E0E0E]" />
            <span aria-hidden="true" className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[32px]" />
            <span aria-hidden="true" className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[32px]" />
            <span aria-hidden="true" className="pointer-events-none absolute inset-[1px] rounded-[31px] bg-[linear-gradient(180deg,rgba(8,8,8,0.985)_0%,rgba(4,4,4,0.985)_100%)]" />

            <div className="relative z-10">
              <div className="flex flex-col gap-[14px] sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <LandingGlowTag className="px-[18px]">Estoque do produto</LandingGlowTag>
                  <div className="mt-[18px]">
                    <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[36px]">
                      {getItemMainLabel(item)}
                    </h2>
                    <p className="mt-[14px] max-w-[560px] text-[14px] leading-[1.62] text-[#787878]">
                      Edite ou duplique este registro do estoque. A quantidade do produto sera atualizada automaticamente.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4]"
                  aria-label="Fechar modal"
                >
                  <span className="text-[18px] leading-none">x</span>
                </button>
              </div>

              {isDuplicateOpen ? (
                <div className="mt-[22px] rounded-[22px] border border-[#1C1C1C] bg-[#0B0B0B] p-[16px]">
                  <div className="flex flex-col gap-[12px] sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#EDEDED]">
                        Duplicar estoque
                      </p>
                      <p className="mt-[6px] text-[12px] leading-[1.55] text-[#777]">
                        Cria copias disponiveis deste mesmo produto. Maximo de 10 por vez.
                      </p>
                    </div>
                    <label className="block w-full sm:w-[150px]">
                      <span className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                        Quantidade
                      </span>
                      <ServerTextInput
                        type="number"
                        min={1}
                        max={10}
                        inputMode="numeric"
                        value={duplicateCount}
                        onChange={(event) =>
                          setDuplicateCount(
                            Math.min(
                              10,
                              Math.max(1, Math.floor(Number(event.target.value) || 1)),
                            ),
                          )
                        }
                        disabled={duplicating}
                      />
                    </label>
                  </div>
                  <div className="mt-[14px] flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setIsDuplicateOpen(false)}
                      disabled={duplicating}
                      className="inline-flex h-[42px] items-center justify-center rounded-[13px] border border-[#171717] bg-[#0D0D0D] px-[16px] text-[13px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancelar duplicacao
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(item, duplicateCount)}
                      disabled={duplicating}
                      aria-busy={duplicating}
                      className="inline-flex h-[42px] items-center justify-center gap-[8px] rounded-[13px] border border-[#242424] bg-[#F1F1F1] px-[16px] text-[13px] font-semibold text-[#080808] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {duplicating ? (
                        <ButtonLoader size={15} colorClassName="text-[#080808]" />
                      ) : (
                        <Copy className="h-[15px] w-[15px]" />
                      )}
                      Confirmar
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-[24px] flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={duplicating}
                  className="inline-flex h-[46px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] px-[18px] text-[14px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  disabled={duplicating}
                  className="inline-flex h-[46px] items-center justify-center gap-[8px] rounded-[14px] border border-[#171717] bg-[#101010] px-[18px] text-[14px] font-semibold text-[#EDEDED] transition-colors hover:border-[#2A2A2A] hover:bg-[#151515] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Pencil className="h-[15px] w-[15px]" />
                  Editar
                </button>

                <button
                  type="button"
                  onClick={() => setIsDuplicateOpen(true)}
                  disabled={duplicating}
                  className="inline-flex h-[46px] items-center justify-center gap-[8px] rounded-[14px] border border-[#1F1F1F] bg-[#151515] px-[18px] text-[14px] font-semibold text-[#EDEDED] transition-colors hover:border-[#303030] hover:bg-[#1A1A1A] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Copy className="h-[15px] w-[15px]" />
                  Duplicar
                </button>

              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, portalTarget);
}

export function SalesStockPanel({
  guildId,
  readOnly = false,
}: {
  guildId: string;
  readOnly?: boolean;
}) {
  const pathname = usePathname();
  const notifications = useNotifications();
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [items, setItems] = useState<StockItem[]>([]);
  const [form, setForm] = useState<StockFormState>(() => createEmptyForm());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [actionItem, setActionItem] = useState<StockItem | null>(null);
  const [formStatus, setFormStatus] = useState<StockItem["status"]>("available");
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savingQuantityItemId, setSavingQuantityItemId] = useState<string | null>(null);
  const [duplicatingItemId, setDuplicatingItemId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [needsDiscordRelink, setNeedsDiscordRelink] = useState(false);
  const [savedFormSnapshot, setSavedFormSnapshot] =
    useState<ReturnType<typeof normalizeStockForm> | null>(null);
  const routeProductCode = getStockProductCodeFromPath(pathname);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) || null,
    [products, selectedProductId],
  );

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return products;
    return products.filter((product) =>
      `${product.title} ${product.sku} ${product.productType || ""} ${(product.tags || []).join(" ")}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [products, query]);

  const availableCount = useMemo(
    () =>
      items
        .filter((item) => item.status === "available")
        .reduce((total, item) => total + Math.max(0, Number(item.quantity || 0)), 0),
    [items],
  );

  const filteredStockItems = useMemo(() => {
    const normalized = stockQuery.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      [
        getItemMainLabel(item),
        item.productName,
        item.email,
        item.login,
        item.platform,
        item.provider,
        item.serviceType,
        item.itemName,
        item.giftCardName,
        item.courseName,
        item.softwareName,
        itemTypeOptions.find(([value]) => value === item.itemType)?.[1] || "",
        deliveryOptions.find(([value]) => value === item.deliveryMethod)?.[1] || "",
        stockStatusOptions.find(([value]) => value === item.status)?.[1] || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [items, stockQuery]);

  const loadProducts = useCallback(async () => {
    setIsLoadingProducts(true);
    setStatusMessage(null);
    setNeedsDiscordRelink(false);
    try {
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
      setProducts(payload.products || []);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Erro ao carregar produtos.");
    } finally {
      setIsLoadingProducts(false);
    }
  }, [guildId]);

  const loadStockItems = useCallback(
    async (productId: string) => {
      if (!productId) return;
      setIsLoadingItems(true);
      setStatusMessage(null);
      try {
        const response = await fetch(
          `/api/auth/me/guilds/sales-stock?guildId=${encodeURIComponent(guildId)}&productId=${encodeURIComponent(productId)}`,
          { credentials: "include", cache: "no-store" },
        );
      const payload = (await response.json().catch(() => ({}))) as StockResponse;
      if (!response.ok || !payload.ok) {
        if (payload.reauthRequired || payload.code === "DISCORD_RELINK_REQUIRED") {
          setNeedsDiscordRelink(true);
        }
        throw new Error(payload.message || "Erro ao carregar estoque.");
      }
        setItems(payload.items || []);
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Erro ao carregar estoque.");
      } finally {
        setIsLoadingItems(false);
      }
    },
    [guildId],
  );

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const openProductStock = useCallback(
    (product: SalesProduct, options?: { syncUrl?: boolean }) => {
      setSelectedProductId(product.id);
      setForm(createEmptyForm(product));
      setSavedFormSnapshot(null);
      setEditingItemId(null);
      setIsFormOpen(false);
      setActionItem(null);
      setFormStatus("available");
      setItems([]);
      setStockQuery("");
      setQuantityDrafts({});
      void loadStockItems(product.id);
      if (options?.syncUrl !== false) {
        window.history.pushState(null, "", getStockEditPath(guildId, product.code));
      }
    },
    [guildId, loadStockItems],
  );

  const selectProduct = useCallback(
    (product: SalesProduct) => openProductStock(product),
    [openProductStock],
  );

  useEffect(() => {
    if (!routeProductCode) {
      if (selectedProductId) {
        setSelectedProductId("");
        setItems([]);
        setEditingItemId(null);
        setIsFormOpen(false);
        setActionItem(null);
        setForm(createEmptyForm());
        setSavedFormSnapshot(null);
      }
      return;
    }
    if (!products.length) return;
    const routeProduct = products.find((product) => product.code === routeProductCode);
    if (!routeProduct || selectedProductId === routeProduct.id) return;
    openProductStock(routeProduct, { syncUrl: false });
  }, [openProductStock, products, routeProductCode, selectedProductId]);

  const updateForm = useCallback(
    <K extends keyof StockFormState>(key: K, value: StockFormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
      setStatusMessage(null);
    },
    [],
  );

  const currentFormSnapshot = useMemo(
    () => normalizeStockForm(form, formStatus),
    [form, formStatus],
  );
  const hasStockFormChanges =
    !editingItemId || !areStockFormSnapshotsEqual(savedFormSnapshot, currentFormSnapshot);
  const canSaveStockItem = Boolean(
    selectedProduct &&
      !readOnly &&
      !isSaving &&
      hasStockFormChanges,
  );

  const saveStockItem = useCallback(async () => {
    if (!canSaveStockItem || !selectedProduct) return;
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const method = editingItemId ? "PATCH" : "POST";
      const response = await fetch("/api/auth/me/guilds/sales-stock", {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          ...(editingItemId ? { itemId: editingItemId } : {}),
          ...form,
          status: formStatus,
          productId: selectedProduct.id,
          productName: selectedProduct.title,
          payload: {
            deliveryLabel: deliveryOptions.find(([value]) => value === form.deliveryMethod)?.[1],
            itemTypeLabel: itemTypeOptions.find(([value]) => value === form.itemType)?.[1],
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as StockResponse;
      if (!response.ok || !payload.ok || !payload.item) {
        throw new Error(payload.message || "Erro ao salvar estoque.");
      }
      setItems((current) =>
        editingItemId
          ? current.map((item) => (item.id === editingItemId ? (payload.item as StockItem) : item))
          : [payload.item as StockItem, ...current],
      );
      setProducts((current) =>
        current.map((product) =>
          product.id === selectedProduct.id
            ? { ...product, stockQuantity: payload.stockQuantity ?? product.stockQuantity }
            : product,
        ),
      );
      setForm(createEmptyForm(selectedProduct));
      setEditingItemId(null);
      setIsFormOpen(false);
      setFormStatus("available");
      notifications.success(
        editingItemId ? "Entrega atualizada com sucesso." : "Estoque salvo com sucesso.",
        {
          title: editingItemId ? "Estoque atualizado" : "Estoque cadastrado",
        },
      );
      if (payload.discordSyncStatus === "failed") {
        notifications.show(
          payload.discordSyncError ||
            "O estoque foi salvo, mas o embed do produto no Discord nao sincronizou agora.",
          { title: "Embed Discord", tone: "default", durationMs: 7200 },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao salvar estoque.";
      notifications.error(message, { title: "Falha no estoque" });
    } finally {
      setIsSaving(false);
    }
  }, [canSaveStockItem, editingItemId, form, formStatus, guildId, notifications, selectedProduct]);

  const startCreateItem = useCallback(() => {
    const emptyForm = createEmptyForm(selectedProduct);
    setForm(emptyForm);
    setSavedFormSnapshot(normalizeStockForm(emptyForm, "available"));
    setEditingItemId(null);
    setActionItem(null);
    setFormStatus("available");
    setStatusMessage(null);
    setIsFormOpen(true);
  }, [selectedProduct]);

  const startEditItem = useCallback((item: StockItem) => {
    setForm({ ...item });
    setFormStatus(item.status);
    setSavedFormSnapshot(normalizeStockForm({ ...item }, item.status));
    setEditingItemId(item.id);
    setActionItem(null);
    setStatusMessage(null);
    setIsFormOpen(true);
    window.requestAnimationFrame(() => {
      document.getElementById("stock-delivery-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setForm(createEmptyForm(selectedProduct));
    setSavedFormSnapshot(null);
    setEditingItemId(null);
    setIsFormOpen(false);
    setActionItem(null);
    setFormStatus("available");
    setStatusMessage(null);
  }, [selectedProduct]);

  const duplicateStockItem = useCallback(
    async (item: StockItem, count: number) => {
      if (!selectedProduct || readOnly) return;
      const duplicateCount = Math.min(10, Math.max(1, Math.floor(Number(count) || 1)));
      setDuplicatingItemId(item.id);
      try {
        const response = await fetch("/api/auth/me/guilds/sales-stock", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            productId: selectedProduct.id,
            duplicateItemId: item.id,
            duplicateCount,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as StockResponse;
        if (!response.ok || !payload.ok || !payload.items?.length) {
          throw new Error(payload.message || "Erro ao duplicar estoque.");
        }
        setItems((current) => [...(payload.items as StockItem[]), ...current]);
        setProducts((current) =>
          current.map((product) =>
            product.id === selectedProduct.id
              ? { ...product, stockQuantity: payload.stockQuantity ?? product.stockQuantity }
              : product,
          ),
        );
        setActionItem(null);
        notifications.success(
          `${duplicateCount} copia${duplicateCount === 1 ? "" : "s"} adicionada${duplicateCount === 1 ? "" : "s"} ao estoque.`,
          { title: "Estoque duplicado" },
        );
        if (payload.discordSyncStatus === "failed") {
          notifications.show(
            payload.discordSyncError ||
              "O estoque foi duplicado, mas o embed do produto no Discord nao sincronizou agora.",
            { title: "Embed Discord", tone: "default", durationMs: 7200 },
          );
        }
      } catch (error) {
        notifications.error(
          error instanceof Error ? error.message : "Erro ao duplicar estoque.",
          { title: "Falha no estoque" },
        );
      } finally {
        setDuplicatingItemId(null);
      }
    },
    [guildId, notifications, readOnly, selectedProduct],
  );

  const saveStockItemQuantity = useCallback(
    async (item: StockItem, rawQuantity: string | number) => {
      if (!selectedProduct || readOnly) return;
      const nextQuantity = Math.max(0, Math.floor(Number(rawQuantity) || 0));
      if (nextQuantity === Math.max(0, Number(item.quantity || 0))) {
        setQuantityDrafts((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        return;
      }

      setSavingQuantityItemId(item.id);
      try {
        const response = await fetch("/api/auth/me/guilds/sales-stock", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            productId: selectedProduct.id,
            itemId: item.id,
            patchMode: "quantity",
            quantity: nextQuantity,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as StockResponse;
        if (!response.ok || !payload.ok || !payload.item) {
          throw new Error(payload.message || "Erro ao atualizar quantidade.");
        }

        setItems((current) =>
          current.map((entry) => (entry.id === item.id ? (payload.item as StockItem) : entry)),
        );
        setProducts((current) =>
          current.map((product) =>
            product.id === selectedProduct.id
              ? { ...product, stockQuantity: payload.stockQuantity ?? product.stockQuantity }
              : product,
          ),
        );
        setQuantityDrafts((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        notifications.success("Quantidade atualizada em tempo real.", {
          title: "Estoque atualizado",
        });
        if (payload.discordSyncStatus === "failed") {
          notifications.show(
            payload.discordSyncError ||
              "A quantidade foi salva, mas o embed do produto no Discord nao sincronizou agora.",
            { title: "Embed Discord", tone: "default", durationMs: 7200 },
          );
        }
      } catch (error) {
        setQuantityDrafts((current) => ({
          ...current,
          [item.id]: String(item.quantity || 0),
        }));
        notifications.error(
          error instanceof Error ? error.message : "Erro ao atualizar quantidade.",
          { title: "Falha no estoque" },
        );
      } finally {
        setSavingQuantityItemId(null);
      }
    },
    [guildId, notifications, readOnly, selectedProduct],
  );

  const fields = fieldTemplates[form.itemType] || fieldTemplates.digital_services;

  return (
    <div className="space-y-[18px]">
      {!selectedProduct ? (
        <ServerSectionHeading
          eyebrow="Modulo Vendas"
          title="Estoque"
          description="Gerencie entregas digitais por produto com dados separados para envio automatico ao comprador."
        />
      ) : (
        <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <ServerButton
              onClick={() => {
                window.history.pushState(null, "", getStockPath(guildId));
                setSelectedProductId("");
                cancelEdit();
              }}
              variant="ghost"
              size="sm"
              className="px-[10px]"
            >
              <ArrowLeft className="h-[16px] w-[16px]" />
              Produtos
            </ServerButton>
            <div className="mt-[10px] flex items-center gap-[10px]">
              <Boxes className="h-[18px] w-[18px] text-[#A5A5A5]" />
              <h3 className="text-[24px] font-semibold tracking-[-0.05em] text-[#EFEFEF]">
                {isFormOpen
                  ? editingItemId
                    ? "Editar estoque"
                    : "Adicionar estoque"
                  : `Estoque - ${selectedProduct.title}`}
              </h3>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-[10px]">
            {isFormOpen ? (
              <>
                <ServerButton onClick={cancelEdit} disabled={isSaving}>
                  Cancelar
                </ServerButton>
                <ServerButton
                  aria-busy={isSaving}
                  disabled={!canSaveStockItem}
                  onClick={() => void saveStockItem()}
                  variant="primary"
                  className="min-w-[158px]"
                >
                  {isSaving ? (
                    <ButtonLoader size={16} colorClassName="text-[#080808]" />
                  ) : (
                    <>
                      <Check className="h-[16px] w-[16px]" />
                      {editingItemId ? "Salvar alteracoes" : "Salvar estoque"}
                    </>
                  )}
                </ServerButton>
              </>
            ) : (
              <ServerButton
                disabled={readOnly}
                onClick={startCreateItem}
                variant="primary"
                size="lg"
              >
                <Plus className="h-[16px] w-[16px]" />
                Adicionar Estoque
              </ServerButton>
            )}
          </div>
        </div>
      )}

      {needsDiscordRelink ? (
        <ServerSurface className="overflow-hidden">
          <ServerDiscordRelinkState />
        </ServerSurface>
      ) : statusMessage ? (
        <div className="rounded-[18px] border border-[#3A2A1E] bg-[#170F09] px-[14px] py-[12px] text-[13px] text-[#F2B27D]">
          {statusMessage}
        </div>
      ) : null}

      {!selectedProduct ? (
        <ServerSurface className="overflow-hidden">
          <div className="flex flex-col gap-[14px] border-b border-[#171717] p-[18px] sm:flex-row sm:items-center sm:justify-between sm:p-[22px]">
            <div>
              <h3 className="text-[18px] font-semibold text-[#EDEDED]">Produtos em estoque</h3>
              <p className="mt-[6px] text-[13px] text-[#777]">
                Clique em um produto para configurar o estoque e a entrega.
              </p>
            </div>
            <div className="relative w-full sm:max-w-[360px]">
              <Search className="pointer-events-none absolute left-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#777]" />
              <ServerTextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar produto"
                className="pl-[40px]"
              />
            </div>
          </div>

          {isLoadingProducts ? (
            <div className="divide-y divide-[#151515]">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-[14px] px-[18px] py-[15px] sm:px-[22px]"
                >
                  <div className="h-[44px] w-[44px] shrink-0 animate-pulse rounded-[14px] bg-[#141414]" />
                  <div className="min-w-0 flex-1">
                    <div className="h-[14px] w-[min(260px,60vw)] animate-pulse rounded-full bg-[#171717]" />
                    <div className="mt-[8px] h-[11px] w-[min(360px,70vw)] animate-pulse rounded-full bg-[#111]" />
                  </div>
                  <div className="h-[30px] w-[72px] animate-pulse rounded-full bg-[#111]" />
                </div>
              ))}
            </div>
          ) : filteredProducts.length ? (
            <div className="divide-y divide-[#151515]">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => selectProduct(product)}
                  className="flowdesk-server-button flex w-full items-center gap-[14px] px-[18px] py-[15px] text-left transition hover:bg-[#0F0F0F] sm:px-[22px]"
                >
                  <ServerIconFrame className="h-[44px] w-[44px] rounded-[14px]">
                    <Boxes className="h-[18px] w-[18px]" />
                  </ServerIconFrame>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-[#EDEDED]">
                      {product.title}
                    </span>
                    <span className="mt-[4px] block truncate text-[12px] text-[#777]">
                      {product.sku || product.code} - {formatMoney(product.priceAmount)}
                    </span>
                  </span>
                  <span className="rounded-full border border-[#242424] bg-[#101010] px-[10px] py-[6px] text-[12px] font-semibold text-[#CFCFCF]">
                    {product.stockQuantity} un.
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <ServerEmptyState
              icon={<PackageSearch className="h-[24px] w-[24px]" />}
              title="Nenhum produto encontrado"
              description="Crie produtos primeiro para gerenciar estoque digital."
            />
          )}
        </ServerSurface>
      ) : isLoadingItems && !isFormOpen ? (
        <StockEditorSkeleton />
      ) : (
        <>
        <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-[18px]">
            {isFormOpen ? (
            <div id="stock-delivery-form">
            <ServerSurface className="p-[18px] sm:p-[22px]">
              <div className="flex flex-col gap-[12px] sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 className="text-[15px] font-semibold text-[#E7E7E7]">
                    {editingItemId ? "Editar entrega digital" : "Nova entrega digital"}
                  </h4>
                  <p className="mt-[7px] text-[13px] leading-[1.5] text-[#777]">
                    Preencha os dados reais que serao entregues ao comprador depois da compra aprovada.
                  </p>
                </div>
                {editingItemId ? (
                  <ServerButton onClick={cancelEdit} size="sm" disabled={isSaving}>
                    Cancelar edicao
                  </ServerButton>
                ) : null}
              </div>
              <div className="mt-[16px] grid gap-[12px] md:grid-cols-2">
                <div>
                  <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                    Tipo de estoque
                  </label>
                  <SelectMenu
                    value={form.itemType}
                    options={itemTypeOptions}
                    onChange={(value) => updateForm("itemType", value)}
                    disabled={readOnly || isSaving}
                    maxVisibleItems={7}
                  />
                </div>
                <div>
                  <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                    Metodo de entrega
                  </label>
                  <SelectMenu
                    value={form.deliveryMethod}
                    options={deliveryOptions}
                    onChange={(value) => updateForm("deliveryMethod", value)}
                    disabled={readOnly || isSaving}
                  />
                </div>
                <div>
                  <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                    Status
                  </label>
                  <SelectMenu
                    value={formStatus}
                    options={stockStatusOptions}
                    onChange={setFormStatus}
                    disabled={readOnly || isSaving}
                  />
                </div>
              </div>

              <div className="mt-[14px] rounded-[16px] border border-[#202020] bg-[#0C0C0C] p-[14px] text-[13px] leading-[1.55] text-[#AFAFAF]">
                {deliveryCopy[form.deliveryMethod]}
              </div>

              <div className="mt-[18px] grid gap-[12px] md:grid-cols-2">
                {fields.map((field) => (
                  <div key={String(field.key)} className={field.multiline ? "md:col-span-2" : ""}>
                    <label className="mb-[8px] block text-[12px] font-semibold text-[#AFAFAF]">
                      {field.label}
                    </label>
                    {field.multiline ? (
                      <textarea
                        value={String(form[field.key] || "")}
                        onChange={(event) =>
                          updateForm(field.key, event.target.value as never)
                        }
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={field.placeholder}
                        disabled={readOnly || isSaving}
                        className="flowdesk-server-input min-h-[104px] w-full resize-y rounded-[14px] border border-[#252525] bg-[#0D0D0D] px-[14px] py-[12px] text-[14px] leading-[1.55] text-[#F1F1F1] outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-[#646464] focus:border-[#4A4A4A] disabled:cursor-not-allowed disabled:opacity-55"
                      />
                    ) : field.key === "password" || field.key === "linkPassword" ? (
                      <div className="relative">
                        <ServerTextInput
                          type={showPassword[String(field.key)] ? "text" : "password"}
                          value={String(form[field.key] || "")}
                          onChange={(event) => updateForm(field.key, event.target.value as never)}
                          placeholder={field.placeholder || field.label}
                          disabled={readOnly || isSaving}
                          autoComplete="new-password"
                          className="pr-[44px]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowPassword((current) => ({
                              ...current,
                              [String(field.key)]: !current[String(field.key)],
                            }))
                          }
                          disabled={readOnly || isSaving}
                          className="flowdesk-server-button absolute right-[8px] top-1/2 inline-flex h-[30px] w-[30px] -translate-y-1/2 items-center justify-center rounded-[10px] text-[#8A8A8A] transition hover:bg-[#171717] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                          aria-label={showPassword[String(field.key)] ? "Ocultar senha" : "Mostrar senha"}
                          title={showPassword[String(field.key)] ? "Ocultar senha" : "Mostrar senha"}
                        >
                          {showPassword[String(field.key)] ? (
                            <EyeOff className="h-[15px] w-[15px]" />
                          ) : (
                            <Eye className="h-[15px] w-[15px]" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <ServerTextInput
                        value={String(form[field.key] || "")}
                        onChange={(event) => {
                          const nextValue =
                            field.key === "quantity"
                              ? Math.max(0, Math.floor(Number(event.target.value) || 0))
                              : event.target.value;
                          updateForm(field.key, nextValue as never);
                        }}
                        inputMode={field.key === "quantity" ? "numeric" : undefined}
                        placeholder={field.placeholder || field.label}
                        disabled={readOnly || isSaving}
                        autoComplete="off"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-[18px] flex justify-end">
                <p className="text-[12px] leading-[1.5] text-[#777]">
                  Use os botoes no topo para cancelar ou salvar esta entrega.
                </p>
              </div>
            </ServerSurface>
            </div>
            ) : (
              <ServerSurface className="overflow-hidden">
                <div className="p-[18px] sm:p-[22px]">
                  <div className="flex flex-col gap-[10px] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="text-[14px] font-semibold text-[#E2E2E2]">
                        Triagens cadastradas
                      </h4>
                      <p className="mt-[8px] text-[12px] leading-[1.5] text-[#777]">
                        Lista de acessos, codigos e triagens vinculadas a este produto.
                      </p>
                    </div>
                    <span className="rounded-full border border-[#242424] bg-[#101010] px-[10px] py-[6px] text-[12px] font-semibold text-[#CFCFCF]">
                      {items.length} registro{items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="relative mt-[16px] w-full sm:max-w-[420px]">
                    <Search className="pointer-events-none absolute left-[14px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#666]" />
                    <ServerTextInput
                      value={stockQuery}
                      onChange={(event) => setStockQuery(event.target.value)}
                      placeholder="Buscar triagem"
                      className="pl-[40px]"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="mx-[18px] mb-[18px] overflow-hidden rounded-[18px] border border-[#202020] sm:mx-[22px] sm:mb-[20px]">
                  <div className="grid grid-cols-[minmax(0,1fr)_96px_110px_44px] items-center gap-[12px] bg-[#101010] px-[14px] py-[10px] text-[12px] font-semibold text-[#BDBDBD] max-sm:grid-cols-[minmax(0,1fr)_64px_40px]">
                    <span>Entrega</span>
                    <span className="text-right">Qtd.</span>
                    <span className="text-right max-sm:hidden">Status</span>
                    <span className="text-right">Editar</span>
                  </div>

                  {isLoadingItems ? (
                    <div className="flex items-center justify-center gap-[10px] px-[14px] py-[34px] text-[13px] text-[#777]">
                      <ButtonLoader size={14} />
                      Carregando estoque...
                    </div>
                  ) : filteredStockItems.length ? (
                    <div className="divide-y divide-[#171717]">
                      {filteredStockItems.map((item) => (
                        <div
                          key={item.id}
                          className="grid grid-cols-[minmax(0,1fr)_96px_110px_44px] items-center gap-[12px] px-[14px] py-[13px] max-sm:grid-cols-[minmax(0,1fr)_64px_40px]"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-semibold text-[#EDEDED]">
                              {getItemMainLabel(item)}
                            </p>
                            <p className="mt-[4px] truncate text-[12px] text-[#777]">
                              {itemTypeOptions.find(([value]) => value === item.itemType)?.[1] || "Estoque"} - {deliveryOptions.find(([value]) => value === item.deliveryMethod)?.[1]} - {formatStockDate(item.updatedAt)}
                            </p>
                          </div>
                          <div className="relative">
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={quantityDrafts[item.id] ?? String(item.quantity || 0)}
                              onChange={(event) =>
                                setQuantityDrafts((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              onBlur={(event) =>
                                void saveStockItemQuantity(item, event.currentTarget.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                                if (event.key === "Escape") {
                                  event.currentTarget.value = String(item.quantity || 0);
                                  setQuantityDrafts((current) => {
                                    const next = { ...current };
                                    delete next[item.id];
                                    return next;
                                  });
                                  event.currentTarget.blur();
                                }
                              }}
                              disabled={
                                readOnly ||
                                savingQuantityItemId === item.id
                              }
                              aria-label={`Quantidade de ${getItemMainLabel(item)}`}
                              className="flowdesk-server-input h-[34px] w-full rounded-[11px] border border-[#242424] bg-[#0D0D0D] px-[10px] text-right text-[13px] font-semibold text-[#DCDCDC] outline-none transition focus:border-[#4A4A4A] disabled:cursor-not-allowed disabled:opacity-55"
                            />
                            {savingQuantityItemId === item.id ? (
                              <span className="pointer-events-none absolute left-[8px] top-1/2 -translate-y-1/2">
                                <ButtonLoader size={12} />
                              </span>
                            ) : null}
                          </div>
                          <span className="text-right text-[12px] font-semibold text-[#AFAFAF] max-sm:hidden">
                            {stockStatusOptions.find(([value]) => value === item.status)?.[1]}
                          </span>
                          <button
                            type="button"
                            onClick={() => setActionItem(item)}
                            disabled={readOnly}
                            className="flowdesk-server-button ml-auto inline-flex h-[32px] w-[32px] items-center justify-center rounded-[11px] text-[#8A8A8A] transition hover:bg-[#171717] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                            aria-label="Abrir acoes do estoque"
                            title="Abrir acoes do estoque"
                          >
                            <Pencil className="h-[14px] w-[14px]" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ServerEmptyState
                      icon={<PackageSearch className="h-[24px] w-[24px]" />}
                      title={items.length ? "Nenhuma triagem encontrada" : "Nenhuma triagem cadastrada"}
                      description={
                        items.length
                          ? "Ajuste a busca para encontrar uma triagem cadastrada."
                          : "Clique em Adicionar Estoque para cadastrar a primeira triagem deste produto."
                      }
                    />
                  )}
                </div>
              </ServerSurface>
            )}
          </div>

          <aside className="space-y-[18px]">
            <ServerSurface className="p-[18px] sm:p-[20px]">
              <h4 className="text-[14px] font-semibold text-[#E2E2E2]">Resumo</h4>
              <div className="mt-[14px] grid grid-cols-2 gap-[10px]">
                <div className="rounded-[16px] border border-[#202020] bg-[#0D0D0D] p-[12px]">
                  <ShieldCheck className="h-[16px] w-[16px] text-[#BDBDBD]" />
                  <p className="mt-[10px] text-[20px] font-semibold text-[#F1F1F1]">{availableCount}</p>
                  <p className="mt-[2px] text-[12px] text-[#777]">Disponivel</p>
                </div>
                <div className="rounded-[16px] border border-[#202020] bg-[#0D0D0D] p-[12px]">
                  <Clock3 className="h-[16px] w-[16px] text-[#BDBDBD]" />
                  <p className="mt-[10px] text-[20px] font-semibold text-[#F1F1F1]">{items.length}</p>
                  <p className="mt-[2px] text-[12px] text-[#777]">Registros</p>
                </div>
              </div>
            </ServerSurface>
          </aside>
        </div>
        <StockItemActionsModal
          key={actionItem?.id || "stock-actions-empty"}
          item={actionItem}
          duplicating={Boolean(actionItem && duplicatingItemId === actionItem.id)}
          onClose={() => setActionItem(null)}
          onEdit={startEditItem}
          onDuplicate={(item, count) => void duplicateStockItem(item, count)}
        />
        </>
      )}
    </div>
  );
}
