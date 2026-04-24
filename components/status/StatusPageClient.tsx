"use client";

import React, { useEffect, useState, useMemo, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  Cloud,
  ShieldCheck,
  Server,
  type LucideIcon
} from "lucide-react";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { StatusSubscribeModalContent } from "@/components/status/StatusSubscribeModalContent";
import type {
  ComponentStatus,
  Incident,
  IncidentStatus,
  StatusSubscriptionType,
  StatusTeamNote,
  SystemStatus,
} from "@/lib/status/types";

// STATUSPAGE ULTRA CONFIG
const STATUS_CONFIG: Record<SystemStatus, { label: string; color: string; icon: LucideIcon; bannerClass: string }> = {
  operational: {
    label: "Todos os sistemas operacionais",
    color: "#0070FF",
    icon: CheckCircle2,
    bannerClass: "bg-[#0070FF]"
  },
  degraded_performance: {
    label: "Sistemas operando normalmente",
    color: "#0070FF",
    icon: CheckCircle2,
    bannerClass: "bg-[#0070FF]"
  },
  partial_outage: {
    label: "Alguns sistemas operando com latencia",
    color: "#FF9F0A",
    icon: AlertCircle,
    bannerClass: "bg-[#FF9F0A]"
  },
  major_outage: {
    label: "Falha critica - nossa equipe ja esta atuando",
    color: "#FF3B30",
    icon: XCircle,
    bannerClass: "bg-[#FF3B30]"
  }
};

function getComponentIcon(name: string, status: SystemStatus): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("square cloud")) return Cloud;
  if (n.includes("discord cdn")) return Server;
  if (n.includes("auditoria") || n.includes("audit")) return ShieldCheck;
  return STATUS_CONFIG[status]?.icon || CheckCircle2;
}

function getComponentLabelColor(status: SystemStatus): string {
  if (status === "major_outage") return "#FF3B30";
  if (status === "partial_outage") return "#FF9F0A";
  return "#0070FF";
}

function getComponentLabelText(status: SystemStatus): string {
  if (status === "operational" || status === "degraded_performance") return "Operacional";
  if (status === "partial_outage") return "Instabilidade detectada";
  return "Falha critica";
}

const BANNER_LABELS: Record<SystemStatus, string> = {
  operational: "Todos os sistemas operacionais",
  degraded_performance: "Todos os sistemas operacionais",
  partial_outage: "Alguns sistemas operando com latencia",
  major_outage: "Falha critica - nossa equipe ja esta atuando",
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
      <div className="mb-16 flex items-center justify-between">
        <SkeletonBar width={182} height={36} className="rounded-md" />
        <SkeletonBar width={220} height={42} className="rounded-full" />
      </div>
      <SkeletonBar width="100%" height={88} className="mb-16 rounded-xl" />
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
    </div>
  );
}

const StatusHistoryBar = memo(({ history, incidents }: { history: { date: string; status: SystemStatus }[]; incidents: Incident[] }) => {
  const historyByDate = useMemo(() => {
    const map = new Map<string, SystemStatus>();
    for (const entry of history) {
      map.set(entry.date, entry.status);
    }
    return map;
  }, [history]);

  const incidentByDate = useMemo(() => {
    const map = new Map<string, Incident>();
    for (const incident of incidents) {
      if (incident.created_at) {
        const day = incident.created_at.slice(0, 10);
        const existing = map.get(day);
        if (!existing || incident.impact === "critical") {
          map.set(day, incident);
        }
      }
    }
    return map;
  }, [incidents]);

  return (
    <div className="flex h-[34px] gap-[2px]">
      {Array.from({ length: 90 }).map((_, i) => {
        const d = buildUtcDay(89 - i);
        const dateIso = d.toISOString().slice(0, 10);
        const dateStr = formatUtcDayLabel(d);

        const dayStatus = historyByDate.get(dateIso) || "operational";
        const incident = incidentByDate.get(dateIso);

        let tooltipText: string;
        if (dayStatus === "operational" && !incident) {
          tooltipText = "Nenhuma interrupcao de servico foi registrada neste dia.";
        } else if (incident) {
          tooltipText = incident.summary || incident.title || "Incidente registrado neste dia.";
        } else {
          tooltipText = STATUS_CONFIG[dayStatus].label;
        }

        return (
          <div key={i} className="group/bar relative flex-1">
            <div
              className="h-full w-full rounded-[1px] transition-all hover:scale-y-110"
              style={{ backgroundColor: STATUS_CONFIG[dayStatus].color }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 z-50 w-[300px] -translate-x-1/2 opacity-0 transition-all group-hover/bar:opacity-100 group-hover/bar:translate-y-0 translate-y-2">
              <div className="relative rounded-lg border border-[#1A1A1A] bg-[#0A0A0A] p-4 shadow-2xl">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[14px] font-bold text-white">{dateStr}</span>
                  {dayStatus !== "operational" && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ backgroundColor: STATUS_CONFIG[dayStatus].color + "22", color: STATUS_CONFIG[dayStatus].color }}
                    >
                      {dayStatus === "major_outage" ? "Falha Critica" : dayStatus === "partial_outage" ? "Latencia" : "Instabilidade"}
                    </span>
                  )}
                </div>
                <p className="text-[13px] leading-relaxed text-[#999]">{tooltipText}</p>
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
  const [initialSubscribeType, setInitialSubscribeType] = useState<StatusSubscriptionType | null>(null);
  const [subscribing, setSubscribing] = useState(false);

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
  };

  useEffect(() => {
    const requestedType = searchParams.get("subscribe");
    if (requestedType) {
      setInitialSubscribeType(requestedType as StatusSubscriptionType);
      setShowSubscribe(true);
    }
  }, [searchParams]);

  useEffect(() => {
    let alive = true;
    async function fetchStatus() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (json.ok) {
          setData(json);
          setError(null);
        } else {
          setError(json.error || "Erro ao buscar status.");
        }
      } catch {
        setError("Falha na conexao.");
      } finally {
        if (alive) {
          setLoading(false);
          setIsInitialLoad(false);
        }
      }
    }
    fetchStatus();
    const timer = setInterval(fetchStatus, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (isInitialLoad) return <div className="flex min-h-screen items-center justify-center"><ButtonLoader size={32} colorClassName="text-white" /></div>;
  if (loading && !data) return <div className="min-h-screen"><StatusSkeleton /></div>;
  if (error) return <div className="flex min-h-screen items-center justify-center text-white">{error}</div>;

  const overallStatus = data?.overallStatus || "operational";
  const config = STATUS_CONFIG[overallStatus];
  const Icon = config.icon;

  return (
    <div className="relative min-h-screen text-white font-sans">
      <div className="mx-auto max-w-[900px] px-6 py-16">
        <div className="mb-16 flex items-center justify-between">
          <div className="relative h-[36px] w-[182px]">
            <Image src="/cdn/logos/logo.png" alt="Flowdesk" fill className="object-contain object-left" priority />
          </div>
          <LandingActionButton variant="dark" onClick={() => setShowSubscribe(true)} className="!h-[42px] !rounded-full px-6">
            Inscreva-se
          </LandingActionButton>
        </div>

        <LandingReveal delay={0}>
          <div className={`mb-16 relative overflow-hidden flex items-center justify-between rounded-xl px-8 py-6 ${config.bannerClass} bg-opacity-90 backdrop-blur-md`}>
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                <Icon className="h-6 w-6 text-white" />
              </div>
              <span className="text-[20px] font-bold tracking-tight text-white">{BANNER_LABELS[overallStatus]}</span>
            </div>
          </div>
        </LandingReveal>

        <div className="mb-24 space-y-12">
          {data?.components.map((component, idx) => (
            <LandingReveal key={component.id} delay={0.05 * idx}>
              <div className="group">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {React.createElement(getComponentIcon(component.name, component.status), {
                      size: 16,
                      style: { color: getComponentLabelColor(component.status) }
                    })}
                    <span className="text-[16px] font-medium text-[#EDEDED]">{component.name}</span>
                  </div>
                  <span className="text-[14px] font-medium" style={{ color: getComponentLabelColor(component.status) }}>
                    {getComponentLabelText(component.status)}
                    {component.latency_ms ? ` - ${component.latency_ms}ms` : ""}
                  </span>
                </div>
                <StatusHistoryBar history={component.history} incidents={data?.incidents || []} />
              </div>
            </LandingReveal>
          ))}
        </div>

        <div className="mb-16">
          <h2 className="mb-8 text-[24px] font-semibold text-white">Incidentes passados</h2>
          <div className="space-y-12">
            {Array.from({ length: 7 }).map((_, i) => {
              const date = buildUtcDay(i);
              const dateIso = date.toISOString().slice(0, 10);
              const dayIncidents = incidentsByDay.get(dateIso) || [];
              return (
                <div key={i} className="border-t border-[#1A1A1A] pt-8">
                  <h3 className="mb-4 text-[18px] font-semibold text-white">{formatUtcDayLabel(date)}</h3>
                  {dayIncidents.length === 0 ? (
                    <p className="text-[14px] text-[#666]">Nenhum incidente foi relatado nesta data.</p>
                  ) : (
                    <div className="space-y-6">
                      {dayIncidents.map(inc => (
                        <div key={inc.id} className="rounded-xl border border-[#1A1A1A] bg-[#0A0A0A] p-5">
                          <h4 className="text-[16px] font-semibold text-white">{inc.title}</h4>
                          <p className="mt-2 text-[14px] text-[#999]">{inc.summary || "Sem resumo disponivel."}</p>
                          {inc.updates.map(upd => (
                            <div key={upd.id} className="mt-4 border-l-2 border-[#1A1A1A] pl-4">
                              <span className="text-[12px] font-bold text-[#0070FF]">{INCIDENT_STATUS_LABELS[upd.status]}</span>
                              <p className="text-[13px] text-[#666]">{upd.message}</p>
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
      </div>

      <AnimatePresence>
        {showSubscribe && (
          <div className="fixed inset-0 z-[2600] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={resetSubscribeModal} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-[500px] rounded-3xl bg-[#0A0A0A] p-8 border border-[#1A1A1A]">
               <StatusSubscribeModalContent resetSubscribeModal={resetSubscribeModal} subscribing={subscribing} setSubscribing={setSubscribing} initialType={initialSubscribeType} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
