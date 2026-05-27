import { nameSiloClient } from "./client";
import type { DomainSearchResponse, DomainSearchResult } from "@/lib/domains/searchTypes";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type NameSiloAvailableItem = {
  domain: string;
  price?: number | string;
  renew?: number | string;
  premium?: number | string;
  duration?: number | string;
};

// ─── TLD list ─────────────────────────────────────────────────────────────────
const DEFAULT_TLDS = [
  "com.br", "com", "net.br", "org.br", "net", "org", "io", "ai", "me", "dev",
  "app", "co", "tv", "shop", "store", "online", "tech", "site", "website", "cloud",
  "digital", "solutions", "services", "systems",
  "agency", "group", "pro", "biz", "info", "vip", "top", "xyz", "link", "click",
  "today", "life", "world", "expert", "guide", "help", "work", "zone",
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
  "com.mx", "mx", "es", "cl", "ar", "pt", "re",
];

const SEARCH_CACHE_TTL_MS = 1000 * 120;
const DEFAULT_MAX_TLDS = 24;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_BATCH_CONCURRENCY = 6;

const searchCache = new Map<string, CacheEntry<DomainSearchResponse>>();
const inflightSearches = new Map<string, Promise<DomainSearchResponse>>();

function getPositiveIntEnv(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function normalizeExtension(value: string) {
  return value.trim().toLowerCase().replace(/^\./, "");
}

function splitDomainParts(domain: string) {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return { name: domain.toLowerCase(), extension: "" };
  return { name: parts[0], extension: parts.slice(1).join(".") };
}

function getConfiguredTlds() {
  const configured =
    process.env.DOMAIN_SEARCH_TLDS?.split(",").map(normalizeExtension).filter(Boolean) ||
    process.env.NAMESILO_TLDS?.split(",").map(normalizeExtension).filter(Boolean);

  const maxTlds = getPositiveIntEnv("DOMAIN_MAX_TLDS", getPositiveIntEnv("NAMESILO_MAX_TLDS", DEFAULT_MAX_TLDS));

  if (!configured || configured.length === 0) {
    return Array.from(new Set(DEFAULT_TLDS.map(normalizeExtension))).slice(0, maxTlds);
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
  return Array.from(new Set(tlds.map(normalizeExtension).filter(Boolean)));
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

function cloneSearchResponse(response: DomainSearchResponse): DomainSearchResponse {
  return {
    ...response,
    searchedTlds: [...response.searchedTlds],
    results: response.results.map((item) => ({ ...item })),
  };
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return [value as T];
  return [];
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "yes" || normalized === "true";
}

async function runWithConcurrencyLimit<TInput, TOutput>(
  items: TInput[],
  limit: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results: TOutput[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async (_item, runnerIndex) => {
    if (runnerIndex > 0) {
      await new Promise((resolve) => setTimeout(resolve, runnerIndex * 150));
    }

    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

function normalizeUnavailableReason(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "reason" in value) {
    return String((value as { reason?: unknown }).reason || "");
  }
  return "";
}

function normalizeCheckResults(inputDomains: string[], reply: Record<string, unknown>): DomainSearchResult[] {
  const availableItems = asArray<NameSiloAvailableItem>((reply as { available?: unknown }).available)
    .map((item) => ({
      domain: String(item.domain || "").toLowerCase(),
      price: toNumber(item.price, 0),
      renew: toNumber(item.renew, toNumber(item.price, 0)),
      premium: toBool(item.premium),
    }))
    .filter((item) => Boolean(item.domain));

  const unavailableRaw = asArray<string | { domain?: unknown; reason?: unknown }>(
    (reply as { unavailable?: unknown }).unavailable,
  );

  const unavailableMap = new Map<string, string>();
  for (const entry of unavailableRaw) {
    if (typeof entry === "string") {
      unavailableMap.set(entry.toLowerCase(), "");
      continue;
    }

    if (entry && typeof entry === "object") {
      const domain = String(entry.domain || "").toLowerCase();
      if (domain) unavailableMap.set(domain, normalizeUnavailableReason(entry.reason));
    }
  }

  const invalidRaw = asArray<string>((reply as { invalid?: unknown }).invalid);
  const invalidSet = new Set(invalidRaw.map((value) => String(value || "").toLowerCase()));

  const availableMap = new Map(availableItems.map((item) => [item.domain, item]));

  return inputDomains.map((domain) => {
    const normalizedDomain = domain.toLowerCase();
    const parsed = splitDomainParts(normalizedDomain);
    const available = availableMap.get(normalizedDomain);
    const isInvalid = invalidSet.has(normalizedDomain);
    const unavailableReason = unavailableMap.get(normalizedDomain) || "";

    if (available) {
      return {
        domain: normalizedDomain,
        extension: parsed.extension,
        status: "free",
        isAvailable: true,
        price: available.price,
        currency: "USD",
        isPremium: available.premium,
        reason: "",
        whois: "",
      } satisfies DomainSearchResult;
    }

    if (isInvalid) {
      return {
        domain: normalizedDomain,
        extension: parsed.extension,
        status: "invalid",
        isAvailable: false,
        price: 0,
        currency: "USD",
        isPremium: false,
        reason: "Dominio invalido para este TLD.",
        whois: "",
      } satisfies DomainSearchResult;
    }

    return {
      domain: normalizedDomain,
      extension: parsed.extension,
      status: "registered",
      isAvailable: false,
      price: 0,
      currency: "USD",
      isPremium: false,
      reason: unavailableReason,
      whois: "",
    } satisfies DomainSearchResult;
  });
}

async function checkBatch(domains: string[]): Promise<DomainSearchResult[]> {
  const { reply } = await nameSiloClient.request("checkRegisterAvailability", {
    domains: domains.join(","),
  });

  return normalizeCheckResults(domains, reply);
}

async function checkDomains(
  domains: string[],
  onChunk?: (results: DomainSearchResult[]) => void,
): Promise<DomainSearchResult[]> {
  const batchSize = getPositiveIntEnv("NAMESILO_BATCH_SIZE", DEFAULT_BATCH_SIZE);
  const concurrency = getPositiveIntEnv("NAMESILO_BATCH_CONCURRENCY", DEFAULT_BATCH_CONCURRENCY);

  const chunks: string[][] = [];
  for (let i = 0; i < domains.length; i += batchSize) {
    chunks.push(domains.slice(i, i + batchSize));
  }

  const batchResults = await runWithConcurrencyLimit(chunks, concurrency, async (chunk) => {
    try {
      const results = await checkBatch(chunk);
      if (onChunk) onChunk(results);
      return results;
    } catch {
      const fallback = chunk.map((domain) => {
        const parsed = splitDomainParts(domain);
        return {
          domain,
          extension: parsed.extension,
          status: "unknown",
          isAvailable: false,
          price: 0,
          currency: "USD",
          isPremium: false,
          reason: "Falha temporaria ao consultar disponibilidade.",
          whois: "",
        } satisfies DomainSearchResult;
      });

      if (onChunk) onChunk(fallback);
      return fallback;
    }
  });

  return batchResults.flat();
}

export async function streamSearchDomains(
  query: string,
  onChunk: (payload: { results: DomainSearchResult[]; isIntermediate: boolean }) => void,
): Promise<DomainSearchResponse> {
  const parsed = parseSearchQuery(query);
  const cacheKey = `${parsed.baseName}::${parsed.requestedExtension || "*"}`;

  const cached = getCachedValue(searchCache, cacheKey);
  if (cached) {
    onChunk({ results: cached.results, isIntermediate: false });
    return cloneSearchResponse(cached);
  }

  const searchedTlds = buildSearchTlds(parsed.requestedExtension);
  const exactDomain = parsed.requestedExtension
    ? `${parsed.baseName}.${parsed.requestedExtension}`
    : null;

  const domainsToCheck = searchedTlds.map((extension) => `${parsed.baseName}.${extension}`);
  const turboBatch = domainsToCheck.slice(0, 4);
  const remaining = domainsToCheck.slice(4);

  const turboPromise = (async () => {
    try {
      const results = await checkBatch(turboBatch);
      onChunk({ results, isIntermediate: true });
      return results;
    } catch {
      return [] as DomainSearchResult[];
    }
  })();

  const remainingPromise = checkDomains(remaining, (chunk) => {
    onChunk({ results: chunk, isIntermediate: true });
  });

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

  searchCache.set(cacheKey, {
    value: response,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });

  onChunk({ results: [], isIntermediate: false });
  return response;
}

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
    const domainsToCheck = searchedTlds.map((extension) => `${parsed.baseName}.${extension}`);
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

    searchCache.set(cacheKey, {
      value: response,
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    });

    return response;
  })();

  inflightSearches.set(cacheKey, request);
  try {
    return cloneSearchResponse(await request);
  } finally {
    inflightSearches.delete(cacheKey);
  }
}
