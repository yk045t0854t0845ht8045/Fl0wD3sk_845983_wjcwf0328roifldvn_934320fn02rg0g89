import type { FlowAiMessage } from "./service";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type FlowAiJobMode = "chat" | "json";

export type FlowAiJobPayload = {
  mode: FlowAiJobMode;
  taskKey: string;
  messages: FlowAiMessage[];
  userId?: string | null;
  temperature?: number;
  maxTokens?: number;
  cacheKey?: string | null;
  cacheTtlMs?: number | null;
  preferredModel?: string | null;
  timeoutMs?: number;
};

export type FlowAiJobRow = {
  id: string;
  api_key_id: number | null;
  auth_user_id: number | null;
  mode: FlowAiJobMode;
  task_key: string;
  payload: FlowAiJobPayload;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  priority: number;
  attempts: number;
  max_attempts: number;
  idempotency_key: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  request_ip: string | null;
  available_at: string;
  locked_at: string | null;
  locked_by: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
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

function normalizeMetadata(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

function nextRetryAt(attempts: number) {
  const delayMs = Math.min(60_000, 1500 * Math.max(1, attempts));
  return new Date(Date.now() + delayMs).toISOString();
}

export async function enqueueFlowAiJob(input: {
  apiKeyId?: number | null;
  authUserId?: number | null;
  mode: FlowAiJobMode;
  taskKey: string;
  payload: FlowAiJobPayload;
  requestIp?: string | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  priority?: number;
  maxAttempts?: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const idempotencyKey = normalizeText(input.idempotencyKey || "", 120) || null;

  if (input.apiKeyId && idempotencyKey) {
    const existing = await supabase
      .from("flowai_job_queue")
      .select("*")
      .eq("api_key_id", input.apiKeyId)
      .eq("idempotency_key", idempotencyKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing.error) {
      throw new Error(existing.error.message);
    }

    if (existing.data) {
      return existing.data as FlowAiJobRow;
    }
  }

  const result = await supabase
    .from("flowai_job_queue")
    .insert({
      api_key_id: input.apiKeyId || null,
      auth_user_id: input.authUserId || null,
      mode: input.mode,
      task_key: normalizeTaskKey(input.taskKey),
      payload: input.payload,
      request_ip: normalizeText(input.requestIp || "", 80) || null,
      metadata: normalizeMetadata(input.metadata),
      idempotency_key: idempotencyKey,
      priority:
        typeof input.priority === "number" && Number.isFinite(input.priority)
          ? Math.max(1, Math.round(input.priority))
          : 100,
      max_attempts:
        typeof input.maxAttempts === "number" && Number.isFinite(input.maxAttempts)
          ? Math.max(1, Math.round(input.maxAttempts))
          : 3,
    })
    .select("*")
    .single();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data as FlowAiJobRow;
}

export async function getFlowAiJobById(input: {
  jobId: string;
  apiKeyId?: number | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  let query = supabase.from("flowai_job_queue").select("*").eq("id", input.jobId);

  if (input.apiKeyId) {
    query = query.eq("api_key_id", input.apiKeyId);
  }

  const result = await query.maybeSingle();
  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data || null) as FlowAiJobRow | null;
}

export async function claimPendingFlowAiJobs(input: {
  workerId: string;
  limit: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = new Date().toISOString();
  const pending = await supabase
    .from("flowai_job_queue")
    .select("*")
    .eq("status", "pending")
    .lte("available_at", nowIso)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(25, Math.round(input.limit))));

  if (pending.error) {
    throw new Error(pending.error.message);
  }

  const claimed: FlowAiJobRow[] = [];
  for (const row of pending.data || []) {
    const claimedResult = await supabase
      .from("flowai_job_queue")
      .update({
        status: "processing",
        locked_at: nowIso,
        locked_by: normalizeText(input.workerId, 120),
        attempts: Math.max(0, Number(row.attempts || 0)) + 1,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (claimedResult.error) {
      throw new Error(claimedResult.error.message);
    }

    if (claimedResult.data) {
      claimed.push(claimedResult.data as FlowAiJobRow);
    }
  }

  return claimed;
}

export async function completeFlowAiJob(input: {
  jobId: string;
  result: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = new Date().toISOString();
  const resultUpdate = await supabase
    .from("flowai_job_queue")
    .update({
      status: "completed",
      result: input.result,
      error: null,
      completed_at: nowIso,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", input.jobId);

  if (resultUpdate.error) {
    throw new Error(resultUpdate.error.message);
  }
}

export async function failFlowAiJob(input: {
  job: FlowAiJobRow;
  error: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const attempts = Math.max(0, Number(input.job.attempts || 0));
  const maxAttempts = Math.max(1, Number(input.job.max_attempts || 3));
  const safeError = normalizeText(input.error, 500);

  if (attempts >= maxAttempts) {
    const result = await supabase
      .from("flowai_job_queue")
      .update({
        status: "failed",
        error: safeError,
        locked_at: null,
        locked_by: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.job.id);

    if (result.error) {
      throw new Error(result.error.message);
    }

    return "failed" as const;
  }

  const result = await supabase
    .from("flowai_job_queue")
    .update({
      status: "pending",
      error: safeError,
      locked_at: null,
      locked_by: null,
      available_at: nextRetryAt(attempts),
    })
    .eq("id", input.job.id);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return "rescheduled" as const;
}

export async function cancelFlowAiJob(input: { jobId: string; error?: string | null }) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("flowai_job_queue")
    .update({
      status: "cancelled",
      error: normalizeText(input.error || "", 500) || null,
      locked_at: null,
      locked_by: null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.jobId);

  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function getFlowAiJobQueueSnapshot() {
  const supabase = getSupabaseAdminClientOrThrow();
  const [pending, processing, completed, failed] = await Promise.all([
    supabase
      .from("flowai_job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("flowai_job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing"),
    supabase
      .from("flowai_job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed"),
    supabase
      .from("flowai_job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
  ]);

  for (const result of [pending, processing, completed, failed]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const oldestPending = await supabase
    .from("flowai_job_queue")
    .select("created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (oldestPending.error) {
    throw new Error(oldestPending.error.message);
  }

  const oldestPendingAgeMs =
    oldestPending.data?.created_at
      ? Math.max(
          0,
          Date.now() - new Date(oldestPending.data.created_at).getTime(),
        )
      : 0;

  return {
    pending: pending.count || 0,
    processing: processing.count || 0,
    completed: completed.count || 0,
    failed: failed.count || 0,
    oldestPendingAgeMs,
  };
}
