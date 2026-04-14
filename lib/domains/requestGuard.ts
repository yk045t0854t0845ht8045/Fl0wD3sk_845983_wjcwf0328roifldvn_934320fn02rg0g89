type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function getClientIdentifier(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const candidate = forwardedFor.split(",")[0]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) {
    return cfIp;
  }

  return request.headers.get("user-agent")?.trim() || "anonymous";
}

function cleanupBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function checkLocalRateLimit(
  request: Request,
  key: string,
  options: {
    max: number;
    windowMs: number;
  },
) {
  const now = Date.now();
  cleanupBuckets(now);

  const bucketKey = `${key}:${getClientIdentifier(request)}`;
  const current = buckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    const next = {
      count: 1,
      resetAt: now + options.windowMs,
    };
    buckets.set(bucketKey, next);

    return {
      ok: true,
      remaining: Math.max(0, options.max - next.count),
      resetAt: next.resetAt,
    };
  }

  current.count += 1;
  buckets.set(bucketKey, current);

  return {
    ok: current.count <= options.max,
    remaining: Math.max(0, options.max - current.count),
    resetAt: current.resetAt,
  };
}

export function getJsonSecurityHeaders(requestId: string) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Request-Id": requestId,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

export function normalizeDomainSearchInput(value: unknown) {
  return String(value || "")
    .trim()
    .slice(0, 120);
}

export function normalizeAiPromptInput(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
