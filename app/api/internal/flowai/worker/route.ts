import { NextResponse } from "next/server";
import { hasFlowAiInternalTokenAuth } from "@/lib/flowai/internalAuth";
import {
  claimPendingFlowAiJobs,
  completeFlowAiJob,
  failFlowAiJob,
} from "@/lib/flowai/jobs";
import { recordFlowAiApiRequestEventSafe } from "@/lib/flowai/tokens";
import { runFlowAiJson, runFlowAiText } from "@/lib/flowai/service";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
} from "@/lib/security/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function respond(body: unknown, requestId: string, init?: ResponseInit) {
  return attachRequestId(
    applyNoStoreHeaders(NextResponse.json(body, init)),
    requestId,
  );
}

function resolveBatchSize(request: Request, body?: Record<string, unknown> | null) {
  const url = new URL(request.url);
  const candidate =
    Number(body?.batchSize) || Number(url.searchParams.get("batchSize") || "");
  if (Number.isFinite(candidate) && candidate > 0) {
    return Math.min(10, Math.round(candidate));
  }

  const envBatch = Number(process.env.FLOWAI_JOB_QUEUE_BATCH_SIZE || "");
  if (Number.isFinite(envBatch) && envBatch > 0) {
    return Math.min(10, Math.round(envBatch));
  }

  return 4;
}

export async function POST(request: Request) {
  const requestContext = createSecurityRequestContext(request);

  try {
    if (!hasFlowAiInternalTokenAuth(request)) {
      return respond(
        { ok: false, message: "Worker interno do FlowAI nao autorizado." },
        requestContext.requestId,
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const batchSize = resolveBatchSize(request, body);
    const workerId =
      String(body?.workerId || "").trim().slice(0, 120) ||
      `flowai-worker:${requestContext.requestId}`;

    const jobs = await claimPendingFlowAiJobs({
      workerId,
      limit: batchSize,
    });

    const processed: Array<{
      id: string;
      status: string;
      mode: string;
      taskKey: string;
      traceId?: string;
    }> = [];

    for (const job of jobs) {
      try {
        const payload = (job.payload || {}) as Record<string, unknown>;

        if (job.mode === "chat") {
          const result = await runFlowAiText({
            taskKey: String(payload.taskKey || job.task_key),
            messages: Array.isArray(payload.messages) ? payload.messages : [],
            userId: typeof payload.userId === "string" ? payload.userId : null,
            temperature:
              typeof payload.temperature === "number"
                ? payload.temperature
                : undefined,
            maxTokens:
              typeof payload.maxTokens === "number" ? payload.maxTokens : undefined,
            cacheKey:
              typeof payload.cacheKey === "string" ? payload.cacheKey : null,
            cacheTtlMs:
              typeof payload.cacheTtlMs === "number"
                ? payload.cacheTtlMs
                : undefined,
            preferredModel:
              typeof payload.preferredModel === "string"
                ? payload.preferredModel
                : null,
            timeoutMs:
              typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
          });

          await completeFlowAiJob({
            jobId: job.id,
            result,
          });

          await recordFlowAiApiRequestEventSafe({
            apiKeyId: job.api_key_id,
            authUserId: job.auth_user_id,
            jobId: job.id,
            requestId: String(job.metadata?.requestId || ""),
            traceId: result.traceId,
            mode: job.mode,
            taskKey: job.task_key,
            provider: result.provider,
            model: result.model,
            responseStatus: 200,
            latencyMs: result.latencyMs,
            queueWaitMs: result.queueWaitMs,
            requestIp: job.request_ip,
            metadata: { workerId, async: true },
          });

          processed.push({
            id: job.id,
            status: "completed",
            mode: job.mode,
            taskKey: job.task_key,
            traceId: result.traceId,
          });
          continue;
        }

        const result = await runFlowAiJson<Record<string, unknown>>({
          taskKey: String(payload.taskKey || job.task_key),
          messages: Array.isArray(payload.messages) ? payload.messages : [],
          userId: typeof payload.userId === "string" ? payload.userId : null,
          temperature:
            typeof payload.temperature === "number"
              ? payload.temperature
              : undefined,
          maxTokens:
            typeof payload.maxTokens === "number" ? payload.maxTokens : undefined,
          cacheKey: typeof payload.cacheKey === "string" ? payload.cacheKey : null,
          cacheTtlMs:
            typeof payload.cacheTtlMs === "number"
              ? payload.cacheTtlMs
              : undefined,
          preferredModel:
            typeof payload.preferredModel === "string"
              ? payload.preferredModel
              : null,
          timeoutMs:
            typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
        });

        await completeFlowAiJob({
          jobId: job.id,
          result,
        });

        await recordFlowAiApiRequestEventSafe({
          apiKeyId: job.api_key_id,
          authUserId: job.auth_user_id,
          jobId: job.id,
          requestId: String(job.metadata?.requestId || ""),
          traceId: result.traceId,
          mode: job.mode,
          taskKey: job.task_key,
          provider: result.provider,
          model: result.model,
          responseStatus: 200,
          latencyMs: result.latencyMs,
          queueWaitMs: result.queueWaitMs,
          requestIp: job.request_ip,
          metadata: { workerId, async: true },
        });

        processed.push({
          id: job.id,
          status: "completed",
          mode: job.mode,
          taskKey: job.task_key,
          traceId: result.traceId,
        });
      } catch (error) {
        const failure = await failFlowAiJob({
          job,
          error:
            error instanceof Error
              ? error.message
              : "Falha ao processar job do FlowAI.",
        });

        await recordFlowAiApiRequestEventSafe({
          apiKeyId: job.api_key_id,
          authUserId: job.auth_user_id,
          jobId: job.id,
          requestId: String(job.metadata?.requestId || ""),
          traceId: null,
          mode: job.mode,
          taskKey: job.task_key,
          responseStatus: failure === "failed" ? 500 : 503,
          requestIp: job.request_ip,
          error:
            error instanceof Error
              ? error.message
              : "Falha ao processar job do FlowAI.",
          metadata: { workerId, async: true, state: failure },
        });

        processed.push({
          id: job.id,
          status: failure,
          mode: job.mode,
          taskKey: job.task_key,
        });
      }
    }

    return respond(
      {
        ok: true,
        requestId: requestContext.requestId,
        workerId,
        claimed: jobs.length,
        processed,
      },
      requestContext.requestId,
    );
  } catch (error) {
    return respond(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Falha no worker interno do FlowAI.",
      },
      requestContext.requestId,
      { status: 500 },
    );
  }
}
