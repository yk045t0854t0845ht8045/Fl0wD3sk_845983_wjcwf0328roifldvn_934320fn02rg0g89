import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
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

function resolveAllowedTokens() {
  return [
    process.env.FLOWAI_INTERNAL_API_TOKEN,
    process.env.CRON_SECRET,
    process.env.OPENAI_API_KEY,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

function secureTokenEquals(expected: string, received: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
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

function isAuthorized(request: Request, url: URL) {
  const expectedTokens = resolveAllowedTokens();
  if (expectedTokens.length === 0) {
    return process.env.NODE_ENV !== "production";
  }

  const candidates = getCandidateTokens(request, url);
  return candidates.some((candidate) =>
    expectedTokens.some((expected) => secureTokenEquals(expected, candidate)),
  );
}

function normalizeMessages(input: unknown) {
  if (!Array.isArray(input)) {
    throw new Error("FlowAI espera um array de mensagens.");
  }

  const messages = input
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
          : "";

      return {
        role,
        content,
      } satisfies FlowAiMessage;
    })
    .filter((message) => message.content.trim())
    .slice(-24);

  if (!messages.length) {
    throw new Error("FlowAI recebeu mensagens vazias.");
  }

  return messages;
}

function normalizePayload(input: FlowAiTaskPayload | undefined) {
  const payload = input || {};

  return {
    taskKey: String(payload.taskKey || "").trim() || "generic",
    userId: typeof payload.userId === "string" ? payload.userId : null,
    temperature:
      typeof payload.temperature === "number"
        ? payload.temperature
        : Number(payload.temperature),
    maxTokens:
      typeof payload.maxTokens === "number"
        ? payload.maxTokens
        : Number(payload.maxTokens),
    cacheKey: typeof payload.cacheKey === "string" ? payload.cacheKey : null,
    cacheTtlMs:
      typeof payload.cacheTtlMs === "number"
        ? payload.cacheTtlMs
        : Number(payload.cacheTtlMs),
    preferredModel:
      typeof payload.preferredModel === "string" ? payload.preferredModel : null,
    timeoutMs:
      typeof payload.timeoutMs === "number"
        ? payload.timeoutMs
        : Number(payload.timeoutMs),
    messages: normalizeMessages(payload.messages),
  };
}

function respond(body: unknown, requestId: string, init?: ResponseInit) {
  return attachRequestId(
    applyNoStoreHeaders(NextResponse.json(body, init)),
    requestId,
  );
}

async function handlePost(request: Request, requestId: string) {
  const url = new URL(request.url);
  if (!isAuthorized(request, url)) {
    return respond(
      { ok: false, message: "FlowAI interno nao autorizado." },
      requestId,
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as FlowAiRequestBody;
  const task = String(body?.task || "").trim().toLowerCase();

  if (task === "health") {
    const result = await runFlowAiHealthProbe();
    return respond({ ok: true, result }, requestId);
  }

  if (task !== "chat" && task !== "json") {
    return respond(
      { ok: false, message: "Tarefa FlowAI invalida." },
      requestId,
      { status: 400 },
    );
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
    if (!isAuthorized(request, url)) {
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
    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao executar a tarefa interna do FlowAI.",
        ),
      },
      requestContext.requestId,
      { status: 500 },
    );
  }
}
