type CacheEntry<TValue> = {
  expiresAt: number;
  value: TValue;
};

const inflightPaymentRequests = new Map<string, Promise<unknown>>();
const recentPaymentResponses = new Map<string, CacheEntry<unknown>>();
const MAX_RECENT_PAYMENT_RESPONSES = 500;

function cloneJsonValue<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

function pruneRecentPaymentResponses(nowMs: number) {
  if (recentPaymentResponses.size <= MAX_RECENT_PAYMENT_RESPONSES) {
    return;
  }

  for (const [key, entry] of recentPaymentResponses.entries()) {
    if (entry.expiresAt <= nowMs) {
      recentPaymentResponses.delete(key);
    }
  }

  if (recentPaymentResponses.size <= MAX_RECENT_PAYMENT_RESPONSES) {
    return;
  }

  const keys = Array.from(recentPaymentResponses.keys());
  const overflow = recentPaymentResponses.size - MAX_RECENT_PAYMENT_RESPONSES;
  for (const key of keys.slice(0, overflow)) {
    recentPaymentResponses.delete(key);
  }
}

export async function runCoalescedPaymentRequest<TValue>(input: {
  key: string;
  producer: () => Promise<TValue>;
  ttlMs?: number;
  shouldCache?: (value: TValue) => boolean;
}) {
  const nowMs = Date.now();
  pruneRecentPaymentResponses(nowMs);

  const cached = recentPaymentResponses.get(input.key);
  if (cached && cached.expiresAt > nowMs) {
    return cloneJsonValue(cached.value as TValue);
  }

  const inflight = inflightPaymentRequests.get(input.key);
  if (inflight) {
    return cloneJsonValue((await inflight) as TValue);
  }

  const request = (async () => {
    const value = await input.producer();
    const ttlMs = Math.max(0, Math.trunc(input.ttlMs || 0));
    const shouldCache = input.shouldCache ? input.shouldCache(value) : ttlMs > 0;

    if (ttlMs > 0 && shouldCache) {
      recentPaymentResponses.set(input.key, {
        expiresAt: Date.now() + ttlMs,
        value: cloneJsonValue(value),
      });
    }

    return value;
  })();

  inflightPaymentRequests.set(input.key, request);

  try {
    return cloneJsonValue(await request);
  } finally {
    inflightPaymentRequests.delete(input.key);
  }
}
