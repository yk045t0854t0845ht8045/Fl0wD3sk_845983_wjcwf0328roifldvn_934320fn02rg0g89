import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  enforceFlowAiRateLimit,
  reserveFlowAiReplayKey,
} from "@/lib/flowai/infra";
import {
  getFlowAiTaskProfile,
  isFlowAiTaskKeyAllowed,
  normalizeFlowAiTaskKey,
  runFlowAiHealthProbe,
  runFlowAiJson,
  runFlowAiText,
  type FlowAiMessage,
} from "@/lib/flowai/service";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
} from "@/lib/security/requestSecurity";

const FLOWAI_SIGNATURE_VERSION = "v1";
const MAX_POST_BODY_BYTES = 64 * 1024;
const MAX_USER_ID_LENGTH = 72;
const MAX_CACHE_KEY_LENGTH = 180;
const MAX_MODEL_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 12_000;
const MAX_MESSAGES = 24;
const MAX_CACHE_TTL_MS = 1000 * 60 * 15;
const MAX_TIMEOUT_MS = 45_000;
const MIN_TIMEOUT_MS = 1_000;
const DEFAULT_TIMESTAMP_SKEW_MS = 1000 * 60 * 5;

type FlowAiTaskPayload = {
  taskKey?: unknown;
  userId?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  cacheKey?: unknown;
  cacheTtlMs?: unknown;
  preferredModel?: unknown;
  timeoutMs?: unknown;
  messages?: unknown;
};

type FlowAiRequestBody =
  | {
      task?: unknown;
      input?: FlowAiTaskPayload;
    }
  | null;

type VerifiedSignature =
  | { ok: true }
  | {
      ok: false;
      status: 400 | 401 | 409;
      message: string;
      replayKey?: string;
    };

function nowMs() {
  return Date.now();
}

function resolveTimestampSkewMs() {
  const configured = Number(process.env.FLOWAI_INTERNAL_CLOCK_SKEW_MS);
  if (Number.isFinite(configured) && configured >= 30_000) {
    return configured;
  }

  return DEFAULT_TIMESTAMP_SKEW_MS;
}

function resolveReplayTtlMs() {
  return resolveTimestampSkewMs() + 15_000;
}

function normalizeSecret(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function resolveAllowedTokens() {
  return Array.from(
    new Set(
      [
        process.env.FLOWAI_INTERNAL_API_TOKEN,
        process.env.CRON_SECRET,
        process.env.OPENAI_API_KEY,
      ]
        .map(normalizeSecret)
        .filter(Boolean),
    ),
  );
}

function resolveSigningSecrets() {
  return Array.from(
    new Set(
      [
        process.env.FLOWAI_INTERNAL_SIGNING_SECRET,
        process.env.FLOWAI_INTERNAL_API_TOKEN,
        process.env.CRON_SECRET,
        process.env.OPENAI_API_KEY,
      ]
        .map(normalizeSecret)
        .filter(Boolean),
    ),
  );
}

function secureTokenEquals(expected: string, received: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function createBodyDigest(rawBody: string) {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

function createRequestSignature(secret: string, timestamp: string, rawBody: string) {
  const bodyDigest = createBodyDigest(rawBody);
  return crypto
    .createHmac("sha256", secret)
    .update(
      `${FLOWAI_SIGNATURE_VERSION}:${timestamp}:${bodyDigest}`,
      "utf8",
    )
    .digest("hex");
}

function getCandidateTokens(request: Request, url: URL) {
  const authorization = request.headers.get("authorization") || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  const bearerToken = bearerMatch?.[1]?.trim() || "";
  const headerToken = request.headers.get("x-flowai-token")?.trim() || "";
  const queryToken =
    process.env.NODE_ENV !== "production"
      ? url.searchParams.get("token")?.trim() || ""
      : "";

  return [bearerToken, headerToken, queryToken].filter(Boolean);
}

function hasValidTokenAuth(request: Request, url: URL) {
  const expectedTokens = resolveAllowedTokens();
  if (expectedTokens.length === 0) {
    return process.env.NODE_ENV !== "production";
  }

  const candidates = getCandidateTokens(request, url);
  return candidates.some((candidate) =>
    expectedTokens.some((expected) => secureTokenEquals(expected, candidate)),
  );
}

async function verifySignedRequest(
  request: Request,
  rawBody: string,
): Promise<VerifiedSignature> {
  const configuredSecrets = resolveSigningSecrets();
  if (configuredSecrets.length === 0) {
    return process.env.NODE_ENV !== "production"
      ? { ok: true }
      : {
          ok: false,
          status: 401,
          message: "FlowAI interno sem segredo de assinatura configurado.",
        };
  }

  const timestamp = request.headers.get("x-flowai-timestamp")?.trim() || "";
  const signature = request.headers.get("x-flowai-signature")?.trim() || "";
  const version =
    request.headers.get("x-flowai-signature-version")?.trim() ||
    FLOWAI_SIGNATURE_VERSION;

  if (!timestamp || !signature) {
    return {
      ok: false,
      status: 401,
      message: "FlowAI interno sem assinatura valida.",
    };
  }

  if (version !== FLOWAI_SIGNATURE_VERSION) {
    return {
      ok: false,
      status: 401,
      message: "Versao de assinatura do FlowAI invalida.",
    };
  }

  if (!/^\d{10,16}$/.test(timestamp)) {
    return {
      ok: false,
      status: 400,
      message: "Timestamp do FlowAI invalido.",
    };
  }

  const timestampMs = Number(timestamp);
  const currentTime = nowMs();
  const allowedSkewMs = resolveTimestampSkewMs();
  if (!Number.isFinite(timestampMs) || Math.abs(currentTime - timestampMs) > allowedSkewMs) {
    return {
      ok: false,
      status: 401,
      message: "Assinatura do FlowAI fora da janela permitida.",
    };
  }

  const signatureMatches = configuredSecrets.some((secret) =>
    secureTokenEquals(createRequestSignature(secret, timestamp, rawBody), signature),
  );

  if (!signatureMatches) {
    return {
      ok: false,
      status: 401,
      message: "Assinatura do FlowAI invalida.",
    };
  }

  const replayKey = `${timestamp}:${signature}`;
  const replayReservation = await reserveFlowAiReplayKey(
    `flowai:replay:${replayKey}`,
    resolveReplayTtlMs(),
  );
  if (!replayReservation.ok) {
    return {
      ok: false,
      status: 409,
      message: "Requisicao do FlowAI ja utilizada anteriormente.",
      replayKey,
    };
  }

  return { ok: true };
}

function readTrimmedString(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
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

function normalizePayload(input: FlowAiTaskPayload | undefined) {
  const payload = input || {};
  const taskKey = normalizeFlowAiTaskKey(String(payload.taskKey || "").trim() || "generic");

  if (!isFlowAiTaskKeyAllowed(taskKey)) {
    throw new Error("TaskKey do FlowAI nao permitida nesta rota.");
  }

  const taskProfile = getFlowAiTaskProfile(taskKey);
  const maxTimeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(taskProfile.defaultTimeoutMs || MIN_TIMEOUT_MS, MIN_TIMEOUT_MS),
  );

  return {
    taskKey,
    userId: readTrimmedString(payload.userId, MAX_USER_ID_LENGTH) || null,
    temperature: coerceFiniteNumber(payload.temperature, { min: 0, max: 1.2 }),
    maxTokens: coerceFiniteNumber(payload.maxTokens, { min: 32, max: 1_500 }),
    cacheKey: readTrimmedString(payload.cacheKey, MAX_CACHE_KEY_LENGTH) || null,
    cacheTtlMs: coerceFiniteNumber(payload.cacheTtlMs, { min: 0, max: MAX_CACHE_TTL_MS }),
    preferredModel: readTrimmedString(payload.preferredModel, MAX_MODEL_LENGTH) || null,
    timeoutMs: coerceFiniteNumber(payload.timeoutMs, {
      min: MIN_TIMEOUT_MS,
      max: maxTimeoutMs,
    }),
    messages: normalizeMessages(payload.messages),
  };
}

function ensureJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  return /^application\/json\b/i.test(contentType);
}

function respond(
  body: unknown,
  requestId: string,
  init?: ResponseInit,
  extraHeaders?: Record<string, string>,
) {
  const response = attachRequestId(
    applyNoStoreHeaders(NextResponse.json(body, init)),
    requestId,
  );

  response.headers.set("X-FlowAI-Signature-Version", FLOWAI_SIGNATURE_VERSION);
  response.headers.set("X-FlowAI-Hardening", "strict");

  for (const [key, value] of Object.entries(extraHeaders || {})) {
    response.headers.set(key, value);
  }

  return response;
}

async function applyRouteRateLimit(key: string, max: number, windowMs: number) {
  return await enforceFlowAiRateLimit({
    key,
    max,
    windowMs,
  });
}

function resolveRateLimitClientKey(request: Request) {
  const explicitClient = readTrimmedString(
    request.headers.get("x-flowai-client"),
    64,
  );
  if (explicitClient) {
    return explicitClient.toLowerCase();
  }

  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const firstIp = forwardedFor.split(",")[0]?.trim() || "";
  if (firstIp) {
    return firstIp;
  }

  return "unknown";
}

async function parseRequestBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_POST_BODY_BYTES) {
    throw Object.assign(new Error("Payload do FlowAI excedeu o limite permitido."), {
      status: 413,
    });
  }

  const rawBody = await request.text();
  const actualLength = Buffer.byteLength(rawBody, "utf8");
  if (actualLength > MAX_POST_BODY_BYTES) {
    throw Object.assign(new Error("Payload do FlowAI excedeu o limite permitido."), {
      status: 413,
    });
  }

  let body: FlowAiRequestBody = null;
  try {
    body = rawBody ? (JSON.parse(rawBody) as FlowAiRequestBody) : null;
  } catch {
    throw Object.assign(new Error("Body JSON do FlowAI invalido."), {
      status: 400,
    });
  }

  return {
    rawBody,
    body,
  };
}

async function handlePost(request: Request, requestId: string) {
  const url = new URL(request.url);
  const clientKey = resolveRateLimitClientKey(request);

  const rateLimit = await applyRouteRateLimit(
    `flowai-internal-post:${clientKey}`,
    90,
    60_000,
  );
  if (!rateLimit.ok) {
    return respond(
      { ok: false, message: "Rate limit interno do FlowAI excedido." },
      requestId,
      { status: 429 },
      {
        "Retry-After": String(
          Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
        ),
      },
    );
  }

  if (!hasValidTokenAuth(request, url)) {
    return respond(
      { ok: false, message: "FlowAI interno nao autorizado." },
      requestId,
      { status: 401 },
    );
  }

  if (!ensureJsonContentType(request)) {
    return respond(
      { ok: false, message: "FlowAI espera Content-Type application/json." },
      requestId,
      { status: 415 },
    );
  }

  const { rawBody, body } = await parseRequestBody(request);
  const signatureVerification = await verifySignedRequest(request, rawBody);
  if (!signatureVerification.ok) {
    return respond(
      { ok: false, message: signatureVerification.message },
      requestId,
      { status: signatureVerification.status },
    );
  }

  const task = readTrimmedString(body?.task, 24).toLowerCase();
  if (task !== "chat" && task !== "json" && task !== "health") {
    return respond(
      { ok: false, message: "Tarefa FlowAI invalida." },
      requestId,
      { status: 400 },
    );
  }

  if (task === "health") {
    const result = await runFlowAiHealthProbe();
    return respond({ ok: true, result }, requestId);
  }

  const payload = normalizePayload(body?.input);
  if (task === "chat") {
    const result = await runFlowAiText(payload);
    return respond({ ok: true, result }, requestId);
  }

  const result = await runFlowAiJson<Record<string, unknown>>(payload);
  return respond({ ok: true, result }, requestId);
}

export async function GET(request: Request) {
  const requestContext = createSecurityRequestContext(request);

  try {
    const url = new URL(request.url);
    const clientKey = resolveRateLimitClientKey(request);
    const rateLimit = await applyRouteRateLimit(
      `flowai-internal-get:${clientKey}`,
      20,
      60_000,
    );
    if (!rateLimit.ok) {
      return respond(
        { ok: false, message: "Rate limit interno do FlowAI excedido." },
        requestContext.requestId,
        { status: 429 },
        {
          "Retry-After": String(
            Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
          ),
        },
      );
    }

    if (!hasValidTokenAuth(request, url)) {
      return respond(
        { ok: false, message: "FlowAI interno nao autorizado." },
        requestContext.requestId,
        { status: 401 },
      );
    }

    const result = await runFlowAiHealthProbe();
    return respond({ ok: true, result }, requestContext.requestId);
  } catch (error) {
    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao consultar a saude interna do FlowAI.",
        ),
      },
      requestContext.requestId,
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const requestContext = createSecurityRequestContext(request);

  try {
    return await handlePost(request, requestContext.requestId);
  } catch (error) {
    const status =
      typeof error === "object" &&
      error &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 500;

    return respond(
      {
        ok: false,
        message:
          status >= 400 && status < 500
            ? sanitizeErrorMessage(error, "Falha ao validar a requisicao interna do FlowAI.")
            : sanitizeErrorMessage(
                error,
                "Erro ao executar a tarefa interna do FlowAI.",
              ),
      },
      requestContext.requestId,
      { status },
    );
  }
}
