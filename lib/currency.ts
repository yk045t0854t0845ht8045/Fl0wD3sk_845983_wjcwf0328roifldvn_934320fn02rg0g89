export interface ExchangeRateResponse {
  result: string;
  base_code: string;
  rates: Record<string, number>;
}

// BRL rate fallback chain: try multiple APIs before using static fallback
const RATE_APIS = [
  {
    url: "https://api.exchangerate-api.com/v4/latest/USD",
    extract: (data: unknown) => (data as { rates: Record<string, number> })?.rates?.["BRL"],
  },
  {
    url: "https://open.er-api.com/v6/latest/USD",
    extract: (data: unknown) => (data as { rates: Record<string, number> })?.rates?.["BRL"],
  },
  {
    url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
    extract: (data: unknown) => (data as { usd: Record<string, number> })?.usd?.["brl"],
  },
];

const STATIC_FALLBACK_RATE = 5.75;
const CACHE_DURATION_MS = 1000 * 60 * 60; // 1h
const STALE_ALLOWED_MS = 1000 * 60 * 60 * 6; // serve stale up to 6h while revalidating
const RATE_FETCH_TIMEOUT_MS = 4000;

let cachedRate: number | null = null;
let lastFetched: number = 0;
let revalidating = false;

async function fetchRateFrom(api: (typeof RATE_APIS)[number]): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RATE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(api.url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const rate = api.extract(data);
    return typeof rate === "number" && rate > 1 && rate < 20 ? rate : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function revalidateRate(): Promise<number> {
  for (const api of RATE_APIS) {
    const rate = await fetchRateFrom(api);
    if (rate) {
      cachedRate = rate;
      lastFetched = Date.now();
      return rate;
    }
  }
  // All APIs failed — keep cached or use static fallback
  return cachedRate ?? STATIC_FALLBACK_RATE;
}

export async function getUSDToBRLRate(): Promise<number> {
  const now = Date.now();
  const age = now - lastFetched;

  // Fresh cache — return immediately
  if (cachedRate && age < CACHE_DURATION_MS) {
    return cachedRate;
  }

  // Stale-while-revalidate: serve stale immediately and refresh in background
  if (cachedRate && age < STALE_ALLOWED_MS) {
    if (!revalidating) {
      revalidating = true;
      revalidateRate().finally(() => { revalidating = false; });
    }
    return cachedRate;
  }

  // No cache or too old — must wait for fresh data
  try {
    revalidating = true;
    return await revalidateRate();
  } finally {
    revalidating = false;
  }
}
