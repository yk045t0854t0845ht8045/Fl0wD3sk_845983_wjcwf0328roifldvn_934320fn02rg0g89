"use client";

import React, { useEffect, useState, useMemo, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  ChevronRight,
  Bell,
  Mail,
  Webhook,
  MessageSquare,
  type LucideIcon
} from "lucide-react";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { StatusSubscribeModalContent } from "@/components/status/StatusSubscribeModalContent";
import type {
  ComponentStatus,
  Incident,
  IncidentImpact,
  IncidentStatus,
  StatusSubscriptionType,
  StatusTeamNote,
  SystemStatus,
} from "@/lib/status/types";

const STATUS_CONFIG: Record<SystemStatus, { label: string; color: string; icon: LucideIcon; bannerClass: string }> = {
  operational: { 
    label: "Todos os sistemas operacionais", 
    color: "#0070FF", 
    icon: CheckCircle2,
    bannerClass: "bg-[#0070FF]"
  },
  degraded_performance: { 
    label: "Instabilidade leve detectada em alguns serviços", 
    color: "#F2C823", 
    icon: AlertTriangle,
    bannerClass: "bg-[#0070FF]"
  },
  partial_outage: { 
    label: "Alguns sistemas operando com latência", 
    color: "#FF9F0A", 
    icon: AlertCircle,
    bannerClass: "bg-[#0070FF]"
  },
  major_outage: { 
    label: "Falha Critica - Nossa equipe já está lidando com a situação", 
    color: "#FF3B30", 
    icon: XCircle,
    bannerClass: "bg-[#FF3B30]"
  }
};

const BANNER_LABELS: Record<SystemStatus, string> = {
  operational: "Todos os sistemas operacionais",
  degraded_performance: "Operacional",
  partial_outage: "Alguns sistemas operando com latencia",
  major_outage: "Falha critica - nossa equipe ja esta atuando",
};

STATUS_CONFIG.degraded_performance.label = "Operacional";
STATUS_CONFIG.partial_outage.label = "Alguns sistemas operando com latencia";
STATUS_CONFIG.major_outage.label = "Falha critica - nossa equipe ja esta atuando";
BANNER_LABELS.partial_outage = "Alguns sistemas operando com latencia";
BANNER_LABELS.major_outage = "Falha critica - nossa equipe ja esta atuando";

const IMPACT_CONFIG: Record<IncidentImpact, { label: string; color: string }> = {
  critical: { label: "Critico", color: "#FF3B30" },
  warning: { label: "Aviso", color: "#F2C823" },
  info: { label: "Informativo", color: "#0070FF" }
};

const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  investigating: "Investigando",
  identified: "Identificado",
  monitoring: "Monitorando",
  resolved: "Resolvido"
};

function buildUtcDay(daysAgo: number) {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - daysAgo);
  return day;
}

function formatUtcDayLabel(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function SkeletonBar({ width, height, className = "" }: { width: number | string; height: number | string; className?: string }) {
  return (
    <div
      className={`flowdesk-shimmer rounded-[12px] bg-[#171717] ${className}`.trim()}
      style={{ width, height }}
    />
  );
}

function StatusSkeleton() {
  return (
    <div className="mx-auto max-w-[900px] px-6 py-16">
      {/* Header Skeleton */}
      <div className="mb-16 flex items-center justify-between">
        <SkeletonBar width={182} height={36} className="rounded-md" />
        <SkeletonBar width={220} height={42} className="rounded-full" />
      </div>

      {/* Main Banner Skeleton */}
      <SkeletonBar width="100%" height={88} className="mb-16 rounded-xl" />

      {/* Components List Skeleton */}
      <div className="mb-24 space-y-12">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="flex justify-between">
              <SkeletonBar width={120} height={18} className="rounded-md" />
              <SkeletonBar width={80} height={18} className="rounded-md" />
            </div>
            <SkeletonBar width="100%" height={34} className="rounded-[4px]" />
            <div className="flex justify-between">
              <SkeletonBar width={70} height={12} className="rounded-md" />
              <SkeletonBar width={40} height={12} className="rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Incidents Skeleton */}
      <div className="space-y-12">
        <SkeletonBar width={240} height={32} className="mb-8 rounded-md" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-t border-[#1A1A1A] pt-8 space-y-4">
            <SkeletonBar width={180} height={24} className="rounded-md" />
            <SkeletonBar width="60%" height={16} className="rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface SubscribeModalContentProps {
  resetSubscribeModal: () => void;
  subscribing: boolean;
  setSubscribing: (s: boolean) => void;
}

export const LegacySubscribeModalContent = ({ resetSubscribeModal, subscribing, setSubscribing }: SubscribeModalContentProps) => {
  const [subscribeType, setSubscribeType] = useState<string | null>(null);
  const [subscribeTarget, setSubscribeTarget] = useState("");
  const [subscribeStatus, setSubscribeStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [subscribeErrorMessage, setSubscribeErrorMessage] = useState("");

  const handleSubscribe = async () => {
    if (!subscribeTarget || !subscribeType) return;

    setSubscribing(true);
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        body: JSON.stringify({ type: subscribeType, target: subscribeTarget }),
        headers: { "Content-Type": "application/json" }
      });
      const json = await res.json();
      if (json.ok) {
        setSubscribeStatus('success');
      } else {
        setSubscribeStatus('error');
        setSubscribeErrorMessage(json.error || "Erro ao se inscrever.");
      }
    } catch {
      setSubscribeStatus('error');
      setSubscribeErrorMessage("Erro ao se inscrever. Tente novamente.");
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <div className="relative z-10">
      <div className="flex items-start justify-between">
        {!subscribeType ? (
          <div>
            <LandingGlowTag className="px-[18px]">Notificações</LandingGlowTag>
            <div className="mt-[18px]">
              <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[36px]">
                Receba atualizações
              </h2>
              <p className="mt-[14px] text-[14px] leading-[1.62] text-[#787878]">
                Escolha como você deseja ser notificado sobre mudanças no status do sistema.
              </p>
            </div>
          </div>
        ) : subscribeStatus === 'success' ? (
          <div className="w-full text-center py-6">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#0070FF]/10 text-[#0070FF]">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[36px]">
              Inscrito com sucesso!
            </h2>
            <p className="mt-4 text-[14px] leading-[1.62] text-[#787878]">
              Você agora receberá atualizações em tempo real via {subscribeType.replace('_', ' ')}.
            </p>
          </div>
        ) : (
          <div>
            <button 
              onClick={() => setSubscribeType(null)}
              className="mb-6 flex items-center gap-2 text-[13px] text-[#666] transition-colors hover:text-white"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
              Voltar para opções
            </button>

            <LandingGlowTag className="px-[18px]">Configuração</LandingGlowTag>
            <div className="mt-[18px]">
              <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[36px]">
                {subscribeType === 'email' ? 'Seu E-mail' : 
                  subscribeType === 'discord_dm' ? 'Seu ID do Discord' :
                  subscribeType === 'webhook' ? 'URL do Webhook' : 'ID do Canal'}
              </h2>
              <p className="mt-[14px] text-[14px] leading-[1.62] text-[#787878]">
                {subscribeType === 'email' ? 'Insira seu melhor e-mail para receber as notificações.' : 
                  subscribeType === 'discord_dm' ? 'Insira seu ID de usuário do Discord para enviarmos a DM.' :
                  subscribeType === 'webhook' ? 'Insira a URL completa para onde enviaremos o POST.' : 'Insira o ID do canal de texto onde postaremos as atualizações.'}
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={resetSubscribeModal}
          className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4]"
          aria-label="Fechar modal"
        >
          <span className="text-[18px] leading-none">×</span>
        </button>
      </div>

      {!subscribeType ? (
        <div className="mt-8 space-y-3">
          <SubscriptionOption 
            icon={Mail} 
            label="E-mail" 
            description="Receba alertas diretamente na sua caixa de entrada."
            onClick={() => setSubscribeType("email")}
          />
          <SubscriptionOption 
            icon={MessageSquare} 
            label="Discord DM" 
            description="Alertas via mensagem direta no Discord."
            onClick={() => setSubscribeType("discord_dm")}
          />
          <SubscriptionOption 
            icon={Webhook} 
            label="Webhook" 
            description="Integre alertas no seu próprio sistema."
            onClick={() => setSubscribeType("webhook")}
          />
          <SubscriptionOption 
            icon={Bell} 
            label="Canal do Discord" 
            description="Acompanhe no canal oficial da Flowdesk."
            onClick={() => setSubscribeType("discord_channel")}
          />
        </div>
      ) : subscribeStatus === 'success' ? (
        <div className="mt-8">
          <LandingActionButton 
            variant="dark"
            onClick={resetSubscribeModal}
            className="w-full !h-[46px] !rounded-[14px]"
          >
            Fechar
          </LandingActionButton>
        </div>
      ) : (
        <>
          <div className="mt-8">
            <input 
              type="text"
              value={subscribeTarget}
              onChange={(e) => setSubscribeTarget(e.target.value)}
              placeholder={subscribeType === 'email' ? 'exemplo@email.com' : 'ID ou URL...'}
              className="w-full rounded-[14px] border border-[#171717] bg-[#070707] px-5 py-4 text-[15px] text-white outline-none ring-[#0070FF]/20 focus:border-[#0070FF] focus:ring-4 transition-all"
              autoFocus
            />
            {subscribeStatus === 'error' && (
              <p className="mt-3 text-[13px] text-red-500 font-medium">{subscribeErrorMessage}</p>
            )}
          </div>

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <LandingActionButton 
              variant="dark"
              onClick={resetSubscribeModal}
              className="flex-1 sm:flex-none !h-[46px] !rounded-[14px] sm:min-w-[120px]"
            >
              Cancelar
            </LandingActionButton>
            <LandingActionButton 
              variant="light"
              onClick={handleSubscribe}
              disabled={subscribing || !subscribeTarget}
              className="flex-1 sm:flex-none !h-[46px] !rounded-[14px] sm:min-w-[140px]"
            >
              {subscribing ? <ButtonLoader size={20} colorClassName="text-[#282828] mx-auto" /> : 'Confirmar'}
            </LandingActionButton>
          </div>
        </>
      )}
    </div>
  );
};

const StatusHistoryBar = memo(({ history, incidents }: { history: { date: string; status: SystemStatus }[]; incidents: Incident[] }) => {
  const historyByDate = useMemo(() => {
    const map = new Map<string, SystemStatus>();
    for (const entry of history) {
      map.set(entry.date, entry.status);
    }
    return map;
  }, [history]);

  const incidentDaySet = useMemo(() => {
    const set = new Set<string>();
    for (const incident of incidents) {
      if (incident.created_at) {
        set.add(incident.created_at.slice(0, 10));
      }
    }
    return set;
  }, [incidents]);

  return (
    <div className="flex h-[34px] gap-[2px]">
      {Array.from({ length: 90 }).map((_, i) => {
        const d = buildUtcDay(89 - i);
        const dateIso = d.toISOString().slice(0, 10);
        const dateStr = formatUtcDayLabel(d);
        
        const dayStatus = historyByDate.get(dateIso) || "operational";
        const hasIncident = incidentDaySet.has(dateIso);
        
        return (
          <div key={i} className="group/bar relative flex-1">
            <div 
              className="h-full w-full rounded-[1px] transition-all hover:scale-y-110"
              style={{ backgroundColor: STATUS_CONFIG[dayStatus].color }}
            />
            
            {/* Tooltip */}
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 z-50 w-[280px] -translate-x-1/2 opacity-0 transition-all group-hover/bar:opacity-100 group-hover/bar:translate-y-0 translate-y-2">
              <div className="relative rounded-lg border border-[#1A1A1A] bg-[#0A0A0A] p-4 shadow-2xl">
                <p className="mb-2 text-[14px] font-bold text-white">{dateStr}</p>
                <p className="text-[13px] leading-relaxed text-[#999]">
                  {dayStatus === 'operational' && !hasIncident 
                    ? "Nenhuma interrupção de serviço foi registrada neste dia." 
                    : hasIncident 
                      ? "Incidentes registrados neste dia. Veja detalhes abaixo."
                      : STATUS_CONFIG[dayStatus].label}
                </p>
                {/* Arrow */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-[#0A0A0A]" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

StatusHistoryBar.displayName = "StatusHistoryBar";

export default function StatusPageClient() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<{
    components: ComponentStatus[];
    incidents: Incident[];
    overallStatus?: SystemStatus;
    rawOverallStatus?: SystemStatus;
    teamNote?: StatusTeamNote | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [initialSubscribeType, setInitialSubscribeType] =
    useState<StatusSubscriptionType | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [flowAiLive, setFlowAiLive] = useState<null | {
    checkedAt: string;
    overall: { status: SystemStatus; latencyMs: number | null };
    upstream: { openai: { status: SystemStatus; latencyMs: number | null } };
    integrations: {
      domainSuggestions: { status: SystemStatus; latencyMs: number | null };
      ticketAi: { status: SystemStatus; latencyMs: number | null };
      discordMessageAi: { status: SystemStatus; latencyMs: number | null };
    };
  }>(null);
  const [apiLive, setApiLive] = useState<null | {
    checkedAt: string;
    latencyMs: number | null;
    status: SystemStatus;
    message: string | null;
  }>(null);
  const [scheduledTasksLive, setScheduledTasksLive] = useState<null | {
    checkedAt: string;
    latencyMs: number | null;
    status: SystemStatus;
    message: string | null;
  }>(null);
  const [domainsLive, setDomainsLive] = useState<null | {
    checkedAt: string;
    latencyMs: number | null;
    status: SystemStatus;
    message: string | null;
  }>(null);
  const [discordBotLive, setDiscordBotLive] = useState<null | {
    checkedAt: string;
    latencyMs: number | null;
    status: SystemStatus;
    message: string | null;
  }>(null);

  const incidentsByDay = useMemo(() => {
    const map = new Map<string, Incident[]>();
    for (const incident of data?.incidents || []) {
      const dayKey = incident.created_at ? incident.created_at.slice(0, 10) : "";
      if (!dayKey) continue;
      const current = map.get(dayKey);
      if (current) {
        current.push(incident);
      } else {
        map.set(dayKey, [incident]);
      }
    }
    return map;
  }, [data?.incidents]);
  
  const resetSubscribeModal = () => {
    setShowSubscribe(false);
    setInitialSubscribeType(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("subscribe");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  };

  useEffect(() => {
    const requestedType = searchParams.get("subscribe");
    if (
      requestedType === "email" ||
      requestedType === "discord_dm" ||
      requestedType === "webhook" ||
      requestedType === "discord_channel"
    ) {
      setInitialSubscribeType(requestedType);
      setShowSubscribe(true);
    }
  }, [searchParams]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function fetchStatus() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (json.ok) {
          setData(json);
          setError(null);
        } else {
          setError(json.error || "Erro desconhecido ao buscar status.");
        }
      } catch (error) {
        console.error("Failed to fetch status:", error);
        setError("Falha na conexão com o servidor.");
      } finally {
        if (alive) {
          setLoading(false);
          setIsInitialLoad(false);
        }
      }
    }
    void fetchStatus();
    timer = setInterval(fetchStatus, 15000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchFlowAiLive() {
      try {
        const res = await fetch("/api/status/flowai", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (json?.ok) {
          setFlowAiLive({
            checkedAt: json.checkedAt,
            overall: { status: json.overall?.status || "operational", latencyMs: json.overall?.latencyMs ?? null },
            upstream: { openai: { status: json.upstream?.openai?.status || "operational", latencyMs: json.upstream?.openai?.latencyMs ?? null } },
            integrations: {
              domainSuggestions: { status: json.integrations?.domainSuggestions?.status || "operational", latencyMs: json.integrations?.domainSuggestions?.latencyMs ?? null },
              ticketAi: { status: json.integrations?.ticketAi?.status || "operational", latencyMs: json.integrations?.ticketAi?.latencyMs ?? null },
              discordMessageAi: { status: json.integrations?.discordMessageAi?.status || "operational", latencyMs: json.integrations?.discordMessageAi?.latencyMs ?? null },
            },
          });
        }
      } catch {
        // Silent: status page should still work from DB-based components.
      }
    }

    void fetchFlowAiLive();
    timer = setInterval(fetchFlowAiLive, 15000);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchDomainsLive() {
      try {
        const res = await fetch("/api/status/domains", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (json?.ok !== undefined) {
          setDomainsLive({
            checkedAt: json.checkedAt,
            latencyMs: json.latencyMs ?? null,
            status: json.status || "operational",
            message: json.message || null,
          });
        }
      } catch {
        // Silent: page still works with aggregate status data.
      }
    }

    void fetchDomainsLive();
    timer = setInterval(fetchDomainsLive, 15000);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchDiscordBotLive() {
      try {
        const res = await fetch("/api/status/discord-bot", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (json?.status) {
          setDiscordBotLive({
            checkedAt: json.checkedAt,
            latencyMs: json.latencyMs ?? null,
            status: json.status || "operational",
            message: json.message || null,
          });
        }
      } catch {
        // Silent: aggregate data still renders.
      }
    }

    void fetchDiscordBotLive();
    timer = setInterval(fetchDiscordBotLive, 15000);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchApiLive() {
      try {
        const res = await fetch("/api/status/api", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (json?.ok !== undefined) {
          setApiLive({
            checkedAt: json.checkedAt,
            latencyMs: json.latencyMs ?? null,
            status: json.status || "operational",
            message: json.message || null,
          });
        }
      } catch {
        // Silent: status page should still work from DB-based components.
      }
    }

    void fetchApiLive();
    timer = setInterval(fetchApiLive, 15000);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchScheduledTasksLive() {
      try {
        const res = await fetch("/api/status/scheduled-tasks", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (json?.ok !== undefined) {
          setScheduledTasksLive({
            checkedAt: json.checkedAt,
            latencyMs: json.latencyMs ?? null,
            status: json.status || "operational",
            message: json.message || null,
          });
        }
      } catch {
        // Silent: status page should still work from DB-based components.
      }
    }

    void fetchScheduledTasksLive();
    timer = setInterval(fetchScheduledTasksLive, 15000);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  const syncStatus = useMemo(() => {
    if (!data?.components.length) return { label: null, isStale: false };

    const latest = data.components.reduce((acc, curr) => {
      const dateStr = curr.updated_at || curr.created_at;
      if (!dateStr) return acc;
      const currTime = new Date(dateStr).getTime();
      return currTime > acc ? currTime : acc;
    }, 0);

    if (latest === 0) return { label: null, isStale: false };

    const diffMinutes = (Date.now() - latest) / 1000 / 60;
    const isStale = diffMinutes > 5; // Mais de 5 minutos sem atualização = Stale

    return {
      label: new Date(latest).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      isStale
    };
  }, [data]);

  const overallStatus = useMemo(() => {
    if (!data) return "operational" as SystemStatus;
    
    // Se os dados estão muito antigos (monitoramento parou), mudar status geral para alerta
    if (syncStatus.isStale) return "degraded_performance";
    if (data.overallStatus) return data.overallStatus;

    if (data.components.some(c => c.status === "major_outage")) return "major_outage";
    if (data.components.some(c => c.status === "partial_outage")) return "partial_outage";
    if (data.components.some(c => c.status === "degraded_performance")) return "degraded_performance";
    return "operational";
  }, [data, syncStatus.isStale]);

  if (isInitialLoad) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <ButtonLoader size={32} colorClassName="text-[#EDEDED]" />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-black">
        <StatusSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white px-6">
        <div className="max-w-[500px] rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
          <h2 className="mb-2 text-[20px] font-bold text-white">Erro de Configuração</h2>
          <p className="mb-6 text-[14px] text-[#999] leading-relaxed">
            {error}
          </p>
          <div className="rounded-lg bg-black/40 p-4 text-left font-mono text-[12px] text-red-400">
            <code>PGRST205: Could not find the table &apos;public.system_components&apos;</code>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="mt-6 rounded-lg bg-white px-6 py-2 text-[14px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const config = STATUS_CONFIG[overallStatus];
  const Icon = config.icon;
  const bannerLabel = syncStatus.isStale ? "Status sob monitoramento" : BANNER_LABELS[overallStatus];

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-[#0070FF]/30">
      <div className="mx-auto max-w-[900px] px-6 py-16">
        {/* Header */}
        <div className="mb-16 flex items-center justify-between">
          <div className="relative h-[36px] w-[182px]">
            <Image
              src="/cdn/logos/logo.png"
              alt="Flowdesk"
              fill
              sizes="182px"
              className="object-contain object-left"
              priority
            />
          </div>
          <LandingActionButton 
            variant="dark"
            onClick={() => {
              setInitialSubscribeType(null);
              setShowSubscribe(true);
            }}
            className="!h-[42px] !rounded-full px-6"
          >
            Inscreva-se para receber atualizações
          </LandingActionButton>
        </div>

        {/* Main Banner */}
        <LandingReveal delay={0}>
          <div className={`mb-16 relative overflow-hidden flex items-center justify-between rounded-xl px-8 py-6 shadow-[0_0_40px_-15px_rgba(0,0,0,0.3)] ${config.bannerClass} bg-opacity-90 backdrop-blur-md`}>
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                <Icon className="h-6 w-6 text-white" />
              </div>
              <div>
                <span className="text-[20px] font-bold tracking-tight text-white block leading-tight">
                  {bannerLabel}
                </span>
                {syncStatus.isStale && (
                  <span className="text-[12px] font-medium text-white/60">
                    Última verificação realizada com sucesso. Sincronização automática ativa.
                  </span>
                )}
              </div>
            </div>
          </div>
        </LandingReveal>

        {overallStatus === "major_outage" && data?.teamNote && (
          <LandingReveal delay={0.04}>
            <div className="mb-16 rounded-xl border border-[#2A1010] bg-[#120707] px-6 py-5 shadow-[0_0_30px_-18px_rgba(255,59,48,0.55)]">
              <div className="border-l-[4px] border-[#FF3B30] pl-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#FF8E88]">
                  Nota da equipe
                </p>
                <h3 className="mt-2 text-[20px] font-semibold text-white">
                  {data.teamNote.title}
                </h3>
                <p className="mt-3 max-w-[760px] text-[14px] leading-[1.7] text-[#E7D4D3]">
                  {data.teamNote.description}
                </p>
                <p className="mt-4 text-[12px] text-[#B88C89]">
                  Componentes afetados: {data.teamNote.affected_components.join(", ")}
                </p>
              </div>
            </div>
          </LandingReveal>
        )}

        {/* Components List */}
        <div className="mb-24 space-y-12">
          {data?.components.map((component, idx) => {
            const sourceKey = component.source_key || "";
            const isFlowAi = sourceKey === "flowai" || /flow\s*ai/i.test(component.name);
            const isApi = sourceKey === "api" || /api/i.test(component.name);
            const isScheduledTasks = sourceKey === "scheduled_tasks" || /tarefas\s*agendadas/i.test(component.name);
            const isDomainsRelated = sourceKey === "domains" || /registro de dom[ií]nio|dns|certificado ssl|firewall dns|geolocaliza/i.test(component.name);
            const isDiscordBot = sourceKey === "discord" || /discord bot|notifica/i.test(component.name);
            const effectiveStatus =
              isFlowAi && flowAiLive
                ? flowAiLive.overall.status
                : isApi && apiLive
                  ? apiLive.status
                  : isScheduledTasks && scheduledTasksLive
                    ? scheduledTasksLive.status
                    : isDomainsRelated && domainsLive
                      ? domainsLive.status
                      : isDiscordBot && discordBotLive
                        ? discordBotLive.status
                      : component.status;
            const effectiveLatencyMs =
              isFlowAi && flowAiLive
                ? flowAiLive.overall.latencyMs
                : isApi && apiLive
                  ? apiLive.latencyMs
                  : isScheduledTasks && scheduledTasksLive
                    ? scheduledTasksLive.latencyMs
                    : isDomainsRelated && domainsLive
                      ? domainsLive.latencyMs
                      : isDiscordBot && discordBotLive
                        ? discordBotLive.latencyMs
                        : component.latency_ms ?? null;

            return (
            <LandingReveal key={component.id} delay={0.05 * idx}>
              <div className="group">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {/* {component.description && <ChevronRight className="h-4 w-4 text-[#666]" />} */}
                    <span className="text-[16px] font-medium text-[#EDEDED]">{component.name}</span>
                  </div>
                  <span className="text-[14px] font-medium" style={{ color: STATUS_CONFIG[effectiveStatus].color }}>
                    {effectiveStatus === 'operational' ? 'Operacional' : STATUS_CONFIG[effectiveStatus].label}
                    {effectiveLatencyMs !== null ? ` - ${effectiveLatencyMs}ms` : ""}
                  </span>
                </div>
                
                {/* 90 Days History Bar */}
                <StatusHistoryBar 
                  history={component.history} 
                  incidents={data?.incidents || []} 
                />
                
                <div className="mt-2 flex items-center justify-between text-[12px] text-[#666]">
                  <span>90 dias atrás</span>
                  <div className="h-[1px] flex-1 mx-4 bg-[#1A1A1A]" />
                  <span>Hoje</span>
                </div>
              </div>
            </LandingReveal>
            );
          })}
        </div>

        {/* Incidents History */}
        <div className="mb-16">
          <h2 className="mb-8 text-[24px] font-semibold text-white">Incidentes passados</h2>
          
          <div className="space-y-12">
            {/* Group incidents by date */}
            {Array.from({ length: 7 }).map((_, i) => {
              const date = buildUtcDay(i);
              const dateStr = formatUtcDayLabel(date);
              const dateIso = date.toISOString().slice(0, 10);
              
              const dayIncidents = incidentsByDay.get(dateIso) || [];

              return (
                <div key={i} className="border-t border-[#1A1A1A] pt-8">
                  <h3 className="mb-4 text-[18px] font-semibold text-white">{dateStr}</h3>
                  
                  {dayIncidents.length === 0 ? (
                    <p className="text-[14px] text-[#666]">Nenhum incidente foi relatado nesta data.</p>
                  ) : (
                    <div className="space-y-8">
                      {dayIncidents.map(incident => (
                        <div key={incident.id} className="space-y-4">
                          <h4 className="text-[16px] font-semibold" style={{ color: IMPACT_CONFIG[incident.impact].color }}>
                            {incident.title}
                          </h4>
                          
                          {incident.updates.map(update => (
                            <div key={update.id} className="space-y-1">
                              <p className="text-[14px] font-bold text-white">
                                {INCIDENT_STATUS_LABELS[update.status]} - 
                                <span className="font-normal text-[#999] ml-2">
                                  {new Date(update.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC
                                </span>
                              </p>
                              <p className="text-[14px] text-[#EDEDED] leading-relaxed">
                                {update.message}
                              </p>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Footer */}
        <div className="mt-32 border-t border-[#1A1A1A] pt-12 text-center">
          <p className="text-[14px] text-[#666]">
            &copy; {new Date().getFullYear()} Flowdesk. Todos os direitos reservados.
          </p>
          <div className="mt-4 flex justify-center gap-6">
            <Link href="/terms" className="text-[13px] text-[#444] transition-colors hover:text-[#666]">Termos</Link>
            <Link href="/privacy" className="text-[13px] text-[#444] transition-colors hover:text-[#666]">Privacidade</Link>
            <Link href="/" className="text-[13px] text-[#444] transition-colors hover:text-[#666]">Pagina Inicial</Link>
          </div>
        </div>
      </div>

      {/* Subscription Modal */}
      <AnimatePresence>
        {showSubscribe && (
          <div className="fixed inset-0 z-[2600] flex items-center justify-center p-6 isolate">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={resetSubscribeModal}
              className="absolute inset-0 bg-[rgba(0,0,0,0.84)] backdrop-blur-[7px]"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-[540px] overflow-hidden rounded-[32px] bg-transparent p-[22px] shadow-[0_34px_110px_rgba(0,0,0,0.52)] sm:p-[28px]"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[32px] border border-[#0E0E0E]" />
              <span aria-hidden="true" className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[32px]" />
              <span aria-hidden="true" className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[32px]" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-[1px] rounded-[31px] bg-[linear-gradient(180deg,rgba(8,8,8,0.985)_0%,rgba(4,4,4,0.985)_100%)]" />

              <StatusSubscribeModalContent 
                resetSubscribeModal={resetSubscribeModal}
                subscribing={subscribing}
                setSubscribing={setSubscribing}
                initialType={initialSubscribeType}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SubscriptionOption({ icon: Icon, label, description, onClick }: { icon: LucideIcon, label: string, description: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex w-full items-start gap-4 rounded-xl border border-[#1A1A1A] bg-[#0D0D0D] p-4 text-left transition-colors hover:border-[#2A2A2A] hover:bg-[#111111]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1A1A1A] text-white">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-[15px] font-semibold text-white">{label}</h3>
        <p className="text-[13px] text-[#666]">{description}</p>
      </div>
      <ChevronRight className="ml-auto mt-1 h-4 w-4 text-[#333]" />
    </button>
  );
}
