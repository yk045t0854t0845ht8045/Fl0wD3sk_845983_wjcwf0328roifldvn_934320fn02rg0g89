"use client";

import { useRef, useState, useEffect, type ReactNode } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgePercent,
  ChevronDown,
  Coins,
  CreditCard,
  History,
  Key,
  LifeBuoy,
  LogOut,
  Search,
  Settings2,
  ShieldAlert,
  Server,
  Activity,
  Ticket,
  UserRound,
  Users,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { useAccountSummary } from "@/hooks/useAccountData";


import { type AccountTab, ACCOUNT_TABS, validateTab } from "@/lib/account/tabs";
export { validateTab };
export type { AccountTab };

type NavItem = {
  id: AccountTab;
  label: string;
  icon: LucideIcon;
};

type NavGroup = {
  category: string;
  items: NavItem[];
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
      { id: "delete_account", label: "Excluir Conta", icon: ShieldAlert },
    ],
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function AccountAvatar({
  avatarUrl,
  displayName,
  size = 38,
}: {
  avatarUrl: string | null;
  displayName: string;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={displayName}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
        unoptimized
      />
    );
  }
  const initials = displayName.slice(0, 2).toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full bg-[linear-gradient(135deg,#1a3a7a,#0d1f47)] text-[#8AB6FF] font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

// ─── Main Workspace Shell ──────────────────────────────────────────────────────

type AccountWorkspaceProps = {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  initialTab?: AccountTab;
  children?: React.ReactNode;
};

export function AccountWorkspace({
  displayName,
  username,
  avatarUrl,
  initialTab = "overview",
  children,
}: AccountWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<AccountTab>(initialTab);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [mountedTabs, setMountedTabs] = useState<Record<AccountTab, boolean>>(() => ({
    overview: true,
    plans: false,
    payment_methods: false,
    payment_history: false,
    api_keys: false,
    teams: false,
    tickets: false,
    delete_account: false,
    [initialTab]: true,
  }));

  const router = useRouter();
  const pathname = usePathname();
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
    setMountedTabs((prev) => (prev[initialTab] ? prev : { ...prev, [initialTab]: true }));
  }, [initialTab]);

  const ACCOUNT_TABS: AccountTab[] = [
    "overview",
    "plans",
    "payment_methods",
    "payment_history",
    "api_keys",
    "teams",
    "tickets",
    "delete_account",
  ];

  function buildTabHref(tab: AccountTab) {
    return tab === "overview" ? "/account" : `/account/${tab}`;
  }

  function prefetchTab(tab: AccountTab) {
    const href = buildTabHref(tab);
    router.prefetch(href);
    const component = TAB_COMPONENTS[tab];
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dynComponent = component as any;
    if (dynComponent && typeof dynComponent.preload === "function") {
      dynComponent.preload();
    }
  }

  function navigateToTab(tab: AccountTab) {
    setIsProfileMenuOpen(false);
    setActiveTab(tab);
    setMountedTabs((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
    const href = buildTabHref(tab);
    if (pathname !== href) {
      router.push(href);
    }
  }

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
      window.location.replace("/login");
    }
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const normalizedSearch = sidebarSearch.trim().toLowerCase();

  function matchesSearch(item: NavItem) {
    if (!normalizedSearch) return true;
    return item.label.toLowerCase().includes(normalizedSearch);
  }

  // ── Content resolver ─────────────────────────────────────────────────────────

  function renderTab(tab: AccountTab) {
    // Dynamic import of each tab at render time
    switch (tab) {
      case "overview":
        return <OverviewContent onNavigate={navigateToTab} displayName={displayName} avatarUrl={avatarUrl} />;
      case "plans":
        return <LazyTab id="plans" />;
      case "payment_methods":
        return <LazyTab id="payment_methods" />;
      case "payment_history":
        return <LazyTab id="payment_history" onNavigateTickets={() => navigateToTab("tickets")} />;
      case "api_keys":
        return <LazyTab id="api_keys" />;
      case "teams":
        return <LazyTab id="teams" />;
      case "tickets":
        return <LazyTab id="tickets" />;
      case "delete_account":
        return <LazyTab id="delete_account" />;
      default:
        return null;
    }
  }

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
    delete_account: {
      eyebrow: "Zona de perigo",
      title: "Excluir Conta",
      subtitle: "Esta ação é permanente e não pode ser revertida.",
    },
  };

  const meta = PAGE_META[activeTab];

  const sidebarShellClass =
    "border border-[#111111] bg-[#060606] flex flex-col overflow-hidden";

  const renderSidebarContent = () => (
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

      <div className="mt-[14px] flex-1 overflow-y-auto pr-[2px]">
        {NAV_GROUPS.map((group, groupIndex) => {
          const visibleItems = group.items.filter(matchesSearch);
          if (!visibleItems.length) return null;
          const shouldShowCategory =
            groupIndex === 0 ||
            (group.category !== NAV_GROUPS[groupIndex - 1]?.category);

          const groupKey = `${group.category}-${groupIndex}`;
          const isCollapsed = collapsedGroups[groupKey] && !normalizedSearch;

          return (
            <div key={groupKey} className={groupIndex > 0 && shouldShowCategory ? "mt-[12px] border-t border-[#121212] pt-[12px]" : ""}>
              {shouldShowCategory && (
                <button
                  type="button"
                  onClick={() => toggleGroup(groupKey)}
                  className="group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-all duration-200 text-[#B5B5B5] hover:bg-[#111111] hover:text-[#E3E3E3]"
                >
                  <span className="inline-flex h-[22px] w-[22px] items-center justify-center text-[#8A8A8A] group-hover:text-[#DADADA]">
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
                    const isActive = activeTab === item.id;
                    const Icon = item.icon;
                    const isDanger = item.id === "delete_account";

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          setActiveTab(item.id);
                        }}
                        onMouseEnter={() => prefetchTab(item.id)}
                        onFocus={() => prefetchTab(item.id)}
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

      <div ref={profileMenuRef} className="mt-[14px] border-t border-[#121212] pt-[14px]">
        <div className="relative">
          {isProfileMenuOpen && (
            <div
              className="absolute inset-x-0 bottom-[calc(100%+10px)] z-[140] overflow-hidden rounded-[22px] border border-[#151515] bg-[#070707] p-[12px] shadow-[0_26px_80px_rgba(0,0,0,0.54)]"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="space-y-[8px]">
                <button
                  type="button"
                  onClick={() => { setIsProfileMenuOpen(false); router.push("/servers"); }}
                  className="flex w-full items-center gap-[12px] rounded-[16px] border border-[#171717] bg-[#0D0D0D] px-[12px] py-[12px] text-left text-[#D8D8D8] transition-colors hover:border-[#222222] hover:bg-[#111111]"
                >
                  <span className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-[11px] border border-[#1A1A1A] bg-[#101010] text-[#CFCFCF]">
                    <Settings2 className="h-[16px] w-[16px] shrink-0" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                      Central de servidores
                    </span>
                    <span className="mt-[6px] block truncate text-[11px] leading-none text-[#686868]">
                      Voltar ao painel
                    </span>
                  </span>
                </button>
                <div className="border-t border-[#121212] pt-[12px]">
                  <div className="space-y-[4px]">
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
            onClick={() => setIsProfileMenuOpen((p) => !p)}
            className="flex w-full items-center justify-between gap-[12px] rounded-[18px] border border-[#111111] bg-[#080808] px-[10px] py-[10px] text-left transition-colors hover:border-[#1A1A1A] hover:bg-[#0B0B0B]"
            aria-expanded={isProfileMenuOpen}
            aria-haspopup="menu"
          >
            <div className="flex min-w-0 items-center gap-[10px]">
              <AccountAvatar avatarUrl={avatarUrl} displayName={displayName} size={38} />
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
            <LandingReveal delay={90}>
              {renderSidebarContent()}
            </LandingReveal>
          </div>
        </aside>
      </div>

      <main className="relative px-[20px] pt-[32px] pb-[56px] md:px-6 lg:px-8 xl:min-h-screen xl:pl-[358px] xl:pr-[42px]">
        <div className="mx-auto w-full max-w-[1220px]">
          <aside className="mb-[20px] min-w-0 xl:hidden">
            <LandingReveal delay={90}>
              <div className={`${sidebarShellClass} rounded-[28px]`}>
                {renderSidebarContent()}
              </div>
            </LandingReveal>
          </aside>

          <section className="min-w-0">
            <LandingReveal delay={120}>
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

            <LandingReveal delay={180}>
              <div className="mt-[28px]">
                {ACCOUNT_TABS.map((tab) => {
                  if (!mountedTabs[tab]) return null;
                  return (
                    <div
                      key={tab}
                      style={{ display: activeTab === tab ? "block" : "none" }}
                    >
                      {renderTab(tab)}
                    </div>
                  );
                })}
              </div>
            </LandingReveal>
          </section>
        </div>
      </main>
      <div style={{ display: "none" }}>{children}</div>
    </div>
  );
}

// ─── Lazy Tab Loader ─────────────────────────────────────────────────────────

import dynamic from "next/dynamic";

const TAB_COMPONENTS: Record<string, React.ComponentType> = {
  plans: dynamic(() => import("@/components/account/tabs/PlansTab").then((m) => ({ default: m.PlansTab })), { ssr: false }),
  payment_methods: dynamic(() => import("@/components/account/tabs/PaymentMethodsTab").then((m) => ({ default: m.PaymentMethodsTab })), { ssr: false }),
  payment_history: dynamic(() => import("@/components/account/tabs/PaymentHistoryTab").then((m) => ({ default: m.PaymentHistoryTab })), { ssr: false }),
  api_keys: dynamic(() => import("@/components/account/tabs/ApiKeysTab").then((m) => ({ default: m.ApiKeysTab })), { ssr: false }),
  teams: dynamic(() => import("@/components/account/tabs/TeamsTab").then((m) => ({ default: m.TeamsTab })), { ssr: false }),
  tickets: dynamic(() => import("@/components/account/tabs/TicketsTab").then((m) => ({ default: m.TicketsTab })), { ssr: false }),
  delete_account: dynamic(() => import("@/components/account/tabs/DeleteAccountTab").then((m) => ({ default: m.DeleteAccountTab })), { ssr: false }),
};

function LazyTab({ id, ...props }: { id: string; [key: string]: any }) {
  const Component = TAB_COMPONENTS[id];
  if (!Component) return null;
  return <Component {...props} />;
}

// ─── Overview Content ─────────────────────────────────────────────────────────

type QuickCard = {
  id: AccountTab;
  icon: LucideIcon;
  title: string;
  description: string;
};

const QUICK_CARDS: QuickCard[] = [
  { id: "plans", icon: BadgePercent, title: "Planos", description: "Visualize seu plano atual, status e opções de upgrade." },
  { id: "payment_methods", icon: CreditCard, title: "Métodos de Pagamento", description: "Adicione ou remova cartões e métodos de pagamento." },
  { id: "payment_history", icon: History, title: "Histórico de Pagamentos", description: "Timeline de cobranças e transações aprovadas." },
  { id: "api_keys", icon: Key, title: "Chaves de API", description: "Crie chaves para integrar o Flowdesk externamente." },
  { id: "teams", icon: Users, title: "Equipes e Membros", description: "Gerencie equipes, convite membros e ajuste permissões." },
  { id: "tickets", icon: Ticket, title: "Tickets de Suporte", description: "Histórico de atendimentos e novos chamados." },
];

type AccountSummary = {
  plan: { name: string; status: string; maxServers: number } | null;
  teamsCount: number;
  apiKeysCount: number;
  paymentMethodsCount: number;
  ordersCount: number;
  ticketsCount: number;
  flowPoints: number;
};

function OverviewContent({
  onNavigate,
  displayName,
  avatarUrl,
}: {
  onNavigate: (tab: AccountTab) => void;
  displayName: string;
  avatarUrl: string | null;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<AccountSummary | null>(null);

  useEffect(() => {
    fetch("/api/auth/me/account/summary")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setSummary(data.summary);
        }
      })
      .catch((err) => console.error("Error fetching account summary", err))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-[28px]">
        {/* Profile Card Skeleton */}
        <div className="flex items-center justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] px-[22px] py-[20px]">
          <div className="flex items-center gap-[18px]">
            <div className="flowdesk-shimmer h-[60px] w-[60px] shrink-0 rounded-full bg-[#1A1A1A]" />
            <div className="space-y-[8px]">
              <div className="flowdesk-shimmer h-[22px] w-[140px] rounded-[6px] bg-[#1A1A1A]" />
              <div className="flowdesk-shimmer h-[14px] w-[110px] rounded-[6px] bg-[#151515]" />
            </div>
          </div>
        </div>

        {/* Overview Stats Skeleton */}
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flowdesk-shimmer h-[104px] w-full rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
          ))}
        </div>

        {/* Quick Access Skeleton */}
        <div className="grid gap-[10px] sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flowdesk-shimmer h-[130px] w-full rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-[24px]">
      {/* Profile card */}
      <div className="flex flex-col gap-[18px] sm:flex-row sm:items-center sm:justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] px-[22px] py-[20px]">
        <div className="flex items-center gap-[18px]">
          <AccountAvatar avatarUrl={avatarUrl} displayName={displayName} size={60} />
          <div>
            <p className="text-[22px] font-semibold tracking-tight text-[#EEEEEE]">{displayName}</p>
            <div className="mt-[5px] flex items-center gap-[8px]">
              <BadgePercent className="h-[14px] w-[14px] text-[#A6A6A6]" />
              <span className="text-[14px] font-medium text-[#D1D1D1]">
                {summary?.plan?.name || "Plano Free"}
              </span>
              <span className="text-[14px] text-[#666666]">• Membro do Flowdesk</span>
            </div>
          </div>
        </div>
        
        {/* Flow Points display on the right */}
        {summary && summary.flowPoints !== undefined && (
          <div className="flex items-center gap-[10px]">
            <Coins className="h-[22px] w-[22px] text-white" />
            <p className="text-[20px] font-bold tracking-tight text-white leading-none">
              {summary.flowPoints}
            </p>
          </div>
        )}
      </div>

      <hr className="border-[#141414] opacity-50" />

      {/* Realtime Stats Grid */}
      {summary && (
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[18px]">
              <div className="flex items-center gap-[10px]">
                <Activity className="h-[16px] w-[16px] text-[#D5D5D5]" />
                <span className="text-[13px] font-medium text-[#8F8F8F]">Plano & Limites</span>
              </div>
              <div className="mt-[14px]">
                <p className="text-[24px] font-semibold text-[#EEEEEE]">{summary.plan?.maxServers || 1}</p>
                <p className="text-[13px] text-[#5A5A5A]">Servidores licenciados</p>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[18px]">
              <div className="flex items-center gap-[10px]">
                <Users className="h-[16px] w-[16px] text-[#D5D5D5]" />
                <span className="text-[13px] font-medium text-[#8F8F8F]">Equipes</span>
              </div>
              <div className="mt-[14px]">
                <p className="text-[24px] font-semibold text-[#EEEEEE]">{summary.teamsCount}</p>
                <p className="text-[13px] text-[#5A5A5A]">{summary.teamsCount === 1 ? 'Equipe ativa' : 'Equipes ativas'}</p>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[18px]">
              <div className="flex items-center gap-[10px]">
                <History className="h-[16px] w-[16px] text-[#D5D5D5]" />
                <span className="text-[13px] font-medium text-[#8F8F8F]">Faturas</span>
              </div>
              <div className="mt-[14px]">
                <p className="text-[24px] font-semibold text-[#EEEEEE]">{summary.ordersCount}</p>
                <p className="text-[13px] text-[#5A5A5A]">{summary.ordersCount === 1 ? 'Fatura no histórico' : 'Faturas no histórico'}</p>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[18px]">
              <div className="flex items-center gap-[10px]">
                <Key className="h-[16px] w-[16px] text-[#D5D5D5]" />
                <span className="text-[13px] font-medium text-[#8F8F8F]">Chaves API</span>
              </div>
              <div className="mt-[14px]">
                <p className="text-[24px] font-semibold text-[#EEEEEE]">{summary.apiKeysCount}</p>
                <p className="text-[13px] text-[#5A5A5A]">{summary.apiKeysCount === 1 ? 'Chave criada' : 'Chaves criadas'}</p>
              </div>
            </div>
          </div>
      )}

      {summary && <hr className="border-[#141414] opacity-50" />}

      {/* Quick access grid */}
      <div className="grid gap-[10px] sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onNavigate(card.id)}
                className="group flex w-full flex-col items-start justify-between min-h-[130px] rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[20px] text-left transition-all duration-300 hover:scale-[1.01] hover:border-[#222222] hover:bg-gradient-to-b hover:from-[#0D0D0D] hover:to-[#0A0A0A]"
              >
                <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[12px] border border-[#1A1A1A] bg-[#111111] transition-colors group-hover:border-[#2A2A2A] group-hover:bg-[#151515]">
                  <Icon className="h-[18px] w-[18px] text-[#888888] group-hover:text-[#E2E2E2] transition-colors" strokeWidth={1.8} />
                </div>
                <div className="mt-[18px]">
                  <p className="text-[15px] font-semibold text-[#DDDDDD] group-hover:text-[#FFFFFF] transition-colors">
                    {card.title}
                  </p>
                  <p className="mt-[6px] text-[13px] leading-[1.4] text-[#666666] group-hover:text-[#888888] transition-colors">
                    {card.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
    </div>
  );
}
