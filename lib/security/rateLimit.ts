import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getServerEnv } from "@/lib/serverEnv";
import { applyStandardSecurityHeaders } from "@/lib/security/http";
import {
  buildFlowSecureDiagnosticFingerprint,
  encryptFlowSecureValue,
} from "@/lib/security/flowSecure";

type RateLimitTrafficScope =
  | "page"
  | "api_read"
  | "api_mutation"
  | "auth"
  | "other";

type RateLimitSignatureKind =
  | "page"
  | "query"
  | "json"
  | "urlencoded"
  | "opaque";

type RateLimitResponseMode = "html" | "json";

type RateLimitBlockScope = "ip" | "scope" | "route" | "signature";

type RateLimitThresholds = {
  windowSeconds: number;
  penaltySeconds: number;
  duplicateThreshold: number;
  routeThreshold: number;
  scopeThreshold: number;
  siteThreshold: number;
  maxBodyBytes: number;
};

type RateLimitCounts = {
  duplicateHits: number;
  routeHits: number;
  scopeHits: number;
  siteHits: number;
};

type RateLimitInspection = {
  responseMode: RateLimitResponseMode;
  trafficScope: RateLimitTrafficScope;
  requestMethod: string;
  requestPath: string;
  hostKey: string;
  routeKey: string;
  signatureHash: string;
  signatureKind: RateLimitSignatureKind;
  ipAddress: string;
  ipFingerprint: string;
  ipEncrypted: string;
  userAgent: string | null;
  metadata: Record<string, unknown>;
};

type PersistedRateLimitResult = {
  blocked: boolean;
  retryAfterSeconds: number;
  reason: string;
  blockedUntilIso: string | null;
  counts: RateLimitCounts;
};

export type FlowSecureBlockedRateLimit = PersistedRateLimitResult & {
  responseMode: RateLimitResponseMode;
  trafficScope: RateLimitTrafficScope;
  ipAddress: string;
};

type LocalHit = {
  atMs: number;
  routeKey: string;
  signatureHash: string;
  trafficScope: RateLimitTrafficScope;
};

type LocalBlock = {
  blockedUntilMs: number;
  reason: string;
  blockScope: RateLimitBlockScope;
  blockKey: string;
  counts: RateLimitCounts;
};

type RpcRateLimitPayload = {
  allowed?: boolean | null;
  blocked?: boolean | null;
  retry_after_seconds?: number | null;
  block_reason?: string | null;
  duplicate_hits?: number | null;
  route_hits?: number | null;
  scope_hits?: number | null;
  site_hits?: number | null;
  blocked_until?: string | null;
};

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const STATIC_PUBLIC_ASSET_PREFIXES = ["/cdn/", "/icons/"] as const;
const STATIC_PUBLIC_ROOT_FILE_PATTERN =
  /^\/[^/]+\.(?:png|jpe?g|gif|webp|svg|ico|txt|xml|json|webmanifest|woff2?|ttf|otf)$/i;
const RATE_LIMIT_ACTIVE_BLOCK_REASON = "active_block";
const LOCAL_HISTORY_RETENTION_MS = 6 * 60 * 1000;
const LOCAL_MAX_HITS_PER_IP = 240;
const LOCAL_MAX_IP_BUCKETS = 2_500;

const localHitsByIp = new Map<string, LocalHit[]>();
const localBlocksByIp = new Map<string, LocalBlock[]>();

function isExplicitlyEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveIntegerEnv(name: string, fallback: number) {
  const rawValue = getServerEnv(name) ?? process.env[name];
  if (!rawValue?.trim()) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function resolveRouteThreshold(
  scope: RateLimitTrafficScope,
  duplicateThreshold: number,
) {
  if (scope === "page") {
    return duplicateThreshold;
  }

  if (scope === "api_mutation") {
    return Math.max(24, duplicateThreshold * 2);
  }

  if (scope === "api_read") {
    return Math.max(60, duplicateThreshold * 4);
  }

  if (scope === "auth") {
    return Math.max(12, duplicateThreshold + 2);
  }

  return Math.max(40, duplicateThreshold * 3);
}

function shouldApplyScopeBurst(scope: RateLimitTrafficScope) {
  return scope === "auth" || scope === "other";
}

function isStaticPublicAssetPath(pathname: string) {
  if (pathname === "/ads.txt") {
    return true;
  }

  if (
    STATIC_PUBLIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return true;
  }

  return STATIC_PUBLIC_ROOT_FILE_PATTERN.test(pathname);
}

function shouldBypassRateLimit(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const purpose = request.headers.get("purpose")?.trim().toLowerCase();
  const secPurpose = request.headers.get("sec-purpose")?.trim().toLowerCase();

  if (request.method.toUpperCase() === "OPTIONS") {
    return true;
  }

  if (isStaticPublicAssetPath(pathname)) {
    return true;
  }

  if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/internal/") ||
    pathname.startsWith("/api/cron/") ||
    pathname === "/api/health" ||
    pathname === "/api/health/" ||
    pathname === "/api/payments/mercadopago/webhook" ||
    pathname === "/api/payments/mercadopago/webhook/"
  ) {
    return true;
  }

  if (
    request.headers.has("next-router-prefetch") ||
    request.headers.has("rsc") ||
    request.headers.has("x-nextjs-data") ||
    purpose === "prefetch" ||
    secPurpose === "prefetch"
  ) {
    return true;
  }

  return false;
}

function resolveThresholds(scope: RateLimitTrafficScope): RateLimitThresholds {
  const duplicateThreshold = resolveIntegerEnv(
    "FLOWSECURE_RATE_LIMIT_DUPLICATE_MAX",
    8,
  );

  return {
    windowSeconds: resolveIntegerEnv(
      "FLOWSECURE_RATE_LIMIT_WINDOW_SECONDS",
      60,
    ),
    penaltySeconds: resolveIntegerEnv(
      "FLOWSECURE_RATE_LIMIT_PENALTY_SECONDS",
      60,
    ),
    duplicateThreshold,
    routeThreshold: resolveRouteThreshold(scope, duplicateThreshold),
    scopeThreshold:
      scope === "page"
        ? resolveIntegerEnv("FLOWSECURE_RATE_LIMIT_PAGE_SCOPE_MAX", 40)
        : scope === "api_read"
          ? resolveIntegerEnv("FLOWSECURE_RATE_LIMIT_API_READ_SCOPE_MAX", 90)
          : scope === "api_mutation"
            ? resolveIntegerEnv(
                "FLOWSECURE_RATE_LIMIT_API_MUTATION_SCOPE_MAX",
                40,
              )
            : scope === "auth"
              ? resolveIntegerEnv("FLOWSECURE_RATE_LIMIT_AUTH_SCOPE_MAX", 20)
              : resolveIntegerEnv("FLOWSECURE_RATE_LIMIT_OTHER_SCOPE_MAX", 60),
    siteThreshold: resolveIntegerEnv("FLOWSECURE_RATE_LIMIT_SITE_MAX", 160),
    maxBodyBytes: resolveIntegerEnv(
      "FLOWSECURE_RATE_LIMIT_BODY_MAX_BYTES",
      24_576,
    ),
  };
}

function resolveBlockTarget(
  inspection: RateLimitInspection,
  reason: string,
): {
  blockScope: RateLimitBlockScope;
  blockKey: string;
} {
  if (reason === "duplicate_signature") {
    return {
      blockScope: "signature",
      blockKey: inspection.signatureHash,
    };
  }

  if (reason === "page_reload_burst" || reason === "route_burst") {
    return {
      blockScope: "route",
      blockKey: inspection.routeKey,
    };
  }

  if (reason === "scope_burst") {
    return {
      blockScope: "scope",
      blockKey: inspection.trafficScope,
    };
  }

  return {
    blockScope: "ip",
    blockKey: "__ip__",
  };
}

function doesBlockMatchInspection(
  inspection: RateLimitInspection,
  block: {
    blockScope: RateLimitBlockScope;
    blockKey: string;
  },
) {
  if (block.blockScope === "ip") {
    return true;
  }

  if (block.blockScope === "scope") {
    return block.blockKey === inspection.trafficScope;
  }

  if (block.blockScope === "route") {
    return block.blockKey === inspection.routeKey;
  }

  return block.blockKey === inspection.signatureHash;
}

function extractClientIp(request: Request) {
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

  return null;
}

function normalizeRateLimitHost(request: NextRequest) {
  const rawHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.trim() ||
    request.nextUrl.host;
  const normalized = rawHost.toLowerCase();

  if (normalized.startsWith("[")) {
    const endIndex = normalized.indexOf("]");
    return endIndex >= 0 ? normalized.slice(0, endIndex + 1) : normalized;
  }

  const colonCount = normalized.split(":").length - 1;
  if (colonCount === 1) {
    return normalized.split(":")[0] || normalized;
  }

  return normalized || "unknown-host";
}

function fingerprintClientIp(ipAddress: string) {
  const fingerprint = buildFlowSecureDiagnosticFingerprint(ipAddress, {
    prefix: "fsrlip",
    subcontext: "rate_limit_ip",
    maxPayloadLength: 512,
  });

  return fingerprint || null;
}

function encryptClientIp(ipAddress: string) {
  return encryptFlowSecureValue(ipAddress, {
    purpose: "rate_limit_ip",
    aad: "flowsecure-rate-limit",
    subcontext: "client_ip",
  });
}

function sortEntries(entries: Array<[string, string]>) {
  return [...entries].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyCompare = leftKey.localeCompare(rightKey, "en-US");
    if (keyCompare !== 0) {
      return keyCompare;
    }

    return leftValue.localeCompare(rightValue, "en-US");
  });
}

function buildQueryPayload(request: NextRequest) {
  return sortEntries(Array.from(request.nextUrl.searchParams.entries()));
}

function pickJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => pickJsonKeys(item));
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort((left, right) => left.localeCompare(right, "en-US"))
    .reduce<Record<string, unknown>>((accumulator, key) => {
      accumulator[key] = pickJsonKeys(record[key]);
      return accumulator;
    }, {});
}

async function buildBodyPayload(
  request: NextRequest,
  maxBodyBytes: number,
): Promise<{
  signatureKind: RateLimitSignatureKind;
  signaturePayload: unknown;
  metadata: Record<string, unknown>;
}> {
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) {
    return {
      signatureKind: "query",
      signaturePayload: null,
      metadata: {},
    };
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;

  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    return {
      signatureKind: "opaque",
      signaturePayload: {
        contentType,
        contentLength,
        oversized: true,
      },
      metadata: {
        bodyKind: "oversized",
        contentLength,
      },
    };
  }

  let rawText = "";

  try {
    rawText = await request.clone().text();
  } catch {
    return {
      signatureKind: "opaque",
      signaturePayload: {
        contentType,
        unreadable: true,
      },
      metadata: {
        bodyKind: "unreadable",
      },
    };
  }

  if (!rawText) {
    return {
      signatureKind: "opaque",
      signaturePayload: null,
      metadata: {
        bodyKind: "empty",
      },
    };
  }

  const clippedText = rawText.slice(0, maxBodyBytes);

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(clippedText) as unknown;
      return {
        signatureKind: "json",
        signaturePayload: parsed,
        metadata: {
          bodyKind: "json",
          bodyKeys: pickJsonKeys(parsed),
        },
      };
    } catch {
      return {
        signatureKind: "opaque",
        signaturePayload: {
          contentType,
          rawHash: crypto
            .createHash("sha256")
            .update(clippedText, "utf8")
            .digest("base64url"),
        },
        metadata: {
          bodyKind: "json_invalid",
        },
      };
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const entries = sortEntries(Array.from(new URLSearchParams(clippedText).entries()));
    return {
      signatureKind: "urlencoded",
      signaturePayload: entries,
      metadata: {
        bodyKind: "urlencoded",
        bodyKeys: entries.map(([key]) => key),
      },
    };
  }

  return {
    signatureKind: "opaque",
    signaturePayload: {
      contentType,
      rawHash: crypto
        .createHash("sha256")
        .update(clippedText, "utf8")
        .digest("base64url"),
    },
    metadata: {
      bodyKind: "opaque",
    },
  };
}

async function inspectRequest(
  request: NextRequest,
): Promise<RateLimitInspection | null> {
  if (shouldBypassRateLimit(request)) {
    return null;
  }

  const pathname = request.nextUrl.pathname;
  const method = request.method.toUpperCase();
  const secFetchDest = request.headers.get("sec-fetch-dest")?.toLowerCase() || "";
  const secFetchMode = request.headers.get("sec-fetch-mode")?.toLowerCase() || "";
  const isApi = pathname.startsWith("/api/");
  const isDocumentNavigation =
    !isApi &&
    (method === "GET" ||
      method === "HEAD" ||
      secFetchDest === "document" ||
      secFetchMode === "navigate");

  const responseMode: RateLimitResponseMode = isApi ? "json" : "html";
  const trafficScope: RateLimitTrafficScope =
    pathname.startsWith("/api/auth/")
      ? "auth"
      : isApi && MUTATION_METHODS.has(method)
        ? "api_mutation"
        : isApi
          ? "api_read"
          : isDocumentNavigation
            ? "page"
            : "other";

  if (trafficScope === "other" && !isApi) {
    return null;
  }

  const ipAddress = extractClientIp(request);
  if (!ipAddress) {
    return null;
  }

  const ipFingerprint = fingerprintClientIp(ipAddress);
  const ipEncrypted = encryptClientIp(ipAddress);
  if (!ipFingerprint || !ipEncrypted) {
    return null;
  }

  const thresholds = resolveThresholds(trafficScope);
  const queryPayload = buildQueryPayload(request);
  const bodyPayload = await buildBodyPayload(request, thresholds.maxBodyBytes);
  const hostKey = normalizeRateLimitHost(request);
  const routeKey = `${method}:${hostKey}:${pathname}`;
  const signatureSource = {
    method,
    host: hostKey,
    pathname,
    query: queryPayload,
    body: bodyPayload.signaturePayload,
    trafficScope,
  };

  const signatureHash =
    buildFlowSecureDiagnosticFingerprint(signatureSource, {
      prefix: "fsrlreq",
      subcontext: `rate_limit:${trafficScope}`,
      maxPayloadLength: 8_192,
    }) ||
    `fsrlreq_${crypto
      .createHash("sha256")
      .update(JSON.stringify(signatureSource), "utf8")
      .digest("base64url")
      .slice(0, 22)}`;

  return {
    responseMode,
    trafficScope,
    requestMethod: method,
    requestPath: pathname,
    hostKey,
    routeKey,
    signatureHash,
    signatureKind:
      trafficScope === "page" ? "page" : bodyPayload.signatureKind,
    ipAddress,
    ipFingerprint,
    ipEncrypted,
    userAgent: request.headers.get("user-agent")?.trim() || null,
    metadata: {
      host: request.headers.get("host")?.trim() || null,
      hostKey,
      pathname,
      queryKeys: queryPayload.map(([key]) => key),
      ...bodyPayload.metadata,
    },
  };
}

function cleanupLocalState(nowMs: number) {
  for (const [ipFingerprint, blocks] of localBlocksByIp.entries()) {
    const retainedBlocks = blocks.filter((block) => block.blockedUntilMs > nowMs);
    if (retainedBlocks.length === 0) {
      localBlocksByIp.delete(ipFingerprint);
      continue;
    }

    localBlocksByIp.set(ipFingerprint, retainedBlocks);
  }

  for (const [ipFingerprint, hits] of localHitsByIp.entries()) {
    const retained = hits.filter((hit) => nowMs - hit.atMs <= LOCAL_HISTORY_RETENTION_MS);
    if (retained.length === 0) {
      localHitsByIp.delete(ipFingerprint);
      continue;
    }

    localHitsByIp.set(
      ipFingerprint,
      retained.slice(Math.max(0, retained.length - LOCAL_MAX_HITS_PER_IP)),
    );
  }

  if (localHitsByIp.size <= LOCAL_MAX_IP_BUCKETS) {
    return;
  }

  const overflow = localHitsByIp.size - LOCAL_MAX_IP_BUCKETS;
  const keys = Array.from(localHitsByIp.keys()).slice(0, overflow);
  for (const key of keys) {
    localHitsByIp.delete(key);
    localBlocksByIp.delete(key);
  }
}

function applyLocalFallbackRateLimit(
  inspection: RateLimitInspection,
  thresholds: RateLimitThresholds,
): PersistedRateLimitResult | null {
  const nowMs = Date.now();
  cleanupLocalState(nowMs);

  const activeBlock = (localBlocksByIp.get(inspection.ipFingerprint) || []).find(
    (block) =>
      block.blockedUntilMs > nowMs && doesBlockMatchInspection(inspection, block),
  );
  if (activeBlock) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((activeBlock.blockedUntilMs - nowMs) / 1000),
      ),
      reason: activeBlock.reason,
      blockedUntilIso: new Date(activeBlock.blockedUntilMs).toISOString(),
      counts: activeBlock.counts,
    };
  }

  const windowStartMs = nowMs - thresholds.windowSeconds * 1000;
  const hits = localHitsByIp.get(inspection.ipFingerprint) || [];
  const nextHits = hits
    .filter((hit) => hit.atMs >= windowStartMs)
    .concat({
      atMs: nowMs,
      routeKey: inspection.routeKey,
      signatureHash: inspection.signatureHash,
      trafficScope: inspection.trafficScope,
    });

  const counts: RateLimitCounts = {
    duplicateHits: nextHits.filter(
      (hit) => hit.signatureHash === inspection.signatureHash,
    ).length,
    routeHits: nextHits.filter((hit) => hit.routeKey === inspection.routeKey).length,
    scopeHits: nextHits.filter(
      (hit) => hit.trafficScope === inspection.trafficScope,
    ).length,
    siteHits: nextHits.length,
  };

  let reason: string | null = null;
  if (
    inspection.trafficScope === "page" &&
    counts.routeHits >= thresholds.duplicateThreshold
  ) {
    reason = "page_reload_burst";
  } else if (counts.duplicateHits >= thresholds.duplicateThreshold) {
    reason = "duplicate_signature";
  } else if (counts.routeHits >= thresholds.routeThreshold) {
    reason = "route_burst";
  } else if (
    shouldApplyScopeBurst(inspection.trafficScope) &&
    counts.scopeHits >= thresholds.scopeThreshold
  ) {
    reason = "scope_burst";
  } else if (counts.siteHits >= thresholds.siteThreshold) {
    reason = "site_burst";
  }

  localHitsByIp.set(
    inspection.ipFingerprint,
    nextHits.slice(Math.max(0, nextHits.length - LOCAL_MAX_HITS_PER_IP)),
  );

  if (!reason) {
    return null;
  }

  const blockTarget = resolveBlockTarget(inspection, reason);
  const blockedUntilMs = nowMs + thresholds.penaltySeconds * 1000;
  const nextBlocks = (localBlocksByIp.get(inspection.ipFingerprint) || [])
    .filter(
      (block) =>
        !(
          block.blockScope === blockTarget.blockScope &&
          block.blockKey === blockTarget.blockKey
        ),
    )
    .concat({
      blockedUntilMs,
      reason,
      blockScope: blockTarget.blockScope,
      blockKey: blockTarget.blockKey,
      counts,
    });
  localBlocksByIp.set(inspection.ipFingerprint, nextBlocks);

  return {
    blocked: true,
    retryAfterSeconds: thresholds.penaltySeconds,
    reason,
    blockedUntilIso: new Date(blockedUntilMs).toISOString(),
    counts,
  };
}

async function applyPersistedRateLimit(
  inspection: RateLimitInspection,
  thresholds: RateLimitThresholds,
  requestId?: string | null,
): Promise<PersistedRateLimitResult | null> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    throw new Error("SUPABASE_UNAVAILABLE");
  }

  const { data, error } = await supabase.rpc("apply_flowsecure_rate_limit", {
    p_request_id: requestId?.trim() || crypto.randomUUID(),
    p_ip_fingerprint: inspection.ipFingerprint,
    p_ip_encrypted: inspection.ipEncrypted,
    p_request_method: inspection.requestMethod,
    p_request_path: inspection.requestPath,
    p_route_key: inspection.routeKey,
    p_traffic_scope: inspection.trafficScope,
    p_signature_hash: inspection.signatureHash,
    p_signature_kind: inspection.signatureKind,
    p_user_agent: inspection.userAgent,
    p_window_seconds: thresholds.windowSeconds,
    p_penalty_seconds: thresholds.penaltySeconds,
    p_duplicate_threshold: thresholds.duplicateThreshold,
    p_scope_threshold: thresholds.scopeThreshold,
    p_site_threshold: thresholds.siteThreshold,
    p_metadata: inspection.metadata,
  });

  if (error) {
    throw new Error(error.message);
  }

  const payload = Array.isArray(data)
    ? (data[0] as RpcRateLimitPayload | undefined)
    : (data as RpcRateLimitPayload | null | undefined);

  if (!payload?.blocked) {
    return null;
  }

  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.trunc(payload.retry_after_seconds || 60)),
    reason: payload.block_reason?.trim() || RATE_LIMIT_ACTIVE_BLOCK_REASON,
    blockedUntilIso: payload.blocked_until || null,
    counts: {
      duplicateHits: Math.max(0, Math.trunc(payload.duplicate_hits || 0)),
      routeHits: Math.max(0, Math.trunc(payload.route_hits || 0)),
      scopeHits: Math.max(0, Math.trunc(payload.scope_hits || 0)),
      siteHits: Math.max(0, Math.trunc(payload.site_hits || 0)),
    },
  };
}

function shouldWarnAboutFallback(error: unknown) {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("supabase") ||
    message.includes("apply_flowsecure_rate_limit") ||
    message.includes("does not exist") ||
    message.includes("could not find the function") ||
    message.includes("unavailable") ||
    message.includes("timeout") ||
    message.includes("network")
  );
}

export async function evaluateFlowSecureRateLimit(
  request: NextRequest,
  input?: {
    requestId?: string | null;
  },
): Promise<FlowSecureBlockedRateLimit | null> {
  const inspection = await inspectRequest(request);
  if (!inspection) {
    return null;
  }

  const thresholds = resolveThresholds(inspection.trafficScope);

  try {
    const persisted = await applyPersistedRateLimit(
      inspection,
      thresholds,
      input?.requestId,
    );
    if (!persisted?.blocked) {
      return null;
    }

    return {
      ...persisted,
      responseMode: inspection.responseMode,
      trafficScope: inspection.trafficScope,
      ipAddress: inspection.ipAddress,
    };
  } catch (error) {
    if (shouldWarnAboutFallback(error) && isExplicitlyEnabled(getServerEnv("FLOWSECURE_RATE_LIMIT_DEBUG"))) {
      console.warn("[FlowSecureRateLimit] usando fallback local:", error);
    }

    const localDecision = applyLocalFallbackRateLimit(inspection, thresholds);
    if (!localDecision?.blocked) {
      return null;
    }

    return {
      ...localDecision,
      responseMode: inspection.responseMode,
      trafficScope: inspection.trafficScope,
      ipAddress: inspection.ipAddress,
    };
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUtcDateTime(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}

function formatRayId(requestId: string) {
  const compact = requestId.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (compact.length >= 16) {
    return compact.slice(0, 16);
  }

  return `${compact}${crypto.randomBytes(8).toString("hex")}`.slice(0, 16);
}

function maskIpAddress(ipAddress: string) {
  if (ipAddress.includes(".")) {
    const parts = ipAddress.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
    }
  }

  if (ipAddress.includes(":")) {
    const parts = ipAddress.split(":").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts.slice(0, 2).join(":")}:****`;
    }
  }

  return "Hidden";
}

function resolveBlockedHeadline(reason: string) {
  if (reason === "page_reload_burst" || reason === "route_burst") {
    return "Acesso temporariamente limitado nesta pagina";
  }

  if (reason === "scope_burst" || reason === "site_burst") {
    return "Muitas requisicoes foram detectadas";
  }

  return "You are being rate limited";
}

function buildRateLimitHtml(
  decision: FlowSecureBlockedRateLimit,
  requestId: string,
) {
  const rayId = formatRayId(requestId);
  const blockedAt = formatUtcDateTime(decision.blockedUntilIso);
  const headline = resolveBlockedHeadline(decision.reason);
  const retryAfterSeconds = Math.max(1, Math.trunc(decision.retryAfterSeconds || 60));
  const maskedIp = maskIpAddress(decision.ipAddress);
  const revealedIp = JSON.stringify(decision.ipAddress);

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Error 1015 | FlowSecure</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f8fc;
        --panel: rgba(255, 255, 255, 0.88);
        --line: rgba(14, 29, 58, 0.11);
        --text: #172033;
        --muted: #6c7385;
        --accent: #0062ff;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(0, 98, 255, 0.1), transparent 28%),
          linear-gradient(180deg, #fbfcfe 0%, var(--bg) 100%);
        color: var(--text);
        font-family: Arial, Helvetica, sans-serif;
      }

      .shell {
        width: min(100%, 1160px);
        margin: 0 auto;
        padding: 52px 24px 64px;
      }

      .panel2 {
        padding: 38px 36px 28px;
      }

      .header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 16px;
      }

      .header h1 {
        margin: 0;
        font-size: clamp(54px, 7vw, 82px);
        line-height: 0.94;
        font-weight: 300;
        letter-spacing: -0.06em;
      }

      .meta {
        color: var(--muted);
        font-size: 23px;
        letter-spacing: -0.035em;
      }

      .submeta {
        margin-top: 10px;
        color: #4f5b74;
        font-size: 18px;
      }

      .content {
        margin-top: 64px;
        max-width: 680px;
      }

      .content h2 {
        margin: 0;
        font-size: clamp(34px, 5vw, 48px);
        line-height: 0.98;
        font-weight: 500;
        letter-spacing: -0.05em;
      }

      .content p {
        margin: 22px 0 0;
        color: #4f5b74;
        font-size: 21px;
        line-height: 1.6;
      }

      .content strong {
        color: #1b2230;
      }

      .feedback {
        margin-top: 76px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 14px;
        color: var(--muted);
        font-size: 19px;
      }

      .feedback button,
      .reveal {
        border: 1px solid rgba(0, 98, 255, 0.26);
        background: rgba(255, 255, 255, 0.92);
        color: var(--accent);
        border-radius: 12px;
        cursor: pointer;
        transition:
          transform 140ms ease,
          box-shadow 140ms ease,
          background 140ms ease;
      }

      .feedback button {
        min-width: 62px;
        height: 42px;
        padding: 0 18px;
        font-size: 16px;
      }

      .feedback button:hover,
      .reveal:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 24px rgba(0, 98, 255, 0.12);
      }

      .divider {
        margin: 62px 0 22px;
        border-top: 1px solid var(--line);
      }

      .footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 8px;
        text-align: center;
        color: #5a6479;
        font-size: 17px;
      }

      .footer strong {
        color: #1b2230;
      }

      .reveal {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 34px;
        padding: 0 12px;
        font-size: 15px;
      }

      .reveal[disabled] {
        cursor: default;
        transform: none;
        box-shadow: none;
        color: #1b2230;
      }

      .feedback-note {
        min-height: 22px;
        margin-top: 14px;
        text-align: center;
        color: var(--muted);
        font-size: 15px;
      }

      @media (max-width: 720px) {
        .shell {
          padding: 20px 14px 32px;
        }

        .panel2 {
          padding: 24px 18px 22px;
          border-radius: 20px;
        }

        .content {
          margin-top: 42px;
        }

        .content p {
          font-size: 18px;
        }

        .feedback {
          margin-top: 52px;
        }

        .footer {
          font-size: 15px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="panel2">
        <div class="header">
          <h1>Error 1015</h1>
          <div class="meta">FlowSecure Ray ID: ${escapeHtml(rayId)} &bull; ${escapeHtml(blockedAt)}</div>
        </div>

        <div class="submeta">You are being rate limited</div>

        <div class="content">
          <h2>${escapeHtml(headline)}</h2>
          <p>O FlowSecure bloqueou temporariamente este IP porque muitas requisicoes foram feitas em pouco tempo para este endereco.</p>
          <p>Aguarde cerca de <strong>${escapeHtml(String(retryAfterSeconds))} segundos</strong> antes de tentar novamente. Se voce estava apenas atualizando a pagina varias vezes, espere o bloqueio expirar.</p>
        </div>

        <div class="feedback">
          <span>Esta informacao foi util?</span>
          <button type="button" data-feedback="yes">Sim</button>
          <button type="button" data-feedback="no">Nao</button>
        </div>
        <div class="feedback-note" id="feedback-note"></div>

        <div class="divider"></div>

        <div class="footer">
          <span>FlowSecure Ray ID: <strong>${escapeHtml(rayId)}</strong></span>
          <span>&bull;</span>
          <span>Your IP:</span>
          <button class="reveal" id="reveal-ip" type="button">Click to reveal</button>
          <span id="revealed-ip" hidden>${escapeHtml(maskedIp)}</span>
          <span>&bull;</span>
          <span>Performance &amp; security by FlowSecure</span>
        </div>
      </section>
    </main>

    <script>
      (() => {
        const revealButton = document.getElementById("reveal-ip");
        const revealedIp = document.getElementById("revealed-ip");
        const feedbackNote = document.getElementById("feedback-note");
        const feedbackButtons = document.querySelectorAll("[data-feedback]");
        const realIp = ${revealedIp};

        if (revealButton && revealedIp) {
          revealButton.addEventListener("click", () => {
            revealedIp.hidden = false;
            revealedIp.textContent = realIp;
            revealButton.textContent = "Revealed";
            revealButton.setAttribute("disabled", "disabled");
          }, { once: true });
        }

        feedbackButtons.forEach((button) => {
          button.addEventListener("click", () => {
            if (feedbackNote) {
              feedbackNote.textContent = "Obrigado. O feedback foi registrado com sucesso.";
            }
          });
        });
      })();
    </script>
  </body>
</html>`;
}

export function buildFlowSecureRateLimitResponse(
  request: NextRequest,
  decision: FlowSecureBlockedRateLimit,
  input: {
    contentSecurityPolicy: string;
    requestId: string;
  },
) {
  const rayId = formatRayId(input.requestId);
  const retryAfterSeconds = Math.max(1, Math.trunc(decision.retryAfterSeconds || 60));
  const blockedUntilIso =
    decision.blockedUntilIso ||
    new Date(Date.now() + retryAfterSeconds * 1000).toISOString();

  const response =
    decision.responseMode === "json"
      ? NextResponse.json(
          {
            ok: false,
            code: "rate_limited",
            message:
              "Muitas requisicoes foram detectadas para este IP. Aguarde 1 minuto e tente novamente.",
            rayId,
            retryAfterSeconds,
            blockedUntil: blockedUntilIso,
          },
          { status: 429 },
        )
      : new NextResponse(buildRateLimitHtml(decision, input.requestId), {
          status: 429,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });

  applyStandardSecurityHeaders(response, {
    contentSecurityPolicy: input.contentSecurityPolicy,
    requestId: input.requestId,
    noIndex: true,
  });

  response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Retry-After", String(retryAfterSeconds));
  response.headers.set("X-FlowSecure-Ray-Id", rayId);
  response.headers.set("X-FlowSecure-RateLimit", "ip");
  response.headers.set("X-FlowSecure-RateLimit-Reason", decision.reason);
  response.headers.set(
    "X-FlowSecure-RateLimit-Reset",
    String(Math.ceil(new Date(blockedUntilIso).getTime() / 1000)),
  );
  response.headers.set(
    "Vary",
    "Accept, CF-Connecting-IP, X-Forwarded-For, X-Real-IP",
  );

  if (request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set("X-Frame-Options", "DENY");
  }

  return response;
}
