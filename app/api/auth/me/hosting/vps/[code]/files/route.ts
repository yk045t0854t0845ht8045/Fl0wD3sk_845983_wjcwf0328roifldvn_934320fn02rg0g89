import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  appendVpsEvent,
  getHostingProjectForUser,
  isRecord,
  normalizeVpsCode,
  readString,
  requestVpsAgent,
} from "@/lib/hosting/vpsRuntime";
import {
  fetchHostingGitHubRepositoryFile,
  fetchHostingGitHubRepositoryTree,
  readHostingGitHubToken,
} from "@/lib/hosting/github";
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

export async function GET(request: NextRequest, { params }: RouteProps) {
  const { code } = await params;
  const loaded = await load(code);
  if (!loaded) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "VPS nao encontrada." }, { status: 404 }),
    );
  }
  const path = request.nextUrl.searchParams.get("path") || "";
  const sync = request.nextUrl.searchParams.get("sync") === "1";
  try {
    const payload = await requestVpsAgent({
      project: loaded.project,
      path: `/v1/vps/${loaded.project.vps_code}/files?path=${encodeURIComponent(path)}${sync ? "&recursive=1" : ""}`,
      timeoutMs: 12_000,
    });
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        ...(isRecord(payload) ? payload : { payload }),
      }),
    );
  } catch {
    const token = await readHostingGitHubToken();
    if (token && path) {
      const file = await fetchHostingGitHubRepositoryFile({
        token,
        owner: loaded.project.github_owner,
        repo: loaded.project.github_repo,
        branch: loaded.project.github_branch,
        path,
      }).catch(() => null);
      if (file) {
        return applyNoStoreHeaders(
          NextResponse.json({ ok: true, file, agentConnected: false, source: "github" }),
        );
      }
    }

    if (token && (sync || !path)) {
      const tree = await fetchHostingGitHubRepositoryTree({
        token,
        owner: loaded.project.github_owner,
        repo: loaded.project.github_repo,
        branch: loaded.project.github_branch,
      }).catch(() => null);
      if (tree) {
        const currentPayload = isRecord(loaded.project.runtime_status_payload)
          ? loaded.project.runtime_status_payload
          : {};
        await getSupabaseAdminClientOrThrow()
          .from("hosting_projects")
          .update({
            runtime_status_payload: {
              ...currentPayload,
              fileTree: tree,
              fileTreeSource: "github",
              fileTreeSyncedAt: new Date().toISOString(),
            },
          })
          .eq("id", loaded.project.id);
        return applyNoStoreHeaders(
          NextResponse.json({ ok: true, tree, file: null, agentConnected: false, source: "github" }),
        );
      }
    }

    const payload = isRecord(loaded.project.runtime_status_payload)
      ? loaded.project.runtime_status_payload
      : {};
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        tree: Array.isArray(payload.fileTree) ? payload.fileTree : [],
        file: null,
        agentConnected: false,
      }),
    );
  }
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
  const path = readString(body.path);
  const content = typeof body.content === "string" ? body.content : null;
  if (!path || content === null) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "Arquivo invalido." }, { status: 400 }),
    );
  }
  try {
    const payload = await requestVpsAgent({
      project: loaded.project,
      method: "POST",
      path: `/v1/vps/${loaded.project.vps_code}/files`,
      body: { path, content },
      timeoutMs: 15_000,
    });
    await appendVpsEvent({
      projectId: loaded.project.id,
      userId: loaded.session.user.id,
      action: "file_write",
      status: "succeeded",
      message: `Arquivo ${path} salvo.`,
    });
    return applyNoStoreHeaders(NextResponse.json({ ok: true, payload }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao salvar arquivo.";
    await getSupabaseAdminClientOrThrow().from("hosting_vps_logs").insert({
      hosting_project_id: loaded.project.id,
      level: "error",
      source: "files",
      message,
      metadata: { path },
    });
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message }, { status: 503 }),
    );
  }
}
