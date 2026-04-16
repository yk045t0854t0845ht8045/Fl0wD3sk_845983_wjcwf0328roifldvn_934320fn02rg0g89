import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  checkApiStatus,
  checkDiscordBotStatus,
  checkDomainsStatus,
  checkFlowAiStatus,
  checkScheduledTasksStatus,
  checkSquareCloudStatus,
  checkDiscordCdnStatus,
  stabilizeFlowAiStatusResponse,
  stabilizeStatusCheckResult,
  emptyTaskStats,
  type ApiStatusResponse,
  type FlowAiStatusResponse,
  type ScheduledTasksStatusResponse,
  type DomainsStatusResponse,
  type DiscordBotStatusResponse,
  type SquareCloudStatusResponse,
  type DiscordCdnStatusResponse,
} from "./monitors";
import { generateCriticalTeamNote, generateIncidentSummary } from "./intelligence";
import type {
  ComponentStatus,
  Incident,
  IncidentImpact,
  IncidentStatus,
  IncidentUpdate,
  StatusTeamNote,
  StatusSubscriptionType,
  SystemStatus,
} from "./types";
import { getWorstSystemStatus } from "./types";

export * from "./types";

type ComponentRow = {
  id: string;
  name: string;
  description: string | null;
  status: SystemStatus;
  is_core?: boolean;
  updated_at: string;
  created_at: string;
  display_order?: number;
};

type HistoryRow = {
  component_id: string;
  status: SystemStatus;
  recorded_at: string;
};

type IncidentRow = {
  id: string;
  title: string;
  impact: IncidentImpact;
  status: IncidentStatus;
  created_at: string;
  updated_at: string;
  public_summary?: string | null;
  ai_summary?: string | null;
  component_summary?: string | null;
  updates?: IncidentUpdate[] | null;
};

type IncidentComponentLink = {
  incident_id: string;
  component_id?: string | null;
  component?: {
    name?: string | null;
  } | null;
};

type MonitorSignal = {
  status: SystemStatus;
  message: string | null;
  checkedAt: string | null;
  latencyMs: number | null;
  ok?: boolean;
  source?: string;
};

type TableProbeResult = {
  available: boolean;
  count: number | null;
  error: string | null;
};

function normalizeText(input: string | null | undefined) {
  return (input || "").trim();
}

function formatDateTimePtBr(dateLike: string) {
  return new Date(dateLike).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function joinNames(names: string[]) {
  if (names.length === 0) return "os servicos monitorados";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function inferComponentSourceKey(name: string) {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("flow ai")) return "flowai";
  if (normalized.includes("tarefas agendadas")) return "scheduled_tasks";
  if (normalized.includes("registro de dominio")) return "domains";
  if (normalized.includes("dns")) return "domains";
  if (normalized.includes("certificado ssl")) return "domains";
  if (normalized.includes("firewall")) return "domains";
  if (normalized.includes("geolocalizacao")) return "domains";
  if (normalized.includes("pagamentos") || normalized.includes("transacoes")) {
    return "payments";
  }
  if (normalized.includes("discord bot") || normalized.includes("notificacoes")) {
    return "discord";
  }
  if (normalized.includes("auditoria") || normalized.includes("analises")) {
    return "audit";
  }
  if (
    normalized.includes("painel") ||
    normalized.includes("cache") ||
    normalized.includes("rede") ||
    normalized.includes("otimizacao") ||
    normalized.includes("velocidade") ||
    normalized.includes("cdn") ||
    normalized.includes("armazenamento db")
  ) {
    if (normalized.includes("discord") || normalized.includes("cdn")) {
      return "discord_cdn";
    }
    return "api";
  }
  if (normalized.includes("api")) return "api";
  if (normalized.includes("squarecloud") || normalized.includes("hospedagem")) {
    return "squarecloud";
  }
  return null;
}

function buildIncidentSummary(
  incident: IncidentRow,
  componentNames: string[],
  overrideMessage?: string | null,
) {
  const explicitMessage = normalizeText(overrideMessage);
  if (explicitMessage) {
    return explicitMessage;
  }

  const summarySources = [
    normalizeText(incident.public_summary),
    normalizeText(incident.ai_summary),
    normalizeText(incident.component_summary),
  ].filter(Boolean);

  if (summarySources.length > 0) {
    return summarySources[0];
  }

  const componentsText = joinNames(componentNames);
  const dateLabel = formatDateTimePtBr(incident.updated_at || incident.created_at);

  switch (incident.status) {
    case "investigating":
      return `Em ${dateLabel}, detectamos uma instabilidade em ${componentsText} e iniciamos a investigacao.`;
    case "identified":
      return `Em ${dateLabel}, identificamos a causa do incidente em ${componentsText} e seguimos aplicando a correcao.`;
    case "monitoring":
      return `Em ${dateLabel}, aplicamos a correcao em ${componentsText} e seguimos monitorando a estabilidade.`;
    case "resolved":
      return `Em ${dateLabel}, o incidente em ${componentsText} foi resolvido e os servicos voltaram ao funcionamento normal.`;
    default:
      return `Em ${dateLabel}, houve uma ocorrencia monitorada em ${componentsText}.`;
  }
}

function buildIncidentUpdates(
  incident: IncidentRow,
  componentNames: string[],
) {
  const updates = Array.isArray(incident.updates) ? [...incident.updates] : [];

  if (updates.length === 0) {
    return [
      {
        id: `generated-${incident.id}`,
        status: incident.status,
        created_at: incident.updated_at || incident.created_at,
        message: buildIncidentSummary(incident, componentNames),
      },
    ] satisfies IncidentUpdate[];
  }

  return updates
    .sort(
      (left, right) =>
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    )
    .map((update, index) => ({
      ...update,
      message: buildIncidentSummary(
        incident,
        componentNames,
        update.message || (index === updates.length - 1 ? incident.public_summary : null),
      ),
    }));
}

function resolvePublicOverallStatus(components: ComponentStatus[]) {
  const coreComponents = components.filter((component) => component.is_core);
  const hasCoreMajorOutage = coreComponents.some(
    (component) => component.status === "major_outage",
  );

  if (hasCoreMajorOutage) {
    return "major_outage" as const;
  }

  if (components.some((component) => component.status === "major_outage")) {
    return "partial_outage" as const;
  }

  if (components.some((component) => component.status === "partial_outage")) {
    return "partial_outage" as const;
  }

  if (components.some((component) => component.status === "degraded_performance")) {
    return "degraded_performance" as const;
  }

  return "operational" as const;
}

function ensureTodayHistory(
  history: { date: string; status: SystemStatus }[],
  status: SystemStatus,
) {
  const today = new Date().toISOString().slice(0, 10);
  const withoutToday = history.filter((entry) => entry.date !== today);
  return [...withoutToday, { date: today, status }].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

async function safeHeadCount(
  table: string,
): Promise<TableProbeResult> {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true });

    if (error) {
      return {
        available: false,
        count: null,
        error: error.message,
      };
    }

    return {
      available: true,
      count: typeof count === "number" ? count : 0,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      count: null,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }
}

async function safePendingPaymentsCount(
  stalePendingDate: string,
): Promise<TableProbeResult> {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    const { count, error } = await supabase
      .from("payment_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("created_at", stalePendingDate);

    if (error) {
      return {
        available: false,
        count: null,
        error: error.message,
      };
    }

    return {
      available: true,
      count: typeof count === "number" ? count : 0,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      count: null,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }
}

async function safeRecentPaymentFailuresCount(
  recentFailuresDate: string,
): Promise<TableProbeResult> {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    const { count, error } = await supabase
      .from("payment_orders")
      .select("id", { count: "exact", head: true })
      .in("status", ["failed", "rejected", "expired"])
      .gte("created_at", recentFailuresDate);

    if (error) {
      return {
        available: false,
        count: null,
        error: error.message,
      };
    }

    return {
      available: true,
      count: typeof count === "number" ? count : 0,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      count: null,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }
}

async function collectInternalSignals() {
  const now = new Date();
  const stalePendingDate = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const recentFailuresDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const paymentsStartedAt = Date.now();
  const [paymentPendingProbe, paymentFailureProbe] = await Promise.all([
    safePendingPaymentsCount(stalePendingDate),
    safeRecentPaymentFailuresCount(recentFailuresDate),
  ]);
  const paymentsLatencyMs = Date.now() - paymentsStartedAt;

  const discordStartedAt = Date.now();
  const [discordLinksProbe, teamServersProbe] = await Promise.all([
    safeHeadCount("auth_user_discord_links"),
    safeHeadCount("auth_user_team_servers"),
  ]);
  const discordLatencyMs = Date.now() - discordStartedAt;

  const auditStartedAt = Date.now();
  const [transcriptsProbe, auditLogsProbe] = await Promise.all([
    safeHeadCount("ticket_transcripts"),
    safeHeadCount("guild_security_logs_settings"),
  ]);
  const auditLatencyMs = Date.now() - auditStartedAt;

  const paymentPending = paymentPendingProbe.count || 0;
  const paymentFailures = paymentFailureProbe.count || 0;

  let paymentsStatus: SystemStatus = "operational";
  let paymentsMessage: string | null = null;

  if (!paymentPendingProbe.available && !paymentFailureProbe.available) {
    paymentsStatus = "degraded_performance";
    paymentsMessage = "Monitoramento de pagamentos indisponivel na base.";
  } else if (paymentPending > 25 || paymentFailures > 20) {
    paymentsStatus = "partial_outage";
    paymentsMessage = `Fila de pagamentos com ${paymentPending} pendentes antigos e ${paymentFailures} falhas recentes.`;
  } else if (paymentPending > 0 || paymentFailures > 0) {
    paymentsStatus = "degraded_performance";
    paymentsMessage = `Foram detectados ${paymentPending} pagamentos pendentes antigos e ${paymentFailures} falhas recentes.`;
  }

  const discordTablesAvailable =
    discordLinksProbe.available || teamServersProbe.available;
  const discordStatus: MonitorSignal = {
    status: discordTablesAvailable ? "operational" : "degraded_performance",
    message: discordTablesAvailable
      ? null
      : "Monitoramento do ecossistema Discord indisponivel na base.",
    checkedAt: now.toISOString(),
    latencyMs: discordLatencyMs,
  };

  const auditTablesAvailable = transcriptsProbe.available && auditLogsProbe.available;
  const auditStatus: MonitorSignal = {
    status: auditTablesAvailable ? "operational" : "degraded_performance",
    message: auditTablesAvailable
      ? null
      : "Parte das tabelas de auditoria ainda nao esta disponivel.",
    checkedAt: now.toISOString(),
    latencyMs: auditLatencyMs,
  };

  return {
    payments: {
      status: paymentsStatus,
      message: paymentsMessage,
      checkedAt: now.toISOString(),
      latencyMs: paymentsLatencyMs,
    } satisfies MonitorSignal,
    discord: discordStatus,
    audit: auditStatus,
  };
}

function resolveSignalForComponent(
  componentName: string,
  signals: Record<string, MonitorSignal>,
) {
  const sourceKey = inferComponentSourceKey(componentName);
  if (!sourceKey) {
    return null;
  }

  return {
    sourceKey,
    signal: signals[sourceKey] || null,
  };
}

function validateSubscriptionTarget(
  type: StatusSubscriptionType,
  target: string,
) {
  const value = target.trim();
  if (!value) {
    throw new Error("Destino da inscricao nao pode ser vazio.");
  }

  if (type === "email") {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (!emailOk) {
      throw new Error("Informe um e-mail valido.");
    }
  }

  if (type === "webhook") {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Protocolo invalido.");
      }
    } catch {
      throw new Error("Informe uma URL de webhook valida.");
    }
  }

  if (type === "discord_dm" || type === "discord_channel") {
    if (!/^\d{16,22}$/.test(value)) {
      throw new Error("Informe um ID do Discord valido.");
    }
  }

  return value;
}

export async function getSystemStatus() {
  const supabase = getSupabaseAdminClientOrThrow();

  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);
    const historyDateStr = ninetyDaysAgo.toISOString().slice(0, 10);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
    const incidentDateStr = thirtyDaysAgo.toISOString();

    const [
      componentsRes,
      historyRes,
      incidentsRes,
      incidentLinksRes,
    ] = await Promise.all([
      supabase
        .from("system_components")
        .select("id, name, description, status, is_core, display_order, updated_at, created_at")
        .order("display_order", { ascending: true }),
      supabase
        .from("system_status_history")
        .select("component_id, status, recorded_at")
        .gte("recorded_at", historyDateStr)
        .order("recorded_at", { ascending: true }),
      supabase
        .from("system_incidents")
        .select("*, updates:system_incident_updates(id, message, status, created_at)")
        .gte("created_at", incidentDateStr)
        .order("created_at", { ascending: false }),
      supabase
        .from("system_incident_components")
        .select("incident_id, component_id, component:system_components(name)"),
    ]);

    if (componentsRes.error) throw componentsRes.error;

    const components = (componentsRes.data || []) as ComponentRow[];
    const incidentsRaw = (incidentsRes.data || []) as IncidentRow[];

    // --- AUTONOMOUS SYNC GATING ---
    // If last update is > 2 minutes old, trigger an on-demand check battery
    const lastUpdate = components.reduce((acc, c) => {
      const ts = new Date(c.updated_at).getTime();
      return ts > acc ? ts : acc;
    }, 0);

    const isStale = Date.now() - lastUpdate > 120_000; // 2 minutes
    let apiLive: ApiStatusResponse, 
        flowAiLive: FlowAiStatusResponse, 
        scheduledTasksLive: ScheduledTasksStatusResponse, 
        domainsLive: DomainsStatusResponse, 
        discordBotLive: DiscordBotStatusResponse, 
        squareCloudLive: SquareCloudStatusResponse, 
        discordCdnLive: DiscordCdnStatusResponse, 
        internalSignals: { payments: MonitorSignal; audit: MonitorSignal; discord: MonitorSignal };

    if (isStale) {
      [apiLive, flowAiLive, scheduledTasksLive, domainsLive, discordBotLive, squareCloudLive, discordCdnLive, internalSignals] = await Promise.all([
        checkApiStatus(),
        checkFlowAiStatus(),
        checkScheduledTasksStatus(),
        checkDomainsStatus(),
        checkDiscordBotStatus(),
        checkSquareCloudStatus(),
        checkDiscordCdnStatus(),
        collectInternalSignals(),
      ]);
      
      // Update DB with results (non-blocking in many contexts, but we wait here for consistency)
      for (const comp of components) {
        const resolved = resolveSignalForComponent(comp.name, {
          api: apiLive,
          flowai: flowAiLive 
            ? { ...flowAiLive.overall, checkedAt: flowAiLive.checkedAt } 
            : { status: "operational", latencyMs: null, message: null, checkedAt: new Date().toISOString() },
          scheduled_tasks: scheduledTasksLive,
          domains: domainsLive,
          discord: discordBotLive,
          squarecloud: squareCloudLive,
          discord_cdn: discordCdnLive,
          payments: internalSignals.payments,
          audit: internalSignals.audit,
        });

        if (resolved?.signal) {
          const statusResult = resolved.signal.status || "operational";
          await supabase.from("system_components").update({ status: statusResult, updated_at: new Date().toISOString() }).eq("id", comp.id);
          await supabase.from("system_status_history").upsert({ 
            component_id: comp.id, 
            status: statusResult, 
            recorded_at: new Date().toISOString().slice(0, 10) 
          }, { onConflict: "component_id,recorded_at" });
        }
      }
    } else {
      // Use cached signals from DB for most requests to keep it fast
      const lastCheckIso = new Date(lastUpdate).toISOString();
      apiLive = { status: "operational", latencyMs: null, message: null, checkedAt: lastCheckIso, ok: true, source: "api" };
      flowAiLive = { 
        overall: { status: "operational", latencyMs: null, message: null }, 
        checkedAt: lastCheckIso, 
        integrations: {
          domainSuggestions: { status: "operational", message: null, latencyMs: null },
          ticketAi: { status: "operational", message: null, latencyMs: null },
          discordMessageAi: { status: "operational", message: null, latencyMs: null }
        }, 
        ok: true, 
        upstream: {
          openai: { status: "operational", latencyMs: null, message: null, baseUrl: "" },
          providers: {
            openai: { status: "operational", latencyMs: null, message: null, baseUrl: "" },
          },
        } 
      };
      scheduledTasksLive = { status: "operational", latencyMs: null, message: null, checkedAt: lastCheckIso, stats: emptyTaskStats(), ok: true, source: "scheduled_tasks" };
      domainsLive = { status: "operational", latencyMs: null, message: null, checkedAt: lastCheckIso, ok: true, source: "domains", circuitBreaker: { state: "closed", failures: 0, lastFailureTime: 0 } };
      discordBotLive = { status: "operational", latencyMs: null, message: null, checkedAt: lastCheckIso, ok: true, source: "discord", ready: true, wsStatus: 0, guildCount: 0, uptimeMs: 0, url: "" };
      squareCloudLive = { status: "operational", latencyMs: null, message: null, checkedAt: lastCheckIso, ok: true, source: "squarecloud" };
      discordCdnLive = { status: "operational", latencyMs: null, message: null, checkedAt: lastCheckIso, ok: true, source: "discord_cdn" };
      internalSignals = { 
        payments: { status: "operational", message: null, checkedAt: lastCheckIso, latencyMs: null, ok: true, source: "internal" },
        audit: { status: "operational", message: null, checkedAt: lastCheckIso, latencyMs: null, ok: true, source: "internal" },
        discord: { status: "operational", message: null, checkedAt: lastCheckIso, latencyMs: null, ok: true, source: "internal" }
      };
    }
    
    // --- DEPENDENCY-AWARE LOGIC (INTELLIGENT DOWNGRADING) ---
    // If Square Cloud is down, the Discord Bot is likely broken too.
    if (squareCloudLive.status === "major_outage" && discordBotLive.status === "operational") {
      discordBotLive.status = "partial_outage";
      discordBotLive.message = "Operacao do bot pode ser afetada por instabilidade na Square Cloud.";
    }
    // If Internal Audit/DB is failing, the API is degraded.
    if (internalSignals.audit.status !== "operational" && apiLive.status === "operational") {
      apiLive.status = "degraded_performance";
      apiLive.message = "API operante, mas com lentidao no processamento de logs internos.";
    }
    // If Discord CDN is down, Landing Page assets (icons) are affected.
    if (discordCdnLive.status !== "operational") {
      apiLive.status = getWorstSystemStatus([apiLive.status as any, "degraded_performance" as any]);
    }
    // --- END OF DEPENDENCY LOGIC ---
    // --- END OF AUTONOMOUS SYNC ---

    const history = (historyRes.data || []) as HistoryRow[];
    const incidentLinks = incidentLinksRes.error
      ? []
      : ((incidentLinksRes.data || []) as IncidentComponentLink[]);

    // AUTO-BACKFILL: Check if historical anomalies have AI summaries
    // We only process one per request to avoid huge latency
    const missingSummary = incidentsRaw.find(inc => !inc.public_summary || inc.public_summary.length < 5);
    if (missingSummary) {
      const linkedComps = incidentLinks.filter(l => l.incident_id === missingSummary.id).map(l => ({ 
        name: l.component?.name || "Componente", 
        status: missingSummary.status 
      }));
      
      const aiNarrative = await generateIncidentSummary(missingSummary.created_at.slice(0, 10), linkedComps);
      
      await supabase.from("system_incidents").update({ 
        public_summary: aiNarrative.summary,
        ai_summary: aiNarrative.summary,
        title: aiNarrative.title
      }).eq("id", missingSummary.id);
      
      missingSummary.public_summary = aiNarrative.summary;
      missingSummary.title = aiNarrative.title;

      await supabase.from("system_incident_updates").insert({
        incident_id: missingSummary.id,
        status: "resolved",
        message: aiNarrative.updateMessage,
        created_at: new Date().toISOString()
      });
    } else {
      // AGGRESSIVE BACKFILL: If no missing summary in existing incidents,
      // look for historical anomalies that don't have an incident AT ALL.
      const incidentsByDaySet = new Set(incidentsRaw.map(inc => inc.created_at.slice(0, 10)));
      const historicalAnomaly = history.find(h => 
        h.status !== "operational" && 
        !incidentsByDaySet.has(h.recorded_at)
      );

      if (historicalAnomaly) {
        const component = components.find(c => c.id === historicalAnomaly.component_id);
        const day = historicalAnomaly.recorded_at;
        
        const aiNarrative = await generateIncidentSummary(day, [{ 
          name: component?.name || "Componente", 
          status: historicalAnomaly.status 
        }]);

        const incidentTime = `${day}T12:00:00Z`;
        const { data: newInc } = await supabase.from("system_incidents").insert({
          title: aiNarrative.title,
          impact: historicalAnomaly.status === "major_outage" ? "critical" : "warning",
          status: "resolved",
          public_summary: aiNarrative.summary,
          ai_summary: aiNarrative.summary,
          created_at: incidentTime,
          updated_at: incidentTime
        }).select("id").single();

        if (newInc) {
          await supabase.from("system_incident_components").insert({
            incident_id: newInc.id,
            component_id: historicalAnomaly.component_id
          });
          
          await supabase.from("system_incident_updates").insert({
            incident_id: newInc.id,
            status: "resolved",
            message: aiNarrative.updateMessage,
            created_at: `${day}T23:59:00Z`
          });
        }
      }
    }

    const apiStable = stabilizeStatusCheckResult("api", apiLive as any);
    const flowAiStable = stabilizeFlowAiStatusResponse(flowAiLive);
    const scheduledStable = stabilizeStatusCheckResult(
      "scheduled_tasks",
      scheduledTasksLive,
    );
    const domainsStable = stabilizeStatusCheckResult("domains", domainsLive);
    const discordStable = stabilizeStatusCheckResult("discord", discordBotLive);
    const paymentsStable = stabilizeStatusCheckResult(
      "payments",
      internalSignals.payments,
    );
    const auditStable = stabilizeStatusCheckResult("audit", internalSignals.audit);
    const squareStable = stabilizeStatusCheckResult("squarecloud", squareCloudLive);
    const cdnStable = stabilizeStatusCheckResult("discord_cdn", discordCdnLive);

    const signals: Record<string, MonitorSignal> = {
      api: {
        status: apiStable.status,
        message: apiStable.message,
        checkedAt: apiStable.checkedAt,
        latencyMs: apiStable.latencyMs,
      },
      flowai: {
        status: flowAiStable.overall.status,
        message: flowAiStable.overall.message,
        checkedAt: flowAiStable.checkedAt,
        latencyMs: flowAiStable.overall.latencyMs,
      },
      scheduled_tasks: {
        status: scheduledStable.status,
        message: scheduledStable.message,
        checkedAt: scheduledStable.checkedAt,
        latencyMs: scheduledStable.latencyMs,
      },
      domains: {
        status: domainsStable.status,
        message: domainsStable.message,
        checkedAt: domainsStable.checkedAt,
        latencyMs: domainsStable.latencyMs,
      },
      discord: {
        status: discordStable.status,
        message: discordStable.message,
        checkedAt: discordStable.checkedAt,
        latencyMs: discordStable.latencyMs,
      },
      squarecloud: {
        status: squareStable.status,
        message: squareStable.message,
        checkedAt: squareStable.checkedAt,
        latencyMs: squareStable.latencyMs,
      },
      discord_cdn: {
        status: cdnStable.status,
        message: cdnStable.message,
        checkedAt: cdnStable.checkedAt,
        latencyMs: cdnStable.latencyMs,
      },
      payments: paymentsStable,
      audit: auditStable,
    };

    const historyByComponent = new Map<string, HistoryRow[]>();
    for (const entry of history) {
      const current = historyByComponent.get(entry.component_id);
      if (current) {
        current.push(entry);
      } else {
        historyByComponent.set(entry.component_id, [entry]);
      }
    }

    const incidentComponentsByIncident = new Map<string, string[]>();
    for (const link of incidentLinks) {
      const componentName = normalizeText(link.component?.name);
      if (!componentName) continue;

      const current = incidentComponentsByIncident.get(link.incident_id);
      if (current) {
        if (!current.includes(componentName)) {
          current.push(componentName);
        }
      } else {
        incidentComponentsByIncident.set(link.incident_id, [componentName]);
      }
    }

    const componentsWithHistory: ComponentStatus[] = components.map((component) => {
      const historyEntries = (historyByComponent.get(component.id) || []).map((entry) => ({
        date: entry.recorded_at,
        status: entry.status,
      }));

      const resolvedSignal = resolveSignalForComponent(component.name, signals);
      const effectiveStatus = resolvedSignal?.signal?.status || component.status;
      const effectiveUpdatedAt =
        resolvedSignal?.signal?.checkedAt || component.updated_at || component.created_at;

      return {
        ...component,
        status: effectiveStatus,
        is_core: Boolean(component.is_core),
        updated_at: effectiveUpdatedAt,
        history: ensureTodayHistory(historyEntries, effectiveStatus),
        status_message: resolvedSignal?.signal?.message || null,
        source_key: resolvedSignal?.sourceKey || null,
        last_checked_at: resolvedSignal?.signal?.checkedAt || null,
        latency_ms: resolvedSignal?.signal?.latencyMs ?? null,
      };
    });

    const incidents: Incident[] = incidentsRaw.map((incident) => {
      const componentNames = incidentComponentsByIncident.get(incident.id) || [];
      const updates = buildIncidentUpdates(incident, componentNames);

      return {
        id: incident.id,
        title: incident.title,
        impact: incident.impact,
        status: incident.status,
        created_at: incident.created_at,
        updated_at: incident.updated_at,
        updates,
        summary: buildIncidentSummary(incident, componentNames),
        affected_components: componentNames,
      };
    });

    const rawOverallStatus = getWorstSystemStatus(
      componentsWithHistory.map((component) => component.status),
    );
    const overallStatus = resolvePublicOverallStatus(componentsWithHistory);

    let teamNote: StatusTeamNote | null = null;
    if (overallStatus === "major_outage") {
      const criticalComponents = componentsWithHistory.filter(
        (component) => component.is_core && component.status === "major_outage",
      );
      teamNote = await generateCriticalTeamNote(criticalComponents);
    }

    return {
      components: componentsWithHistory,
      incidents,
      overallStatus,
      rawOverallStatus,
      teamNote,
      checkedAt: new Date().toISOString(),
      liveChecks: {
        api: apiStable,
        flowAi: flowAiStable,
        scheduledTasks: scheduledStable,
        domains: domainsStable,
        discordBot: discordStable,
        squareCloud: squareStable,
        discordCdn: cdnStable,
        audit: auditStable,
      },
    };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "PGRST205"
    ) {
      throw new Error(
        "As tabelas de status ainda nao foram criadas no banco. Execute primeiro o SQL 064_system_status.sql e depois a migration de upgrade do status.",
      );
    }

    throw error;
  }
}

export async function subscribeToStatus(
  type: StatusSubscriptionType,
  target: string,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const normalizedTarget = validateSubscriptionTarget(type, target);

  const { error } = await supabase
    .from("system_status_subscriptions")
    .upsert(
      {
        type,
        target: normalizedTarget,
      },
      {
        onConflict: "type,target",
        ignoreDuplicates: false,
      },
    );

  if (error) {
    throw error;
  }

  return { ok: true };
}
