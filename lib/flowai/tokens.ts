import crypto from "node:crypto";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { enforceFlowAiRateLimit } from "./infra";

export type FlowAiApiScope =
  | "*"
  | "flowai:invoke"
  | "flowai:health"
  | "flowai:jobs:read"
  | "flowai:jobs:write";

export type FlowAiApiTokenRecord = {
  id: number;
  user_id: number;
  name: string;
  token_prefix: string | null;
  last_four: string;
  scopes: string[] | null;
  allowed_tasks: string[] | null;
  rate_limit_per_minute: number | null;
  monthly_quota: number | null;
  metadata: Record<string, unknown> | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

type CreateFlowAiApiTokenInput = {
  userId: number;
  name: string;
  scopes?: FlowAiApiScope[];
  allowedTasks?: string[];
  rateLimitPerMinute?: number;
  monthlyQuota?: number | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

type AuthenticateFlowAiApiTokenInput = {
  request: Request;
  requiredScope?: FlowAiApiScope;
  requestedTaskKey?: string | null;
};

function normalizeText(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeTaskKey(value: string) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "generic";
}

function normalizeScopes(input: unknown) {
  const allowed: FlowAiApiScope[] = [
    "*",
    "flowai:invoke",
    "flowai:health",
    "flowai:jobs:read",
    "flowai:jobs:write",
  ];

  const values = Array.isArray(input) ? input : [];
  const scopes = Array.from(
    new Set(
      values
        .map((value) => normalizeText(value, 32).toLowerCase())
        .filter((value): value is FlowAiApiScope =>
          allowed.includes(value as FlowAiApiScope),
        ),
    ),
  );

  return scopes.length ? scopes : (["flowai:invoke", "flowai:jobs:read", "flowai:jobs:write", "flowai:health"] as FlowAiApiScope[]);
}

function normalizeAllowedTasks(input: unknown) {
  const values = Array.isArray(input) ? input : [];
  const allowedTasks = Array.from(
    new Set(
      values
        .map((value) => normalizeTaskKey(String(value || "")))
        .filter(Boolean)
        .slice(0, 24),
    ),
  );

  return allowedTasks.length ? allowedTasks : ["*"];
}

function normalizeMetadata(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

function normalizeIsoDateTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function parsePositiveInteger(value: unknown, fallback: number) {
  const numeric =
    typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.max(1, Math.round(numeric));
}

function hashToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function buildRawToken() {
  const prefix = crypto.randomBytes(6).toString("hex");
  const secret = crypto.randomBytes(32).toString("hex");
  return `flai_live_${prefix}_${secret}`;
}

function extractTokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  const bearerToken = bearerMatch?.[1]?.trim() || "";
  const headerToken = request.headers.get("x-api-key")?.trim() || "";
  return bearerToken || headerToken || "";
}

function hasScope(token: FlowAiApiTokenRecord, requiredScope: FlowAiApiScope) {
  const scopes = Array.isArray(token.scopes) ? token.scopes : [];
  return scopes.includes("*") || scopes.includes(requiredScope);
}

function isTaskAllowed(token: FlowAiApiTokenRecord, taskKey: string | null | undefined) {
  if (!taskKey) {
    return true;
  }

  const allowedTasks = Array.isArray(token.allowed_tasks)
    ? token.allowed_tasks
    : ["*"];

  if (allowedTasks.includes("*")) {
    return true;
  }

  return allowedTasks.includes(normalizeTaskKey(taskKey));
}

async function getMonthlyUsageCount(apiKeyId: number) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("flowai_api_request_events")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", apiKeyId)
    .gte("created_at", monthStart.toISOString());

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.count || 0;
}

export async function listFlowAiApiTokensForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_api_keys")
    .select(
      "id, user_id, name, token_prefix, last_four, scopes, allowed_tasks, rate_limit_per_minute, monthly_quota, metadata, last_used_at, last_used_ip, expires_at, created_at, revoked_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data || []) as FlowAiApiTokenRecord[];
}

export async function createFlowAiApiTokenForUser(
  input: CreateFlowAiApiTokenInput,
) {
  const name = normalizeText(input.name, 120);
  if (!name) {
    throw new Error("Nome da chave e obrigatorio.");
  }

  const rawToken = buildRawToken();
  const tokenPrefix = rawToken.slice(0, 18);
  const keyHash = hashToken(rawToken);
  const lastFour = rawToken.slice(-4);
  const scopes = normalizeScopes(input.scopes);
  const allowedTasks = normalizeAllowedTasks(input.allowedTasks);
  const rateLimitPerMinute = parsePositiveInteger(
    input.rateLimitPerMinute,
    60,
  );
  const monthlyQuota =
    input.monthlyQuota === null || input.monthlyQuota === undefined
      ? null
      : parsePositiveInteger(input.monthlyQuota, 10_000);
  const expiresAt = normalizeIsoDateTime(input.expiresAt);

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_api_keys")
    .insert({
      user_id: input.userId,
      name,
      key_hash: keyHash,
      token_prefix: tokenPrefix,
      last_four: lastFour,
      scopes,
      allowed_tasks: allowedTasks,
      rate_limit_per_minute: rateLimitPerMinute,
      monthly_quota: monthlyQuota,
      expires_at: expiresAt,
      metadata: normalizeMetadata(input.metadata),
    })
    .select(
      "id, user_id, name, token_prefix, last_four, scopes, allowed_tasks, rate_limit_per_minute, monthly_quota, metadata, last_used_at, last_used_ip, expires_at, created_at, revoked_at",
    )
    .single();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return {
    record: result.data as FlowAiApiTokenRecord,
    secret: rawToken,
  };
}

export async function revokeFlowAiApiTokenForUser(input: {
  userId: number;
  tokenId: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.tokenId)
    .eq("user_id", input.userId)
    .is("revoked_at", null);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return true;
}

export async function touchFlowAiApiTokenUsage(input: {
  tokenId: number;
  requestIp: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  await supabase
    .from("auth_user_api_keys")
    .update({
      last_used_at: new Date().toISOString(),
      last_used_ip: input.requestIp,
    })
    .eq("id", input.tokenId);
}

export async function touchFlowAiApiTokenUsageSafe(input: {
  tokenId: number;
  requestIp: string | null;
}) {
  try {
    await touchFlowAiApiTokenUsage(input);
  } catch {
    // nunca derrubar o fluxo principal por telemetria de uso
  }
}

export async function recordFlowAiApiRequestEvent(input: {
  apiKeyId?: number | null;
  authUserId?: number | null;
  jobId?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  mode: string;
  taskKey: string;
  provider?: string | null;
  model?: string | null;
  responseStatus: number;
  latencyMs?: number | null;
  queueWaitMs?: number | null;
  cacheHit?: boolean;
  requestIp?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase.from("flowai_api_request_events").insert({
    api_key_id: input.apiKeyId || null,
    auth_user_id: input.authUserId || null,
    job_id: input.jobId || null,
    request_id: input.requestId || null,
    trace_id: input.traceId || null,
    mode: normalizeText(input.mode, 24) || "chat",
    task_key: normalizeTaskKey(input.taskKey),
    provider: normalizeText(input.provider || "", 32) || null,
    model: normalizeText(input.model || "", 120) || null,
    response_status: input.responseStatus,
    latency_ms:
      typeof input.latencyMs === "number" ? Math.max(0, Math.round(input.latencyMs)) : null,
    queue_wait_ms:
      typeof input.queueWaitMs === "number"
        ? Math.max(0, Math.round(input.queueWaitMs))
        : null,
    cache_hit: input.cacheHit === true,
    request_ip: normalizeText(input.requestIp || "", 80) || null,
    error: normalizeText(input.error || "", 280) || null,
    metadata: normalizeMetadata(input.metadata),
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function recordFlowAiApiRequestEventSafe(input: {
  apiKeyId?: number | null;
  authUserId?: number | null;
  jobId?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  mode: string;
  taskKey: string;
  provider?: string | null;
  model?: string | null;
  responseStatus: number;
  latencyMs?: number | null;
  queueWaitMs?: number | null;
  cacheHit?: boolean;
  requestIp?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    await recordFlowAiApiRequestEvent(input);
  } catch {
    // auditoria nao pode derrubar a API publica nem o worker
  }
}

export async function authenticateFlowAiApiToken(
  input: AuthenticateFlowAiApiTokenInput,
) {
  const rawToken = extractTokenFromRequest(input.request);
  if (!rawToken) {
    return {
      ok: false as const,
      status: 401,
      message: "Token da API FlowAI ausente.",
    };
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_api_keys")
    .select(
      "id, user_id, name, token_prefix, last_four, scopes, allowed_tasks, rate_limit_per_minute, monthly_quota, metadata, last_used_at, last_used_ip, expires_at, created_at, revoked_at",
    )
    .eq("key_hash", hashToken(rawToken))
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  const token = result.data as FlowAiApiTokenRecord | null;
  if (!token || token.revoked_at) {
    return {
      ok: false as const,
      status: 401,
      message: "Token da API FlowAI invalido ou revogado.",
    };
  }

  if (
    token.expires_at &&
    Number.isFinite(new Date(token.expires_at).getTime()) &&
    new Date(token.expires_at).getTime() <= Date.now()
  ) {
    return {
      ok: false as const,
      status: 401,
      message: "Token da API FlowAI expirado.",
    };
  }

  const requiredScope = input.requiredScope || "flowai:invoke";
  if (!hasScope(token, requiredScope)) {
    return {
      ok: false as const,
      status: 403,
      message: "Token sem escopo suficiente para esta operacao.",
    };
  }

  if (!isTaskAllowed(token, input.requestedTaskKey)) {
    return {
      ok: false as const,
      status: 403,
      message: "Token sem permissao para esta task do FlowAI.",
    };
  }

  const monthlyQuota =
    typeof token.monthly_quota === "number" && token.monthly_quota > 0
      ? token.monthly_quota
      : null;
  if (monthlyQuota && requiredScope !== "flowai:jobs:read") {
    const usageCount = await getMonthlyUsageCount(token.id);
    if (usageCount >= monthlyQuota) {
      return {
        ok: false as const,
        status: 429,
        message: "Quota mensal da API FlowAI excedida para este token.",
      };
    }
  }

  const rateLimit = await enforceFlowAiRateLimit({
    key: `flowai-public-token:${token.id}`,
    max:
      typeof token.rate_limit_per_minute === "number" &&
      token.rate_limit_per_minute > 0
        ? token.rate_limit_per_minute
        : 60,
    windowMs: 60_000,
  });

  if (!rateLimit.ok) {
    return {
      ok: false as const,
      status: 429,
      message: "Rate limit do token FlowAI excedido.",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
      ),
    };
  }

  return {
    ok: true as const,
    token,
    rateLimit,
    rawToken,
  };
}
