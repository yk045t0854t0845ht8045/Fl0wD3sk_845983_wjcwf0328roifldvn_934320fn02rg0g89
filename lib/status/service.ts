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
  type ApiStatusResponse,
  type FlowAiStatusResponse,
  type ScheduledTasksStatusResponse,
  type DomainsStatusResponse,
  type DiscordBotStatusResponse,
  type SquareCloudStatusResponse,
  type DiscordCdnStatusResponse,
} from "./monitors";
import { generateCriticalTeamNote } from "./intelligence";
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
import {
  buildIdentifiedUpdateFromContext,
  buildIncidentSummaryFromContext,
  buildIncidentTitleFromContext,
  buildInvestigationUpdateFromContext,
  buildMonitoringUpdateFromContext,
  buildResolvedUpdateFromContext,
  buildTextSignature,
  finalizeIncidentSummary,
  finalizeIncidentUpdate,
  inferSystemStatusFromIncidentStatus,
} from "./copy";

export * from "./types";

type ComponentRow = {
  id: string;
  name: string;
  description: string | null;
  status: SystemStatus;
  is_core?: boolean;
  latency_ms?: number | null;
  source_key?: string | null;
  status_message?: string | null;
  last_checked_at?: string | null;
  last_raw_status?: SystemStatus | null;
  last_raw_checked_at?: string | null;
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

export type MonitorSignal = {
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

type LiveStatusSnapshot = {
  checkedAt: string;
  signals: Record<string, MonitorSignal>;
  liveChecks: {
    api: ApiStatusResponse;
    flowAi: FlowAiStatusResponse;
    scheduledTasks: ScheduledTasksStatusResponse;
    domains: DomainsStatusResponse;
    discordBot: DiscordBotStatusResponse;
    squareCloud: SquareCloudStatusResponse;
    discordCdn: DiscordCdnStatusResponse;
    audit: MonitorSignal;
    payments: MonitorSignal;
  };
};

let latestLiveStatusSnapshot:
  | {
      expiresAt: number;
      snapshot: LiveStatusSnapshot;
    }
  | null = null;

function normalizeText(input: string | null | undefined) {
  return String(input || "").trim();
}

export function inferComponentSourceKey(name: string) {
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
  const fallback = buildIncidentSummaryFromContext(
    incident.created_at.slice(0, 10),
    componentNames,
    inferSystemStatusFromIncidentStatus(incident.status, incident.impact),
  );

  return finalizeIncidentSummary(
    overrideMessage ||
      incident.public_summary ||
      incident.ai_summary ||
      incident.component_summary ||
      "",
    fallback,
  );
}

function buildDefaultIncidentUpdate(
  incident: IncidentRow,
  componentNames: string[],
  status: IncidentStatus,
) {
  const inferredStatus = inferSystemStatusFromIncidentStatus(status, incident.impact);

  switch (status) {
    case "investigating":
      return buildInvestigationUpdateFromContext(componentNames, inferredStatus);
    case "identified":
      return buildIdentifiedUpdateFromContext(componentNames);
    case "monitoring":
      return buildMonitoringUpdateFromContext(componentNames);
    case "resolved":
      return buildResolvedUpdateFromContext(componentNames);
    default:
      return buildIncidentSummary(incident, componentNames);
  }
}

function buildIncidentUpdates(
  incident: IncidentRow,
  componentNames: string[],
) {
  const updates = (Array.isArray(incident.updates) ? [...incident.updates] : [])
    .sort(
      (left, right) =>
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    )
    .map((update) => ({
      ...update,
      message: finalizeIncidentUpdate(
        update.message,
        buildDefaultIncidentUpdate(incident, componentNames, update.status),
      ),
    }));

  if (updates.length === 0) {
    return [
      {
        id: `generated-${incident.id}`,
        status: incident.status,
        created_at: incident.updated_at || incident.created_at,
        message: buildDefaultIncidentUpdate(incident, componentNames, incident.status),
      },
    ] satisfies IncidentUpdate[];
  }

  const deduped: IncidentUpdate[] = [];
  const seen = new Set<string>();

  for (const update of updates) {
    const signature = `${update.status}:${buildTextSignature(update.message)}`;
    if (!signature || seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    deduped.push(update);
  }

  if (incident.status === "resolved") {
    const firstActive = deduped.find((update) => update.status !== "resolved");
    const finalResolved = [...deduped]
      .reverse()
      .find((update) => update.status === "resolved");

    return [firstActive, finalResolved]
      .filter((update): update is IncidentUpdate => Boolean(update))
      .filter(
        (update, index, collection) =>
          collection.findIndex(
            (item) =>
              item.status === update.status &&
              buildTextSignature(item.message) === buildTextSignature(update.message),
          ) === index,
      );
  }

  return deduped.slice(-3);
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

export async function collectLiveStatusSnapshot(): Promise<LiveStatusSnapshot> {
  const cached = latestLiveStatusSnapshot;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.snapshot;
  }

  const [
    apiRaw,
    flowAiRaw,
    scheduledRaw,
    domainsRaw,
    discordRaw,
    squareCloudRaw,
    discordCdnRaw,
    internalSignals,
  ] = await Promise.all([
    checkApiStatus(),
    checkFlowAiStatus(),
    checkScheduledTasksStatus(),
    checkDomainsStatus(),
    checkDiscordBotStatus(),
    checkSquareCloudStatus(),
    checkDiscordCdnStatus(),
    collectInternalSignals(),
  ]);

  let api = { ...stabilizeStatusCheckResult("api", apiRaw) };
  const flowAi = stabilizeFlowAiStatusResponse(flowAiRaw);
  const scheduledTasks = stabilizeStatusCheckResult("scheduled_tasks", scheduledRaw);
  const domains = stabilizeStatusCheckResult("domains", domainsRaw);
  let discordBot = { ...stabilizeStatusCheckResult("discord", discordRaw) };
  const payments = stabilizeStatusCheckResult("payments", internalSignals.payments);
  const audit = stabilizeStatusCheckResult("audit", internalSignals.audit);
  const squareCloud = stabilizeStatusCheckResult("squarecloud", squareCloudRaw);
  const discordCdn = stabilizeStatusCheckResult("discord_cdn", discordCdnRaw);

  if (squareCloud.status === "major_outage" && discordBot.status === "operational") {
    discordBot = {
      ...discordBot,
      status: "partial_outage",
      message: "Operacao do bot pode ser afetada por instabilidade na hospedagem.",
    };
  }

  if (audit.status !== "operational" && api.status === "operational") {
    api = {
      ...api,
      status: "degraded_performance",
      message: "API operante, mas com lentidao no processamento de logs internos.",
    };
  }

  if (discordCdn.status !== "operational" && api.status === "operational") {
    api = {
      ...api,
      status: "degraded_performance",
      message: api.message || "Alguns assets externos podem apresentar instabilidade.",
    };
  }

  const checkedAt = new Date().toISOString();
  const snapshot: LiveStatusSnapshot = {
    checkedAt,
    signals: {
      api: {
        status: api.status,
        message: api.message,
        checkedAt: api.checkedAt,
        latencyMs: api.latencyMs,
      },
      flowai: {
        status: flowAi.overall.status,
        message: flowAi.overall.message,
        checkedAt: flowAi.checkedAt,
        latencyMs: flowAi.overall.latencyMs,
      },
      scheduled_tasks: {
        status: scheduledTasks.status,
        message: scheduledTasks.message,
        checkedAt: scheduledTasks.checkedAt,
        latencyMs: scheduledTasks.latencyMs,
      },
      domains: {
        status: domains.status,
        message: domains.message,
        checkedAt: domains.checkedAt,
        latencyMs: domains.latencyMs,
      },
      discord: {
        status: discordBot.status,
        message: discordBot.message,
        checkedAt: discordBot.checkedAt,
        latencyMs: discordBot.latencyMs,
      },
      squarecloud: {
        status: squareCloud.status,
        message: squareCloud.message,
        checkedAt: squareCloud.checkedAt,
        latencyMs: squareCloud.latencyMs,
      },
      discord_cdn: {
        status: discordCdn.status,
        message: discordCdn.message,
        checkedAt: discordCdn.checkedAt,
        latencyMs: discordCdn.latencyMs,
      },
      payments: {
        status: payments.status,
        message: payments.message,
        checkedAt: payments.checkedAt,
        latencyMs: payments.latencyMs,
      },
      audit: {
        status: audit.status,
        message: audit.message,
        checkedAt: audit.checkedAt,
        latencyMs: audit.latencyMs,
      },
    },
    liveChecks: {
      api,
      flowAi,
      scheduledTasks,
      domains,
      discordBot,
      squareCloud,
      discordCdn,
      audit,
      payments,
    },
  };

  latestLiveStatusSnapshot = {
    expiresAt: Date.now() + 30_000,
    snapshot,
  };

  return snapshot;
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

function sanitizeSupabaseError(error: unknown): Error {
  const message =
    error instanceof Error ? error.message : String((error as { message?: string })?.message || error || "");

  if (
    message.includes("<!DOCTYPE html>") ||
    message.includes("522") ||
    message.includes("Connection timed out") ||
    message.includes("timeout")
  ) {
    return new Error(
      "O banco de dados (Supabase) demorou muito para responder ou esta offline. Verifique o Dashboard do Supabase.",
    );
  }

  return error instanceof Error ? error : new Error(message);
}

async function retryQuery<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  throw lastError;
}

function isMissingOptionalStatusColumnError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String((error as { message?: string })?.message || error || "");

  return /status_message|last_checked_at|last_raw_status|last_raw_checked_at|latency_ms|source_key/i.test(message);
}

async function loadComponentRows(supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>) {
  const preferredResult = await supabase
    .from("system_components")
    .select(
      "id, name, description, status, is_core, display_order, latency_ms, source_key, status_message, last_checked_at, last_raw_status, last_raw_checked_at, updated_at, created_at",
    )
    .order("display_order", { ascending: true });

  if (!preferredResult.error) {
    return preferredResult.data as ComponentRow[];
  }

  if (!isMissingOptionalStatusColumnError(preferredResult.error)) {
    throw preferredResult.error;
  }

  const fallbackResult = await supabase
    .from("system_components")
    .select("id, name, description, status, is_core, display_order, updated_at, created_at")
    .order("display_order", { ascending: true });

  if (fallbackResult.error) {
    throw fallbackResult.error;
  }

  return (fallbackResult.data || []) as ComponentRow[];
}

function buildStoredSignal(component: ComponentRow): MonitorSignal | null {
  const checkedAt =
    component.last_checked_at ||
    component.last_raw_checked_at ||
    component.updated_at ||
    component.created_at ||
    null;

  if (!checkedAt && !component.status_message && component.latency_ms == null) {
    return null;
  }

  return {
    status: component.status,
    message: component.status_message || null,
    checkedAt,
    latencyMs: component.latency_ms ?? null,
  };
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

    const [components, historyRes, incidentsRes, incidentLinksRes] = await retryQuery(() =>
      Promise.all([
        loadComponentRows(supabase),
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
      ]),
    );

    if (historyRes.error) throw historyRes.error;
    if (incidentsRes.error) throw incidentsRes.error;
    if (incidentLinksRes.error) throw incidentLinksRes.error;

    const incidentsRaw = (incidentsRes.data || []) as IncidentRow[];

    const lastUpdate = components.reduce((acc, c) => {
      const ts = new Date(c.updated_at).getTime();
      return ts > acc ? ts : acc;
    }, 0);

    const isStale = !lastUpdate || Date.now() - lastUpdate > 120_000;
    const liveSnapshot = isStale ? await collectLiveStatusSnapshot() : null;

    const history = (historyRes.data || []) as HistoryRow[];
    const incidentLinks = incidentLinksRes.error
      ? []
      : ((incidentLinksRes.data || []) as IncidentComponentLink[]);
    const signals: Record<string, MonitorSignal> = liveSnapshot?.signals || {};

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

    const componentsWithHistory: ComponentStatus[] = components
      .filter((component) => inferComponentSourceKey(component.name) !== "flowai")
      .map((component) => {
        const historyEntries = (historyByComponent.get(component.id) || []).map((entry) => ({
          date: entry.recorded_at,
          status: entry.status,
        }));

        const resolvedSignal = resolveSignalForComponent(component.name, signals);
        const storedSignal = buildStoredSignal(component);
        const effectiveSignal = resolvedSignal?.signal || storedSignal;
        const effectiveStatus = effectiveSignal?.status || component.status;
        const effectiveUpdatedAt =
          effectiveSignal?.checkedAt || component.updated_at || component.created_at;

        return {
          ...component,
          status: effectiveStatus,
          is_core: Boolean(component.is_core),
          updated_at: effectiveUpdatedAt,
          history: ensureTodayHistory(historyEntries, effectiveStatus),
          status_message: effectiveSignal?.message || component.status_message || null,
          source_key: resolvedSignal?.sourceKey || component.source_key || null,
          last_checked_at: effectiveSignal?.checkedAt || component.last_checked_at || null,
          latency_ms: effectiveSignal?.latencyMs ?? component.latency_ms ?? null,
        };
      });

    const incidents: Incident[] = incidentsRaw
      .map((incident) => {
        const allComponentNames = incidentComponentsByIncident.get(incident.id) || [];
        // Remove FlowAI from affected components list
        const componentNames = allComponentNames.filter(
          (name) => inferComponentSourceKey(name) !== "flowai",
        );
        const updates = buildIncidentUpdates(incident, componentNames);
        const inferredStatus = inferSystemStatusFromIncidentStatus(
          incident.status,
          incident.impact,
        );

        return {
          id: incident.id,
          title: normalizeText(incident.title) || buildIncidentTitleFromContext(componentNames, inferredStatus),
          impact: incident.impact,
          status: incident.status,
          created_at: incident.created_at,
          updated_at: incident.updated_at,
          updates,
          summary: buildIncidentSummary(incident, componentNames),
          affected_components: componentNames,
          _onlyFlowAi: allComponentNames.length > 0 && componentNames.length === 0,
        };
      })
      // Hide incidents that were exclusively linked to FlowAI
      .filter((incident) => !incident._onlyFlowAi)
      .map((incident) => {
        const { _onlyFlowAi: onlyFlowAiFlag, ...rest } = incident;
        void onlyFlowAiFlag;
        return rest;
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

    const latestPersistedCheckAt = componentsWithHistory.reduce((highest, component) => {
      const candidate = Date.parse(
        component.last_checked_at || component.updated_at || component.created_at || "",
      );
      return Number.isFinite(candidate) && candidate > highest ? candidate : highest;
    }, 0);

    return {
      components: componentsWithHistory,
      incidents,
      overallStatus,
      rawOverallStatus,
      teamNote,
      checkedAt:
        liveSnapshot?.checkedAt ||
        (latestPersistedCheckAt
          ? new Date(latestPersistedCheckAt).toISOString()
          : lastUpdate
            ? new Date(lastUpdate).toISOString()
            : new Date().toISOString()),
      liveChecks: liveSnapshot?.liveChecks || null,
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

    throw sanitizeSupabaseError(error);
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
