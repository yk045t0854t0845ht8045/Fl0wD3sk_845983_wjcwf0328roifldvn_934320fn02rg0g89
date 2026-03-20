"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ClientErrorBoundary } from "@/components/common/ClientErrorBoundary";
import { ConfigStepMultiSelect } from "@/components/config/ConfigStepMultiSelect";
import { ConfigStepSelect } from "@/components/config/ConfigStepSelect";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { serversScale } from "@/components/servers/serversScale";
import {
  isValidBrazilDocument,
  normalizeBrazilDocumentDigits,
  resolveBrazilDocumentType,
} from "@/lib/payments/brazilDocument";

type ManagedServerStatus = "paid" | "expired" | "off";
type EditorTab = "settings" | "payments" | "methods" | "plans";
type PaymentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";

type SelectOption = {
  id: string;
  name: string;
};

type PaymentOrder = {
  id: number;
  orderNumber: number;
  guildId: string;
  method: "pix" | "card";
  status: PaymentStatus;
  amount: number;
  currency: string;
  providerStatusDetail: string | null;
  card: {
    brand: string | null;
    firstSix: string | null;
    lastFour: string | null;
    expMonth: number | null;
    expYear: number | null;
  } | null;
  createdAt: string;
};

type SavedMethod = {
  id: string;
  brand: string | null;
  firstSix: string;
  lastFour: string;
  expMonth: number | null;
  expYear: number | null;
  lastUsedAt: string;
  timesUsed: number;
  nickname?: string | null;
};

type PlanSettings = {
  planCode: "pro";
  monthlyAmount: number;
  currency: string;
  recurringEnabled: boolean;
  recurringMethodId: string | null;
  recurringMethod: {
    id: string;
    brand: string | null;
    firstSix: string;
    lastFour: string;
    expMonth: number | null;
    expYear: number | null;
    lastUsedAt: string;
    nickname?: string | null;
  } | null;
  availableMethods?: Array<{
    id: string;
    brand: string | null;
    firstSix: string;
    lastFour: string;
    expMonth: number | null;
    expYear: number | null;
    lastUsedAt: string;
    nickname?: string | null;
  }>;
  availableMethodsCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type PlanApiResponse = {
  ok: boolean;
  message?: string;
  plan?: PlanSettings;
};

type ServerSettingsEditorProps = {
  guildId: string;
  guildName: string;
  status: ManagedServerStatus;
  allServers: Array<{
    guildId: string;
    guildName: string;
    iconUrl: string | null;
  }>;
  initialTab?: EditorTab;
  onTabChange?: (tab: EditorTab) => void;
  onClose: () => void;
  standalone?: boolean;
};

const TAB_INDEX: Record<EditorTab, number> = {
  settings: 0,
  payments: 1,
  methods: 2,
  plans: 3,
};

function normalizeSearch(value: string) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeBrandValue(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function statusBadge(status: ManagedServerStatus) {
  if (status === "paid") return { label: "Pago", cls: "border-[#6AE25A] bg-[rgba(106,226,90,0.2)] text-[#6AE25A]" };
  if (status === "expired") return { label: "Expirado", cls: "border-[#F2C823] bg-[rgba(242,200,35,0.2)] text-[#F2C823]" };
  return { label: "Desligado", cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]" };
}

function orderStatusBadge(status: PaymentStatus) {
  if (status === "approved") return { label: "Pago", cls: "border-[#6AE25A] bg-[rgba(106,226,90,0.2)] text-[#6AE25A]" };
  if (status === "pending") return { label: "Pendente", cls: "border-[#D8D8D8] bg-[rgba(216,216,216,0.12)] text-[#D8D8D8]" };
  if (status === "expired") return { label: "Expirado", cls: "border-[#F2C823] bg-[rgba(242,200,35,0.2)] text-[#F2C823]" };
  if (status === "cancelled") return { label: "Cancelado", cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]" };
  if (status === "rejected") return { label: "Rejeitado", cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]" };
  return { label: "Falhou", cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]" };
}

function cardBrandLabel(brand: string | null | undefined) {
  const normalized = normalizeBrandValue(brand);
  if (normalized === "visa") return "Visa";
  if (normalized === "mastercard") return "Mastercard";
  if (normalized === "amex") return "American Express";
  if (normalized === "elo") return "Elo";
  return typeof brand === "string" && brand.trim()
    ? brand.trim().toUpperCase()
    : "Cartao";
}

function cardBrandIcon(brand: string | null | undefined) {
  const normalized = normalizeBrandValue(brand);
  if (normalized === "visa") return "/cdn/icons/card_visa.svg";
  if (normalized === "mastercard") return "/cdn/icons/card_mastercard.svg";
  if (normalized === "amex") return "/cdn/icons/card_amex.svg";
  if (normalized === "elo") return "/cdn/icons/card_elo.svg";
  return "/cdn/icons/card_.png";
}

function formatDateTime(value: string | null) {
  if (!value) return "--";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(amount);
}

const ELO_PREFIXES = [
  "401178",
  "401179",
  "438935",
  "457631",
  "457632",
  "431274",
  "451416",
  "457393",
  "504175",
  "506699",
  "506770",
  "506771",
  "506772",
  "506773",
  "506774",
  "506775",
  "506776",
  "506777",
  "506778",
  "509000",
  "509999",
  "627780",
  "636297",
  "636368",
  "650031",
  "650033",
  "650035",
  "650051",
  "650405",
  "650439",
  "650485",
  "650538",
  "650541",
  "650598",
  "650700",
  "650718",
  "650720",
  "650727",
  "650901",
  "650920",
  "651652",
  "651679",
  "655000",
  "655019",
];

function normalizeCardDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 19);
}

function detectCardBrand(cardDigits: string) {
  const digits = normalizeCardDigits(cardDigits);
  if (!digits) return null;
  if (ELO_PREFIXES.some((prefix) => digits.startsWith(prefix))) return "elo";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(50|5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^4/.test(digits)) return "visa";
  return null;
}

function cardNumberLengthsForBrand(brand: string | null) {
  switch (brand) {
    case "amex":
      return [15];
    case "mastercard":
    case "elo":
      return [16];
    case "visa":
      return [13, 16, 19];
    default:
      return [13, 14, 15, 16, 17, 18, 19];
  }
}

function isLuhnValid(cardDigits: string) {
  let sum = 0;
  let shouldDouble = false;

  for (let index = cardDigits.length - 1; index >= 0; index -= 1) {
    let digit = Number(cardDigits[index]);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function normalizeCardExpiryDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

function formatCardNumberInput(value: string) {
  const digits = normalizeCardDigits(value);
  const brand = detectCardBrand(digits);

  if (brand === "amex") {
    const g1 = digits.slice(0, 4);
    const g2 = digits.slice(4, 10);
    const g3 = digits.slice(10, 15);
    return [g1, g2, g3].filter(Boolean).join(" ");
  }

  const groups = digits.match(/.{1,4}/g) || [];
  return groups.join(" ");
}

function formatCardExpiryInput(value: string) {
  const digits = normalizeCardExpiryDigits(value);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
}

function normalizeCardCvvInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

function isValidCardExpiry(expiry: string) {
  const digits = normalizeCardExpiryDigits(expiry);
  if (digits.length !== 4) return false;

  const month = Number(digits.slice(0, 2));
  const year = Number(digits.slice(2, 4)) + 2000;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear) return false;
  if (year === currentYear && month < currentMonth) return false;
  return true;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toSafeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function toSafeNullableText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toSafeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function toSafeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toSafePaymentStatus(value: unknown): PaymentStatus {
  if (value === "approved") return "approved";
  if (value === "pending") return "pending";
  if (value === "rejected") return "rejected";
  if (value === "cancelled") return "cancelled";
  if (value === "expired") return "expired";
  return "failed";
}

function sanitizePaymentOrder(input: unknown): PaymentOrder | null {
  const order = asRecord(input);
  if (!order) return null;

  const id = toSafeInteger(order.id);
  const orderNumber = toSafeInteger(order.orderNumber);
  const guildId = toSafeText(order.guildId);
  const method = order.method === "card" ? "card" : order.method === "pix" ? "pix" : null;
  const status = toSafePaymentStatus(order.status);
  const currency = toSafeText(order.currency, "BRL");
  const providerStatusDetail = toSafeNullableText(order.providerStatusDetail);
  const createdAt = toSafeText(order.createdAt);

  if (id === null || orderNumber === null || !guildId || !method || !createdAt) {
    return null;
  }

  const cardRaw = asRecord(order.card);
  const card = cardRaw
    ? {
        brand: toSafeNullableText(cardRaw.brand),
        firstSix: toSafeNullableText(cardRaw.firstSix),
        lastFour: toSafeNullableText(cardRaw.lastFour),
        expMonth: toSafeInteger(cardRaw.expMonth),
        expYear: toSafeInteger(cardRaw.expYear),
      }
    : null;

  return {
    id,
    orderNumber,
    guildId,
    method,
    status,
    amount: toSafeNumber(order.amount),
    currency,
    providerStatusDetail,
    card,
    createdAt,
  };
}

function sanitizeSavedMethod(input: unknown): SavedMethod | null {
  const method = asRecord(input);
  if (!method) return null;

  const id = toSafeText(method.id);
  const firstSix = toSafeText(method.firstSix);
  const lastFour = toSafeText(method.lastFour);
  const lastUsedAt = toSafeText(method.lastUsedAt);
  const timesUsed = toSafeInteger(method.timesUsed);

  if (!id || !/^[a-z0-9:_-]{1,120}$/i.test(id)) return null;
  if (!/^\d{6}$/.test(firstSix) || !/^\d{4}$/.test(lastFour)) return null;
  if (!lastUsedAt) return null;

  return {
    id,
    brand: toSafeNullableText(method.brand),
    firstSix,
    lastFour,
    expMonth: toSafeInteger(method.expMonth),
    expYear: toSafeInteger(method.expYear),
    lastUsedAt,
    timesUsed: timesUsed === null ? 0 : Math.max(0, timesUsed),
    nickname: toSafeNullableText(method.nickname),
  };
}

export function ServerSettingsEditor({
  guildId,
  guildName,
  status,
  allServers,
  initialTab = "settings",
  onTabChange,
  onClose,
  standalone = false,
}: ServerSettingsEditorProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>(initialTab);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [textChannelOptions, setTextChannelOptions] = useState<SelectOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<SelectOption[]>([]);
  const [roleOptions, setRoleOptions] = useState<SelectOption[]>([]);

  const [menuChannelId, setMenuChannelId] = useState<string | null>(null);
  const [ticketsCategoryId, setTicketsCategoryId] = useState<string | null>(null);
  const [logsCreatedChannelId, setLogsCreatedChannelId] = useState<string | null>(null);
  const [logsClosedChannelId, setLogsClosedChannelId] = useState<string | null>(null);

  const [adminRoleId, setAdminRoleId] = useState<string | null>(null);
  const [claimRoleIds, setClaimRoleIds] = useState<string[]>([]);
  const [closeRoleIds, setCloseRoleIds] = useState<string[]>([]);
  const [notifyRoleIds, setNotifyRoleIds] = useState<string[]>([]);

  const [isPaymentsLoading, setIsPaymentsLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [methods, setMethods] = useState<SavedMethod[]>([]);
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [paymentGuildFilter, setPaymentGuildFilter] = useState<string>(guildId);
  const [methodSearch, setMethodSearch] = useState("");
  const [methodStatusFilter, setMethodStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [methodGuildFilter, setMethodGuildFilter] = useState<string>(guildId);
  const [openMethodMenuId, setOpenMethodMenuId] = useState<string | null>(null);
  const [deletingMethodId, setDeletingMethodId] = useState<string | null>(null);
  const [savingMethodNicknameId, setSavingMethodNicknameId] = useState<string | null>(null);
  const [methodNicknameDrafts, setMethodNicknameDrafts] = useState<Record<string, string>>({});
  const [methodActionMessage, setMethodActionMessage] = useState<string | null>(null);
  const [isAddMethodModalOpen, setIsAddMethodModalOpen] = useState(false);
  const [isAddingMethod, setIsAddingMethod] = useState(false);
  const [addMethodError, setAddMethodError] = useState<string | null>(null);
  const [addMethodForm, setAddMethodForm] = useState({
    cardNumber: "",
    holderName: "",
    expiry: "",
    cvv: "",
    document: "",
    nickname: "",
  });

  const [isPlanLoading, setIsPlanLoading] = useState(true);
  const [isPlanSaving, setIsPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const [planSettings, setPlanSettings] = useState<PlanSettings | null>(null);

  const locked = status === "expired" || status === "off";
  const headerStatus = statusBadge(status);

  useEffect(() => {
    setActiveTab(initialTab);
    setPaymentGuildFilter(guildId);
    setPaymentSearch("");
    setPaymentStatusFilter("all");
    setMethodGuildFilter(guildId);
    setMethodSearch("");
    setMethodStatusFilter("all");
    setOpenMethodMenuId(null);
    setDeletingMethodId(null);
    setSavingMethodNicknameId(null);
    setMethodActionMessage(null);
    setIsAddMethodModalOpen(false);
    setIsAddingMethod(false);
    setAddMethodError(null);
    setAddMethodForm({
      cardNumber: "",
      holderName: "",
      expiry: "",
      cvv: "",
      document: "",
      nickname: "",
    });
    setPlanError(null);
    setPlanSuccess(null);
  }, [guildId, initialTab]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!(target instanceof Element)) {
        setOpenMethodMenuId(null);
        return;
      }
      if (!target.closest("[data-method-menu-root='true']")) {
        setOpenMethodMenuId(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMethodMenuId(null);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadSettings() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const [channelsRes, ticketRes, rolesRes, staffRes] = await Promise.all([
          fetch(`/api/auth/me/guilds/channels?guildId=${guildId}`, { cache: "no-store" }),
          fetch(`/api/auth/me/guilds/ticket-settings?guildId=${guildId}`, { cache: "no-store" }),
          fetch(`/api/auth/me/guilds/roles?guildId=${guildId}`, { cache: "no-store" }),
          fetch(`/api/auth/me/guilds/ticket-staff-settings?guildId=${guildId}`, { cache: "no-store" }),
        ]);

        const channels = await channelsRes.json();
        const ticket = await ticketRes.json();
        const roles = await rolesRes.json();
        const staff = await staffRes.json();

        if (!mounted) return;
        if (!channelsRes.ok || !channels.ok || !channels.channels) {
          throw new Error(channels.message || "Falha ao carregar canais.");
        }
        if (!rolesRes.ok || !roles.ok || !roles.roles) {
          throw new Error(roles.message || "Falha ao carregar cargos.");
        }

        const text = channels.channels.text.map((c: { id: string; name: string }) => ({ id: c.id, name: `# ${c.name}` }));
        const cats = channels.channels.categories.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }));
        const roleList = roles.roles as SelectOption[];
        setTextChannelOptions(text);
        setCategoryOptions(cats);
        setRoleOptions(roleList);

        const textSet = new Set(text.map((item: SelectOption) => item.id));
        const catSet = new Set(cats.map((item: SelectOption) => item.id));
        const roleSet = new Set(roleList.map((item: SelectOption) => item.id));

        const ticketSettings = ticketRes.ok && ticket.ok ? ticket.settings : null;
        const staffSettings = staffRes.ok && staff.ok ? staff.settings : null;

        setMenuChannelId(ticketSettings?.menuChannelId && textSet.has(ticketSettings.menuChannelId) ? ticketSettings.menuChannelId : null);
        setTicketsCategoryId(ticketSettings?.ticketsCategoryId && catSet.has(ticketSettings.ticketsCategoryId) ? ticketSettings.ticketsCategoryId : null);
        setLogsCreatedChannelId(ticketSettings?.logsCreatedChannelId && textSet.has(ticketSettings.logsCreatedChannelId) ? ticketSettings.logsCreatedChannelId : null);
        setLogsClosedChannelId(ticketSettings?.logsClosedChannelId && textSet.has(ticketSettings.logsClosedChannelId) ? ticketSettings.logsClosedChannelId : null);

        setAdminRoleId(staffSettings?.adminRoleId && roleSet.has(staffSettings.adminRoleId) ? staffSettings.adminRoleId : null);
        setClaimRoleIds(Array.isArray(staffSettings?.claimRoleIds) ? staffSettings.claimRoleIds.filter((id: string) => roleSet.has(id)) : []);
        setCloseRoleIds(Array.isArray(staffSettings?.closeRoleIds) ? staffSettings.closeRoleIds.filter((id: string) => roleSet.has(id)) : []);
        setNotifyRoleIds(Array.isArray(staffSettings?.notifyRoleIds) ? staffSettings.notifyRoleIds.filter((id: string) => roleSet.has(id)) : []);
      } catch (error) {
        if (!mounted) return;
        setErrorMessage(error instanceof Error ? error.message : "Erro ao carregar configuracoes.");
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    void loadSettings();
    return () => {
      mounted = false;
    };
  }, [guildId]);

  useEffect(() => {
    setMethodNicknameDrafts((current) => {
      const next: Record<string, string> = {};
      for (const method of methods) {
        next[method.id] = current[method.id] ?? method.nickname ?? "";
      }
      return next;
    });
  }, [methods]);

  useEffect(() => {
    let mounted = true;
    async function loadPayments() {
      setIsPaymentsLoading(true);
      setPaymentsError(null);
      try {
        const response = await fetch("/api/auth/me/payments/history", { cache: "no-store" });
        const payload = await response.json();
        if (!mounted) return;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Falha ao carregar pagamentos.");
        }
        const safeOrders = Array.isArray(payload.orders)
          ? payload.orders
              .map((order: unknown) => sanitizePaymentOrder(order))
              .filter((order: PaymentOrder | null): order is PaymentOrder => Boolean(order))
          : [];
        const safeMethods = Array.isArray(payload.methods)
          ? payload.methods
              .map((method: unknown) => sanitizeSavedMethod(method))
              .filter((method: SavedMethod | null): method is SavedMethod => Boolean(method))
          : [];

        setOrders(safeOrders);
        setMethods(safeMethods);
      } catch (error) {
        if (!mounted) return;
        setPaymentsError(error instanceof Error ? error.message : "Erro ao carregar pagamentos.");
      } finally {
        if (mounted) setIsPaymentsLoading(false);
      }
    }
    void loadPayments();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadPlan() {
      setIsPlanLoading(true);
      setPlanError(null);
      try {
        const response = await fetch(
          `/api/auth/me/servers/plans?guildId=${guildId}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as PlanApiResponse;

        if (!mounted) return;

        if (!response.ok || !payload.ok || !payload.plan) {
          throw new Error(payload.message || "Falha ao carregar plano do servidor.");
        }

        setPlanSettings(payload.plan);
      } catch (error) {
        if (!mounted) return;
        setPlanSettings(null);
        setPlanError(
          error instanceof Error ? error.message : "Erro ao carregar plano.",
        );
      } finally {
        if (mounted) setIsPlanLoading(false);
      }
    }

    void loadPlan();

    return () => {
      mounted = false;
    };
  }, [guildId]);

  const serverMap = useMemo(() => {
    const map = new Map<string, { guildName: string; iconUrl: string | null }>();
    for (const server of allServers) {
      map.set(server.guildId, { guildName: server.guildName, iconUrl: server.iconUrl });
    }
    if (!map.has(guildId)) {
      map.set(guildId, { guildName, iconUrl: null });
    }
    return map;
  }, [allServers, guildId, guildName]);

  const serverOptions = useMemo(() => {
    const options = Array.from(serverMap.entries()).map(([id, info]) => ({ id, name: info.guildName }));
    options.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return [{ id: "all", name: "Todos servidores" }, ...options];
  }, [serverMap]);

  const filteredOrders = useMemo(() => {
    const search = normalizeSearch(paymentSearch);
    return orders.filter((order) => {
      if (paymentStatusFilter !== "all" && order.status !== paymentStatusFilter) return false;
      if (paymentGuildFilter !== "all" && order.guildId !== paymentGuildFilter) return false;
      if (!search) return true;
      const guildLabel = serverMap.get(order.guildId)?.guildName || order.guildId;
      const text = normalizeSearch(`${order.orderNumber} ${order.guildId} ${guildLabel} ${order.method} ${order.status}`);
      return text.includes(search);
    });
  }, [orders, paymentGuildFilter, paymentSearch, paymentStatusFilter, serverMap]);

  const cardOrdersByMethod = useMemo(() => {
    const map = new Map<string, PaymentOrder[]>();
    for (const order of orders) {
      if (order.method !== "card" || !order.card?.firstSix || !order.card?.lastFour) continue;
      const methodKey = [
        (order.card.brand || "card").toLowerCase(),
        order.card.firstSix,
        order.card.lastFour,
        order.card.expMonth ?? "",
        order.card.expYear ?? "",
      ].join(":");

      const current = map.get(methodKey) || [];
      current.push(order);
      map.set(methodKey, current);
    }
    return map;
  }, [orders]);

  const filteredMethods = useMemo(() => {
    const search = normalizeSearch(methodSearch);

    return methods.filter((method) => {
      const relatedOrders = cardOrdersByMethod.get(method.id) || [];

      if (methodStatusFilter !== "all") {
        const matchesStatus = relatedOrders.some((order) => order.status === methodStatusFilter);
        if (!matchesStatus) return false;
      }

      if (methodGuildFilter !== "all") {
        const matchesGuild = relatedOrders.some((order) => order.guildId === methodGuildFilter);
        if (!matchesGuild) return false;
      }

      if (!search) return true;

      const brandLabel = cardBrandLabel(method.brand);
      const masked = `${method.firstSix} ${method.lastFour}`;
      const nickname = (method.nickname || "").trim();
      const relatedServerNames = relatedOrders
        .map((order) => serverMap.get(order.guildId)?.guildName || order.guildId)
        .join(" ");
      const relatedStatuses = relatedOrders.map((order) => order.status).join(" ");
      const haystack = normalizeSearch(`${brandLabel} ${nickname} ${masked} ${relatedServerNames} ${relatedStatuses}`);
      return haystack.includes(search);
    });
  }, [
    cardOrdersByMethod,
    methodGuildFilter,
    methodSearch,
    methodStatusFilter,
    methods,
    serverMap,
  ]);

  const methodById = useMemo(
    () => new Map(methods.map((method) => [method.id, method])),
    [methods],
  );

  const recurringMethod = useMemo(() => {
    if (!planSettings?.recurringMethodId) return null;
    return (
      methodById.get(planSettings.recurringMethodId) ||
      planSettings.recurringMethod ||
      null
    );
  }, [methodById, planSettings]);

  const recurringMethodOptions = useMemo(() => {
    const fromPlan = planSettings?.availableMethods || [];
    if (fromPlan.length) return fromPlan;
    return methods;
  }, [methods, planSettings?.availableMethods]);

  const addMethodCardDigits = useMemo(
    () => normalizeCardDigits(addMethodForm.cardNumber),
    [addMethodForm.cardNumber],
  );

  const addMethodCardBrand = useMemo(
    () => detectCardBrand(addMethodCardDigits),
    [addMethodCardDigits],
  );

  const addMethodExpiryDigits = useMemo(
    () => normalizeCardExpiryDigits(addMethodForm.expiry),
    [addMethodForm.expiry],
  );

  const addMethodCvvDigits = useMemo(
    () => normalizeCardCvvInput(addMethodForm.cvv),
    [addMethodForm.cvv],
  );

  const addMethodBrandIconPath = useMemo(
    () => cardBrandIcon(addMethodCardBrand),
    [addMethodCardBrand],
  );
  const addMethodBrandIconSafePath = useMemo(
    () =>
      typeof addMethodBrandIconPath === "string" &&
      addMethodBrandIconPath.startsWith("/")
        ? addMethodBrandIconPath
        : "/cdn/icons/card_.png",
    [addMethodBrandIconPath],
  );

  const addMethodDocumentDigits = useMemo(
    () => normalizeBrazilDocumentDigits(addMethodForm.document),
    [addMethodForm.document],
  );

  const addMethodCanSubmit = useMemo(() => {
    const holderName = addMethodForm.holderName.trim().replace(/\s+/g, " ");
    const nickname = addMethodForm.nickname.trim().replace(/\s+/g, " ");
    const docType = resolveBrazilDocumentType(addMethodDocumentDigits);
    const expectedCvvLength = addMethodCardBrand === "amex" ? 4 : 3;
    const cardLengthValid = cardNumberLengthsForBrand(addMethodCardBrand).includes(addMethodCardDigits.length);

    return Boolean(
      addMethodCardBrand &&
        cardLengthValid &&
        isLuhnValid(addMethodCardDigits) &&
        holderName.length >= 2 &&
        isValidCardExpiry(addMethodForm.expiry) &&
        addMethodCvvDigits.length === expectedCvvLength &&
        docType &&
        isValidBrazilDocument(addMethodDocumentDigits) &&
        nickname.length <= 42,
    );
  }, [
    addMethodCardBrand,
    addMethodCardDigits,
    addMethodCvvDigits.length,
    addMethodDocumentDigits,
    addMethodForm.expiry,
    addMethodForm.holderName,
    addMethodForm.nickname,
  ]);

  const serverSettingsControlHeight = 60;

  const canSave = Boolean(
    !locked &&
      !isLoading &&
      !isSaving &&
      menuChannelId &&
      ticketsCategoryId &&
      logsCreatedChannelId &&
      logsClosedChannelId &&
      adminRoleId &&
      claimRoleIds.length &&
      closeRoleIds.length &&
      notifyRoleIds.length,
  );

  const handleToggleRecurring = useCallback(async () => {
    if (!planSettings || isPlanSaving || locked) return;

    const nextRecurringEnabled = !planSettings.recurringEnabled;
    const fallbackMethodId =
      planSettings.recurringMethodId || recurringMethodOptions[0]?.id || null;

    setIsPlanSaving(true);
    setPlanError(null);
    setPlanSuccess(null);

    try {
      const response = await fetch("/api/auth/me/servers/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          recurringEnabled: nextRecurringEnabled,
          recurringMethodId: nextRecurringEnabled ? fallbackMethodId : null,
        }),
      });
      const payload = (await response.json()) as PlanApiResponse;

      if (!response.ok || !payload.ok || !payload.plan) {
        throw new Error(payload.message || "Falha ao atualizar recorrencia.");
      }

      setPlanSettings(payload.plan);
      setPlanSuccess(
        nextRecurringEnabled
          ? "Cobranca recorrente ativada com sucesso."
          : "Cobranca recorrente desativada com sucesso.",
      );
    } catch (error) {
      setPlanError(
        error instanceof Error
          ? error.message
          : "Erro ao atualizar recorrencia.",
      );
    } finally {
      setIsPlanSaving(false);
    }
  }, [guildId, isPlanSaving, locked, planSettings, recurringMethodOptions]);

  const handleRenewByPix = useCallback(() => {
    const params = new URLSearchParams({
      guild: guildId,
      method: "pix",
      renew: "1",
      return: "servers",
      returnGuild: guildId,
      returnTab: "plans",
    });

    window.location.assign(`/config?${params.toString()}#/payment`);
  }, [guildId]);

  const handleDeleteMethod = useCallback(
    async (methodId: string) => {
      if (deletingMethodId) return;

      setDeletingMethodId(methodId);
      setMethodActionMessage(null);
      setOpenMethodMenuId(null);
      setPaymentsError(null);

      try {
        const response = await fetch("/api/auth/me/payments/methods", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            methodId,
          }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          message?: string;
        };

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Falha ao remover metodo.");
        }

        setMethods((current) => current.filter((method) => method.id !== methodId));
        setMethodActionMessage("Metodo removido com sucesso.");
        setMethodNicknameDrafts((current) => {
          const next = { ...current };
          delete next[methodId];
          return next;
        });
        setPlanSettings((current) =>
          current
            ? {
                ...current,
                availableMethods: (current.availableMethods || []).filter(
                  (method) => method.id !== methodId,
                ),
              }
            : current,
        );

        if (planSettings?.recurringMethodId === methodId) {
          setPlanSettings((current) =>
            current
              ? {
                  ...current,
                  recurringMethodId: null,
                  recurringMethod: null,
                }
              : current,
          );
        }
      } catch (error) {
        setPaymentsError(
          error instanceof Error
            ? error.message
            : "Erro ao remover metodo de pagamento.",
        );
      } finally {
        setDeletingMethodId(null);
      }
    },
    [deletingMethodId, guildId, planSettings?.recurringMethodId],
  );

  const handleSaveMethodNickname = useCallback(
    async (methodId: string) => {
      if (savingMethodNicknameId) return;

      const nickname = (methodNicknameDrafts[methodId] || "").trim();
      setSavingMethodNicknameId(methodId);
      setPaymentsError(null);
      setMethodActionMessage(null);

      try {
        const response = await fetch("/api/auth/me/payments/methods", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            methodId,
            nickname,
          }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          message?: string;
          method?: SavedMethod;
        };

        if (!response.ok || !payload.ok || !payload.method) {
          throw new Error(payload.message || "Falha ao salvar apelido.");
        }

        setMethods((current) =>
          current.map((method) =>
            method.id === methodId ? { ...method, nickname: payload.method?.nickname || null } : method,
          ),
        );
        setPlanSettings((current) =>
          current
            ? {
                ...current,
                recurringMethod:
                  current.recurringMethodId === methodId && current.recurringMethod
                    ? {
                        ...current.recurringMethod,
                        nickname: payload.method?.nickname || null,
                      }
                    : current.recurringMethod,
                availableMethods: (current.availableMethods || []).map((method) =>
                  method.id === methodId
                    ? {
                        ...method,
                        nickname: payload.method?.nickname || null,
                      }
                    : method,
                ),
              }
            : current,
        );
        setMethodActionMessage("Apelido salvo com sucesso.");
      } catch (error) {
        setPaymentsError(
          error instanceof Error
            ? error.message
            : "Erro ao salvar apelido do cartao.",
        );
      } finally {
        setSavingMethodNicknameId(null);
      }
    },
    [guildId, methodNicknameDrafts, savingMethodNicknameId],
  );

  const handleAddMethodSubmit = useCallback(async () => {
    if (!addMethodCanSubmit || isAddingMethod) return;

    setIsAddingMethod(true);
    setAddMethodError(null);
    setMethodActionMessage(null);
    setPaymentsError(null);

    try {
      const expMonth = Number(addMethodExpiryDigits.slice(0, 2));
      const expYear = Number(addMethodExpiryDigits.slice(2, 4)) + 2000;
      const nickname = addMethodForm.nickname.trim().replace(/\s+/g, " ");

      const response = await fetch("/api/auth/me/payments/methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          brand: addMethodCardBrand,
          firstSix: addMethodCardDigits.slice(0, 6),
          lastFour: addMethodCardDigits.slice(-4),
          expMonth: Number.isInteger(expMonth) ? expMonth : null,
          expYear: Number.isInteger(expYear) ? expYear : null,
          nickname,
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        method?: SavedMethod;
      };

      if (!response.ok || !payload.ok || !payload.method) {
        throw new Error(payload.message || "Falha ao adicionar metodo.");
      }

      const addedMethod = payload.method;

      setMethods((current) => {
        const methodExists = current.some((method) => method.id === addedMethod.id);
        if (methodExists) {
          return current.map((method) =>
            method.id === addedMethod.id ? { ...method, ...addedMethod } : method,
          );
        }
        return [addedMethod as SavedMethod, ...current];
      });

      setMethodNicknameDrafts((current) => ({
        ...current,
        [addedMethod.id]: addedMethod.nickname || "",
      }));
      setPlanSettings((current) => {
        if (!current) return current;
        const currentMethods = current.availableMethods || [];
        const exists = currentMethods.some((method) => method.id === addedMethod.id);
        const nextMethods = exists
          ? currentMethods.map((method) =>
              method.id === addedMethod.id
                ? {
                    ...method,
                    ...addedMethod,
                  }
                : method,
            )
          : [
              {
                id: addedMethod.id,
                brand: addedMethod.brand,
                firstSix: addedMethod.firstSix,
                lastFour: addedMethod.lastFour,
                expMonth: addedMethod.expMonth,
                expYear: addedMethod.expYear,
                lastUsedAt: addedMethod.lastUsedAt,
                nickname: addedMethod.nickname || null,
              },
              ...currentMethods,
            ];

        return {
          ...current,
          availableMethods: nextMethods,
          availableMethodsCount: nextMethods.length,
        };
      });

      setAddMethodForm({
        cardNumber: "",
        holderName: "",
        expiry: "",
        cvv: "",
        document: "",
        nickname: "",
      });
      setIsAddMethodModalOpen(false);
      setMethodActionMessage("Metodo adicionado com sucesso.");
    } catch (error) {
      setAddMethodError(
        error instanceof Error ? error.message : "Erro ao adicionar metodo de pagamento.",
      );
    } finally {
      setIsAddingMethod(false);
    }
  }, [
    addMethodCanSubmit,
    addMethodCardBrand,
    addMethodCardDigits,
    addMethodExpiryDigits,
    addMethodForm.nickname,
    guildId,
    isAddingMethod,
  ]);

  const handleSelectRecurringMethod = useCallback(
    async (methodId: string) => {
      if (!planSettings || isPlanSaving || locked) return;
      if (!methodId) return;

      setIsPlanSaving(true);
      setPlanError(null);
      setPlanSuccess(null);

      try {
        const response = await fetch("/api/auth/me/servers/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            recurringEnabled: planSettings.recurringEnabled,
            recurringMethodId: methodId,
          }),
        });
        const payload = (await response.json()) as PlanApiResponse;

        if (!response.ok || !payload.ok || !payload.plan) {
          throw new Error(payload.message || "Falha ao definir cartao da recorrencia.");
        }

        setPlanSettings(payload.plan);
        setPlanSuccess("Cartao da recorrencia atualizado com sucesso.");
      } catch (error) {
        setPlanError(
          error instanceof Error
            ? error.message
            : "Erro ao definir cartao da recorrencia.",
        );
      } finally {
        setIsPlanSaving(false);
      }
    },
    [guildId, isPlanSaving, locked, planSettings],
  );

  const handleSave = useCallback(async () => {
    if (!canSave || !adminRoleId) return;
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const [ticketRes, staffRes] = await Promise.all([
        fetch("/api/auth/me/guilds/ticket-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            menuChannelId,
            ticketsCategoryId,
            logsCreatedChannelId,
            logsClosedChannelId,
          }),
        }),
        fetch("/api/auth/me/guilds/ticket-staff-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            adminRoleId,
            claimRoleIds,
            closeRoleIds,
            notifyRoleIds,
          }),
        }),
      ]);

      const ticket = await ticketRes.json();
      const staff = await staffRes.json();
      if (!ticketRes.ok || !ticket.ok) throw new Error(ticket.message || "Falha ao salvar canais.");
      if (!staffRes.ok || !staff.ok) throw new Error(staff.message || "Falha ao salvar staff.");
      setSuccessMessage("Configuracoes salvas com sucesso.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao salvar configuracoes.");
    } finally {
      setIsSaving(false);
    }
  }, [
    adminRoleId,
    canSave,
    claimRoleIds,
    closeRoleIds,
    guildId,
    logsClosedChannelId,
    logsCreatedChannelId,
    menuChannelId,
    notifyRoleIds,
    ticketsCategoryId,
  ]);

  return (
    <ClientErrorBoundary
      fallback={
        <section
          className="flowdesk-fade-up-soft border border-[#2E2E2E] bg-[#0A0A0A]"
          style={{
            marginTop: standalone ? "0px" : `${serversScale.cardsTopSpacing}px`,
            borderRadius: `${serversScale.cardRadius}px`,
            padding: `${Math.max(16, serversScale.cardPadding + 4)}px`,
          }}
        >
          <div className="flex min-h-[220px] items-center justify-center text-center">
            <div>
              <p className="text-[16px] text-[#D8D8D8]">
                Nao foi possivel carregar as configuracoes deste servidor.
              </p>
              <p className="mt-2 text-[12px] text-[#8E8E8E]">
                Atualize a pagina para tentar novamente.
              </p>
            </div>
          </div>
        </section>
      }
    >
      <section
        className="flowdesk-fade-up-soft border border-[#2E2E2E] bg-[#0A0A0A]"
        style={{
          marginTop: standalone ? "0px" : `${serversScale.cardsTopSpacing}px`,
          borderRadius: `${serversScale.cardRadius}px`,
          padding: `${Math.max(16, serversScale.cardPadding + 4)}px`,
        }}
      >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-[#777777]">Configuracoes do servidor</p>
          <h2 className="truncate text-[18px] font-medium text-[#D8D8D8]">{guildName}</h2>
        </div>

        <div className="flex items-center gap-2">
          <span className={`inline-flex h-[22px] items-center justify-center rounded-[3px] border px-3 text-[11px] ${headerStatus.cls}`}>
            {headerStatus.label}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-[32px] rounded-[3px] border border-[#2E2E2E] bg-[#111111] px-3 text-[12px] text-[#D8D8D8] transition-colors hover:bg-[#171717]"
          >
            Fechar
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 border-b border-[#242424] pb-3">
        {([
          ["settings", "Configurações"],
          ["payments", "Histórico de Cobrança"],
          ["methods", "Métodos"],
          ["plans", "Planos"],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setActiveTab(tab);
              onTabChange?.(tab);
            }}
            className={`rounded-[3px] border px-3 py-[7px] text-[12px] transition-colors ${
              activeTab === tab
                ? "border-[#D8D8D8] bg-[#D8D8D8] text-black"
                : "border-[#2E2E2E] bg-[#0A0A0A] text-[#D8D8D8] hover:bg-[#121212]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden">
        <div
          className="flex w-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${TAB_INDEX[activeTab] * 100}%)` }}
        >
          <div className="w-full shrink-0">
            {isLoading ? (
              <div className="flex h-[180px] items-center justify-center">
                <ButtonLoader size={28} />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2">
                  <div className="flex flex-col gap-4">
                    <ConfigStepSelect label="Canal do menu principal de tickets" placeholder="Escolha o canal" options={textChannelOptions} value={menuChannelId} onChange={setMenuChannelId} disabled={isSaving || locked} controlHeightPx={serverSettingsControlHeight} />
                    <ConfigStepSelect label="Categoria onde os tickets serao abertos" placeholder="Escolha uma categoria" options={categoryOptions} value={ticketsCategoryId} onChange={setTicketsCategoryId} disabled={isSaving || locked} controlHeightPx={serverSettingsControlHeight} />
                    <ConfigStepSelect label="Canal de logs de criacao" placeholder="Escolha o canal de logs" options={textChannelOptions} value={logsCreatedChannelId} onChange={setLogsCreatedChannelId} disabled={isSaving || locked} controlHeightPx={serverSettingsControlHeight} />
                    <ConfigStepSelect label="Canal de logs de fechamento" placeholder="Escolha o canal de logs" options={textChannelOptions} value={logsClosedChannelId} onChange={setLogsClosedChannelId} disabled={isSaving || locked} controlHeightPx={serverSettingsControlHeight} />
                  </div>

                  <div className="flex flex-col gap-4">
                    <ConfigStepSelect label="Cargo administrador do ticket" placeholder="Escolha o cargo" options={roleOptions} value={adminRoleId} onChange={setAdminRoleId} disabled={isSaving || locked} controlHeightPx={serverSettingsControlHeight} />
                    <ConfigStepMultiSelect label="Cargos que podem assumir tickets" placeholder="Escolha os cargos" options={roleOptions} values={claimRoleIds} onChange={setClaimRoleIds} disabled={isSaving || locked} controlHeightPx={serverSettingsControlHeight} />
                    <ConfigStepMultiSelect label="Cargos que podem fechar tickets" placeholder="Escolha os cargos" options={roleOptions} values={closeRoleIds} onChange={setCloseRoleIds} disabled={isSaving || locked} controlHeightPx={serverSettingsControlHeight} />
                    <ConfigStepMultiSelect label="Cargos que podem enviar notificacao" placeholder="Escolha os cargos" options={roleOptions} values={notifyRoleIds} onChange={setNotifyRoleIds} disabled={isSaving || locked} controlHeightPx={serverSettingsControlHeight} />
                  </div>
                </div>

                {locked ? (
                  <p className="mt-2 text-[11px] text-[#C2C2C2]">
                    Plano expirado/desligado. Renove para liberar alteracoes.
                  </p>
                ) : null}

                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleSave();
                    }}
                    disabled={!canSave}
                    className="flex h-[42px] w-full items-center justify-center rounded-[3px] bg-[#D8D8D8] text-[13px] font-medium text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isSaving ? <ButtonLoader size={22} /> : "Salvar configuracoes"}
                  </button>
                  {errorMessage ? <p className="text-[11px] text-[#C2C2C2]">{errorMessage}</p> : null}
                  {successMessage ? <p className="text-[11px] text-[#9BD694]">{successMessage}</p> : null}
                </div>
              </>
            )}
          </div>

          <div className="w-full shrink-0 pl-0 min-[860px]:pl-[8px]">
            <div className="grid grid-cols-1 gap-3 min-[980px]:grid-cols-[1fr_auto_auto]">
              <input
                type="text"
                value={paymentSearch}
                onChange={(event) => setPaymentSearch(event.currentTarget.value)}
                placeholder="Pesquisar pagamento por ID, servidor ou metodo"
                className="h-[52px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[15px] text-[#D8D8D8] placeholder:text-[#3A3A3A] outline-none"
              />
              <select value={paymentGuildFilter} onChange={(event) => setPaymentGuildFilter(event.currentTarget.value)} className="h-[52px] min-w-[238px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[15px] text-[#D8D8D8] outline-none">
                {serverOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.currentTarget.value as "all" | PaymentStatus)} className="h-[52px] min-w-[213px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[15px] text-[#D8D8D8] outline-none">
                <option value="all">Todos status</option>
                <option value="approved">Pago</option>
                <option value="pending">Pendente</option>
                <option value="expired">Expirado</option>
                <option value="cancelled">Cancelado</option>
                <option value="rejected">Rejeitado</option>
                <option value="failed">Falhou</option>
              </select>
            </div>

            <div className="mt-4 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A]">
              {isPaymentsLoading ? (
                <div className="flex h-[275px] items-center justify-center">
                  <ButtonLoader size={28} />
                </div>
              ) : paymentsError ? (
                <p className="px-4 py-8 text-center text-[15px] text-[#C2C2C2]">{paymentsError}</p>
              ) : filteredOrders.length ? (
                <div className="max-h-[575px] overflow-y-auto thin-scrollbar">
                  {filteredOrders.map((order) => {
                    const badge = orderStatusBadge(order.status);
                    const methodIcon = order.method === "pix" ? "/cdn/icons/pix_.png" : cardBrandIcon(order.card?.brand || null);
                    const serverName = serverMap.get(order.guildId)?.guildName || order.guildId;
                    return (
                      <div key={order.id} className="flex items-start justify-between gap-3 border-b border-[#1C1C1C] px-4 py-3 last:border-b-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <span className="relative block h-[38px] w-[38px] shrink-0 overflow-hidden rounded-[3px] bg-[#111111]">
                              <Image src={methodIcon} alt="Metodo" fill sizes="30px" className="object-contain" unoptimized />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[15px] text-[#D8D8D8]">Pagamento #{order.orderNumber}</p>
                              <p className="truncate text-[14px] text-[#777777]">{serverName}</p>
                            </div>
                          </div>
                          {order.providerStatusDetail ? (
                            <p className="mt-2 truncate text-[12px] text-[#686868]">{order.providerStatusDetail}</p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right">
                          <span className={`inline-flex rounded-[3px] border px-[10px] py-[4px] text-[12px] ${badge.cls}`}>{badge.label}</span>
                          <p className="mt-1 text-[12px] text-[#777777]">{formatDateTime(order.createdAt)}</p>
                          <p className="mt-1 text-[14px] text-[#D8D8D8]">{formatAmount(order.amount, order.currency)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-[15px] text-[#C2C2C2]">Nenhum pagamento encontrado para esse filtro.</p>
              )}
            </div>
          </div>

          <div className="w-full shrink-0 pl-0 min-[860px]:pl-[8px]">
            <div className="grid grid-cols-1 gap-3 min-[980px]:grid-cols-[1fr_auto_auto]">
              <input
                type="text"
                value={methodSearch}
                onChange={(event) => setMethodSearch(event.currentTarget.value)}
                placeholder="Pesquisar metodo por bandeira, final ou servidor"
                className="h-[52px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[15px] text-[#D8D8D8] placeholder:text-[#3A3A3A] outline-none"
              />
              <select
                value={methodGuildFilter}
                onChange={(event) => setMethodGuildFilter(event.currentTarget.value)}
                className="h-[52px] min-w-[238px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[15px] text-[#D8D8D8] outline-none"
              >
                {serverOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <select
                value={methodStatusFilter}
                onChange={(event) => setMethodStatusFilter(event.currentTarget.value as "all" | PaymentStatus)}
                className="h-[52px] min-w-[213px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[15px] text-[#D8D8D8] outline-none"
              >
                <option value="all">Todos status</option>
                <option value="approved">Pago</option>
                <option value="pending">Pendente</option>
                <option value="expired">Expirado</option>
                <option value="cancelled">Cancelado</option>
                <option value="rejected">Rejeitado</option>
                <option value="failed">Falhou</option>
              </select>
            </div>

            <div className="mt-4">
              {isPaymentsLoading ? (
                <div className="flex h-[275px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A]">
                  <ButtonLoader size={28} />
                </div>
              ) : filteredMethods.length ? (
                <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-2">
                  {filteredMethods.map((method) => {
                    const brandLabel = cardBrandLabel(method.brand);
                    const masked = `${method.firstSix} ****** ${method.lastFour}`;
                    const isDeleting = deletingMethodId === method.id;
                    return (
                      <article key={method.id} className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="relative block h-[40px] w-[40px] shrink-0 overflow-hidden rounded-[3px] bg-[#111111]">
                              <Image src={cardBrandIcon(method.brand)} alt={brandLabel} fill sizes="32px" className="object-contain" unoptimized />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[15px] text-[#D8D8D8]">{method.nickname?.trim() || brandLabel}</p>
                              <p className="truncate text-[14px] text-[#777777]">{masked}</p>
                            </div>
                          </div>

                          <div className="relative" data-method-menu-root="true">
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => {
                                setOpenMethodMenuId((current) =>
                                  current === method.id ? null : method.id,
                                );
                              }}
                              className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[2px] text-[18px] leading-none text-[#4A4A4A] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-[#7A7A7A] disabled:cursor-not-allowed disabled:opacity-45"
                              aria-label="Abrir menu do metodo"
                            >
                              ...
                            </button>

                            {openMethodMenuId === method.id ? (
                              <div className="flowdesk-scale-in-soft absolute right-0 top-[30px] z-20 min-w-[122px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] py-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleDeleteMethod(method.id);
                                  }}
                                  className="block w-full px-3 py-2 text-left text-[12px] text-[#DB4646] transition-colors hover:bg-[#121212]"
                                >
                                  {isDeleting ? "Removendo..." : "Deletar"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
                          <div>
                            <p className="mb-1 text-[11px] text-[#686868]">Apelido do cartao</p>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={methodNicknameDrafts[method.id] ?? ""}
                                onChange={(event) => {
                                  const nextValue = event.currentTarget.value.slice(0, 42);
                                  setMethodNicknameDrafts((current) => ({
                                    ...current,
                                    [method.id]: nextValue,
                                  }));
                                }}
                                placeholder="Ex: Cartao principal"
                                className="h-[33px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-2 text-[12px] text-[#D8D8D8] placeholder:text-[#3A3A3A] outline-none"
                              />
                              <button
                                type="button"
                                disabled={savingMethodNicknameId === method.id}
                                onClick={() => {
                                  void handleSaveMethodNickname(method.id);
                                }}
                                className="inline-flex h-[33px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#121212] px-3 text-[11px] text-[#D8D8D8] transition-colors hover:bg-[#1A1A1A] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {savingMethodNicknameId === method.id ? (
                                  <ButtonLoader size={14} colorClassName="text-[#D8D8D8]" />
                                ) : (
                                  "Salvar"
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col items-end justify-between text-[12px] text-[#777777]">
                            <span>{method.timesUsed} uso(s)</span>
                            <span className="mt-1">
                              Validade:{" "}
                              {method.expMonth && method.expYear
                                ? `${String(method.expMonth).padStart(2, "0")}/${String(method.expYear).slice(-2)}`
                                : "--/--"}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between text-[11px] text-[#686868]">
                          <span>
                            Bandeira: {brandLabel}
                          </span>
                          <span>Metodo: {method.id}</span>
                        </div>

                        <div className="mt-3 flex items-center justify-between text-[12px] text-[#777777]">
                          <span>
                            Ultimo uso: {formatDateTime(method.lastUsedAt)}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-8 text-center text-[15px] text-[#C2C2C2]">
                  Nenhum metodo encontrado para esse filtro.
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setAddMethodError(null);
                  setIsAddMethodModalOpen(true);
                }}
                className="mt-3 flex h-[46px] w-full items-center justify-center rounded-[3px] bg-[#D8D8D8] text-[13px] font-medium text-black transition-opacity hover:opacity-90"
              >
                ADICIONAR NOVO METODO
              </button>

              {methodActionMessage ? (
                <p className="mt-2 text-[11px] text-[#9BD694]">{methodActionMessage}</p>
              ) : null}
              {paymentsError ? (
                <p className="mt-2 text-[11px] text-[#C2C2C2]">{paymentsError}</p>
              ) : null}
            </div>
          </div>

          <div className="w-full shrink-0 pl-0 min-[860px]:pl-[8px]">
            {isPlanLoading ? (
              <div className="flex h-[275px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A]">
                <ButtonLoader size={28} />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {status !== "paid" ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-3 py-3">
                    <div className="min-w-0">
                      <p className="text-[14px] text-[#F2C823]">
                        {status === "expired"
                          ? "Plano expirado neste servidor"
                          : "Plano desligado neste servidor"}
                      </p>
                      <p className="mt-1 text-[11px] text-[#D6C68A]">
                        Renove agora para reativar o Flowdesk com mais 30 dias de licenca.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleRenewByPix}
                      className="inline-flex h-[34px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#D8D8D8] px-4 text-[12px] font-medium text-black transition-opacity hover:opacity-90"
                    >
                      RENOVAR
                    </button>
                  </div>
                ) : null}

                <div className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[16px] font-medium text-[#D8D8D8]">Plano Pro</p>
                      <p className="text-[12px] text-[#8E8E8E]">
                        Licenca padrao do servidor por 30 dias
                      </p>
                    </div>
                    <span className="inline-flex h-[23px] items-center justify-center rounded-[3px] border border-[#6AE25A] bg-[rgba(106,226,90,0.2)] px-3 text-[11px] text-[#6AE25A]">
                      R$ 9,99 / mes
                    </span>
                  </div>

                  <div className="mt-4 rounded-[3px] border border-[#2E2E2E] bg-[#090909] px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[14px] text-[#D8D8D8]">Cobranca recorrente</p>
                        <p className="mt-1 text-[11px] text-[#8E8E8E]">
                          Ative para renovar automaticamente a cada 30 dias.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          void handleToggleRecurring();
                        }}
                        disabled={locked || isPlanSaving || !planSettings}
                        className={`inline-flex h-[31px] min-w-[92px] items-center justify-center rounded-[3px] border px-3 text-[12px] transition-opacity disabled:cursor-not-allowed disabled:opacity-45 ${
                          planSettings?.recurringEnabled
                            ? "border-[#6AE25A] bg-[rgba(106,226,90,0.2)] text-[#6AE25A]"
                            : "border-[#2E2E2E] bg-[#0A0A0A] text-[#D8D8D8]"
                        }`}
                      >
                        {isPlanSaving ? (
                          <ButtonLoader size={16} colorClassName="text-[#D8D8D8]" />
                        ) : planSettings?.recurringEnabled ? (
                          "Ativado"
                        ) : (
                          "Desativado"
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[3px] border border-[#2E2E2E] bg-[#090909] px-3 py-3">
                    <p className="text-[12px] text-[#8E8E8E]">Cartao vinculado a recorrencia</p>

                    {recurringMethodOptions.length > 1 ? (
                      <div className="mt-2">
                        <label className="mb-1 block text-[11px] text-[#686868]">
                          Escolha o cartao para renovar
                        </label>
                        <select
                          value={planSettings?.recurringMethodId || ""}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            if (!value) return;
                            void handleSelectRecurringMethod(value);
                          }}
                          disabled={locked || isPlanSaving || !planSettings?.recurringEnabled}
                          className="h-[38px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-3 text-[12px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {recurringMethodOptions.map((method) => (
                            <option key={method.id} value={method.id}>
                              {(method.nickname?.trim() || cardBrandLabel(method.brand)) +
                                " - " +
                                `${method.firstSix} ****** ${method.lastFour}`}
                            </option>
                          ))}
                        </select>
                        {!planSettings?.recurringEnabled ? (
                          <p className="mt-1 text-[11px] text-[#686868]">
                            Ative a cobranca recorrente para escolher o cartao.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {recurringMethod ? (
                      <div className="mt-2 flex items-center gap-3">
                        <span className="relative block h-[38px] w-[38px] shrink-0 overflow-hidden rounded-[3px] bg-[#111111]">
                          <Image
                            src={cardBrandIcon(recurringMethod.brand)}
                            alt={cardBrandLabel(recurringMethod.brand)}
                            fill
                            sizes="32px"
                            className="object-contain"
                            unoptimized
                          />
                        </span>
                        <div>
                          <p className="text-[14px] text-[#D8D8D8]">
                            {recurringMethod.nickname?.trim() || cardBrandLabel(recurringMethod.brand)}
                          </p>
                          <p className="text-[12px] text-[#777777]">
                            {recurringMethod.firstSix} ****** {recurringMethod.lastFour}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-[12px] text-[#777777]">
                        Nenhum cartao vinculado.
                      </p>
                    )}
                  </div>

                  {locked ? (
                    <p className="mt-3 text-[11px] text-[#C2C2C2]">
                      Servidor expirado/desligado. Renove para alterar recorrencia.
                    </p>
                  ) : null}

                  {planError ? <p className="mt-2 text-[11px] text-[#C2C2C2]">{planError}</p> : null}
                  {planSuccess ? <p className="mt-2 text-[11px] text-[#9BD694]">{planSuccess}</p> : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isAddMethodModalOpen ? (
        <ClientErrorBoundary
          fallback={
            <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 px-4 py-6">
              <div className="w-full max-w-[520px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] p-6 text-center">
                <p className="text-[16px] text-[#D8D8D8]">
                  Nao foi possivel abrir o modal de cartao.
                </p>
                <p className="mt-2 text-[12px] text-[#8E8E8E]">
                  Feche e tente novamente em alguns segundos.
                </p>
                <button
                  type="button"
                  onClick={() => setIsAddMethodModalOpen(false)}
                  className="mt-5 inline-flex h-[40px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[13px] text-[#D8D8D8] transition-colors hover:bg-[#121212]"
                >
                  Fechar
                </button>
              </div>
            </div>
          }
        >
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 px-4 py-6">
            <div className="relative w-full max-w-[760px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] p-6">
            <button
              type="button"
              onClick={() => {
                if (isAddingMethod) return;
                setIsAddMethodModalOpen(false);
              }}
              className="absolute right-4 top-4 inline-flex h-[28px] w-[28px] items-center justify-center rounded-[3px] text-[#8A8A8A] transition-colors hover:text-[#D8D8D8]"
              aria-label="Fechar modal"
            >
              X
            </button>

            <h3 className="text-center text-[24px] text-[#D8D8D8]">
              Adicionar um cartao
            </h3>

            <div className="mt-6 h-[1px] w-full bg-[#242424]" />

            <div className="mt-6">
              <p className="mb-3 text-[12px] text-[#D8D8D8]">Dados do Cartao</p>

              <div className="grid grid-cols-1 gap-3">
                <div className="relative">
                  <input
                    type="text"
                    value={addMethodForm.cardNumber}
                    onChange={(event) => {
                      setAddMethodForm((current) => ({
                        ...current,
                        cardNumber: formatCardNumberInput(event.currentTarget.value),
                      }));
                    }}
                    placeholder="Numero do Cartao"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    className="h-[51px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 pr-[52px] text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 inline-flex h-[26px] w-[26px] -translate-y-1/2 items-center justify-center rounded-[3px] bg-[#111111]">
                    <Image
                      src={addMethodBrandIconSafePath}
                      alt={addMethodCardBrand ? cardBrandLabel(addMethodCardBrand) : "Cartao"}
                      width={18}
                      height={18}
                      className="object-contain"
                      unoptimized
                    />
                  </span>
                </div>
                <input
                  type="text"
                  value={addMethodForm.holderName}
                  onChange={(event) => {
                    setAddMethodForm((current) => ({
                      ...current,
                      holderName: event.currentTarget.value.slice(0, 120),
                    }));
                  }}
                  placeholder="Nome do Titular"
                  className="h-[51px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none"
                />

                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={addMethodForm.expiry}
                    onChange={(event) => {
                      setAddMethodForm((current) => ({
                        ...current,
                        expiry: formatCardExpiryInput(event.currentTarget.value),
                      }));
                    }}
                    placeholder="Data de Validade"
                    className="h-[51px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none"
                  />
                  <input
                    type="text"
                    value={addMethodForm.cvv}
                    onChange={(event) => {
                      setAddMethodForm((current) => ({
                        ...current,
                        cvv: normalizeCardCvvInput(event.currentTarget.value),
                      }));
                    }}
                    placeholder="CVV/CVC"
                    className="h-[51px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none"
                  />
                </div>

                <input
                  type="text"
                  value={addMethodForm.document}
                  onChange={(event) => {
                    const digits = normalizeBrazilDocumentDigits(event.currentTarget.value).slice(0, 14);
                    setAddMethodForm((current) => ({
                      ...current,
                      document: digits,
                    }));
                  }}
                  placeholder="CPF/CNPJ"
                  className="h-[51px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none"
                />

                <input
                  type="text"
                  value={addMethodForm.nickname}
                  onChange={(event) => {
                    setAddMethodForm((current) => ({
                      ...current,
                      nickname: event.currentTarget.value.slice(0, 42),
                    }));
                  }}
                  placeholder="Apelido do cartao (opcional)"
                  className="h-[51px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                void handleAddMethodSubmit();
              }}
              disabled={!addMethodCanSubmit || isAddingMethod}
              className="mt-5 flex h-[51px] w-full items-center justify-center rounded-[3px] bg-[#D8D8D8] text-[16px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAddingMethod ? <ButtonLoader size={24} /> : "Confirmar pagamento"}
            </button>

            {addMethodError ? (
              <p className="mt-3 text-[14px] text-[#DB4646]">{addMethodError}</p>
            ) : null}
            </div>
          </div>
        </ClientErrorBoundary>
      ) : null}
      </section>
    </ClientErrorBoundary>
  );
}
