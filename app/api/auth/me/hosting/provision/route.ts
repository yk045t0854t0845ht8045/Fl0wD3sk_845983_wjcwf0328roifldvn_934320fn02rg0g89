import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  HOSTING_PLANS,
  HOSTING_REGIONS,
  type HostingKind,
} from "@/lib/hosting/catalog";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders } from "@/lib/security/http";

type ProvisionBody = {
  orderNumber?: unknown;
  kind?: unknown;
  planId?: unknown;
  regionId?: unknown;
  repository?: unknown;
};

function isHostingKind(value: unknown): value is HostingKind {
  return value === "site" || value === "bot" || value === "cdn";
}

function normalizeText(value: unknown, maxLength = 160) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeOrderNumber(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRepository(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const owner = normalizeText(record.owner, 80);
  const name = normalizeText(record.name, 120);
  if (!owner || !name) return null;
  return {
    owner,
    name,
    id: normalizeText(record.id, 80),
    branch: normalizeText(record.branch, 120) || "main",
    fullName: `${owner}/${name}`,
  };
}

export async function POST(request: NextRequest) {
  let body: ProvisionBody;
  try {
    body = await request.json() as ProvisionBody;
  } catch {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "Payload invalido." }, { status: 400 }),
    );
  }

  const session = await getCurrentAuthSessionFromCookie();
  if (!session) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        message: "Entre na sua conta para liberar a VPS.",
      }, { status: 401 }),
    );
  }
  const orderNumber = normalizeOrderNumber(body.orderNumber);
  const kind = isHostingKind(body.kind) ? body.kind : null;
  const planId = normalizeText(body.planId, 80);
  const regionId = normalizeText(body.regionId, 80);
  const repository = normalizeRepository(body.repository);
  const plan = kind && planId
    ? HOSTING_PLANS[kind].find((item) => item.id === planId)
    : null;
  const region = regionId
    ? HOSTING_REGIONS.find((item) => item.id === regionId)
    : null;

  if (!orderNumber || !kind || !plan || !region || !repository) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        message: "Complete tipo, repositorio, regiao, plano e pedido antes de provisionar.",
      }, { status: 400 }),
    );
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const { data: order, error: orderError } = await supabase
    .from("payment_orders")
    .select("id, order_number, user_id, status, amount, plan_code")
    .eq("order_number", orderNumber)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (orderError) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: orderError.message }, { status: 500 }),
    );
  }

  if (!order || order.status !== "approved") {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        message: "O pedido ainda nao esta aprovado para liberar a VPS.",
      }, { status: 409 }),
    );
  }

  const { data: existingProject, error: existingError } = await supabase
    .from("hosting_projects")
    .select("vps_code, status")
    .eq("payment_order_id", order.id)
    .maybeSingle();

  if (existingError) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: existingError.message }, { status: 500 }),
    );
  }

  if (existingProject?.vps_code) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        reused: true,
        vpsCode: existingProject.vps_code,
        status: existingProject.status,
        redirectUrl: `https://fdesk.flwdesk.com/vps/${existingProject.vps_code}`,
      }),
    );
  }

  const { data: project, error: insertError } = await supabase
    .from("hosting_projects")
    .insert({
      user_id: session.user.id,
      payment_order_id: order.id,
      hosting_kind: kind,
      hosting_plan_id: plan.id,
      hosting_region_id: region.id,
      github_owner: repository.owner,
      github_repo: repository.name,
      github_repo_id: repository.id,
      github_branch: repository.branch,
      status: "pending_provision",
      provisioning_payload: {
        source: "dashboard_hosting",
        windowsRuntime: "windows-vps",
        repository,
        plan,
        region,
      },
    })
    .select("vps_code, status")
    .single();

  if (insertError) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: insertError.message }, { status: 500 }),
    );
  }

  return applyNoStoreHeaders(
    NextResponse.json({
      ok: true,
      reused: false,
      vpsCode: project.vps_code,
      status: project.status,
      redirectUrl: `https://fdesk.flwdesk.com/vps/${project.vps_code}`,
    }),
  );
}
