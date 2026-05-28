import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  getHostingProjectForUser,
  normalizeVpsCode,
} from "@/lib/hosting/vpsRuntime";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders } from "@/lib/security/http";

type RouteProps = {
  params: Promise<{ code: string }>;
};

export async function GET(request: NextRequest, { params }: RouteProps) {
  const session = await getCurrentAuthSessionFromCookie();
  const { code } = await params;
  const vpsCode = normalizeVpsCode(code);
  if (!session || !vpsCode) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "Login necessario." }, { status: 401 }),
    );
  }
  const project = await getHostingProjectForUser({ userId: session.user.id, vpsCode });
  if (!project) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "VPS nao encontrada." }, { status: 404 }),
    );
  }
  const search = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() || "";
  const level = request.nextUrl.searchParams.get("level")?.trim().toLowerCase() || "";
  let query = getSupabaseAdminClientOrThrow()
    .from("hosting_vps_logs")
    .select("*")
    .eq("hosting_project_id", project.id)
    .order("emitted_at", { ascending: false })
    .limit(500);
  if (["debug", "info", "warn", "error", "success"].includes(level)) {
    query = query.eq("level", level);
  }
  const { data, error } = await query;
  if (error) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: error.message }, { status: 500 }),
    );
  }
  const logs = (data || []).filter((log) =>
    search ? String(log.message || "").toLowerCase().includes(search) : true,
  );
  return applyNoStoreHeaders(NextResponse.json({ ok: true, logs: logs.reverse() }));
}
