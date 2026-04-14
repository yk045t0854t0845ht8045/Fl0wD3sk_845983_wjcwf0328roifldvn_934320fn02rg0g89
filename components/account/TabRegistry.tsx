"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
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

const TAB_COMPONENTS: Record<string, ComponentType<any>> = {
  plans: dynamic(() => import("@/components/account/tabs/PlansTab").then((m) => ({ default: m.PlansTab })), { ssr: false }),
  payment_methods: dynamic(() => import("@/components/account/tabs/PaymentMethodsTab").then((m) => ({ default: m.PaymentMethodsTab })), { ssr: false }),
  payment_history: dynamic(() => import("@/components/account/tabs/PaymentHistoryTab").then((m) => ({ default: m.PaymentHistoryTab })), { ssr: false }),
  api_keys: dynamic(() => import("@/components/account/tabs/ApiKeysTab").then((m) => ({ default: m.ApiKeysTab })), { ssr: false }),
  teams: dynamic(() => import("@/components/account/tabs/TeamsTab").then((m) => ({ default: m.TeamsTab })), { ssr: false }),
  tickets: dynamic(() => import("@/components/account/tabs/TicketsTab").then((m) => ({ default: m.TicketsTab })), { ssr: false }),
  status: dynamic(() => import("@/components/account/tabs/StatusTab").then((m) => ({ default: m.StatusTab })), { ssr: false }),
  delete_account: dynamic(() => import("@/components/account/tabs/DeleteAccountTab").then((m) => ({ default: m.DeleteAccountTab })), { ssr: false }),
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
    extraProps.onNavigateTickets = () => router.push("/account/tickets");
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
  const { data, error, isLoading } = useSWR<AccountSummaryResponse>(
    "/api/auth/me/account/summary",
    async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.message || "Falha na requisicao");
      }
      return (await response.json()) as AccountSummaryResponse;
    },
    {
      fallbackData: initialSummary ? { ok: true, summary: initialSummary } : undefined,
      revalidateOnFocus: false,
      shouldRetryOnError: true,
      errorRetryCount: 3,
    },
  );

  const router = useRouter();
  const onNavigate = (tab: AccountTab) =>
    router.push(tab === "overview" ? "/account" : `/account/${tab}`);

  const summary = data?.ok ? data.summary ?? null : null;

  if (error) {
    console.error("[TabRegistry] SWR Error:", error);
  }

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
