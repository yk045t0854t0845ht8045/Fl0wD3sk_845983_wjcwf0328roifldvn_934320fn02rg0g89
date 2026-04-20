"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import Image from "next/image";
import {
  Activity,
  BadgePercent,
  Coins,
  CreditCard,
  History,
  Key,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";

import { type AccountTab } from "@/lib/account/tabs";
import {
  scheduleWarmBrowserRoutes,
  warmBrowserRoute,
} from "@/lib/routing/browserWarmup";

type AccountSummaryData = {
  plan?: {
    name?: string | null;
    maxServers?: number | null;
  } | null;
  teamsCount?: number;
  ordersCount?: number;
  apiKeysCount?: number;
  flowPoints?: number;
  initialTickets?: unknown[];
};

type AccountSummaryResponse = {
  ok: boolean;
  summary?: AccountSummaryData | null;
  message?: string;
};

type TabRendererProps = {
  id: AccountTab;
  initialSummary?: AccountSummaryData | null;
  initialTickets?: unknown[];
  displayName?: string;
  avatarUrl?: string | null;
  [key: string]: unknown;
};

const ACCOUNT_TAB_IMPORTERS = {
  plans: () => import("@/components/account/tabs/PlansTab"),
  payment_methods: () => import("@/components/account/tabs/PaymentMethodsTab"),
  payment_history: () => import("@/components/account/tabs/PaymentHistoryTab"),
  api_keys: () => import("@/components/account/tabs/ApiKeysTab"),
  teams: () => import("@/components/account/tabs/TeamsTab"),
  tickets: () => import("@/components/account/tabs/TicketsTab"),
  status: () => import("@/components/account/tabs/StatusTab"),
  delete_account: () => import("@/components/account/tabs/DeleteAccountTab"),
} as const;

const PRELOADABLE_ACCOUNT_TABS = Object.keys(
  ACCOUNT_TAB_IMPORTERS,
) as Array<Exclude<AccountTab, "overview">>;

function AccountTabLoadingState() {
  return (
    <div className="space-y-[16px]">
      <div className="flowdesk-shimmer h-[68px] rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
      <div className="grid gap-[12px] md:grid-cols-2">
        <div className="flowdesk-shimmer h-[140px] rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
        <div className="flowdesk-shimmer h-[140px] rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
      </div>
      <div className="flowdesk-shimmer h-[220px] rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
    </div>
  );
}

function preloadAccountTabModule(tab: Exclude<AccountTab, "overview">) {
  return ACCOUNT_TAB_IMPORTERS[tab]().catch(() => null);
}

const TAB_COMPONENTS: Record<string, ComponentType<Record<string, unknown>>> = {
  plans: dynamic<Record<string, unknown>>(() => ACCOUNT_TAB_IMPORTERS.plans().then((m) => m.PlansTab), { ssr: false, loading: AccountTabLoadingState }),
  payment_methods: dynamic<Record<string, unknown>>(() => ACCOUNT_TAB_IMPORTERS.payment_methods().then((m) => m.PaymentMethodsTab), { ssr: false, loading: AccountTabLoadingState }),
  payment_history: dynamic<Record<string, unknown>>(() => ACCOUNT_TAB_IMPORTERS.payment_history().then((m) => m.PaymentHistoryTab), { ssr: false, loading: AccountTabLoadingState }),
  api_keys: dynamic<Record<string, unknown>>(() => ACCOUNT_TAB_IMPORTERS.api_keys().then((m) => m.ApiKeysTab), { ssr: false, loading: AccountTabLoadingState }),
  teams: dynamic<Record<string, unknown>>(() => ACCOUNT_TAB_IMPORTERS.teams().then((m) => m.TeamsTab), { ssr: false, loading: AccountTabLoadingState }),
  tickets: dynamic<Record<string, unknown>>(() => ACCOUNT_TAB_IMPORTERS.tickets().then((m) => m.TicketsTab), { ssr: false, loading: AccountTabLoadingState }),
  status: dynamic<Record<string, unknown>>(() => ACCOUNT_TAB_IMPORTERS.status().then((m) => m.StatusTab), { ssr: false, loading: AccountTabLoadingState }),
  delete_account: dynamic<Record<string, unknown>>(() => ACCOUNT_TAB_IMPORTERS.delete_account().then((m) => m.DeleteAccountTab), { ssr: false, loading: AccountTabLoadingState }),
};

export function TabRenderer({
  id,
  initialSummary,
  initialTickets,
  displayName,
  avatarUrl,
  ...props
}: TabRendererProps) {
  const router = useRouter();
  const navigateToAccountPath = useCallback((href: string) => {
    const target = warmBrowserRoute(href, {
      router,
      prefetchDocument: true,
    });
    if (!target.sameOrigin) {
      window.location.assign(target.href);
      return;
    }

    router.push(target.path, { scroll: false });
  }, [router]);

  useEffect(() => {
    return scheduleWarmBrowserRoutes(
      PRELOADABLE_ACCOUNT_TABS.map((tab) => `/account/${tab}`),
      {
        router,
        delayMs: 90,
      },
    );
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      PRELOADABLE_ACCOUNT_TABS.forEach((tab) => {
        void preloadAccountTabModule(tab);
      });
    }, 60);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  if (id === "overview") {
    return (
      <OverviewContent
        initialSummary={initialSummary}
        displayName={displayName}
        avatarUrl={avatarUrl}
        {...props}
      />
    );
  }

  const Component = TAB_COMPONENTS[id];
  if (!Component) return null;

  const extraProps: Record<string, unknown> = {};
  if (id === "payment_history") {
    extraProps.onNavigateTickets = () => navigateToAccountPath("/account/tickets");
  }

  return (
    <Component
      initialTickets={initialTickets ?? initialSummary?.initialTickets}
      displayName={displayName}
      avatarUrl={avatarUrl}
      {...props}
      {...extraProps}
    />
  );
}

type QuickCard = {
  id: AccountTab;
  icon: LucideIcon;
  title: string;
  description: string;
};

const QUICK_CARDS: QuickCard[] = [
  { id: "plans", icon: BadgePercent, title: "Planos", description: "Visualize seu plano atual, status e opcoes de upgrade." },
  { id: "payment_methods", icon: CreditCard, title: "Metodos de Pagamento", description: "Adicione ou remova cartoes e metodos de pagamento." },
  { id: "payment_history", icon: History, title: "Historico de Pagamentos", description: "Timeline de cobrancas e transacoes aprovadas." },
  { id: "api_keys", icon: Key, title: "Chaves de API", description: "Crie chaves para integrar o Flowdesk externamente." },
  { id: "teams", icon: Users, title: "Equipes e Membros", description: "Gerencie equipes, convites e ajuste permissoes." },
  { id: "tickets", icon: Ticket, title: "Tickets de Suporte", description: "Historico de atendimentos e novos chamados." },
];

function OverviewContent({
  displayName,
  avatarUrl,
  initialSummary,
}: {
  displayName?: string;
  avatarUrl?: string | null;
  initialSummary?: AccountSummaryData | null;
}) {
  const hasInitialSummary = Boolean(initialSummary);
  const { data, isLoading } = useSWR<AccountSummaryResponse>(
    "/api/auth/me/account/summary",
    async (url) => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          return {
            ok: false,
            summary: null,
            message:
              typeof payload.message === "string"
                ? payload.message
                : "Falha ao atualizar o resumo da conta.",
          } satisfies AccountSummaryResponse;
        }

        return {
          ok: payload?.ok !== false,
          summary: payload?.summary ?? null,
          message:
            typeof payload?.message === "string" ? payload.message : undefined,
        } satisfies AccountSummaryResponse;
      } catch {
        return {
          ok: false,
          summary: null,
          message: "Nao foi possivel atualizar o resumo da conta agora.",
        } satisfies AccountSummaryResponse;
      }
    },
    {
      fallbackData: hasInitialSummary ? { ok: true, summary: initialSummary } : undefined,
      revalidateOnMount: !hasInitialSummary,
      revalidateIfStale: !hasInitialSummary,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      errorRetryCount: 0,
    },
  );

  const router = useRouter();
  const onNavigate = useCallback((tab: AccountTab) => {
    const href = tab === "overview" ? "/account" : `/account/${tab}`;
    const target = warmBrowserRoute(href, {
      router,
      prefetchDocument: true,
    });
    if (!target.sameOrigin) {
      window.location.assign(target.href);
      return;
    }

    router.push(target.path, { scroll: false });
  }, [router]);

  const summary = data?.ok ? data.summary ?? null : initialSummary ?? null;
  const summaryWarning =
    data && !data.ok ? data.message || "Nao foi possivel atualizar o resumo da conta." : null;

  if (isLoading) {
    return (
      <div className="space-y-[28px]">
        <div className="flex items-center justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] px-[22px] py-[20px]">
          <div className="flex items-center gap-[18px]">
            <div className="flowdesk-shimmer h-[60px] w-[60px] shrink-0 rounded-full bg-[#1A1A1A]" />
            <div className="space-y-[8px]">
              <div className="flowdesk-shimmer h-[22px] w-[140px] rounded-[6px] bg-[#1A1A1A]" />
              <div className="flowdesk-shimmer h-[14px] w-[110px] rounded-[6px] bg-[#151515]" />
            </div>
          </div>
        </div>
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="flowdesk-shimmer h-[104px] w-full rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
          ))}
        </div>
        <div className="grid gap-[10px] sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, index) => (
            <div key={index} className="flowdesk-shimmer h-[130px] w-full rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-[24px]">
      {summaryWarning && !summary ? (
        <div className="rounded-[18px] border border-[rgba(219,70,70,0.22)] bg-[rgba(42,12,12,0.82)] px-[18px] py-[14px]">
          <p className="text-[14px] font-medium text-[#F1D3D3]">{summaryWarning}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-[18px] rounded-[20px] border border-[#141414] bg-[#0A0A0A] px-[22px] py-[20px] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-[18px]">
          {avatarUrl ? (
            <Image src={avatarUrl} alt={displayName || ""} width={60} height={60} className="rounded-full" />
          ) : (
            <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-[#111] text-[20px] font-bold text-[#444]">
              {displayName?.charAt(0) || "?"}
            </div>
          )}
          <div>
            <p className="text-[22px] font-semibold tracking-tight text-[#EEEEEE]">{displayName}</p>
            <div className="mt-[5px] flex items-center gap-[8px]">
              <BadgePercent className="h-[14px] w-[14px] text-[#A6A6A6]" />
              <span className="text-[14px] font-medium text-[#D1D1D1]">
                {summary?.plan?.name || "Plano Free"}
              </span>
              <span className="text-[14px] text-[#666666]">- Membro do Flowdesk</span>
            </div>
          </div>
        </div>
        {summary && summary.flowPoints !== undefined ? (
          <div className="flex items-center gap-[10px]">
            <Coins className="h-[22px] w-[22px] text-white" />
            <p className="text-[20px] font-bold leading-none tracking-tight text-white">
              {summary.flowPoints}
            </p>
          </div>
        ) : null}
      </div>

      <hr className="border-[#141414] opacity-50" />

      {summary ? (
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
              <p className="text-[24px] font-semibold text-[#EEEEEE]">{summary.teamsCount ?? 0}</p>
              <p className="text-[13px] text-[#5A5A5A]">
                {(summary.teamsCount ?? 0) === 1 ? "Equipe ativa" : "Equipes ativas"}
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[18px]">
            <div className="flex items-center gap-[10px]">
              <History className="h-[16px] w-[16px] text-[#D5D5D5]" />
              <span className="text-[13px] font-medium text-[#8F8F8F]">Faturas</span>
            </div>
            <div className="mt-[14px]">
              <p className="text-[24px] font-semibold text-[#EEEEEE]">{summary.ordersCount ?? 0}</p>
              <p className="text-[13px] text-[#5A5A5A]">
                {(summary.ordersCount ?? 0) === 1 ? "Fatura no historico" : "Faturas no historico"}
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[18px]">
            <div className="flex items-center gap-[10px]">
              <Key className="h-[16px] w-[16px] text-[#D5D5D5]" />
              <span className="text-[13px] font-medium text-[#8F8F8F]">Chaves API</span>
            </div>
            <div className="mt-[14px]">
              <p className="text-[24px] font-semibold text-[#EEEEEE]">{summary.apiKeysCount ?? 0}</p>
              <p className="text-[13px] text-[#5A5A5A]">
                {(summary.apiKeysCount ?? 0) === 1 ? "Chave criada" : "Chaves criadas"}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {summary ? <hr className="border-[#141414] opacity-50" /> : null}

      <div className="grid gap-[10px] sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onNavigate(card.id)}
              onMouseEnter={() => {
                warmBrowserRoute(`/account/${card.id}`, { router });
                void preloadAccountTabModule(card.id);
              }}
              onFocus={() => {
                warmBrowserRoute(`/account/${card.id}`, { router });
                void preloadAccountTabModule(card.id);
              }}
              className="group flex min-h-[130px] w-full flex-col items-start justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[20px] text-left transition-all duration-300 hover:scale-[1.01] hover:border-[#222222] hover:bg-gradient-to-b hover:from-[#0D0D0D] hover:to-[#0A0A0A]"
            >
              <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[12px] border border-[#1A1A1A] bg-[#111111] transition-colors group-hover:border-[#2A2A2A] group-hover:bg-[#151515]">
                <Icon className="h-[18px] w-[18px] text-[#888888] transition-colors group-hover:text-[#E2E2E2]" strokeWidth={1.8} />
              </div>
              <div className="mt-[18px]">
                <p className="text-[15px] font-semibold text-[#DDDDDD] transition-colors group-hover:text-[#FFFFFF]">
                  {card.title}
                </p>
                <p className="mt-[6px] text-[13px] leading-[1.4] text-[#666666] transition-colors group-hover:text-[#888888]">
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
