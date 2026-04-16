import { NextResponse } from "next/server";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
} from "@/lib/security/requestSecurity";
import { authenticateFlowAiApiToken } from "@/lib/flowai/tokens";
import { getFlowAiJobById } from "@/lib/flowai/jobs";

function respond(body: unknown, requestId: string, init?: ResponseInit) {
  return attachRequestId(
    applyNoStoreHeaders(NextResponse.json(body, init)),
    requestId,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestContext = createSecurityRequestContext(request);

  try {
    const auth = await authenticateFlowAiApiToken({
      request,
      requiredScope: "flowai:jobs:read",
    });

    if (!auth.ok) {
      return respond(
        { ok: false, message: auth.message },
        requestContext.requestId,
        { status: auth.status },
      );
    }

    const resolvedParams = await params;
    const job = await getFlowAiJobById({
      jobId: resolvedParams.id,
      apiKeyId: auth.token.id,
    });

    if (!job) {
      return respond(
        { ok: false, message: "Job do FlowAI nao encontrado." },
        requestContext.requestId,
        { status: 404 },
      );
    }

    return respond(
      {
        ok: true,
        requestId: requestContext.requestId,
        job: {
          id: job.id,
          status: job.status,
          taskKey: job.task_key,
          mode: job.mode,
          attempts: job.attempts,
          maxAttempts: job.max_attempts,
          result: job.result,
          error: job.error,
          createdAt: job.created_at,
          updatedAt: job.updated_at,
          completedAt: job.completed_at,
        },
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
            : "Falha ao consultar job do FlowAI.",
      },
      requestContext.requestId,
      { status: 500 },
    );
  }
}
