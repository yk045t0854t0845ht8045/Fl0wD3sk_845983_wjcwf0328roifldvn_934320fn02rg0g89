import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  appendVpsEvent,
  getHostingProjectForUser,
  normalizeVpsCode,
  requestVpsAgent,
  resolveRuntimeStatus,
  type VpsAction,
} from "@/lib/hosting/vpsRuntime";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders } from "@/lib/security/http";

type RouteProps = {
  params: Promise<{ code: string }>;
};

function normalizeAction(value: unknown): VpsAction | null {
  return value === "start" ||
    value === "stop" ||
    value === "restart" ||
    value === "deploy" ||
    value === "rollback" ||
    value === "sync"
    ? value
    : null;
}

function nextRuntimeStatusForAction(action: VpsAction) {
  if (action === "start") return "online" as const;
  if (action === "stop") return "offline" as const;
  if (action === "restart") return "restarting" as const;
  if (action === "deploy" || action === "rollback") return "deploying" as const;
  return "unknown" as const;
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const session = await getCurrentAuthSessionFromCookie();
  if (!session) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "Login necessario." }, { status: 401 }),
    );
  }

  const { code } = await params;
  const vpsCode = normalizeVpsCode(code);
  if (!vpsCode) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "Codigo da VPS invalido." }, { status: 400 }),
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = normalizeAction((body as Record<string, unknown>).action);
  if (!action) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "Acao invalida." }, { status: 400 }),
    );
  }

  const project = await getHostingProjectForUser({
    userId: session.user.id,
    vpsCode,
  });
  if (!project) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "VPS nao encontrada." }, { status: 404 }),
    );
  }

  const supabase = getSupabaseAdminClientOrThrow();
  await appendVpsEvent({
    projectId: project.id,
    userId: session.user.id,
    action,
    status: "running",
    message: `Acao ${action} iniciada.`,
    requestPayload: body,
  });

  await supabase
    .from("hosting_projects")
    .update({
      runtime_status: nextRuntimeStatusForAction(action),
      runtime_status_payload: {
        lastAction: action,
        startedAt: new Date().toISOString(),
      },
      runtime_last_seen_at: new Date().toISOString(),
    })
    .eq("id", project.id);

  try {
    const payload = await requestVpsAgent<Record<string, unknown>>({
      project,
      method: "POST",
      path: `/v1/vps/${project.vps_code}/actions/${action}`,
      body,
      timeoutMs: action === "deploy" ? 45_000 : 15_000,
    });
    const runtimeStatus = resolveRuntimeStatus(payload.status);

    await supabase
      .from("hosting_projects")
      .update({
        runtime_status: runtimeStatus === "unknown" ? nextRuntimeStatusForAction(action) : runtimeStatus,
        runtime_status_payload: payload,
        runtime_last_seen_at: new Date().toISOString(),
      })
      .eq("id", project.id);
    await appendVpsEvent({
      projectId: project.id,
      userId: session.user.id,
      action,
      status: "succeeded",
      message: `Acao ${action} concluida.`,
      requestPayload: body,
      responsePayload: payload,
    });

    return applyNoStoreHeaders(NextResponse.json({ ok: true, status: runtimeStatus, payload }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao executar acao.";
    await appendVpsEvent({
      projectId: project.id,
      userId: session.user.id,
      action,
      status: "failed",
      message,
      requestPayload: body,
    });
    await supabase
      .from("hosting_vps_logs")
      .insert({
        hosting_project_id: project.id,
        level: "error",
        source: "control-plane",
        message,
        metadata: { action },
      });

    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message }, { status: 503 }),
    );
  }
}
