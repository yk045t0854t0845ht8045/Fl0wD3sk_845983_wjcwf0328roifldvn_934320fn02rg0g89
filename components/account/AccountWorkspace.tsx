"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  useTransition,
  type RefObject,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BadgePercent,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Cog,
  CreditCard,
  History,
  Key,
  LifeBuoy,
  LogOut,
  Palette,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  Ticket,
  UserRound,
  Users,
  Shield,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { OFFICIAL_DISCORD_INVITE_URL } from "@/lib/discordLink/config";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { useAccountStatus } from "@/hooks/useAccountData";
import { AccountTabLoadingState } from "@/components/account/TabRegistry";

import {
  ACCOUNT_RETURN_QUERY_PARAM,
  getAccountReturnLabel,
  readStoredAccountReturnPath,
  sanitizeAccountReturnPath,
  storeAccountReturnPath,
} from "@/lib/account/navigation";
import { buildDiscordAuthStartHref, buildLoginHref } from "@/lib/auth/paths";
import { type AccountTab, ACCOUNT_TABS, validateTab } from "@/lib/account/tabs";
import { buildBrowserRoutingTargetFromInternalPath } from "@/lib/routing/subdomains";
import {
  scheduleWarmBrowserRoutes,
  warmBrowserRoute,
} from "@/lib/routing/browserWarmup";
import { useLatchedPendingKey } from "@/lib/ui/useLatchedPendingKey";
export { validateTab };
export type { AccountTab };

function normalizeComparablePath(value: string) {
  if (!value) return "/";
  if (value === "/") return value;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

type NavItem = {
  id: AccountTab;
  label: string;
  icon: LucideIcon;
};

type NavGroup = {
  category: string;
  items: NavItem[];
};

type SavedPanelAccount = {
  authUserId: number;
  discordUserId: string | null;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  lastSeenAt: number;
};

const NAV_GROUPS: NavGroup[] = [
  {
    category: "Conta",
    items: [
      { id: "overview", label: "Visão Geral", icon: UserRound },
    ],
  },
  {
    category: "Cobrança",
    items: [
      { id: "plans", label: "Planos", icon: BadgePercent },
      { id: "payment_methods", label: "Métodos de Pagamento", icon: CreditCard },
      { id: "payment_history", label: "Histórico", icon: History },
    ],
  },
  {
    category: "Ferramentas",
    items: [
      { id: "api_keys", label: "Chaves API", icon: Key },
      { id: "teams", label: "Equipes e Membros", icon: Users },
      { id: "tickets", label: "Tickets de Suporte", icon: Ticket },
    ],
  },
  {
    category: "Conta",
    items: [
      { id: "status", label: "Status da Conta", icon: ShieldCheck },
      { id: "delete_account", label: "Excluir Conta", icon: ShieldAlert },
    ],
  },
];

const ACCOUNT_SIDEBAR_COLLAPSE_KEY = "flowdesk_account_sidebar_groups_v1";
const SAVED_PANEL_ACCOUNTS_KEY = "flowdesk_saved_panel_accounts_v1";

function buildAccountGroupKey(group: NavGroup, groupIndex: number) {
  return `${group.category}-${groupIndex}`;
}

function buildDefaultCollapsedGroups() {
  return Object.fromEntries(
    NAV_GROUPS.map((group, groupIndex) => [buildAccountGroupKey(group, groupIndex), true]),
  ) as Record<string, boolean>;
}

function readStoredCollapsedGroups() {
  if (typeof window === "undefined") {
    return buildDefaultCollapsedGroups();
  }

  const fallback = buildDefaultCollapsedGroups();

  try {
    const raw = window.localStorage.getItem(ACCOUNT_SIDEBAR_COLLAPSE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return Object.fromEntries(
      Object.keys(fallback).map((key) => [key, typeof parsed[key] === "boolean" ? parsed[key] : fallback[key]]),
    ) as Record<string, boolean>;
  } catch {
    return fallback;
  }
}

function accountInitial(name: string, username: string) {
  const source = name.trim() || username.trim();
  return source ? source.charAt(0).toUpperCase() : "F";
}

function normalizeSavedPanelAccounts(input: unknown) {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<SavedPanelAccount>;
      if (
        typeof record.authUserId !== "number" ||
        typeof record.displayName !== "string" ||
        typeof record.username !== "string" ||
        typeof record.lastSeenAt !== "number"
      ) {
        return null;
      }

      return {
        authUserId: record.authUserId,
        discordUserId:
          typeof record.discordUserId === "string" ? record.discordUserId : null,
        displayName: record.displayName,
        username: record.username,
        avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl : null,
        lastSeenAt: record.lastSeenAt,
      } satisfies SavedPanelAccount;
    })
    .filter((value): value is SavedPanelAccount => value !== null)
    .slice(0, 3);
}

function resolveSavedAccountKey(account: {
  authUserId: number;
  discordUserId: string | null;
}) {
  return account.discordUserId || `auth:${account.authUserId}`;
}

function mergeSavedPanelAccounts(
  currentAccount: SavedPanelAccount,
  previousAccounts: SavedPanelAccount[],
) {
  const currentAccountKey = resolveSavedAccountKey(currentAccount);
  return [
    currentAccount,
    ...previousAccounts.filter(
      (account) => resolveSavedAccountKey(account) !== currentAccountKey,
    ),
  ]
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
    .slice(0, 3);
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function AccountAvatar({
  avatarUrl,
  displayName,
  username,
  size = 38,
  className = "",
}: {
  avatarUrl: string | null;
  displayName: string;
  username: string;
  size?: number;
  className?: string;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={displayName}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`.trim()}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`relative flex items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,#7D3BFF_0%,#3C0F6D_54%,#170822_100%)] font-semibold text-[#F0F0F0] shadow-[0_0_28px_rgba(125,59,255,0.14)] ${className}`.trim()}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {accountInitial(displayName, username)}
      <span className="absolute bottom-[2px] right-[2px] h-[8px] w-[8px] rounded-full bg-[#0062FF]" />
    </div>
  );
}

// ─── Main Workspace Shell ──────────────────────────────────────────────────────

type AccountWorkspaceProps = {
  authUserId: number;
  discordUserId: string | null;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  children?: React.ReactNode;
};

export function AccountWorkspace({
  authUserId,
  discordUserId,
  displayName,
  username,
  avatarUrl,
  children,
}: AccountWorkspaceProps) {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => buildDefaultCollapsedGroups());
  const [hasLoadedCollapsedGroups, setHasLoadedCollapsedGroups] = useState(false);
  const [pendingTab, setPendingTab] = useState<AccountTab | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedPanelAccount[]>([]);
  const [returnPath, setReturnPath] = useState<string | null>(null);
  const [, startSidebarNavigationTransition] = useTransition();

  const { statusData } = useAccountStatus();
  const isSuspended = (statusData?.statusLevel ?? 0) >= 4;
  const isAtRisk = (statusData?.statusLevel ?? 0) >= 1;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const desktopProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const currentAccount = useMemo(
    () => ({
      authUserId,
      discordUserId,
      displayName,
      username,
      avatarUrl,
    }),
    [authUserId, avatarUrl, discordUserId, displayName, username],
  );

  // Derive active tab from pathname reactively
  const segments = pathname.split("/").filter(Boolean);
  // segments could be ["account"] or ["account", "plans"]
  const lastSegment = segments[segments.length - 1];
  const activeTab: AccountTab = (lastSegment && lastSegment !== "account") 
    ? validateTab(lastSegment) 
    : "overview";
  const latchedPendingTab = useLatchedPendingKey({
    pendingKey: pendingTab,
    resolvedKey: activeTab,
  });
  const highlightedTab = pendingTab ?? activeTab;
  const displayedTab = (latchedPendingTab as AccountTab | null) ?? highlightedTab;

  const buildTabHref = useCallback((tab: AccountTab) => {
    return tab === "overview" ? "/account" : `/account/${tab}`;
  }, []);

  const prefetchHref = useCallback((href: string) => {
    warmBrowserRoute(href, {
      router,
      prefetchDocument: true,
    });
  }, [router]);

  const prefetchTab = useCallback((tab: AccountTab) => {
    prefetchHref(buildTabHref(tab));
  }, [buildTabHref, prefetchHref]);

  const navigateToHref = useCallback((href: string, nextTab?: AccountTab | null) => {
    setIsProfileMenuOpen(false);
    const target = warmBrowserRoute(href, {
      router,
      prefetchDocument: true,
    });
    if (normalizeComparablePath(pathname) === normalizeComparablePath(target.path)) {
      return;
    }

    if (nextTab) {
      setPendingTab(nextTab);
    }

    if (!target.sameOrigin) {
      window.location.assign(target.href);
      return;
    }

    prefetchHref(href);
    startSidebarNavigationTransition(() => {
      router.push(target.path, { scroll: false });
    });
  }, [pathname, prefetchHref, router, startSidebarNavigationTransition]);

  const navigateToTab = useCallback((tab: AccountTab) => {
    navigateToHref(buildTabHref(tab), tab);
  }, [buildTabHref, navigateToHref]);

  useEffect(() => {
    if (!pendingTab || pendingTab !== activeTab) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPendingTab(null);
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeTab, pendingTab]);

  useEffect(() => {
    return scheduleWarmBrowserRoutes(
      [
        ...ACCOUNT_TABS.map((tab) =>
          tab === "overview" ? "/account" : `/account/${tab}`,
        ),
        "/servers",
        "/dashboard",
        "/discord/link",
      ],
      {
        router,
        delayMs: 80,
      },
    );
  }, [router]);

  useEffect(() => {
    setCollapsedGroups(readStoredCollapsedGroups());
    setHasLoadedCollapsedGroups(true);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_PANEL_ACCOUNTS_KEY);
      const currentSnapshot: SavedPanelAccount = {
        ...currentAccount,
        lastSeenAt: Date.now(),
      };
      const nextAccounts = mergeSavedPanelAccounts(
        currentSnapshot,
        normalizeSavedPanelAccounts(raw ? JSON.parse(raw) : []),
      );
      setSavedAccounts(nextAccounts);
      window.localStorage.setItem(
        SAVED_PANEL_ACCOUNTS_KEY,
        JSON.stringify(nextAccounts),
      );
    } catch {
      setSavedAccounts([
        {
          ...currentAccount,
          lastSeenAt: Date.now(),
        },
      ]);
    }
  }, [currentAccount]);

  useEffect(() => {
    const queryReturnPath = sanitizeAccountReturnPath(
      searchParams.get(ACCOUNT_RETURN_QUERY_PARAM),
    );
    const storedReturnPath = readStoredAccountReturnPath();
    const resolvedReturnPath =
      storeAccountReturnPath(queryReturnPath ?? storedReturnPath ?? "/dashboard") ||
      "/dashboard";

    setReturnPath(resolvedReturnPath);
  }, [searchParams]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;

      const clickedInsideDesktop = desktopProfileMenuRef.current?.contains(target);
      const clickedInsideMobile = mobileProfileMenuRef.current?.contains(target);
      if (!clickedInsideDesktop && !clickedInsideMobile) {
        setIsProfileMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
      });
    } catch {
      // Mesmo com erro de rede, redireciona para login
    } finally {
      try {
        window.localStorage.removeItem("flowdesk_pending_account_switch_v1");
      } catch {
        // noop
      }
      window.location.replace(buildLoginHref());
    }
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const normalizedSearch = sidebarSearch.trim().toLowerCase();

  useEffect(() => {
    if (!hasLoadedCollapsedGroups) return;

    try {
      window.localStorage.setItem(ACCOUNT_SIDEBAR_COLLAPSE_KEY, JSON.stringify(collapsedGroups));
    } catch {
      // noop
    }
  }, [collapsedGroups, hasLoadedCollapsedGroups]);

  useEffect(() => {
    const activeGroupIndex = NAV_GROUPS.findIndex((group) =>
      group.items.some((item) => item.id === activeTab),
    );
    if (activeGroupIndex < 0) return;

    const groupKey = buildAccountGroupKey(NAV_GROUPS[activeGroupIndex], activeGroupIndex);
    setCollapsedGroups((prev) => {
      if (prev[groupKey] === false) return prev;
      return { ...prev, [groupKey]: false };
    });
  }, [activeTab]);

  function matchesSearch(item: NavItem) {
    if (!normalizedSearch) return true;
    return item.label.toLowerCase().includes(normalizedSearch);
  }

  const openDiscordLoginFlow = useCallback(() => {
    if (typeof window === "undefined") return;
    const nextPath = `${window.location.pathname}${window.location.search}`;
    window.location.assign(buildDiscordAuthStartHref(nextPath));
  }, []);

  const handleAddAnotherAccount = useCallback(() => {
    setIsProfileMenuOpen(false);
    openDiscordLoginFlow();
  }, [openDiscordLoginFlow]);

  const handleSwitchSavedAccount = useCallback((account: SavedPanelAccount) => {
    if (resolveSavedAccountKey(account) === resolveSavedAccountKey(currentAccount)) {
      setIsProfileMenuOpen(false);
      return;
    }

    if (!account.discordUserId) {
      setIsProfileMenuOpen(false);
      window.location.replace(buildLoginHref());
      return;
    }

    try {
      window.localStorage.setItem(
        "flowdesk_pending_account_switch_v1",
        JSON.stringify({
          discordUserId: account.discordUserId,
          requestedAt: Date.now(),
        }),
      );
    } catch {
      // noop
    }

    setIsProfileMenuOpen(false);
    openDiscordLoginFlow();
  }, [currentAccount, openDiscordLoginFlow]);

  const handleOpenAccountSettings = useCallback(() => {
    navigateToHref("/account", "overview");
  }, [navigateToHref]);

  const handleOpenMyAccount = useCallback(() => {
    setIsProfileMenuOpen(false);
    window.location.assign(
      buildBrowserRoutingTargetFromInternalPath("/discord/link", {
        fallbackArea: "public",
      }).href,
    );
  }, []);

  const handleOpenHelp = useCallback(() => {
    setIsProfileMenuOpen(false);
    window.open(OFFICIAL_DISCORD_INVITE_URL, "_blank", "noopener,noreferrer");
  }, []);

  const handleReturnToPreviousPage = useCallback(() => {
    navigateToHref(returnPath || "/dashboard");
  }, [navigateToHref, returnPath]);

  // ── Page title / description ─────────────────────────────────────────────────

  const PAGE_META: Record<AccountTab, { eyebrow: string; title: string; subtitle: string }> = {
    overview: {
      eyebrow: "Minha conta",
      title: "Visão Geral",
      subtitle: "Gerencie sua conta, cobrança, chaves de API e equipes em um único lugar.",
    },
    plans: {
      eyebrow: "Cobrança",
      title: "Planos",
      subtitle: "Seu plano atual, status de ativação e opções de upgrade.",
    },
    payment_methods: {
      eyebrow: "Cobrança",
      title: "Métodos de Pagamento",
      subtitle: "Cadastre e gerencie seus cartões e métodos de pagamento.",
    },
    payment_history: {
      eyebrow: "Cobrança",
      title: "Histórico de Pagamentos",
      subtitle: "Visualize todas as transações e cobranças da sua conta.",
    },
    api_keys: {
      eyebrow: "Ferramentas",
      title: "Chaves de API",
      subtitle: "Crie e revogue chaves para integrar o Flowdesk com sistemas externos.",
    },
    teams: {
      eyebrow: "Ferramentas",
      title: "Equipes e Membros",
      subtitle: "Gerencie equipes, convite membros e ajuste permissões.",
    },
    tickets: {
      eyebrow: "Suporte",
      title: "Tickets de Suporte",
      subtitle: "Visualize o histórico de atendimentos e abra novos chamados.",
    },
    status: {
      eyebrow: "Avançado",
      title: "Status da Conta",
      subtitle: "Visualize o histórico de violações e integridade da sua conta.",
    },
    delete_account: {
      eyebrow: "Zona de perigo",
      title: "Excluir Conta",
      subtitle: "Esta ação é permanente e não pode ser revertida.",
    },
  };

  const meta = PAGE_META[displayedTab];
  const shouldShowAccountContentLoading = Boolean(latchedPendingTab);
  const returnLabel = getAccountReturnLabel(returnPath);

  const sidebarShellClass =
    "border border-[#111111] bg-[#060606] flex flex-col overflow-hidden";

  const renderSidebarContent = (profileMenuRef: RefObject<HTMLDivElement | null>) => (
    <div className="flex h-full flex-col px-[14px] pb-[14px] pt-[20px]">
      <div className="flex items-center gap-[10px] rounded-[16px] border border-[#141414] bg-[#080808] px-[14px] py-[12px]">
        <Search className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]" strokeWidth={1.85} aria-hidden="true" />
        <input
          type="text"
          value={sidebarSearch}
          onChange={(e) => setSidebarSearch(e.target.value)}
          placeholder="Buscar..."
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#5A5A5A]"
        />
        <span className="inline-flex h-[28px] min-w-[28px] items-center justify-center rounded-[9px] border border-[#1A1A1A] bg-[#101010] px-[8px] text-[12px] font-medium text-[#A7A7A7]">
          F
        </span>
      </div>

      <div className="mt-[14px] space-y-[4px]">
          <button
            type="button"
            onMouseEnter={() => prefetchHref(returnPath || "/dashboard")}
            onFocus={() => prefetchHref(returnPath || "/dashboard")}
            onPointerDown={() => prefetchHref(returnPath || "/dashboard")}
            onClick={handleReturnToPreviousPage}
            className="group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#B5B5B5] transition-all duration-200 hover:bg-[#111111] hover:text-[#E3E3E3]"
          >
          <span className="inline-flex h-[22px] w-[22px] items-center justify-center text-[#8A8A8A] group-hover:text-[#DADADA]">
            <ChevronLeft className="h-[18px] w-[18px] shrink-0" strokeWidth={1.85} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">
            {returnLabel}
          </span>
        </button>
      </div>

      <div className="mt-[14px] flex-1 overflow-y-auto pr-[2px]">
        {NAV_GROUPS.map((group, groupIndex) => {
          const visibleItems = group.items.filter(matchesSearch);
          if (!visibleItems.length) return null;
          const shouldShowCategory =
            groupIndex === 0 ||
            (group.category !== NAV_GROUPS[groupIndex - 1]?.category);

          const groupKey = buildAccountGroupKey(group, groupIndex);
          const isCollapsed = collapsedGroups[groupKey] && !normalizedSearch;
          const isGroupActive = group.items.some((item) => item.id === activeTab);
          const isGroupOpen = !isCollapsed && !normalizedSearch;

          return (
            <div key={groupKey} className={groupIndex > 0 && shouldShowCategory ? "mt-[12px]" : ""}>
              {shouldShowCategory && (
                <button
                  type="button"
                  onClick={() => toggleGroup(groupKey)}
                  className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-all duration-200 ${
                    isGroupActive
                      ? "bg-[#1E1E1E] text-[#F0F0F0] font-semibold"
                      : isGroupOpen
                        ? "bg-[#121212] text-[#D6D6D6]"
                        : "text-[#B5B5B5] hover:bg-[#111111] hover:text-[#E3E3E3]"
                  }`}
                >
                  <span className={`inline-flex h-[22px] w-[22px] items-center justify-center ${
                    isGroupActive
                      ? "text-[#DADADA]"
                      : isGroupOpen
                        ? "text-[#C7C7C7]"
                        : "text-[#8A8A8A] group-hover:text-[#DADADA]"
                  }`}>
                     {group.category === "Conta" && <Settings2 className="h-[16px] w-[16px]" strokeWidth={1.9} />}
                     {group.category === "Cobrança" && <CreditCard className="h-[16px] w-[16px]" strokeWidth={1.9} />}
                     {group.category === "Ferramentas" && <Key className="h-[16px] w-[16px]" strokeWidth={1.9} />}
                     {group.category === "Suporte" && <LifeBuoy className="h-[16px] w-[16px]" strokeWidth={1.9} />}
                     {group.category === "Zona de perigo" && <Shield className="h-[16px] w-[16px]" strokeWidth={1.9} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">
                    {group.category === "Conta" && groupIndex > 0 ? "Avançado" : group.category}
                  </span>
                  <span
                    className={`transition-transform duration-200 ${
                      !isCollapsed || normalizedSearch
                        ? "rotate-180 text-[#C9C9C9]"
                        : "rotate-0 text-[#6F6F6F] group-hover:text-[#BEBEBE]"
                    }`}
                  >
                    <ChevronDown className="h-[14px] w-[14px] shrink-0" strokeWidth={1.9} />
                  </span>
                </button>
              )}

              {(!isCollapsed || normalizedSearch) && (
                <div className="mt-[6px] space-y-[4px] pl-[12px]">
                  {visibleItems.map((item) => {
                    const isActive = highlightedTab === item.id;
                    const Icon = item.icon;
                    const isDanger = item.id === "delete_account";

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigateToTab(item.id)}
                        onMouseEnter={() => prefetchTab(item.id)}
                        onFocus={() => prefetchTab(item.id)}
                        onPointerDown={() => prefetchTab(item.id)}
                        className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[10px] text-left transition-all duration-200 ${
                          isActive
                            ? isDanger
                              ? "bg-[rgba(219,70,70,0.08)] text-[#F0A0A0]"
                              : "bg-[#1A1A1A] text-[#F0F0F0]"
                            : isDanger
                              ? "text-[#B07070] hover:bg-[rgba(219,70,70,0.06)] hover:text-[#F0A0A0]"
                              : "text-[#AFAFAF] hover:bg-[#101010] hover:text-[#E3E3E3]"
                        }`}
                      >
                        <span
                          className={`inline-flex h-[20px] w-[20px] items-center justify-center ${
                            isActive
                              ? isDanger ? "text-[#F0A0A0]" : "text-[#F0F0F0]"
                              : isDanger
                                ? "text-[#9A5555] group-hover:text-[#F0A0A0]"
                                : "text-[#7F7F7F] group-hover:text-[#DADADA]"
                          }`}
                        >
                          <Icon className="h-[16px] w-[16px]" strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div ref={profileMenuRef} className="mt-[14px]">
        <div className="relative">
          {isProfileMenuOpen && (
            <div
              className="absolute inset-x-0 bottom-[calc(100%+10px)] z-[140] overflow-hidden rounded-[22px] border border-[#151515] bg-[#070707] p-[12px] shadow-[0_26px_80px_rgba(0,0,0,0.54)]"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="space-y-[8px]">
                <button
                  type="button"
                  onClick={handleAddAnotherAccount}
                  className="flex w-full items-center gap-[12px] rounded-[16px] border border-[#171717] bg-[#0D0D0D] px-[12px] py-[12px] text-left text-[#D8D8D8] transition-colors hover:border-[#222222] hover:bg-[#111111]"
                >
                  <span className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-[11px] border border-[#1A1A1A] bg-[#101010] text-[#CFCFCF]">
                    <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                      Adicionar outra conta
                    </span>
                    <span className="mt-[6px] block truncate text-[11px] leading-none text-[#686868]">
                      Ate 3 contas salvas neste navegador
                    </span>
                  </span>
                </button>

                <div className="border-t border-[#121212] pt-[12px]">
                  <p className="px-[4px] text-[11px] uppercase tracking-[0.16em] text-[#5F5F5F]">
                    Contas salvas
                  </p>
                  <div className="mt-[10px] space-y-[6px]">
                    {savedAccounts.map((account) => {
                      const isCurrent =
                        resolveSavedAccountKey(account) ===
                        resolveSavedAccountKey(currentAccount);

                      return (
                        <button
                          key={resolveSavedAccountKey(account)}
                          type="button"
                          onClick={() => handleSwitchSavedAccount(account)}
                          className={`flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-colors ${
                            isCurrent
                              ? "bg-[#141414] text-[#ECECEC]"
                              : "text-[#A7A7A7] hover:bg-[#111111] hover:text-[#E6E6E6]"
                          }`}
                        >
                          <AccountAvatar
                            avatarUrl={account.avatarUrl}
                            displayName={account.displayName}
                            username={account.username}
                            size={36}
                            className="shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                              {account.displayName}
                            </span>
                            <span className="mt-[6px] block truncate text-[11px] leading-none text-[#666666]">
                              @{account.username}
                            </span>
                          </span>
                          {isCurrent ? (
                            <span className="inline-flex rounded-full border border-[rgba(0,98,255,0.28)] bg-[rgba(0,98,255,0.1)] px-[8px] py-[5px] text-[10px] leading-none font-medium text-[#8AB6FF]">
                              ativa
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-[#121212] pt-[12px]">
                  <div className="space-y-[4px]">
                    <button
                      type="button"
                      onClick={handleOpenMyAccount}
                      className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#B7B7B7] transition-colors hover:bg-[#111111] hover:text-[#ECECEC]"
                    >
                      <UserRound className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
                      <span className="text-[14px] leading-none font-medium">Minha conta</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenAccountSettings}
                      className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#B7B7B7] transition-colors hover:bg-[#111111] hover:text-[#ECECEC]"
                    >
                      <Cog className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
                      <span className="text-[14px] leading-none font-medium">Configuracoes</span>
                    </button>
                    <button
                      type="button"
                      disabled
                      className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#656565]"
                    >
                      <Palette className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
                      <span className="text-[14px] leading-none font-medium">Personalizacao</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenHelp}
                      className="flex w-full items-center justify-between gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#B7B7B7] transition-colors hover:bg-[#111111] hover:text-[#ECECEC]"
                    >
                      <span className="inline-flex items-center gap-[12px]">
                        <CircleHelp className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
                        <span className="text-[14px] leading-none font-medium">Ajuda</span>
                      </span>
                      <ChevronRight className="h-[14px] w-[14px] shrink-0" strokeWidth={1.9} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleLogout(); }}
                      disabled={isLoggingOut}
                      className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#DB9E9E] transition-colors hover:bg-[#111111] hover:text-[#F1C0C0] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isLoggingOut ? (
                        <ButtonLoader size={16} colorClassName="text-[#DB8A8A]" />
                      ) : (
                        <LogOut className="h-[17px] w-[17px] shrink-0" strokeWidth={1.9} aria-hidden="true" />
                      )}
                      <span className="text-[14px] leading-none font-medium">Sair</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsProfileMenuOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-[12px] rounded-[18px] border border-[#111111] bg-[#080808] px-[10px] py-[10px] text-left transition-colors hover:border-[#1A1A1A] hover:bg-[#0B0B0B]"
            aria-expanded={isProfileMenuOpen}
            aria-haspopup="menu"
          >
            <div className="flex min-w-0 items-center gap-[10px]">
              <AccountAvatar
                avatarUrl={avatarUrl}
                displayName={displayName}
                username={username}
                size={38}
              />
              <div className="min-w-0">
                <p className="truncate text-[15px] leading-none font-medium tracking-[-0.03em] text-[#E5E5E5]">
                  {displayName}
                </p>
                <p className="mt-[5px] truncate text-[12px] leading-none text-[#686868]">
                  @{username}
                </p>
              </div>
            </div>
            <span className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[10px] text-[#7E7E7E] transition-colors hover:bg-[#101010] hover:text-[#D8D8D8]">
              <ChevronDown className="h-[14px] w-[14px] shrink-0" strokeWidth={1.9} aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]"
      />

      <div className="hidden xl:block">
        <aside className="fixed inset-y-0 left-0 z-20 w-[318px]">
          <div className={`${sidebarShellClass} h-full rounded-none border-y-0 border-l-0 border-r-[#151515]`}>
            <LandingReveal delay={24} duration={240}>
              {renderSidebarContent(desktopProfileMenuRef)}
            </LandingReveal>
          </div>
        </aside>
      </div>

      <main className="relative px-[20px] pt-[32px] pb-[56px] md:px-6 lg:px-8 xl:min-h-screen xl:pl-[358px] xl:pr-[42px]">
        <div className="mx-auto w-full max-w-[1220px]">
          <aside className="mb-[20px] min-w-0 xl:hidden">
            <LandingReveal delay={24} duration={240}>
              <div className={`${sidebarShellClass} rounded-[28px]`}>
                {renderSidebarContent(mobileProfileMenuRef)}
              </div>
            </LandingReveal>
          </aside>

          <section className="min-w-0">
            <LandingReveal delay={36} duration={240}>
              <div className="flex flex-col gap-[14px] md:flex-row md:items-end md:justify-between">
                <div>
                  <LandingGlowTag className="px-[24px]">{meta.eyebrow}</LandingGlowTag>
                  <h1 className="mt-[18px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.02] font-normal tracking-[-0.05em] text-transparent md:text-[42px]">
                    {meta.title}
                  </h1>
                  <p className="mt-[14px] max-w-[760px] text-[14px] leading-[1.55] text-[#7D7D7D] md:text-[15px]">
                    {meta.subtitle}
                  </p>
                </div>
              </div>
            </LandingReveal>

            <LandingReveal delay={52} duration={240}>
              <div className="mt-[28px]">
                {/* Suspension Banner */}
                {isSuspended && activeTab !== "status" && (
                  <div className="mb-[20px] flex items-start gap-[16px] rounded-[18px] border border-[#DB4646]/40 bg-[rgba(219,70,70,0.08)] px-[20px] py-[18px]">
                    <Shield className="mt-[2px] h-[22px] w-[22px] shrink-0 text-[#DB4646]" strokeWidth={2} />
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-[#DB4646]">Conta Suspensa</p>
                      <p className="mt-[4px] text-[13px] text-[#B06060] leading-[1.5]">
                        Sua conta está suspensa e o acesso às funcionalidades está limitado.{" "}
                        <Link href="/account/status" className="underline hover:text-[#DB4646]">Ver detalhes na aba Status</Link>.
                      </p>
                    </div>
                  </div>
                )}
                {isAtRisk && !isSuspended && activeTab !== "status" && (
                  <div className="mb-[20px] flex items-start gap-[16px] rounded-[18px] border border-[#E7A540]/30 bg-[rgba(231,165,64,0.07)] px-[20px] py-[18px]">
                    <ShieldAlert className="mt-[2px] h-[22px] w-[22px] shrink-0 text-[#E7A540]" strokeWidth={2} />
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-[#E7A540]">Conta com Restrições</p>
                      <p className="mt-[4px] text-[13px] text-[#A08040] leading-[1.5]">
                        Sua conta possui violações ativas que podem afetar seus serviços.{" "}
                        <Link href="/account/status" className="underline hover:text-[#E7A540]">Ver na aba Status</Link>.
                      </p>
                    </div>
                  </div>
                )}
                {shouldShowAccountContentLoading ? <AccountTabLoadingState /> : children}
              </div>
            </LandingReveal>
          </section>
        </div>
      </main>
    </div>
  );
}
