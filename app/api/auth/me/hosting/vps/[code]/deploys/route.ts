import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  appendVpsEvent,
  getHostingProjectForUser,
  normalizeVpsCode,
  readString,
  requestVpsAgent,
} from "@/lib/hosting/vpsRuntime";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders } from "@/lib/security/http";

type RouteProps = {
  params: Promise<{ code: string }>;
};

async function load(code: string) {
  const session = await getCurrentAuthSessionFromCookie();
  const vpsCode = normalizeVpsCode(code);
  if (!session || !vpsCode) return null;
  const project = await getHostingProjectForUser({ userId: session.user.id, vpsCode });
  return project ? { session, project } : null;
}

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const { code } = await params;
  const loaded = await load(code);
  if (!loaded) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "VPS nao encontrada." }, { status: 404 }),
    );
  }
  const { data, error } = await getSupabaseAdminClientOrThrow()
    .from("hosting_vps_deployments")
    .select("*")
    .eq("hosting_project_id", loaded.project.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: error.message }, { status: 500 }),
    );
  }
  return applyNoStoreHeaders(NextResponse.json({ ok: true, deployments: data || [] }));
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const { code } = await params;
  const loaded = await load(code);
  if (!loaded) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "VPS nao encontrada." }, { status: 404 }),
    );
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const branch = readString(body.branch) || loaded.project.github_branch;
  const environment =
    body.environment === "development" || body.environment === "preview" || body.environment === "production"
      ? body.environment
      : branch === loaded.project.github_branch
        ? "production"
        : "preview";
  const supabase = getSupabaseAdminClientOrThrow();
  const { data: deployment, error } = await supabase
    .from("hosting_vps_deployments")
    .insert({
      hosting_project_id: loaded.project.id,
      environment,
      status: "queued",
      branch,
      commit_sha: readString(body.commitSha),
      commit_author: readString(body.commitAuthor),
      commit_message: readString(body.commitMessage),
      metadata: { source: "dashboard" },
    })
    .select("*")
    .single();
  if (error) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: error.message }, { status: 500 }),
    );
  }

  await appendVpsEvent({
    projectId: loaded.project.id,
    userId: loaded.session.user.id,
    action: "deploy",
    status: "running",
    message: `Deploy ${environment} enfileirado.`,
    responsePayload: deployment,
  });

  try {
    await requestVpsAgent({
      project: loaded.project,
      method: "POST",
      path: `/v1/vps/${loaded.project.vps_code}/deploys`,
      body: { deploymentId: deployment.id, branch, environment },
      timeoutMs: 30_000,
    });
  } catch (error) {
    await supabase
      .from("hosting_vps_deployments")
      .update({
        status: "failed",
        logs: [{ level: "error", message: error instanceof Error ? error.message : "Falha ao iniciar deploy." }],
        build_finished_at: new Date().toISOString(),
      })
      .eq("id", deployment.id);
  }

  return applyNoStoreHeaders(NextResponse.json({ ok: true, deployment }));
}
