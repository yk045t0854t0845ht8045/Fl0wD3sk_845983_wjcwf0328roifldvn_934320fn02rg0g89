"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { BadgePercent, CreditCard, History, Key, Users, Ticket, Coins, Activity } from "lucide-react";
import Image from "next/image";

import { type AccountTab } from "@/lib/account/tabs";

const TAB_COMPONENTS: Record<string, any> = {
  plans: dynamic(() => import("@/components/account/tabs/PlansTab").then((m) => ({ default: m.PlansTab })), { ssr: false }),
  payment_methods: dynamic(() => import("@/components/account/tabs/PaymentMethodsTab").then((m) => ({ default: m.PaymentMethodsTab })), { ssr: false }),
  payment_history: dynamic(() => import("@/components/account/tabs/PaymentHistoryTab").then((m) => ({ default: m.PaymentHistoryTab })), { ssr: false }),
  api_keys: dynamic(() => import("@/components/account/tabs/ApiKeysTab").then((m) => ({ default: m.ApiKeysTab })), { ssr: false }),
  teams: dynamic(() => import("@/components/account/tabs/TeamsTab").then((m) => ({ default: m.TeamsTab })), { ssr: false }),
  tickets: dynamic(() => import("@/components/account/tabs/TicketsTab").then((m) => ({ default: m.TicketsTab })), { ssr: false }),
  status: dynamic(() => import("@/components/account/tabs/StatusTab").then((m) => ({ default: m.StatusTab })), { ssr: false }),
  delete_account: dynamic(() => import("@/components/account/tabs/DeleteAccountTab").then((m) => ({ default: m.DeleteAccountTab })), { ssr: false }),
};


export function TabRenderer({ id, ...props }: { id: AccountTab; [key: string]: any }) {
  if (id === "overview") return <OverviewContent {...props} />;
  
  const Component = TAB_COMPONENTS[id];
  if (!Component) return null;
  
  const router = useRouter();
  
  // Custom props for specific tabs if needed
  const extraProps: any = {};
  if (id === "payment_history") {
    extraProps.onNavigateTickets = () => router.push("/account/tickets");
  }

  return <Component {...props} {...extraProps} />;
}

// ─── Overview Content ─────────────────────────────────────────────────────────

type QuickCard = {
  id: AccountTab;
  icon: any;
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

function OverviewContent({
  displayName,
  avatarUrl,
}: {
  displayName?: string;
  avatarUrl?: string | null;
}) {
  const router = useRouter();
  const onNavigate = (tab: AccountTab) => router.push(tab === "overview" ? "/account" : `/account/${tab}`);
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<any>(null);

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
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flowdesk-shimmer h-[104px] w-full rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
          ))}
        </div>
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
      <div className="flex flex-col gap-[18px] sm:flex-row sm:items-center sm:justify-between rounded-[20px] border border-[#141414] bg-[#0A0A0A] px-[22px] py-[20px]">
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
              <span className="text-[14px] text-[#666666]">• Membro do Flowdesk</span>
            </div>
          </div>
        </div>
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
