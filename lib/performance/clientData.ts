"use client";

type ClientDataCacheEntry<TValue> = {
  expiresAt: number;
  value: TValue;
};

type ClientDataOptions<TValue> = {
  cacheKey?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  storage?: "session" | "memory" | "none";
  parse?: (response: Response) => Promise<TValue>;
};

const memoryCache = new Map<string, ClientDataCacheEntry<unknown>>();
const inflightRequests = new Map<string, Promise<unknown>>();
const DEFAULT_TIMEOUT_MS = 4500;
const DEFAULT_CACHE_TTL_MS = 45_000;

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function readSessionCache<TValue>(key: string) {
  if (!canUseSessionStorage()) return null;

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as ClientDataCacheEntry<TValue>;
    if (!entry || typeof entry.expiresAt !== "number") return null;
    if (entry.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

function writeSessionCache<TValue>(key: string, value: TValue, ttlMs: number) {
  if (!canUseSessionStorage() || ttlMs <= 0) return;

  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        expiresAt: Date.now() + ttlMs,
        value,
      } satisfies ClientDataCacheEntry<TValue>),
    );
  } catch {
    // noop
  }
}

export function readClientDataCache<TValue>(key: string) {
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
    return memoryEntry.value as TValue;
  }
  if (memoryEntry) memoryCache.delete(key);

  const sessionValue = readSessionCache<TValue>(key);
  if (sessionValue !== null) {
    memoryCache.set(key, {
      expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
      value: sessionValue,
    });
  }
  return sessionValue;
}

export function writeClientDataCache<TValue>(
  key: string,
  value: TValue,
  ttlMs = DEFAULT_CACHE_TTL_MS,
  storage: "session" | "memory" | "none" = "session",
) {
  if (storage === "none" || ttlMs <= 0) return;

  memoryCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });

  if (storage === "session") {
    writeSessionCache(key, value, ttlMs);
  }
}

export function invalidateClientDataCache(keyPrefix?: string) {
  if (!keyPrefix) {
    memoryCache.clear();
    return;
  }

  for (const key of memoryCache.keys()) {
    if (key.startsWith(keyPrefix)) memoryCache.delete(key);
  }
}

function resolveRequestKey(input: RequestInfo | URL, init?: RequestInit) {
  const method = init?.method?.toUpperCase() || "GET";
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return `${method}:${url}`;
}

async function parseJson<TValue>(response: Response) {
  return (await response.json()) as TValue;
}

export async function fetchClientData<TValue>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ClientDataOptions<TValue> = {},
) {
  const requestKey = options.cacheKey || resolveRequestKey(input, init);
  const method = init?.method?.toUpperCase() || "GET";
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const storage = options.storage ?? (method === "GET" ? "session" : "none");

  if (method === "GET" && cacheTtlMs > 0) {
    const cached = readClientDataCache<TValue>(requestKey);
    if (cached !== null) return cached;
  }

  const inflight = inflightRequests.get(requestKey);
  if (inflight) return (await inflight) as TValue;

  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const timeoutId = window.setTimeout(
    () => controller.abort("flowdesk_client_timeout"),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason || "upstream_abort");
  if (upstreamSignal) {
    if (upstreamSignal.aborted) abortFromUpstream();
    else upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
  }

  const request = (async () => {
    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      const parser = options.parse || parseJson<TValue>;
      const payload = await parser(response);

      if (!response.ok) {
        const message =
          payload &&
          typeof payload === "object" &&
          "message" in payload &&
          typeof payload.message === "string"
            ? payload.message
            : "Falha ao carregar dados.";
        throw Object.assign(new Error(message), { responseStatus: response.status });
      }

      if (method === "GET") {
        writeClientDataCache(requestKey, payload, cacheTtlMs, storage);
      }

      return payload;
    } finally {
      window.clearTimeout(timeoutId);
      if (upstreamSignal) upstreamSignal.removeEventListener("abort", abortFromUpstream);
      inflightRequests.delete(requestKey);
    }
  })();

  inflightRequests.set(requestKey, request);
  return (await request) as TValue;
}
