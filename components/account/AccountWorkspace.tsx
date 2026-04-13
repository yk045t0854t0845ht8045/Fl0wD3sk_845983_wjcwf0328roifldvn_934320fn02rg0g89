"use client";

import { useRef, useState, useEffect, type ReactNode } from "react";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
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
  children: ReactNode;
};

export function AccountWorkspace({
  displayName,
  username,
  avatarUrl,
  children,
}: AccountWorkspaceProps) {
  const pathname = usePathname();
  const pathParts = pathname.split("/").filter(Boolean);
  const detectedTab = pathParts[pathParts.length - 1];
  const activeTab = validateTab(detectedTab === "account" ? "overview" : detectedTab);

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const router = useRouter();
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

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
                          router.push(item.id === "overview" ? "/account" : `/account/${item.id}`);
                        }}
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
                {children}
              </div>
            </LandingReveal>
          </section>
        </div>
      </main>
    </div>
  );
}
