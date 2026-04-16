import crypto from "node:crypto";
import { getServerEnv, getServerEnvList } from "@/lib/serverEnv";
import { getWorstSystemStatus, type SystemStatus } from "@/lib/status/types";
import {
  canFlowAiProviderRun,
  getFlowAiCircuitSnapshot,
  getFlowAiInfraSnapshot,
  getFlowAiObservabilitySnapshot,
  recordFlowAiCacheHit,
  recordFlowAiCircuitFailure,
  recordFlowAiCircuitSuccess,
  recordFlowAiProviderFailure,
  recordFlowAiProviderSuccess,
  startFlowAiTrace,
  withFlowAiTaskQueue,
} from "./infra";
import {
  getConfiguredFlowAiProviders,
  resolveProviderModelCandidates,
  type FlowAiProviderConfig,
  type FlowAiProviderKey,
} from "./providers";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 16_000;
const DEFAULT_MAX_RETRIES = 2;
const MODEL_BLOCK_TTL_MS = 1000 * 60 * 30;
const HEALTH_CACHE_TTL_MS = 1000 * 20;

export type FlowAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type FlowAiTextRequest = {
  taskKey: string;
  messages: FlowAiMessage[];
  userId?: string | null;
  temperature?: number;
  maxTokens?: number;
  cacheKey?: string | null;
  cacheTtlMs?: number | null;
  preferredModel?: string | null;
  timeoutMs?: number;
  recordTelemetry?: boolean;
};

export type FlowAiTextResponse = {
  content: string;
  model: string;
  latencyMs: number;
  provider: FlowAiProviderKey;
  traceId: string;
  queueWaitMs: number;
  candidates: string[];
  adaptive: {
    selectedBy: "telemetry" | "default";
    taskKey: string;
    provider: FlowAiProviderKey;
    model: string;
    avgLatencyMs: number | null;
    successRate: number | null;
    failureCount: number;
  };
};

export type FlowAiJsonResponse<T> = FlowAiTextResponse & {
  rawContent: string;
  object: T;
};

export type FlowAiIntegrationHealth = {
  status: SystemStatus;
  message: string | null;
  latencyMs: number | null;
};

export type FlowAiHealthResponse = {
  ok: boolean;
  checkedAt: string;
  overall: {
    status: SystemStatus;
    latencyMs: number | null;
    message: string | null;
  };
  upstream: {
    openai: {
      status: SystemStatus;
      latencyMs: number | null;
      message: string | null;
      baseUrl: string;
    };
    providers: Record<
      string,
      {
        status: SystemStatus;
        latencyMs: number | null;
        message: string | null;
        baseUrl: string;
      }
    >;
  };
  integrations: {
    domainSuggestions: FlowAiIntegrationHealth;
    ticketAi: FlowAiIntegrationHealth;
    ticketSuggestion?: FlowAiIntegrationHealth;
    discordMessageAi: FlowAiIntegrationHealth;
    adminAssistant?: FlowAiIntegrationHealth;
    affiliateInsight?: FlowAiIntegrationHealth;
    statusPageAi?: FlowAiIntegrationHealth;
  };
  adaptiveMemory?: {
    trackedPairs: number;
    entries: Array<{
      taskKey: string;
      provider: string | undefined;
      model: string;
      successes: number;
      failures: number;
      avgLatencyMs: number | null;
      lastSuccessAt: string | null;
      lastErrorAt: string | null;
    }>;
  };
  infrastructure?: ReturnType<typeof getFlowAiInfraSnapshot>;
  circuitBreakers?: Awaited<ReturnType<typeof getFlowAiCircuitSnapshot>>;
  observability?: ReturnType<typeof getFlowAiObservabilitySnapshot>;
};

type ModelTelemetry = {
  successes: number;
  failures: number;
  avgLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type OpenAiCallOptions = {
  mode: "text" | "json";
  taskKey: string;
  messages: FlowAiMessage[];
  userId?: string | null;
  temperature: number;
  maxTokens: number;
  preferredModel?: string | null;
  timeoutMs: number;
  recordTelemetry: boolean;
  trace?: ReturnType<typeof startFlowAiTrace>;
};

type OpenAiCallResult = {
  content: string;
  model: string;
  latencyMs: number;
  provider: FlowAiProviderKey;
  candidates: string[];
  selectedBy: "telemetry" | "default";
  queueWaitMs: number;
};

type FlowAiTaskProfile = {
  preferredModel?: string | null;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  defaultTimeoutMs?: number;
  defaultCacheTtlMs?: number;
  systemGuard?: string;
  queueGroup?: string | null;
  queueConcurrency?: number;
};

const unavailableModelCache = new Map<string, number>();
const modelTelemetryStore = new Map<string, ModelTelemetry>();
const responseCache = new Map<string, CacheEntry<unknown>>();
const inflightRequests = new Map<string, Promise<unknown>>();

const FLOWAI_SYSTEM_GUARD = [
  "Voce e o nucleo enterprise do FlowAI da Flowdesk.",
  "Priorize precisao, contexto, consistencia e linguagem profissional em portugues do Brasil, salvo instrucao explicita em contrario.",
  "Nunca invente dados, metricas, eventos, integracoes ou resultados.",
  "Se o contexto for insuficiente, responda com a melhor saida segura e objetiva baseada apenas no que foi recebido.",
  "Evite floreios, promessas absolutas, tom exagerado ou marketing vazio.",
].join(" ");

const FLOWAI_TASK_PROFILES: Record<string, FlowAiTaskProfile> = {
  generic: {
    preferredModel: "gpt-4o-mini",
    defaultTemperature: 0.35,
    defaultMaxTokens: 400,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    queueGroup: "default",
    queueConcurrency: 3,
  },
  domain_suggestions: {
    preferredModel: "gpt-4o-mini",
    defaultTemperature: 0.7,
    defaultMaxTokens: 650,
    defaultTimeoutMs: 14_000,
    defaultCacheTtlMs: 1000 * 60 * 5,
    queueGroup: "heavy",
    queueConcurrency: 1,
    systemGuard:
      "Pense como estrategista de naming e branding. Entregue nomes claros, curtos, memoraveis e com boa sonoridade para dominio.",
  },
  ticket_reply: {
    preferredModel: "gpt-4o-mini",
    defaultTemperature: 0.35,
    defaultMaxTokens: 420,
    defaultTimeoutMs: 16_000,
    systemGuard:
      "Atue como suporte premium. Seja objetivo, humano, tecnico quando necessario e focado em resolver o ticket.",
  },
  ticket_suggestion: {
    preferredModel: "gpt-4o-mini",
    defaultTemperature: 0.3,
    defaultMaxTokens: 260,
    defaultTimeoutMs: 14_000,
    systemGuard:
      "Gere sugestoes iniciais de atendimento curtas, praticas e seguras, sem inventar acoes ja realizadas.",
  },
  discord_mention: {
    preferredModel: "gpt-4o-mini",
    defaultTemperature: 0.3,
    defaultMaxTokens: 220,
    defaultTimeoutMs: 12_000,
    systemGuard:
      "Responda como especialista em comunidade. Seja rapido, claro, amigavel e sem enrolacao.",
  },
  admin_plan: {
    preferredModel: "gpt-4o-mini",
    defaultTemperature: 0.18,
    defaultMaxTokens: 340,
    defaultTimeoutMs: 14_000,
    queueGroup: "default",
    queueConcurrency: 2,
    systemGuard:
      "Pense como um orquestrador administrativo. Priorize acoes executaveis, validas e sem ambiguidade.",
  },
  status_note: {
    preferredModel: "gpt-4o-mini",
    defaultTemperature: 0.2,
    defaultMaxTokens: 180,
    defaultTimeoutMs: 12_000,
    systemGuard:
      "Escreva como time de SRE para uma status page: transparencia, sobriedade e clareza operacional.",
  },
  status_incident_summary: {
    preferredModel: "gpt-4o-mini",
    defaultTemperature: 0.25,
    defaultMaxTokens: 250,
    defaultTimeoutMs: 14_000,
    queueGroup: "heavy",
    queueConcurrency: 1,
    systemGuard:
      "Produza resumos tecnicos curtos e confiaveis para incidentes, com foco em entendimento rapido do cliente.",
  },
  status_investigation_note: {
    preferredModel: "gpt-4o-mini",
    defaultTemperature: 0.2,
    defaultMaxTokens: 200,
    defaultTimeoutMs: 12_000,
    systemGuard:
      "Escreva comunicados curtos de investigacao para status page, sem culpar terceiros e sem prazo inventado.",
  },
  affiliate_insight: {
    preferredModel: "gpt-4o-mini",
    defaultTemperature: 0.3,
    defaultMaxTokens: 220,
    defaultTimeoutMs: 14_000,
    defaultCacheTtlMs: 1000 * 60 * 3,
    queueGroup: "default",
    queueConcurrency: 2,
    systemGuard:
      "Atue como analista senior de growth para afiliados. Gere insights acionaveis, honestos e baseados em sinais reais de desempenho.",
  },
};

export const FLOWAI_KNOWN_TASK_KEYS = Object.freeze(
  Object.keys(FLOWAI_TASK_PROFILES).filter((taskKey) => taskKey !== "generic"),
);

function nowMs() {
  return Date.now();
}

export function normalizeFlowAiTaskKey(taskKey: string) {
  const normalized = String(taskKey || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "generic";
}

function toTaskEnvKey(taskKey: string) {
  return normalizeFlowAiTaskKey(taskKey).toUpperCase();
}

function normalizeText(value: string, maxLength = 12_000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeMessages(messages: FlowAiMessage[]): FlowAiMessage[] {
  const normalized = Array.isArray(messages)
    ? messages
        .map((message) => {
          const role: FlowAiMessage["role"] =
            message?.role === "assistant" || message?.role === "system"
              ? message.role
              : "user";

          return {
            role,
            content: normalizeText(message?.content || "", 12_000),
          } satisfies FlowAiMessage;
        })
        .filter((message) => Boolean(message.content))
        .slice(-24)
    : [];

  if (!normalized.length) {
    throw new Error("FlowAI recebeu mensagens vazias.");
  }

  return normalized;
}

function getTaskProfile(taskKey: string): FlowAiTaskProfile {
  const normalizedTaskKey = normalizeFlowAiTaskKey(taskKey);

  if (FLOWAI_TASK_PROFILES[normalizedTaskKey]) {
    return FLOWAI_TASK_PROFILES[normalizedTaskKey];
  }

  if (normalizedTaskKey.startsWith("status_")) {
    return {
      ...FLOWAI_TASK_PROFILES.generic,
      preferredModel:
        FLOWAI_TASK_PROFILES.status_note.preferredModel ||
        FLOWAI_TASK_PROFILES.generic.preferredModel,
      defaultTemperature: 0.22,
      defaultMaxTokens: 220,
      defaultTimeoutMs: 13_000,
      systemGuard:
        "Escreva para status page com clareza, transparencia, tom profissional e foco no que o cliente precisa entender.",
    };
  }

  return FLOWAI_TASK_PROFILES.generic;
}

export function isFlowAiTaskKeyAllowed(taskKey: string) {
  const normalizedTaskKey = normalizeFlowAiTaskKey(taskKey);

  return (
    normalizedTaskKey === "generic" ||
    Boolean(FLOWAI_TASK_PROFILES[normalizedTaskKey]) ||
    normalizedTaskKey.startsWith("status_")
  );
}

export function getFlowAiTaskProfile(taskKey: string) {
  return {
    ...getTaskProfile(taskKey),
  };
}

function clampTemperature(value: number | undefined) {
  if (!Number.isFinite(value)) return 0.35;
  return Math.min(1.2, Math.max(0, Number(value)));
}

function clampMaxTokens(value: number | undefined, fallback = 400) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1_500, Math.max(32, Math.round(Number(value))));
}

function resolveOpenAiApiKey() {
  return getServerEnv("OPENAI_API_KEY") || "";
}

function resolveOpenAiBaseUrl() {
  return (getServerEnv("OPENAI_BASE_URL") || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, "");
}

function resolveTaskSpecificModels(taskKey: string) {
  const taskProfile = getTaskProfile(taskKey);
  const taskEnvKey = toTaskEnvKey(taskKey);
  const taskModel = getServerEnv(`FLOWAI_MODEL_${taskEnvKey}`);
  const taskFallbacks = getServerEnvList(`FLOWAI_MODEL_${taskEnvKey}_FALLBACKS`);

  const specialModels: string[] = [];
  if (normalizeFlowAiTaskKey(taskKey).startsWith("status_")) {
    const statusModel = getServerEnv("OPENAI_STATUS_MODEL");
    if (statusModel) {
      specialModels.push(statusModel);
    }
  }

  return [
    taskProfile.preferredModel || null,
    taskModel,
    ...taskFallbacks,
    ...specialModels,
  ].filter(Boolean) as string[];
}

function resolveModelCandidates(taskKey: string, preferredModel?: string | null) {
  return Array.from(
    new Set(
      [
        preferredModel || null,
        ...resolveTaskSpecificModels(taskKey),
        getServerEnv("OPENAI_MODEL"),
        ...getServerEnvList("OPENAI_MODEL_FALLBACKS"),
        "gpt-4o-mini",
        "gpt-4o",
      ].filter(Boolean),
    ),
  ) as string[];
}

function buildTaskSystemGuard(taskKey: string, mode: "text" | "json") {
  const profile = getTaskProfile(taskKey);

  return [
    FLOWAI_SYSTEM_GUARD,
    `Task atual: ${normalizeFlowAiTaskKey(taskKey)}.`,
    profile.systemGuard || "",
    mode === "json"
      ? "Responda somente JSON valido quando a tarefa pedir JSON. Nao use markdown, comentarios extras nem texto fora do objeto JSON."
      : "Responda de forma direta, util e alinhada ao objetivo do fluxo.",
  ]
    .filter(Boolean)
    .join(" ");
}

function applyTaskProfileToMessages(
  taskKey: string,
  messages: FlowAiMessage[],
  mode: "text" | "json",
) {
  const normalizedMessages = normalizeMessages(messages);
  const profiledMessages = normalizedMessages.slice(-23);

  return [
    {
      role: "system",
      content: buildTaskSystemGuard(taskKey, mode),
    },
    ...profiledMessages,
  ] satisfies FlowAiMessage[];
}

function parseErrorPayload(rawText: string) {
  try {
    return JSON.parse(rawText) as {
      error?: {
        message?: string;
        code?: string;
      };
    };
  } catch {
    return null;
  }
}

function isModelAccessError(status: number, rawText: string) {
  const payload = parseErrorPayload(rawText);
  const message = String(payload?.error?.message || rawText || "").toLowerCase();
  const code = String(payload?.error?.code || "").toLowerCase();

  return (
    status === 403 ||
    code === "model_not_found" ||
    message.includes("does not have access to model") ||
    message.includes("model_not_found")
  );
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return normalizeText(error.message, 280);
  }

  return normalizeText(String(error || "Erro desconhecido"), 280);
}

function providerModelKey(provider: string, model: string) {
  return `${provider}:${model}`;
}

function modelTelemetryKey(taskKey: string, provider: string, model: string) {
  return `${normalizeFlowAiTaskKey(taskKey)}::${provider}::${model}`;
}

function getModelTelemetry(taskKey: string, provider: string, model: string) {
  return (
    modelTelemetryStore.get(modelTelemetryKey(taskKey, provider, model)) || {
      successes: 0,
      failures: 0,
      avgLatencyMs: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
    }
  );
}

function recordModelSuccess(
  taskKey: string,
  provider: string,
  model: string,
  latencyMs: number,
  recordTelemetry: boolean,
) {
  if (!recordTelemetry) return;

  const key = modelTelemetryKey(taskKey, provider, model);
  const current = getModelTelemetry(taskKey, provider, model);
  const totalSuccesses = current.successes + 1;
  const avgLatencyMs =
    current.avgLatencyMs === null
      ? latencyMs
      : Math.round(
          (current.avgLatencyMs * current.successes + latencyMs) / totalSuccesses,
        );

  modelTelemetryStore.set(key, {
    ...current,
    successes: totalSuccesses,
    avgLatencyMs,
    lastSuccessAt: nowMs(),
    lastError: null,
  });
}

function recordModelFailure(
  taskKey: string,
  provider: string,
  model: string,
  error: unknown,
  recordTelemetry: boolean,
) {
  if (!recordTelemetry) return;

  const key = modelTelemetryKey(taskKey, provider, model);
  const current = getModelTelemetry(taskKey, provider, model);

  modelTelemetryStore.set(key, {
    ...current,
    failures: current.failures + 1,
    lastErrorAt: nowMs(),
    lastError: formatErrorMessage(error),
  });
}

function getModelScore(
  taskKey: string,
  provider: string,
  model: string,
  baseIndex: number,
) {
  const telemetry = getModelTelemetry(taskKey, provider, model);
  const total = telemetry.successes + telemetry.failures;
  const successRate =
    total > 0 ? telemetry.successes / Math.max(1, total) : null;
  const latencyPenalty =
    typeof telemetry.avgLatencyMs === "number"
      ? telemetry.avgLatencyMs / 350
      : 0;
  const failurePenalty = telemetry.failures * 2.5;
  const successBonus =
    successRate === null ? 0 : successRate * 18 + telemetry.successes * 0.15;

  return 100 - baseIndex + successBonus - latencyPenalty - failurePenalty;
}

function rankModelCandidates(taskKey: string, provider: string, models: string[]) {
  const ranked = models
    .map((model, index) => ({
      model,
      index,
      score: getModelScore(taskKey, provider, model, index),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selectedBy =
    ranked.some((entry, index) => entry.index !== index) ? "telemetry" : "default";

  return {
    candidates: ranked.map((entry) => entry.model),
    selectedBy: selectedBy as "telemetry" | "default",
  };
}

async function delay(ms: number) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function extractJsonObject(rawContent: string) {
  const trimmed = rawContent.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function buildAdaptiveSnapshot(
  taskKey: string,
  provider: FlowAiProviderKey,
  model: string,
  selectedBy: "telemetry" | "default",
) {
  const telemetry = getModelTelemetry(taskKey, provider, model);
  const total = telemetry.successes + telemetry.failures;

  return {
    selectedBy,
    taskKey: normalizeFlowAiTaskKey(taskKey),
    provider,
    model,
    avgLatencyMs: telemetry.avgLatencyMs,
    successRate: total > 0 ? telemetry.successes / total : null,
    failureCount: telemetry.failures,
  };
}

function buildCacheFingerprint(kind: string, input: FlowAiTextRequest) {
  const providedKey = String(input.cacheKey || "").trim();
  if (providedKey) {
    return `${kind}:${normalizeFlowAiTaskKey(input.taskKey)}:${providedKey}`;
  }

  const fingerprint = JSON.stringify({
    taskKey: normalizeFlowAiTaskKey(input.taskKey),
    messages: normalizeMessages(input.messages),
    userId: String(input.userId || "").slice(0, 64),
    temperature: clampTemperature(input.temperature),
    maxTokens: clampMaxTokens(input.maxTokens),
    preferredModel: input.preferredModel || null,
  });

  const digest = crypto.createHash("sha1").update(fingerprint).digest("hex");
  return `${kind}:${normalizeFlowAiTaskKey(input.taskKey)}:${digest}`;
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function withCache<T>(
  kind: string,
  input: FlowAiTextRequest,
  producer: () => Promise<T>,
) {
  const ttlMs = Number(input.cacheTtlMs || 0);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return await producer();
  }

  const cacheKey = buildCacheFingerprint(kind, input);
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs()) {
    recordFlowAiCacheHit();
    return cloneJsonValue(cached.value as T);
  }

  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    return cloneJsonValue((await inflight) as T);
  }

  const request = (async () => {
    const value = await producer();
    responseCache.set(cacheKey, {
      expiresAt: nowMs() + ttlMs,
      value,
    });
    return value;
  })();

  inflightRequests.set(cacheKey, request);

  try {
    return cloneJsonValue(await request);
  } finally {
    inflightRequests.delete(cacheKey);
  }
}

function parseBooleanEnv(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveProviderRetryCount() {
  const configured = Number(getServerEnv("FLOWAI_PROVIDER_MAX_RETRIES") || "");
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.min(4, Math.round(configured));
  }

  return DEFAULT_MAX_RETRIES;
}

function resolveQueuePolicy(taskKey: string) {
  const taskProfile = getTaskProfile(taskKey);
  const heavy = taskProfile.queueGroup === "heavy";
  const enabled = parseBooleanEnv(getServerEnv("FLOWAI_QUEUE_ENABLED"), true);
  const concurrency = Number(
    getServerEnv(
      heavy ? "FLOWAI_QUEUE_HEAVY_CONCURRENCY" : "FLOWAI_QUEUE_CONCURRENCY",
    ) ||
      taskProfile.queueConcurrency ||
      (heavy ? 1 : 3),
  );

  return {
    enabled,
    queueKey: `flowai:${taskProfile.queueGroup || "default"}`,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1,
  };
}

async function callOpenAi(
  options: OpenAiCallOptions,
): Promise<OpenAiCallResult> {
  const configuredProviders = getConfiguredFlowAiProviders();
  if (!configuredProviders.length) {
    throw new Error(
      "Nenhum provider de IA configurado para o FlowAI. Configure OPENAI_API_KEY ou providers de fallback.",
    );
  }

  const messages = normalizeMessages(options.messages);
  const queuePolicy = resolveQueuePolicy(options.taskKey);
  const providerBundles = configuredProviders.map((provider) => {
    const { candidates, selectedBy } = rankModelCandidates(
      options.taskKey,
      provider.key,
      resolveProviderModelCandidates({
        provider,
        taskKey: options.taskKey,
        preferredModel: options.preferredModel,
      }),
    );

    return {
      provider,
      candidates,
      selectedBy,
    };
  });
  const candidateLabels = providerBundles.flatMap((bundle) =>
    bundle.candidates.map((model) => `${bundle.provider.key}:${model}`),
  );

  const queued = await withFlowAiTaskQueue({
    queueKey: queuePolicy.queueKey,
    concurrency: queuePolicy.concurrency,
    enabled: queuePolicy.enabled,
    producer: async () => {
      let lastError: Error | null = null;
      const maxRetries = resolveProviderRetryCount();

      for (const bundle of providerBundles) {
        const provider = bundle.provider;
        const circuitState = await canFlowAiProviderRun(provider.key);
        if (!circuitState.ok) {
          lastError = new Error(
            `Provider ${provider.key} em circuit breaker ate ${circuitState.nextAttemptAt ? new Date(circuitState.nextAttemptAt).toISOString() : "novo ciclo"}.`,
          );
          continue;
        }

        let providerLastError: Error | null = null;

        for (const model of bundle.candidates) {
          const blockedUntil =
            unavailableModelCache.get(providerModelKey(provider.key, model)) || 0;
          if (blockedUntil > nowMs()) {
            continue;
          }

          let allowJsonResponseFormat = options.mode === "json";

          for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
            const startedAt = nowMs();

            try {
              const body: Record<string, unknown> = {
                model,
                messages,
                temperature: options.temperature,
                max_tokens: options.maxTokens,
                user: String(options.userId || "").slice(0, 64) || undefined,
              };

              if (allowJsonResponseFormat) {
                body.response_format = { type: "json_object" };
              }

              const response = await fetchWithTimeout(
                `${provider.baseUrl}/chat/completions`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${provider.apiKey}`,
                    "Content-Type": "application/json",
                    ...(provider.headers || {}),
                  },
                  body: JSON.stringify(body),
                },
                options.timeoutMs,
              );

              const latencyMs = nowMs() - startedAt;
              const rawText = await response.text().catch(() => "");

              if (!response.ok) {
                const error = new Error(
                  `Falha no FlowAI com ${provider.key}/${model}: ${response.status} ${response.statusText} ${normalizeText(rawText, 320)}`,
                );

                if (
                  allowJsonResponseFormat &&
                  (response.status === 400 || response.status === 422)
                ) {
                  allowJsonResponseFormat = false;
                  recordModelFailure(
                    options.taskKey,
                    provider.key,
                    model,
                    error,
                    options.recordTelemetry,
                  );
                  recordFlowAiProviderFailure({
                    provider: provider.key,
                    model,
                    error: error.message,
                  });
                  providerLastError = error;
                  continue;
                }

                if (isModelAccessError(response.status, rawText)) {
                  unavailableModelCache.set(
                    providerModelKey(provider.key, model),
                    nowMs() + MODEL_BLOCK_TTL_MS,
                  );
                  recordModelFailure(
                    options.taskKey,
                    provider.key,
                    model,
                    error,
                    options.recordTelemetry,
                  );
                  recordFlowAiProviderFailure({
                    provider: provider.key,
                    model,
                    error: error.message,
                  });
                  lastError = error;
                  providerLastError = error;
                  break;
                }

                if (isRetryableStatus(response.status) && attempt <= maxRetries) {
                  recordModelFailure(
                    options.taskKey,
                    provider.key,
                    model,
                    error,
                    options.recordTelemetry,
                  );
                  recordFlowAiProviderFailure({
                    provider: provider.key,
                    model,
                    error: error.message,
                  });
                  await delay(attempt * 350);
                  lastError = error;
                  providerLastError = error;
                  continue;
                }

                recordModelFailure(
                  options.taskKey,
                  provider.key,
                  model,
                  error,
                  options.recordTelemetry,
                );
                recordFlowAiProviderFailure({
                  provider: provider.key,
                  model,
                  error: error.message,
                });
                lastError = error;
                providerLastError = error;

                if (
                  response.status >= 500 ||
                  response.status === 429 ||
                  response.status === 401 ||
                  response.status === 403
                ) {
                  break;
                }

                throw error;
              }

              let payload: {
                choices?: Array<{ message?: { content?: string } }>;
              } | null = null;
              try {
                payload = JSON.parse(rawText) as {
                  choices?: Array<{ message?: { content?: string } }>;
                };
              } catch (error) {
                const parsingError = new Error(
                  `Resposta invalida do FlowAI com ${provider.key}/${model}: ${formatErrorMessage(error)}`,
                );
                recordModelFailure(
                  options.taskKey,
                  provider.key,
                  model,
                  parsingError,
                  options.recordTelemetry,
                );
                recordFlowAiProviderFailure({
                  provider: provider.key,
                  model,
                  error: parsingError.message,
                });
                lastError = parsingError;
                providerLastError = parsingError;
                continue;
              }

              const content = normalizeText(
                payload?.choices?.[0]?.message?.content || "",
                10_000,
              );

              if (!content) {
                const emptyError = new Error(
                  `Resposta vazia do FlowAI com ${provider.key}/${model}.`,
                );
                recordModelFailure(
                  options.taskKey,
                  provider.key,
                  model,
                  emptyError,
                  options.recordTelemetry,
                );
                recordFlowAiProviderFailure({
                  provider: provider.key,
                  model,
                  error: emptyError.message,
                });
                lastError = emptyError;
                providerLastError = emptyError;
                continue;
              }

              unavailableModelCache.delete(providerModelKey(provider.key, model));
              recordModelSuccess(
                options.taskKey,
                provider.key,
                model,
                latencyMs,
                options.recordTelemetry,
              );
              recordFlowAiProviderSuccess({
                provider: provider.key,
                model,
                latencyMs,
              });
              await recordFlowAiCircuitSuccess(provider.key);
              options.trace?.setProvider(provider.key, model);

              return {
                content,
                model,
                provider: provider.key,
                latencyMs,
                candidates: candidateLabels,
                selectedBy: bundle.selectedBy,
                queueWaitMs: 0,
              } satisfies OpenAiCallResult;
            } catch (error) {
              const latencyMs = nowMs() - startedAt;
              const isAbort =
                error instanceof DOMException && error.name === "AbortError";
              const errorMessage = formatErrorMessage(error);
              const wrappedError = new Error(
                isAbort
                  ? `Timeout ao consultar o FlowAI com ${provider.key}/${model}.`
                  : `Falha de rede no FlowAI com ${provider.key}/${model}: ${errorMessage}`,
              );

              recordModelFailure(
                options.taskKey,
                provider.key,
                model,
                wrappedError,
                options.recordTelemetry,
              );
              recordFlowAiProviderFailure({
                provider: provider.key,
                model,
                error: wrappedError.message,
              });
              lastError = wrappedError;
              providerLastError = wrappedError;

              if (attempt <= maxRetries) {
                await delay(Math.max(250, attempt * 350));
                continue;
              }

              if (latencyMs >= options.timeoutMs || isAbort) {
                break;
              }
            }
          }
        }

        if (providerLastError) {
          await recordFlowAiCircuitFailure({
            provider: provider.key,
            error: providerLastError.message,
          });
          lastError = providerLastError;
        }
      }

      throw lastError || new Error("Nenhum provider disponivel respondeu no FlowAI.");
    },
  });

  if (queued.waitMs > 0) {
    options.trace?.setQueue(queued.waitMs);
  }

  return {
    ...queued.value,
    queueWaitMs: queued.waitMs,
  };
}

export async function runFlowAiText(
  input: FlowAiTextRequest,
): Promise<FlowAiTextResponse> {
  const taskKey = normalizeFlowAiTaskKey(input.taskKey);
  const taskProfile = getTaskProfile(taskKey);
  const trace = startFlowAiTrace({
    taskKey,
    kind: "text",
  });
  const normalizedInput: FlowAiTextRequest = {
    ...input,
    taskKey,
    messages: applyTaskProfileToMessages(taskKey, input.messages, "text"),
    temperature: clampTemperature(
      Number.isFinite(input.temperature)
        ? input.temperature
        : taskProfile.defaultTemperature,
    ),
    maxTokens: clampMaxTokens(input.maxTokens, taskProfile.defaultMaxTokens || 400),
    cacheTtlMs:
      Number.isFinite(input.cacheTtlMs) && Number(input.cacheTtlMs) > 0
        ? Number(input.cacheTtlMs)
        : taskProfile.defaultCacheTtlMs ?? null,
    preferredModel:
      typeof input.preferredModel === "string" && input.preferredModel.trim()
        ? input.preferredModel.trim()
        : taskProfile.preferredModel || null,
    timeoutMs:
      Number.isFinite(input.timeoutMs) && Number(input.timeoutMs) > 0
        ? Number(input.timeoutMs)
        : taskProfile.defaultTimeoutMs || DEFAULT_TIMEOUT_MS,
    recordTelemetry: input.recordTelemetry !== false,
  };

  try {
    const result = await withCache("text", normalizedInput, async () => {
      const providerResult = await callOpenAi({
        mode: "text",
        taskKey: normalizedInput.taskKey,
        messages: normalizedInput.messages,
        userId: normalizedInput.userId,
        temperature:
          normalizedInput.temperature ?? taskProfile.defaultTemperature ?? 0.35,
        maxTokens:
          normalizedInput.maxTokens ?? taskProfile.defaultMaxTokens ?? 400,
        preferredModel: normalizedInput.preferredModel,
        timeoutMs:
          normalizedInput.timeoutMs ??
          taskProfile.defaultTimeoutMs ??
          DEFAULT_TIMEOUT_MS,
        recordTelemetry: normalizedInput.recordTelemetry !== false,
        trace,
      });

      return {
        content: providerResult.content,
        model: providerResult.model,
        latencyMs: providerResult.latencyMs,
        provider: providerResult.provider,
        traceId: trace.traceId,
        queueWaitMs: providerResult.queueWaitMs,
        candidates: providerResult.candidates,
        adaptive: buildAdaptiveSnapshot(
          normalizedInput.taskKey,
          providerResult.provider,
          providerResult.model,
          providerResult.selectedBy,
        ),
      } satisfies FlowAiTextResponse;
    });

    trace.finish({
      status: "success",
      latencyMs: result.latencyMs,
    });

    return result;
  } catch (error) {
    trace.finish({
      status: "error",
      latencyMs: 0,
      error: formatErrorMessage(error),
    });
    throw error;
  }
}

export async function runFlowAiJson<T>(
  input: FlowAiTextRequest,
): Promise<FlowAiJsonResponse<T>> {
  const taskKey = normalizeFlowAiTaskKey(input.taskKey);
  const taskProfile = getTaskProfile(taskKey);
  const trace = startFlowAiTrace({
    taskKey,
    kind: "json",
  });
  const normalizedInput: FlowAiTextRequest = {
    ...input,
    taskKey,
    messages: applyTaskProfileToMessages(taskKey, input.messages, "json"),
    temperature: clampTemperature(
      Number.isFinite(input.temperature)
        ? input.temperature
        : taskProfile.defaultTemperature ?? 0.2,
    ),
    maxTokens: clampMaxTokens(input.maxTokens, taskProfile.defaultMaxTokens || 500),
    cacheTtlMs:
      Number.isFinite(input.cacheTtlMs) && Number(input.cacheTtlMs) > 0
        ? Number(input.cacheTtlMs)
        : taskProfile.defaultCacheTtlMs ?? null,
    preferredModel:
      typeof input.preferredModel === "string" && input.preferredModel.trim()
        ? input.preferredModel.trim()
        : taskProfile.preferredModel || null,
    timeoutMs:
      Number.isFinite(input.timeoutMs) && Number(input.timeoutMs) > 0
        ? Number(input.timeoutMs)
        : taskProfile.defaultTimeoutMs || DEFAULT_TIMEOUT_MS,
    recordTelemetry: input.recordTelemetry !== false,
  };

  try {
    const result = await withCache("json", normalizedInput, async () => {
      const providerResult = await callOpenAi({
        mode: "json",
        taskKey: normalizedInput.taskKey,
        messages: normalizedInput.messages,
        userId: normalizedInput.userId,
        temperature:
          normalizedInput.temperature ?? taskProfile.defaultTemperature ?? 0.2,
        maxTokens:
          normalizedInput.maxTokens ?? taskProfile.defaultMaxTokens ?? 500,
        preferredModel: normalizedInput.preferredModel,
        timeoutMs:
          normalizedInput.timeoutMs ??
          taskProfile.defaultTimeoutMs ??
          DEFAULT_TIMEOUT_MS,
        recordTelemetry: normalizedInput.recordTelemetry !== false,
        trace,
      });

      const rawContent = normalizeText(providerResult.content, 10_000);
      const objectText = extractJsonObject(rawContent);

      if (!objectText) {
        throw new Error("FlowAI nao retornou JSON valido.");
      }

      let object: T;
      try {
        object = JSON.parse(objectText) as T;
      } catch (error) {
        throw new Error(
          `FlowAI retornou JSON invalido: ${formatErrorMessage(error)}`,
        );
      }

      return {
        rawContent,
        object,
        content: rawContent,
        model: providerResult.model,
        latencyMs: providerResult.latencyMs,
        provider: providerResult.provider,
        traceId: trace.traceId,
        queueWaitMs: providerResult.queueWaitMs,
        candidates: providerResult.candidates,
        adaptive: buildAdaptiveSnapshot(
          normalizedInput.taskKey,
          providerResult.provider,
          providerResult.model,
          providerResult.selectedBy,
        ),
      } satisfies FlowAiJsonResponse<T>;
    });

    trace.finish({
      status: "success",
      latencyMs: result.latencyMs,
    });

    return result;
  } catch (error) {
    trace.finish({
      status: "error",
      latencyMs: 0,
      error: formatErrorMessage(error),
    });
    throw error;
  }
}

async function probeProviderUpstream(provider: FlowAiProviderConfig) {
  const startedAt = nowMs();

  try {
    const response = await fetchWithTimeout(
      `${provider.baseUrl}/models`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          ...(provider.headers || {}),
        },
      },
      8_000,
    );

    const latencyMs = nowMs() - startedAt;
    if (!response.ok) {
      const rawText = await response.text().catch(() => "");

      return {
        status:
          response.status === 401 || response.status === 403
            ? ("major_outage" as const)
            : ("partial_outage" as const),
        latencyMs,
        message:
          response.status === 401 || response.status === 403
            ? `Credenciais invalidas no provider ${provider.label}.`
            : `Falha ao consultar ${provider.label}: ${normalizeText(rawText, 220) || `HTTP ${response.status}`}`,
        baseUrl: provider.baseUrl,
      };
    }

    return {
      status: "operational" as const,
      latencyMs,
      message: null,
      baseUrl: provider.baseUrl,
    };
  } catch (error) {
    return {
      status: "partial_outage" as const,
      latencyMs: nowMs() - startedAt,
      message: `Falha de conexao com ${provider.label}: ${formatErrorMessage(error)}`,
      baseUrl: provider.baseUrl,
    };
  }
}

async function probeConfiguredProvidersUpstream() {
  const providers = getConfiguredFlowAiProviders();
  const results = await Promise.all(
    providers.map(async (provider) => ({
      key: provider.key,
      result: await probeProviderUpstream(provider),
    })),
  );

  const providerMap = Object.fromEntries(
    results.map((entry) => [entry.key, entry.result]),
  ) as FlowAiHealthResponse["upstream"]["providers"];

  return {
    openai:
      providerMap.openai || {
        status: "major_outage" as const,
        latencyMs: null,
        message: "Provider OpenAI nao configurado.",
        baseUrl: resolveOpenAiBaseUrl(),
      },
    providers: providerMap,
  };
}

function buildHealthStatusFromLatency(
  latencyMs: number,
  degradedAt: number,
  partialAt: number,
) {
  if (latencyMs >= partialAt) return "partial_outage" as const;
  if (latencyMs >= degradedAt) return "degraded_performance" as const;
  return "operational" as const;
}

function mapProbeFailureToStatus(error: unknown) {
  const message = formatErrorMessage(error);

  if (/api_key|credenciais|401|403|unauthorized|forbidden/i.test(message)) {
    return {
      status: "major_outage" as const,
      message,
    };
  }

  return {
    status: "partial_outage" as const,
    message,
  };
}

async function probeTextTask(
  taskKey: string,
  messages: FlowAiMessage[],
  input?: { degradedAt?: number; partialAt?: number },
) {
  try {
    const result = await runFlowAiText({
      taskKey,
      messages,
      temperature: 0.1,
      maxTokens: 120,
      timeoutMs: 10_000,
      cacheKey: `health:${normalizeFlowAiTaskKey(taskKey)}`,
      cacheTtlMs: HEALTH_CACHE_TTL_MS,
      recordTelemetry: false,
    });

    return {
      status: buildHealthStatusFromLatency(
        result.latencyMs,
        input?.degradedAt || 5_500,
        input?.partialAt || 9_500,
      ),
      message: null,
      latencyMs: result.latencyMs,
    } satisfies FlowAiIntegrationHealth;
  } catch (error) {
    const failure = mapProbeFailureToStatus(error);
    return {
      status: failure.status,
      message: failure.message,
      latencyMs: null,
    } satisfies FlowAiIntegrationHealth;
  }
}

async function probeJsonTask(
  taskKey: string,
  messages: FlowAiMessage[],
  input?: { degradedAt?: number; partialAt?: number },
) {
  try {
    const result = await runFlowAiJson<Record<string, unknown>>({
      taskKey,
      messages,
      temperature: 0.1,
      maxTokens: 160,
      timeoutMs: 10_000,
      cacheKey: `health:${normalizeFlowAiTaskKey(taskKey)}`,
      cacheTtlMs: HEALTH_CACHE_TTL_MS,
      recordTelemetry: false,
    });

    return {
      status: buildHealthStatusFromLatency(
        result.latencyMs,
        input?.degradedAt || 5_500,
        input?.partialAt || 9_500,
      ),
      message: null,
      latencyMs: result.latencyMs,
    } satisfies FlowAiIntegrationHealth;
  } catch (error) {
    const failure = mapProbeFailureToStatus(error);
    return {
      status: failure.status,
      message: failure.message,
      latencyMs: null,
    } satisfies FlowAiIntegrationHealth;
  }
}

function buildAdaptiveMemorySnapshot() {
  return {
    trackedPairs: modelTelemetryStore.size,
    entries: Array.from(modelTelemetryStore.entries())
      .map(([key, telemetry]) => {
        const [taskKey, provider, model] = key.split("::");
        return {
          taskKey,
          provider,
          model,
          successes: telemetry.successes,
          failures: telemetry.failures,
          avgLatencyMs: telemetry.avgLatencyMs,
          lastSuccessAt: telemetry.lastSuccessAt
            ? new Date(telemetry.lastSuccessAt).toISOString()
            : null,
          lastErrorAt: telemetry.lastErrorAt
            ? new Date(telemetry.lastErrorAt).toISOString()
            : null,
        };
      })
      .sort(
        (left, right) =>
          right.successes - left.successes ||
          right.failures - left.failures ||
          left.taskKey.localeCompare(right.taskKey),
      )
      .slice(0, 16),
  };
}

export async function runFlowAiHealthProbe(): Promise<FlowAiHealthResponse> {
  const checkedAt = new Date().toISOString();
  const [upstream, circuitBreakers] = await Promise.all([
    probeConfiguredProvidersUpstream(),
    getFlowAiCircuitSnapshot(),
  ]);
  const upstreamProviderStatuses = Object.values(upstream.providers).map(
    (provider) => provider.status,
  );
  const upstreamProviderLatencies = Object.values(upstream.providers).map(
    (provider) => provider.latencyMs,
  );
  const upstreamProviderMessages = Object.values(upstream.providers).map(
    (provider) => provider.message,
  );

  const [
    domainSuggestions,
    ticketAi,
    ticketSuggestion,
    discordMessageAi,
    adminAssistant,
    affiliateInsight,
    statusPageAi,
  ] = await Promise.all([
    probeTextTask("domain_suggestions", [
      {
        role: "system",
        content: "Voce sugere nomes curtos de dominio em PT-BR.",
      },
      {
        role: "user",
        content:
          "Sugira um nome curto de dominio para uma empresa ficticia chamada Flowdesk.",
      },
    ]),
    probeTextTask("ticket_reply", [
      {
        role: "system",
        content: "Voce atua como atendimento premium em PT-BR.",
      },
      {
        role: "user",
        content: "Nao consigo acessar meu painel e o ticket ainda esta aberto.",
      },
    ]),
    probeTextTask("ticket_suggestion", [
      {
        role: "system",
        content:
          "Voce entrega uma sugestao inicial de atendimento antes da abertura do ticket.",
      },
      {
        role: "user",
        content: "Preciso de ajuda com a configuracao do painel de tickets.",
      },
    ]),
    probeTextTask("discord_mention", [
      {
        role: "system",
        content: "Voce responde duvidas curtas no Discord em PT-BR.",
      },
      {
        role: "user",
        content: "Onde eu configuro os logs do ticket neste servidor?",
      },
    ]),
    probeJsonTask("admin_plan", [
      {
        role: "system",
        content:
          "Responda apenas JSON com intent e actions para um assistente administrativo do Discord.",
      },
      {
        role: "user",
        content:
          'Retorne {"intent":"execute","actions":[{"type":"create_channel","name":"suporte"}]}.',
      },
    ]),
    probeJsonTask("affiliate_insight", [
      {
        role: "system",
        content:
          "Responda apenas JSON com type, title, body e confidence para um insight de afiliado.",
      },
      {
        role: "user",
        content: JSON.stringify({
          approvedConversions: 5,
          pendingConversions: 2,
          bestHourWindow: "19h e 22h",
          topPlan: "Pro",
        }),
      },
    ]),
    probeJsonTask("status_note", [
      {
        role: "system",
        content:
          "Responda apenas JSON com title e description para uma pagina de status.",
      },
      {
        role: "user",
        content:
          'Gere {"title":"Instabilidade parcial","description":"Detectamos lentidao em um servico monitorado."}.',
      },
    ]),
  ]);

  const overallStatus = getWorstSystemStatus([
    upstream.openai.status,
    ...upstreamProviderStatuses,
    domainSuggestions.status,
    ticketAi.status,
    ticketSuggestion.status,
    discordMessageAi.status,
    adminAssistant.status,
    affiliateInsight.status,
    statusPageAi.status,
  ]);

  const latencyCandidates = [
    upstream.openai.latencyMs,
    ...upstreamProviderLatencies,
    domainSuggestions.latencyMs,
    ticketAi.latencyMs,
    ticketSuggestion.latencyMs,
    discordMessageAi.latencyMs,
    adminAssistant.latencyMs,
    affiliateInsight.latencyMs,
    statusPageAi.latencyMs,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const overallMessage =
    overallStatus === "operational"
      ? null
      : upstream.openai.message ||
        upstreamProviderMessages.find(Boolean) ||
        domainSuggestions.message ||
        ticketAi.message ||
        ticketSuggestion.message ||
        discordMessageAi.message ||
        adminAssistant.message ||
        affiliateInsight.message ||
        statusPageAi.message ||
        "Instabilidade detectada no FlowAI.";

  return {
    ok: overallStatus === "operational" || overallStatus === "degraded_performance",
    checkedAt,
    overall: {
      status: overallStatus,
      latencyMs: latencyCandidates.length ? Math.max(...latencyCandidates) : null,
      message: overallMessage,
    },
    upstream,
    integrations: {
      domainSuggestions,
      ticketAi,
      ticketSuggestion,
      discordMessageAi,
      adminAssistant,
      affiliateInsight,
      statusPageAi,
    },
    adaptiveMemory: buildAdaptiveMemorySnapshot(),
    infrastructure: getFlowAiInfraSnapshot(),
    circuitBreakers,
    observability: getFlowAiObservabilitySnapshot(),
  };
}
