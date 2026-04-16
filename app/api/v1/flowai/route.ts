import { NextResponse } from "next/server";
import {
  getFlowAiTaskProfile,
  isFlowAiTaskKeyAllowed,
  normalizeFlowAiTaskKey,
  runFlowAiHealthProbe,
  runFlowAiJson,
  runFlowAiText,
  type FlowAiMessage,
} from "@/lib/flowai/service";
import {
  authenticateFlowAiApiToken,
  recordFlowAiApiRequestEventSafe,
  touchFlowAiApiTokenUsageSafe,
} from "@/lib/flowai/tokens";
import { enqueueFlowAiJob } from "@/lib/flowai/jobs";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
} from "@/lib/security/requestSecurity";
import { sanitizeErrorMessage } from "@/lib/security/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 12_000;
const MAX_MESSAGES = 24;
const MAX_TIMEOUT_MS = 45_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_CACHE_TTL_MS = 1000 * 60 * 15;

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const candidate = forwardedFor.split(",")[0]?.trim();
    if (candidate) return candidate;
  }

  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    null
  );
}

function respond(body: unknown, requestId: string, init?: ResponseInit) {
  return attachRequestId(
    applyNoStoreHeaders(NextResponse.json(body, init)),
    requestId,
  );
}

function normalizeMode(value: unknown) {
  const normalized = String(value || "chat").trim().toLowerCase();
  if (normalized === "json" || normalized === "health") {
    return normalized;
  }

  return "chat";
}

function ensureJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  return /^application\/json\b/i.test(contentType);
}

function normalizeMessages(input: unknown) {
  if (!Array.isArray(input)) {
    throw new Error("FlowAI espera um array de mensagens.");
  }

  const messages = input
    .slice(-MAX_MESSAGES)
    .map((entry) => {
      const role =
        entry &&
        typeof entry === "object" &&
        "role" in entry &&
        (entry.role === "system" ||
          entry.role === "assistant" ||
          entry.role === "user")
          ? entry.role
          : "user";

      const content =
        entry && typeof entry === "object" && "content" in entry
          ? String(entry.content || "")
              .replace(/\r\n/g, "\n")
              .replace(/\r/g, "\n")
              .trim()
              .slice(0, MAX_MESSAGE_LENGTH)
          : "";

      return {
        role,
        content,
      } satisfies FlowAiMessage;
    })
    .filter((message) => message.content);

  if (!messages.length) {
    throw new Error("FlowAI recebeu mensagens vazias.");
  }

  return messages;
}

function coerceFiniteNumber(
  value: unknown,
  input?: { min?: number; max?: number },
) {
  const numeric =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  if (typeof input?.min === "number" && numeric < input.min) {
    return undefined;
  }

  if (typeof input?.max === "number" && numeric > input.max) {
    return undefined;
  }

  return numeric;
}

function normalizePayload(body: Record<string, unknown>) {
  const taskKey = normalizeFlowAiTaskKey(String(body.taskKey || "generic"));
  if (!isFlowAiTaskKeyAllowed(taskKey)) {
    throw new Error("TaskKey do FlowAI nao permitida.");
  }

  const taskProfile = getFlowAiTaskProfile(taskKey);
  const maxTimeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(taskProfile.defaultTimeoutMs || MIN_TIMEOUT_MS, MIN_TIMEOUT_MS),
  );

  return {
    taskKey,
    userId: String(body.userId || "").trim().slice(0, 72) || null,
    temperature: coerceFiniteNumber(body.temperature, { min: 0, max: 1.2 }),
    maxTokens: coerceFiniteNumber(body.maxTokens, { min: 32, max: 1_500 }),
    cacheKey: String(body.cacheKey || "").trim().slice(0, 180) || null,
    cacheTtlMs: coerceFiniteNumber(body.cacheTtlMs, {
      min: 0,
      max: MAX_CACHE_TTL_MS,
    }),
    preferredModel:
      String(body.preferredModel || "").trim().slice(0, 120) || null,
    timeoutMs: coerceFiniteNumber(body.timeoutMs, {
      min: MIN_TIMEOUT_MS,
      max: maxTimeoutMs,
    }),
    messages: normalizeMessages(body.messages),
  };
}

function wantsAsync(request: Request, body: Record<string, unknown>) {
  const prefer = request.headers.get("prefer") || "";
  const asyncHeader = request.headers.get("x-flowai-mode") || "";
  return (
    body.async === true ||
    /\brespond-async\b/i.test(prefer) ||
    String(asyncHeader).trim().toLowerCase() === "async"
  );
}

export async function POST(request: Request) {
  const requestContext = createSecurityRequestContext(request);

  try {
    if (!ensureJsonContentType(request)) {
      return respond(
        {
          ok: false,
          message: "FlowAI espera Content-Type application/json.",
        },
        requestContext.requestId,
        { status: 415 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!body || typeof body !== "object") {
      return respond(
        { ok: false, message: "Body JSON do FlowAI invalido." },
        requestContext.requestId,
        { status: 400 },
      );
    }

    const mode = normalizeMode(body.mode);
    const asyncRequested =
      mode !== "health" && wantsAsync(request, body);
    const requestedTaskKey = normalizeFlowAiTaskKey(
      String(body.taskKey || "generic"),
    );
    const auth = await authenticateFlowAiApiToken({
      request,
      requiredScope:
        mode === "health"
          ? "flowai:health"
          : asyncRequested
            ? "flowai:jobs:write"
            : "flowai:invoke",
      requestedTaskKey,
    });

    if (!auth.ok) {
      return respond(
        { ok: false, message: auth.message },
        requestContext.requestId,
        {
          status: auth.status,
          headers:
            "retryAfterSeconds" in auth && auth.retryAfterSeconds
              ? { "Retry-After": String(auth.retryAfterSeconds) }
              : undefined,
        },
      );
    }

    const requestIp = getClientIp(request);
    void touchFlowAiApiTokenUsageSafe({
      tokenId: auth.token.id,
      requestIp,
    });

    if (mode === "health") {
      const result = await runFlowAiHealthProbe();
      void recordFlowAiApiRequestEventSafe({
        apiKeyId: auth.token.id,
        authUserId: auth.token.user_id,
        requestId: requestContext.requestId,
        traceId: null,
        mode,
        taskKey: "health",
        responseStatus: 200,
        requestIp,
      });
      return respond({ ok: true, requestId: requestContext.requestId, result }, requestContext.requestId);
    }

    const payload = normalizePayload(body);

    if (asyncRequested) {
      const job = await enqueueFlowAiJob({
        apiKeyId: auth.token.id,
        authUserId: auth.token.user_id,
        mode,
        taskKey: payload.taskKey,
        payload: {
          ...payload,
          mode,
        },
        requestIp,
        metadata: {
          tokenName: auth.token.name,
          requestId: requestContext.requestId,
        },
        idempotencyKey:
          request.headers.get("idempotency-key")?.trim() ||
          request.headers.get("x-idempotency-key")?.trim() ||
          null,
        priority:
          getFlowAiTaskProfile(payload.taskKey).queueGroup === "heavy" ? 40 : 90,
      });

      void recordFlowAiApiRequestEventSafe({
        apiKeyId: auth.token.id,
        authUserId: auth.token.user_id,
        jobId: job.id,
        requestId: requestContext.requestId,
        traceId: null,
        mode,
        taskKey: payload.taskKey,
        responseStatus: 202,
        requestIp,
        metadata: { queued: true },
      });

      return respond(
        {
          ok: true,
          queued: true,
          requestId: requestContext.requestId,
          job: {
            id: job.id,
            status: job.status,
            createdAt: job.created_at,
            pollUrl: `/api/v1/flowai/jobs/${job.id}`,
          },
        },
        requestContext.requestId,
        { status: 202 },
      );
    }

    if (mode === "chat") {
      const result = await runFlowAiText(payload);
      void recordFlowAiApiRequestEventSafe({
        apiKeyId: auth.token.id,
        authUserId: auth.token.user_id,
        requestId: requestContext.requestId,
        traceId: result.traceId,
        mode,
        taskKey: payload.taskKey,
        provider: result.provider,
        model: result.model,
        responseStatus: 200,
        latencyMs: result.latencyMs,
        queueWaitMs: result.queueWaitMs,
        requestIp,
      });
      return respond(
        { ok: true, requestId: requestContext.requestId, result },
        requestContext.requestId,
      );
    }

    const result = await runFlowAiJson<Record<string, unknown>>(payload);
    void recordFlowAiApiRequestEventSafe({
      apiKeyId: auth.token.id,
      authUserId: auth.token.user_id,
      requestId: requestContext.requestId,
      traceId: result.traceId,
      mode,
      taskKey: payload.taskKey,
      provider: result.provider,
      model: result.model,
      responseStatus: 200,
      latencyMs: result.latencyMs,
      queueWaitMs: result.queueWaitMs,
      requestIp,
    });
    return respond(
      { ok: true, requestId: requestContext.requestId, result },
      requestContext.requestId,
    );
  } catch (error) {
    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao executar a API publica do FlowAI.",
        ),
      },
      requestContext.requestId,
      { status: 500 },
    );
  }
}
