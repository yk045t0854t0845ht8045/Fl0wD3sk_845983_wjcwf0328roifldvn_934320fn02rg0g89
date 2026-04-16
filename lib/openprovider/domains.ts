import { OpenProviderRequestError, openProviderClient } from "./client";
import {
  DomainCheckResult,
  DomainCheckRequest,
  DomainCheckResponseData,
  DomainPriceResponseData,
  DomainSearchResponse,
  DomainSearchResult,
} from "./types";

export interface CheckDomainInput {
  name: string;
  extension: string;
  idn_script?: string;
}

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

// ─── TLD list ─────────────────────────────────────────────────────────────────
// Priority order: Brazilian TLDs first, then global high-value, then long-tail
const DEFAULT_TLDS = [
  // Tier 1 — Brazil + global must-haves
  "com.br", "com", "net.br", "org.br", "net", "org", "io", "ai", "me", "dev",
  "app", "co", "tv", "shop", "store", "online", "tech", "site", "website", "cloud",
  "digital", "solutions", "services", "systems",
  // Tier 2 — popular global
  "agency", "group", "pro", "biz", "info", "vip", "top", "xyz", "link", "click",
  "today", "life", "world", "expert", "guide", "help", "work", "zone",
  // Tier 3 — business verticals
  "academy", "associates", "bar", "beauty", "blog", "beer", "bio", "build",
  "builders", "business", "cafe", "camera", "camp", "care", "cards", "catering",
  "center", "city", "club", "coach", "codes", "coffee", "community", "company",
  "computer", "consulting", "contact", "cool", "courses", "creative", "dance",
  "data", "dating", "deals", "delivery", "design", "directory", "discount",
  "doctor", "domains", "education", "email", "energy", "engineering", "enterprises",
  "equipment", "estate", "events", "exchange", "expert", "express", "farm",
  "fashion", "fyi", "finance", "financial", "fish", "fit", "fitness", "flights",
  "florist", "football", "foundation", "fund", "furniture", "gallery", "games",
  "garden", "gifts", "glass", "global", "gold", "golf", "graphics", "gratis",
  "green", "gripe", "guru", "healthcare", "hockey", "holdings", "holiday", "homes",
  "horse", "hospital", "host", "house", "immo", "industries", "institute", "insure",
  "international", "investments", "jewelry", "jobs", "kitchen", "land", "lease",
  "legal", "lighting", "limited", "limo", "live", "loans", "love", "ltd", "luxury",
  "management", "market", "marketing", "media", "memorial", "money", "movie",
  "network", "news", "ninja", "one", "partners", "parts", "party", "photo",
  "photography", "photos", "pics", "pictures", "pink", "pizza", "plus", "poker",
  "press", "productions", "promo", "properties", "pub", "recipes", "red", "rehab",
  "rent", "rentals", "repair", "report", "restaurant", "reviews", "rocks", "run",
  "sale", "school", "science", "shoes", "shopping", "show", "singles", "social",
  "software", "solar", "space", "sport", "style", "supply", "support", "surgery",
  "tattoo", "tax", "taxi", "team", "technology", "tennis", "theater", "tienda",
  "tips", "tires", "tools", "tour", "town", "toys", "trade", "training", "university",
  "vacations", "ventures", "video", "villas", "vin", "vision", "voyage", "watch",
  "wine", "works", "wtf", "yoga",
  // LatAm + EU
  "com.mx", "mx", "es", "cl", "ar", "pt", "re",
];

// ─── Constants ────────────────────────────────────────────────────────────────
const SEARCH_CACHE_TTL_MS = 1000 * 120;   // 2min
const PRICE_CACHE_TTL_MS  = 1000 * 60 * 20; // 20min
const DEFAULT_MAX_TLDS    = 24;
// OpenProvider hard limit per /domains/check request is 10 domains
const OPENPROVIDER_MAX_DOMAINS_PER_BATCH = 10;
const DEFAULT_BATCH_SIZE  = OPENPROVIDER_MAX_DOMAINS_PER_BATCH;
const DEFAULT_BATCH_CONCURRENCY  = 6;  // 6 parallel batches × 10 = 60 simultaneous checks
const DEFAULT_PRICE_CONCURRENCY  = 8;  // aggressive price hydration

// Timeout for price hydration — never block main results
const PRICE_HYDRATION_TIMEOUT_MS = 4000;

// Detect OpenProvider's "too many domains" error
function isLimitExceededError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /limit exceed|too many domain|send less domain/i.test(error.message);
}

// ─── In-process caches ────────────────────────────────────────────────────────
const searchCache = new Map<string, CacheEntry<DomainSearchResponse>>();
const inflightSearches = new Map<string, Promise<DomainSearchResponse>>();
const priceCache = new Map<string, CacheEntry<{ price: number; currency: string; isPremium: boolean }>>();
const inflightPrices = new Map<string, Promise<{ price: number; currency: string; isPremium: boolean }>>();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getPositiveIntEnv(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function normalizeExtension(value: string) {
  return value.trim().toLowerCase().replace(/^\./, "");
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function splitDomainParts(domain: string) {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return { name: domain.toLowerCase(), extension: "" };
  return { name: parts[0], extension: parts.slice(1).join(".") };
}

function getConfiguredTlds() {
  const configured = process.env.OPENPROVIDER_TLDS
    ?.split(",")
    .map((item) => normalizeExtension(item))
    .filter(Boolean);

  const maxTlds = getPositiveIntEnv("OPENPROVIDER_MAX_TLDS", DEFAULT_MAX_TLDS);

  if (!configured || configured.length === 0) {
    return Array.from(new Set(DEFAULT_TLDS.map((item) => normalizeExtension(item)))).slice(0, maxTlds);
  }

  return Array.from(new Set(configured)).slice(0, maxTlds);
}

function sanitizeSearchInput(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .replace(/^www\./, "")
    .replace(/\s+/g, "");
}

function parseSearchQuery(input: string) {
  const normalized = sanitizeSearchInput(input);
  const parts = normalized.split(".").filter(Boolean);
  const baseName = (parts[0] || "").replace(/[^\p{L}\p{N}-]/gu, "");
  const requestedExtension = parts.length > 1 ? parts.slice(1).join(".") : null;

  if (!baseName) throw new Error("Nome de dominio invalido.");

  return { query: normalized, baseName, requestedExtension };
}

function buildSearchTlds(requestedExtension: string | null) {
  const configured = getConfiguredTlds();
  const tlds = requestedExtension ? [requestedExtension, ...configured] : configured;
  return Array.from(new Set(tlds.map((item) => normalizeExtension(item)).filter(Boolean)));
}

function cloneSearchResponse(response: DomainSearchResponse): DomainSearchResponse {
  return {
    ...response,
    searchedTlds: [...response.searchedTlds],
    results: response.results.map((item) => ({ ...item })),
  };
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────
async function runWithConcurrencyLimit<TInput, TOutput>(
  items: TInput[],
  limit: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results: TOutput[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const currentIndex = cursor++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

// ─── Result normalization ─────────────────────────────────────────────────────
function normalizeResult(input: CheckDomainInput, rawResult?: DomainCheckResult): DomainSearchResult {
  const fallbackDomain = `${normalizeName(input.name)}.${normalizeExtension(input.extension)}`;
  const fullDomain = rawResult?.domain?.toLowerCase() || fallbackDomain;
  const parsed = splitDomainParts(fullDomain);

  const regularPrice = rawResult?.price?.reseller?.price ?? rawResult?.price?.product?.price ?? 0;
  const regularCurrency = rawResult?.price?.reseller?.currency ?? rawResult?.price?.product?.currency ?? "";
  const premiumPrice = rawResult?.premium?.price?.create ?? 0;
  const premiumCurrency = rawResult?.premium?.currency ?? "";

  return {
    domain: fullDomain,
    extension: parsed.extension || normalizeExtension(input.extension),
    status: rawResult?.status || "unknown",
    isAvailable: rawResult?.status === "free",
    price: Number(regularPrice || premiumPrice || 0),
    currency: regularCurrency || premiumCurrency || "USD",
    isPremium: Boolean(rawResult?.is_premium),
    reason: rawResult?.reason || "",
    whois: rawResult?.whois || "",
  };
}

// ─── Price hydration ─────────────────────────────────────────────────────────
async function getDomainPrice(input: CheckDomainInput) {
  const cacheKey = `${normalizeName(input.name)}.${normalizeExtension(input.extension)}`;
  const cached = getCachedValue(priceCache, cacheKey);
  if (cached) return cached;

  const inflight = inflightPrices.get(cacheKey);
  if (inflight) return inflight;

  const request = (async () => {
    const response = await openProviderClient.get<DomainPriceResponseData>("domains/prices", {
      "domain.name": normalizeName(input.name),
      "domain.extension": normalizeExtension(input.extension),
      operation: "create",
      period: 1,
      ...(input.idn_script ? { "additional_data.idn_script": input.idn_script } : {}),
    });

    const price =
      response.data?.price?.reseller?.price ??
      response.data?.price?.product?.price ??
      response.data?.tier_price?.reseller?.price ??
      response.data?.tier_price?.product?.price ??
      0;

    const currency =
      response.data?.price?.reseller?.currency ??
      response.data?.price?.product?.currency ??
      response.data?.tier_price?.reseller?.currency ??
      response.data?.tier_price?.product?.currency ??
      "USD";

    const resolved = { price: Number(price || 0), currency, isPremium: Boolean(response.data?.is_premium) };

    priceCache.set(cacheKey, { value: resolved, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
    return resolved;
  })();

  inflightPrices.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inflightPrices.delete(cacheKey);
  }
}

/**
 * Hydrate missing prices for available domains.
 * Never throws — worst case leaves price as 0.
 * Has a global deadline so it never blocks the response too long.
 */
async function hydrateMissingPrices(inputs: CheckDomainInput[], results: DomainSearchResult[]) {
  const missing = results
    .map((result, index) => ({ result, input: inputs[index] }))
    .filter(({ result }) => result.isAvailable && result.price <= 0);

  if (missing.length === 0) return results;

  // Race against a global deadline: if price API is slow, return without prices
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), PRICE_HYDRATION_TIMEOUT_MS));

  const hydrationWork = runWithConcurrencyLimit(
    missing,
    getPositiveIntEnv("OPENPROVIDER_PRICE_CONCURRENCY", DEFAULT_PRICE_CONCURRENCY),
    async ({ input, result }) => {
      try {
        const price = await getDomainPrice(input);
        return {
          domain: `${normalizeName(input.name)}.${normalizeExtension(input.extension)}`,
          price,
          fallback: result,
        };
      } catch {
        return {
          domain: `${normalizeName(input.name)}.${normalizeExtension(input.extension)}`,
          price: null,
          fallback: result,
        };
      }
    },
  );

  const resolved = await Promise.race([hydrationWork, deadline]);

  // If timed out, return results as-is (price stays 0 — frontend must handle gracefully)
  if (!resolved) {
    console.warn("[hydrateMissingPrices] Price hydration timed out — returning results without prices");
    return results;
  }

  const priceMap = new Map(resolved.map((item) => [item.domain, item]));

  return results.map((result) => {
    const hydrated = priceMap.get(result.domain);
    if (!hydrated?.price) return result;
    return {
      ...result,
      price: hydrated.price.price,
      currency: hydrated.price.currency,
      isPremium: result.isPremium || hydrated.price.isPremium,
    };
  });
}

// ─── Single batch check ────────────────────────────────────────────────────────
async function checkBatch(batch: CheckDomainInput[]): Promise<DomainSearchResult[]> {
  const payload: DomainCheckRequest = {
    domains: batch.map(({ name, extension }) => ({
      name: normalizeName(name),
      extension: normalizeExtension(extension),
    })),
    with_price: true,
  };

  const idnScript = batch.find((d) => d.idn_script)?.idn_script;
  if (idnScript) payload.additional_data = { idn_script: idnScript };

  const response = await openProviderClient.post<DomainCheckResponseData>("domains/check", payload);
  const rawResults = response.data?.results || [];
  const rawMap = new Map(rawResults.map((item) => [item.domain.toLowerCase(), item]));

  const normalized = batch.map((domain) => {
    const domainKey = `${normalizeName(domain.name)}.${normalizeExtension(domain.extension)}`;
    return normalizeResult(domain, rawMap.get(domainKey));
  });

  return hydrateMissingPrices(batch, normalized);
}

// ─── Domain availability check ────────────────────────────────────────────────
export async function checkDomains(
  domains: CheckDomainInput[],
  onChunk?: (results: DomainSearchResult[]) => void,
): Promise<DomainSearchResult[]> {
  // Use env override or the hard limit for this API
  const batchSize = Math.min(
    getPositiveIntEnv("OPENPROVIDER_BATCH_SIZE", DEFAULT_BATCH_SIZE),
    OPENPROVIDER_MAX_DOMAINS_PER_BATCH,
  );
  const chunks: CheckDomainInput[][] = [];

  for (let i = 0; i < domains.length; i += batchSize) {
    chunks.push(domains.slice(i, i + batchSize));
  }

  const batchResults = await runWithConcurrencyLimit(
    chunks,
    getPositiveIntEnv("OPENPROVIDER_BATCH_CONCURRENCY", DEFAULT_BATCH_CONCURRENCY),
    async (batch, batchIndex) => {
      try {
        const results = await checkBatch(batch);
        if (onChunk) onChunk(results);
        return results;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[checkDomains] Batch ${batchIndex} (${batch.length}) failed: ${errMsg}`);

        // Circuit breaker open or maintenance — don't waste time, return unknown
        if (
          error instanceof OpenProviderRequestError &&
          (error.maintenance || error.status === 503)
        ) {
          const fallback = batch.map((d) => normalizeResult(d, undefined));
          if (onChunk) onChunk(fallback);
          return fallback;
        }

        // Limit-exceeded: split in half and retry recursively (NOT individual)
        if (isLimitExceededError(error) && batch.length > 1) {
          const mid = Math.ceil(batch.length / 2);
          const [left, right] = [batch.slice(0, mid), batch.slice(mid)];
          console.log(`[checkDomains] Splitting batch ${batchIndex} → ${left.length} + ${right.length}`);
          const [leftResults, rightResults] = await Promise.all([
            checkDomains(left, onChunk),
            checkDomains(right, onChunk),
          ]);
          return [...leftResults, ...rightResults];
        }

        // Other transient error — return unknown (already retried inside client)
        const fallback = batch.map((d) => normalizeResult(d, undefined));
        if (onChunk) onChunk(fallback);
        return fallback;
      }
    },
  );

  return batchResults.flat();
}

// ─── High-level search with streaming support ──────────────────────────────────
export async function streamSearchDomains(
  query: string,
  onChunk: (payload: { results: DomainSearchResult[]; isIntermediate: boolean }) => void,
): Promise<DomainSearchResponse> {
  const parsed = parseSearchQuery(query);
  const cacheKey = `${parsed.baseName}::${parsed.requestedExtension || "*"}`;

  // Check cache first
  const cached = getCachedValue(searchCache, cacheKey);
  if (cached) {
    onChunk({ results: cached.results, isIntermediate: false });
    return cloneSearchResponse(cached);
  }

  const searchedTlds = buildSearchTlds(parsed.requestedExtension);
  const exactDomain = parsed.requestedExtension
    ? `${parsed.baseName}.${parsed.requestedExtension}`
    : null;

  const domainsToCheck = searchedTlds.map((extension) => ({ name: parsed.baseName, extension }));

  // Collect all results for final return
  const allResults: DomainSearchResult[] = [];

  // ─── TURBO BATCH (First 3 TLDs) ───
  // Small batch size (3) ensures OpenProvider responds in < 3s
  const turboBatch = domainsToCheck.slice(0, 3);
  const remaining = domainsToCheck.slice(3);

  // Fire turbo batch first
  const turboPromise = (async () => {
    try {
      const results = await checkBatch(turboBatch);
      allResults.push(...results);
      onChunk({ results, isIntermediate: true });
      return results;
    } catch (error) {
      console.warn("[streamSearchDomains] Turbo batch failed, falling back", error);
      return [];
    }
  })();

  // Fire remaining in parallel (optimized batch size/concurrency)
  const remainingPromise = checkDomains(remaining, (chunk) => {
    allResults.push(...chunk);
    onChunk({ results: chunk, isIntermediate: true });
  });

  // Wait for all to finish for the final return
  const [turboResults, restResults] = await Promise.all([turboPromise, remainingPromise]);
  const results = [...turboResults, ...restResults];

  const tldOrder = new Map(searchedTlds.map((tld, index) => [tld, index]));

  results.sort((left, right) => {
    const leftExact = left.domain === exactDomain ? 1 : 0;
    const rightExact = right.domain === exactDomain ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;
    if (left.isAvailable !== right.isAvailable) return left.isAvailable ? -1 : 1;
    if (left.isPremium !== right.isPremium) return left.isPremium ? 1 : -1;
    return (
      (tldOrder.get(left.extension) ?? Number.MAX_SAFE_INTEGER) -
      (tldOrder.get(right.extension) ?? Number.MAX_SAFE_INTEGER)
    );
  });

  const response: DomainSearchResponse = {
    query: parsed.query,
    baseName: parsed.baseName,
    exactDomain,
    searchedTlds,
    results,
  };

  searchCache.set(cacheKey, { value: response, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });

  // Final chunk to signal completion
  onChunk({ results: [], isIntermediate: false });

  return response;
}



// ─── High-level search ────────────────────────────────────────────────────────
export async function searchDomains(query: string): Promise<DomainSearchResponse> {
  const parsed = parseSearchQuery(query);
  const cacheKey = `${parsed.baseName}::${parsed.requestedExtension || "*"}`;

  const cached = getCachedValue(searchCache, cacheKey);
  if (cached) return cloneSearchResponse(cached);

  const inflight = inflightSearches.get(cacheKey);
  if (inflight) return cloneSearchResponse(await inflight);

  const request = (async () => {
    const searchedTlds = buildSearchTlds(parsed.requestedExtension);
    const exactDomain = parsed.requestedExtension
      ? `${parsed.baseName}.${parsed.requestedExtension}`
      : null;

    const domainsToCheck = searchedTlds.map((extension) => ({ name: parsed.baseName, extension }));

    const results = await checkDomains(domainsToCheck);
    const tldOrder = new Map(searchedTlds.map((tld, index) => [tld, index]));

    results.sort((left, right) => {
      const leftExact = left.domain === exactDomain ? 1 : 0;
      const rightExact = right.domain === exactDomain ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      if (left.isAvailable !== right.isAvailable) return left.isAvailable ? -1 : 1;
      if (left.isPremium !== right.isPremium) return left.isPremium ? 1 : -1;
      return (
        (tldOrder.get(left.extension) ?? Number.MAX_SAFE_INTEGER) -
        (tldOrder.get(right.extension) ?? Number.MAX_SAFE_INTEGER)
      );
    });

    const response: DomainSearchResponse = {
      query: parsed.query,
      baseName: parsed.baseName,
      exactDomain,
      searchedTlds,
      results,
    };

    searchCache.set(cacheKey, { value: response, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
    return response;
  })();

  inflightSearches.set(cacheKey, request);

  try {
    return cloneSearchResponse(await request);
  } finally {
    inflightSearches.delete(cacheKey);
  }
}
