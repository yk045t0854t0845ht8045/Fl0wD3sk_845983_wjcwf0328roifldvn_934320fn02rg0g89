import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  getHostingProjectForUser,
  isRecord,
  normalizeVpsCode,
  readString,
  resolveRuntimeStatus,
} from "@/lib/hosting/vpsRuntime";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders } from "@/lib/security/http";

type RouteProps = {
  params: Promise<{ code: string }>;
};

async function loadProject(code: string) {
  const session = await getCurrentAuthSessionFromCookie();
  if (!session) {
    return { response: NextResponse.json({ ok: false, message: "Login necessario." }, { status: 401 }) };
  }
  const vpsCode = normalizeVpsCode(code);
  if (!vpsCode) {
    return { response: NextResponse.json({ ok: false, message: "Codigo da VPS invalido." }, { status: 400 }) };
  }
  const project = await getHostingProjectForUser({
    userId: session.user.id,
    vpsCode,
  });
  if (!project) {
    return { response: NextResponse.json({ ok: false, message: "VPS nao encontrada." }, { status: 404 }) };
  }
  return { session, project };
}

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const { code } = await params;
  const loaded = await loadProject(code);
  if ("response" in loaded && loaded.response) return applyNoStoreHeaders(loaded.response);

  const supabase = getSupabaseAdminClientOrThrow();
  const [metricsResult, logsResult, deploysResult, envResult, actionsResult] =
    await Promise.all([
      supabase
        .from("hosting_vps_metrics")
        .select("*")
        .eq("hosting_project_id", loaded.project.id)
        .order("sampled_at", { ascending: false })
        .limit(48),
      supabase
        .from("hosting_vps_logs")
        .select("*")
        .eq("hosting_project_id", loaded.project.id)
        .order("emitted_at", { ascending: false })
        .limit(200),
      supabase
        .from("hosting_vps_deployments")
        .select("*")
        .eq("hosting_project_id", loaded.project.id)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("hosting_vps_env_vars")
        .select("id, environment, key, value_preview, visible_value, note, sensitive, version, updated_at")
        .eq("hosting_project_id", loaded.project.id)
        .order("environment", { ascending: true })
        .order("key", { ascending: true }),
      supabase
        .from("hosting_vps_action_events")
        .select("*")
        .eq("hosting_project_id", loaded.project.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const runtimePayload = isRecord(loaded.project.runtime_status_payload)
    ? loaded.project.runtime_status_payload
    : {};
  const fileTree = Array.isArray(runtimePayload.fileTree)
    ? runtimePayload.fileTree
    : [];
  const provisioningRepository = isRecord(loaded.project.provisioning_payload)
    ? loaded.project.provisioning_payload.repository
    : null;

  return applyNoStoreHeaders(
    NextResponse.json({
      ok: true,
      project: {
        id: loaded.project.id,
        vpsCode: loaded.project.vps_code,
        status: loaded.project.status,
        runtimeStatus: resolveRuntimeStatus(loaded.project.runtime_status),
        runtimeLastSeenAt: loaded.project.runtime_last_seen_at,
        runtimePayload,
        kind: loaded.project.hosting_kind,
        planId: loaded.project.hosting_plan_id,
        regionId: loaded.project.hosting_region_id,
        repository: {
          owner: loaded.project.github_owner,
          name: loaded.project.github_repo,
          id: loaded.project.github_repo_id,
          branch: loaded.project.github_branch,
          fullName: `${loaded.project.github_owner}/${loaded.project.github_repo}`,
          description: readString(
            isRecord(provisioningRepository) ? provisioningRepository.description : null,
          ),
        },
        provisioningPayload: loaded.project.provisioning_payload,
      },
      metrics: (metricsResult.data || []).reverse(),
      logs: (logsResult.data || []).reverse(),
      deployments: deploysResult.data || [],
      envVars: envResult.data || [],
      actions: actionsResult.data || [],
      fileTree,
    }),
  );
}
