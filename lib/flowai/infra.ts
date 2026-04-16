import crypto from "node:crypto";
import { getServerEnv } from "@/lib/serverEnv";

type LocalBucket = {
  count: number;
  resetAt: number;
};

type QueueWaiter = {
  resolve: () => void;
  enqueuedAt: number;
};

type QueueState = {
  active: number;
  pending: QueueWaiter[];
  processed: number;
  totalWaitMs: number;
  maxObservedPending: number;
};

type ProviderMetric = {
  requests: number;
  successes: number;
  failures: number;
  avgLatencyMs: number | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
};

type TraceEntry = {
  traceId: string;
  taskKey: string;
  kind: "text" | "json";
  status: "success" | "error" | "cache_hit";
  provider: string | null;
  model: string | null;
  latencyMs: number;
  queuedMs: number;
  cacheHit: boolean;
  createdAt: string;
  error: string | null;
};

type FlowAiCircuitState = {
  provider: string;
  state: "closed" | "open" | "half_open";
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  openedAt: number | null;
  nextAttemptAt: number | null;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  updatedAt: number;
  mode: "distributed" | "local";
};

const TRACE_LIMIT = 48;
const localReplayStore = new Map<string, number>();
const localRateLimitStore = new Map<string, LocalBucket>();
const localCircuitStore = new Map<string, FlowAiCircuitState>();
const queueStore = new Map<string, QueueState>();
const providerMetricsStore = new Map<string, ProviderMetric>();
const traceStore: TraceEntry[] = [];

const counters = {
  requestsTotal: 0,
  successTotal: 0,
  failedTotal: 0,
  cacheHitTotal: 0,
  queuedTotal: 0,
  replayBlockedTotal: 0,
  rateLimitedTotal: 0,
  circuitOpenedTotal: 0,
};

type RedisCommandResult<T = unknown> = {
  ok: boolean;
  result: T | null;
  error: string | null;
};

type FlowAiTraceHandle = {
  traceId: string;
  taskKey: string;
  kind: "text" | "json";
  setQueue(waitMs: number): void;
  setProvider(provider: string, model: string | null): void;
  finish(input: {
    status: "success" | "error" | "cache_hit";
    latencyMs: number;
    error?: string | null;
    cacheHit?: boolean;
  }): void;
};

function nowMs() {
  return Date.now();
}

function normalizeText(value: string, maxLength = 220) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanupLocalMap(store: Map<string, number>, now: number) {
  for (const [key, expiresAt] of store) {
    if (expiresAt <= now) {
      store.delete(key);
    }
  }
}

function cleanupLocalRateLimits(now: number) {
  for (const [key, bucket] of localRateLimitStore) {
    if (bucket.resetAt <= now) {
      localRateLimitStore.delete(key);
    }
  }
}

function resolveRedisConfig() {
  const url =
    getServerEnv("FLOWAI_REDIS_REST_URL") ||
    getServerEnv("UPSTASH_REDIS_REST_URL") ||
    "";
  const token =
    getServerEnv("FLOWAI_REDIS_REST_TOKEN") ||
    getServerEnv("UPSTASH_REDIS_REST_TOKEN") ||
    "";

  return {
    enabled: Boolean(url && token),
    url: url.replace(/\/$/, ""),
    token,
  };
}

function resolveCircuitConfig() {
  const openAfter = Number(getServerEnv("FLOWAI_CIRCUIT_OPEN_AFTER") || 5);
  const cooldownMs = Number(getServerEnv("FLOWAI_CIRCUIT_COOLDOWN_MS") || 45_000);
  const closeAfterSuccesses = Number(
    getServerEnv("FLOWAI_CIRCUIT_HALF_OPEN_SUCCESSES") || 2,
  );

  return {
    openAfter:
      Number.isFinite(openAfter) && openAfter > 0 ? Math.round(openAfter) : 5,
    cooldownMs:
      Number.isFinite(cooldownMs) && cooldownMs >= 5_000
        ? Math.round(cooldownMs)
        : 45_000,
    closeAfterSuccesses:
      Number.isFinite(closeAfterSuccesses) && closeAfterSuccesses > 0
        ? Math.round(closeAfterSuccesses)
        : 2,
  };
}

async function redisCommand<T = unknown>(
  args: Array<string | number>,
): Promise<RedisCommandResult<T>> {
  const config = resolveRedisConfig();
  if (!config.enabled) {
    return {
      ok: false,
      result: null,
      error: "redis_not_configured",
    };
  }

  try {
    const commandPath = args
      .map((part) => encodeURIComponent(String(part)))
      .join("/");
    const response = await fetch(`${config.url}/${commandPath}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          result?: T;
          error?: string;
        }
      | null;

    if (!response.ok) {
      return {
        ok: false,
        result: null,
        error: normalizeText(payload?.error || `HTTP ${response.status}`),
      };
    }

    return {
      ok: !payload?.error,
      result: (payload?.result ?? null) as T | null,
      error: payload?.error ? normalizeText(payload.error) : null,
    };
  } catch (error) {
    return {
      ok: false,
      result: null,
      error: normalizeText(error instanceof Error ? error.message : String(error)),
    };
  }
}

function buildCircuitKey(provider: string) {
  return `flowai:circuit:${provider}`;
}

function getDefaultCircuitState(provider: string, mode: "distributed" | "local") {
  return {
    provider,
    state: "closed" as const,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    openedAt: null,
    nextAttemptAt: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastError: null,
    updatedAt: nowMs(),
    mode,
  };
}

async function readDistributedCircuitState(provider: string) {
  const result = await redisCommand<string>(["GET", buildCircuitKey(provider)]);
  if (!result.ok) {
    return null;
  }

  try {
    const parsed = JSON.parse(String(result.result || "")) as FlowAiCircuitState;
    return {
      ...getDefaultCircuitState(provider, "distributed"),
      ...parsed,
      provider,
      mode: "distributed" as const,
    };
  } catch {
    return getDefaultCircuitState(provider, "distributed");
  }
}

async function writeDistributedCircuitState(state: FlowAiCircuitState) {
  const ttlMs = Math.max(resolveCircuitConfig().cooldownMs * 6, 60_000);
  const payload = JSON.stringify({
    ...state,
    updatedAt: nowMs(),
    mode: "distributed",
  });

  const result = await redisCommand<string>([
    "SET",
    buildCircuitKey(state.provider),
    payload,
    "PX",
    ttlMs,
  ]);

  return result.ok;
}

async function readCircuitState(provider: string) {
  const distributed = await readDistributedCircuitState(provider);
  if (distributed) {
    return distributed;
  }

  return (
    localCircuitStore.get(provider) || getDefaultCircuitState(provider, "local")
  );
}

async function writeCircuitState(state: FlowAiCircuitState) {
  const nextState = {
    ...state,
    updatedAt: nowMs(),
  };

  const distributedSaved = await writeDistributedCircuitState(nextState);
  if (!distributedSaved) {
    localCircuitStore.set(state.provider, {
      ...nextState,
      mode: "local",
    });
    return "local" as const;
  }

  localCircuitStore.delete(state.provider);
  return "distributed" as const;
}

function getProviderMetric(key: string): ProviderMetric {
  return (
    providerMetricsStore.get(key) || {
      requests: 0,
      successes: 0,
      failures: 0,
      avgLatencyMs: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
    }
  );
}

function setProviderMetric(key: string, value: ProviderMetric) {
  providerMetricsStore.set(key, value);
}

function pushTrace(entry: TraceEntry) {
  traceStore.unshift(entry);
  if (traceStore.length > TRACE_LIMIT) {
    traceStore.length = TRACE_LIMIT;
  }
}

export function startFlowAiTrace(input: {
  taskKey: string;
  kind: "text" | "json";
}): FlowAiTraceHandle {
  counters.requestsTotal += 1;

  let queuedMs = 0;
  let provider: string | null = null;
  let model: string | null = null;

  return {
    traceId: crypto.randomUUID(),
    taskKey: input.taskKey,
    kind: input.kind,
    setQueue(waitMs: number) {
      queuedMs = Math.max(0, Math.round(waitMs));
      if (queuedMs > 0) {
        counters.queuedTotal += 1;
      }
    },
    setProvider(nextProvider: string, nextModel: string | null) {
      provider = nextProvider;
      model = nextModel;
    },
    finish({ status, latencyMs, error, cacheHit }) {
      if (status === "success") {
        counters.successTotal += 1;
      } else if (status === "cache_hit") {
        counters.successTotal += 1;
        counters.cacheHitTotal += 1;
      } else {
        counters.failedTotal += 1;
      }

      pushTrace({
        traceId: this.traceId,
        taskKey: input.taskKey,
        kind: input.kind,
        status,
        provider,
        model,
        latencyMs: Math.max(0, Math.round(latencyMs)),
        queuedMs,
        cacheHit: Boolean(cacheHit),
        createdAt: new Date().toISOString(),
        error: error ? normalizeText(error) : null,
      });
    },
  };
}

export function recordFlowAiCacheHit() {
  counters.cacheHitTotal += 1;
}

export function recordFlowAiProviderSuccess(input: {
  provider: string;
  model: string;
  latencyMs: number;
}) {
  const key = `${input.provider}:${input.model}`;
  const current = getProviderMetric(key);
  const totalSuccesses = current.successes + 1;
  const avgLatencyMs =
    current.avgLatencyMs === null
      ? Math.round(input.latencyMs)
      : Math.round(
          (current.avgLatencyMs * current.successes + input.latencyMs) /
            totalSuccesses,
        );

  setProviderMetric(key, {
    ...current,
    requests: current.requests + 1,
    successes: totalSuccesses,
    avgLatencyMs,
    lastSuccessAt: new Date().toISOString(),
    lastError: null,
  });
}

export function recordFlowAiProviderFailure(input: {
  provider: string;
  model: string;
  error: string;
}) {
  const key = `${input.provider}:${input.model}`;
  const current = getProviderMetric(key);

  setProviderMetric(key, {
    ...current,
    requests: current.requests + 1,
    failures: current.failures + 1,
    lastErrorAt: new Date().toISOString(),
    lastError: normalizeText(input.error),
  });
}

export async function canFlowAiProviderRun(provider: string) {
  const current = await readCircuitState(provider);
  const config = resolveCircuitConfig();

  if (current.state === "open") {
    const nextAttemptAt = current.nextAttemptAt || 0;
    if (nextAttemptAt > nowMs()) {
      return {
        ok: false as const,
        state: current.state,
        nextAttemptAt,
        reason: current.lastError,
      };
    }

    const transitioned: FlowAiCircuitState = {
      ...current,
      state: "half_open",
      consecutiveSuccesses: 0,
      nextAttemptAt: nowMs() + config.cooldownMs,
    };
    const mode = await writeCircuitState(transitioned);

    return {
      ok: true as const,
      state: "half_open" as const,
      nextAttemptAt: transitioned.nextAttemptAt,
      mode,
    };
  }

  return {
    ok: true as const,
    state: current.state,
    nextAttemptAt: current.nextAttemptAt,
    mode: current.mode,
  };
}

export async function recordFlowAiCircuitSuccess(provider: string) {
  const config = resolveCircuitConfig();
  const current = await readCircuitState(provider);
  const successCount =
    current.state === "half_open"
      ? current.consecutiveSuccesses + 1
      : current.consecutiveSuccesses + 1;

  const shouldClose =
    current.state !== "half_open" || successCount >= config.closeAfterSuccesses;

  const nextState: FlowAiCircuitState = shouldClose
    ? {
        ...getDefaultCircuitState(provider, current.mode),
        consecutiveSuccesses: successCount,
        lastSuccessAt: nowMs(),
      }
    : {
        ...current,
        state: "half_open",
        consecutiveFailures: 0,
        consecutiveSuccesses: successCount,
        lastSuccessAt: nowMs(),
        lastError: null,
      };

  await writeCircuitState(nextState);
  return nextState;
}

export async function recordFlowAiCircuitFailure(input: {
  provider: string;
  error: string;
}) {
  const config = resolveCircuitConfig();
  const current = await readCircuitState(input.provider);
  const consecutiveFailures = current.consecutiveFailures + 1;
  const shouldOpen =
    current.state === "half_open" || consecutiveFailures >= config.openAfter;
  const nextAttemptAt = shouldOpen ? nowMs() + config.cooldownMs : null;

  const nextState: FlowAiCircuitState = {
    ...current,
    state: shouldOpen ? "open" : "closed",
    consecutiveFailures,
    consecutiveSuccesses: 0,
    openedAt: shouldOpen ? nowMs() : current.openedAt,
    nextAttemptAt,
    lastFailureAt: nowMs(),
    lastError: normalizeText(input.error, 320),
  };

  if (shouldOpen && current.state !== "open") {
    counters.circuitOpenedTotal += 1;
  }

  await writeCircuitState(nextState);
  return nextState;
}

export async function reserveFlowAiReplayKey(key: string, ttlMs: number) {
  const normalizedTtlMs = Math.max(1000, Math.round(ttlMs));
  const redis = await redisCommand<string>([
    "SET",
    key,
    String(nowMs()),
    "NX",
    "PX",
    normalizedTtlMs,
  ]);

  if (redis.ok) {
    if (redis.result === "OK") {
      return { ok: true as const, mode: "distributed" as const };
    }

    counters.replayBlockedTotal += 1;
    return { ok: false as const, mode: "distributed" as const };
  }

  const currentTime = nowMs();
  cleanupLocalMap(localReplayStore, currentTime);
  const existing = localReplayStore.get(key) || 0;
  if (existing > currentTime) {
    counters.replayBlockedTotal += 1;
    return { ok: false as const, mode: "local" as const };
  }

  localReplayStore.set(key, currentTime + normalizedTtlMs);
  return { ok: true as const, mode: "local" as const };
}

export async function enforceFlowAiRateLimit(input: {
  key: string;
  max: number;
  windowMs: number;
}) {
  const normalizedMax = Math.max(1, Math.round(input.max));
  const normalizedWindowMs = Math.max(1000, Math.round(input.windowMs));
  const bucketKey = `flowai:ratelimit:${input.key}`;

  const increment = await redisCommand<number>(["INCR", bucketKey]);
  if (increment.ok && typeof increment.result === "number") {
    const count = Number(increment.result);
    if (count === 1) {
      await redisCommand(["PEXPIRE", bucketKey, normalizedWindowMs]);
    }

    const ttl = await redisCommand<number>(["PTTL", bucketKey]);
    const ttlMs =
      ttl.ok && typeof ttl.result === "number" && ttl.result > 0
        ? Number(ttl.result)
        : normalizedWindowMs;

    if (count > normalizedMax) {
      counters.rateLimitedTotal += 1;
    }

    return {
      ok: count <= normalizedMax,
      mode: "distributed" as const,
      count,
      remaining: Math.max(0, normalizedMax - count),
      resetAt: nowMs() + ttlMs,
    };
  }

  const currentTime = nowMs();
  cleanupLocalRateLimits(currentTime);

  const current = localRateLimitStore.get(bucketKey);
  if (!current || current.resetAt <= currentTime) {
    const next = {
      count: 1,
      resetAt: currentTime + normalizedWindowMs,
    };
    localRateLimitStore.set(bucketKey, next);

    return {
      ok: true,
      mode: "local" as const,
      count: next.count,
      remaining: Math.max(0, normalizedMax - next.count),
      resetAt: next.resetAt,
    };
  }

  current.count += 1;
  localRateLimitStore.set(bucketKey, current);

  if (current.count > normalizedMax) {
    counters.rateLimitedTotal += 1;
  }

  return {
    ok: current.count <= normalizedMax,
    mode: "local" as const,
    count: current.count,
    remaining: Math.max(0, normalizedMax - current.count),
    resetAt: current.resetAt,
  };
}

export async function withFlowAiTaskQueue<T>(input: {
  queueKey: string;
  concurrency: number;
  enabled: boolean;
  producer: () => Promise<T>;
}) {
  if (!input.enabled) {
    return {
      value: await input.producer(),
      waitMs: 0,
      mode: "direct" as const,
    };
  }

  const concurrency = Math.max(1, Math.round(input.concurrency));
  const state =
    queueStore.get(input.queueKey) ||
    {
      active: 0,
      pending: [],
      processed: 0,
      totalWaitMs: 0,
      maxObservedPending: 0,
    };
  queueStore.set(input.queueKey, state);

  const waitStartedAt = nowMs();
  if (state.active >= concurrency) {
    await new Promise<void>((resolve) => {
      state.pending.push({
        resolve,
        enqueuedAt: waitStartedAt,
      });
      state.maxObservedPending = Math.max(
        state.maxObservedPending,
        state.pending.length,
      );
    });
  }

  state.active += 1;
  const waitMs = nowMs() - waitStartedAt;
  state.totalWaitMs += waitMs;

  try {
    return {
      value: await input.producer(),
      waitMs,
      mode: "local" as const,
    };
  } finally {
    state.active = Math.max(0, state.active - 1);
    state.processed += 1;
    const next = state.pending.shift();
    if (next) {
      next.resolve();
    }
  }
}

export function getFlowAiInfraSnapshot() {
  const redis = resolveRedisConfig();
  const circuit = resolveCircuitConfig();

  return {
    redis: {
      configured: redis.enabled,
      mode: redis.enabled ? "distributed" : "local",
    },
    replayProtection: {
      mode: redis.enabled ? "distributed" : "local",
      localEntries: localReplayStore.size,
    },
    rateLimit: {
      mode: redis.enabled ? "distributed" : "local",
      localBuckets: localRateLimitStore.size,
    },
    circuitBreaker: {
      mode: redis.enabled ? "distributed" : "local",
      openAfter: circuit.openAfter,
      cooldownMs: circuit.cooldownMs,
      closeAfterSuccesses: circuit.closeAfterSuccesses,
      localEntries: localCircuitStore.size,
    },
    queue: {
      mode: "local",
      groups: Array.from(queueStore.entries()).map(([key, state]) => ({
        key,
        active: state.active,
        pending: state.pending.length,
        processed: state.processed,
        avgWaitMs:
          state.processed > 0
            ? Math.round(state.totalWaitMs / state.processed)
            : 0,
        maxObservedPending: state.maxObservedPending,
      })),
    },
  };
}

export async function getFlowAiCircuitSnapshot() {
  const redis = resolveRedisConfig();
  const providerNames = new Set<string>([
    ...Array.from(localCircuitStore.keys()),
    ...Array.from(providerMetricsStore.keys()).map((key) => key.split(":")[0] || key),
    "openai",
    "groq",
    "openrouter",
    "mistral",
  ]);

  const entries = await Promise.all(
    Array.from(providerNames)
      .filter(Boolean)
      .map(async (provider) => await readCircuitState(provider)),
  );

  return entries
    .map((entry) => ({
      provider: entry.provider,
      state: entry.state,
      consecutiveFailures: entry.consecutiveFailures,
      consecutiveSuccesses: entry.consecutiveSuccesses,
      openedAt: entry.openedAt ? new Date(entry.openedAt).toISOString() : null,
      nextAttemptAt: entry.nextAttemptAt
        ? new Date(entry.nextAttemptAt).toISOString()
        : null,
      lastFailureAt: entry.lastFailureAt
        ? new Date(entry.lastFailureAt).toISOString()
        : null,
      lastSuccessAt: entry.lastSuccessAt
        ? new Date(entry.lastSuccessAt).toISOString()
        : null,
      lastError: entry.lastError,
      mode: redis.enabled ? "distributed" : "local",
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider));
}

export function getFlowAiObservabilitySnapshot() {
  return {
    counters: {
      ...counters,
    },
    providers: Array.from(providerMetricsStore.entries())
      .map(([key, metric]) => ({
        key,
        ...metric,
      }))
      .sort(
        (left, right) =>
          right.requests - left.requests || left.key.localeCompare(right.key),
      )
      .slice(0, 18),
    recentTraces: [...traceStore],
  };
}
