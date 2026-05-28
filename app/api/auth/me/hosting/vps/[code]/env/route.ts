import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  appendVpsEvent,
  encryptEnvValue,
  getHostingProjectForUser,
  maskSecretPreview,
  normalizeVpsCode,
  readString,
  requestVpsAgent,
} from "@/lib/hosting/vpsRuntime";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders } from "@/lib/security/http";

type RouteProps = {
  params: Promise<{ code: string }>;
};

type NormalizedEnvVariableInput = {
  environment: "development" | "preview" | "production";
  key: string;
  value: string;
  note: string | null;
  sensitive: boolean;
};

function normalizeEnvironment(value: unknown) {
  return value === "development" || value === "preview" || value === "production"
    ? value
    : null;
}

function normalizeEnvVariableInput(
  value: unknown,
  fallbackEnvironment: unknown,
): NormalizedEnvVariableInput | null {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const environment = normalizeEnvironment(source.environment) || normalizeEnvironment(fallbackEnvironment);
  const key = readString(source.key);
  const rawValue = typeof source.value === "string" ? source.value : null;
  const note = typeof source.note === "string" ? source.note.trim().slice(0, 500) : null;
  const sensitive = source.sensitive !== false;

  if (!environment || !key || rawValue === null) return null;
  return {
    environment,
    key,
    value: rawValue,
    note,
    sensitive,
  };
}

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
  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("hosting_vps_env_vars")
    .select("id, environment, key, value_preview, visible_value, note, sensitive, version, updated_at")
    .eq("hosting_project_id", loaded.project.id)
    .order("environment", { ascending: true })
    .order("key", { ascending: true });

  if (error) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: error.message }, { status: 500 }),
    );
  }
  return applyNoStoreHeaders(NextResponse.json({ ok: true, envVars: data || [] }));
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
  const variables = Array.isArray(body.variables)
    ? body.variables.map((item) => normalizeEnvVariableInput(item, body.environment))
    : [normalizeEnvVariableInput(body, body.environment)];
  const normalizedVariables = variables.filter((item): item is NormalizedEnvVariableInput => Boolean(item));

  if (!normalizedVariables.length || normalizedVariables.length > 250) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "Envie entre 1 e 250 variaveis por vez." }, { status: 400 }),
    );
  }

  const seen = new Set<string>();
  for (const variable of normalizedVariables) {
    if (!/^[A-Z_][A-Z0-9_]{0,80}$/i.test(variable.key)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: `Variavel invalida: ${variable.key}.` }, { status: 400 }),
      );
    }
    const fingerprint = `${variable.environment}:${variable.key.toLowerCase()}`;
    if (seen.has(fingerprint)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: `Variavel duplicada: ${variable.key}.` }, { status: 400 }),
      );
    }
    seen.add(fingerprint);
  }

  let rows: Array<Record<string, unknown>>;
  try {
    rows = normalizedVariables.map((variable) => ({
      hosting_project_id: loaded.project.id,
      environment: variable.environment,
      key: variable.key,
      encrypted_value: encryptEnvValue(variable.value),
      value_preview: variable.sensitive ? maskSecretPreview(variable.value) : variable.value,
      visible_value: variable.sensitive ? null : variable.value,
      note: variable.note,
      sensitive: variable.sensitive,
      updated_by_user_id: loaded.session.user.id,
    }));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        message: error instanceof Error ? error.message : "Falha ao criptografar.",
      }, { status: 500 }),
    );
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const keys = [...new Set(normalizedVariables.map((item) => item.key))];
  const { data: currentRows } = await supabase
    .from("hosting_vps_env_vars")
    .select("environment, key, version")
    .eq("hosting_project_id", loaded.project.id)
    .in("key", keys);

  const versionByKey = new Map(
    (currentRows || []).map((item: { environment: string; key: string; version: number }) => [
      `${item.environment}:${item.key.toLowerCase()}`,
      item.version,
    ]),
  );
  rows = rows.map((row) => ({
    ...row,
    version: (versionByKey.get(`${row.environment}:${String(row.key).toLowerCase()}`) || 0) + 1,
  }));

  const { data, error } = await supabase
    .from("hosting_vps_env_vars")
    .upsert(
      rows,
      { onConflict: "hosting_project_id,environment,key" },
    )
    .select("id, environment, key, value_preview, visible_value, note, sensitive, version, updated_at")
    .returns<Array<{
      id: number;
      environment: string;
      key: string;
      value_preview: string | null;
      visible_value: string | null;
      note: string | null;
      sensitive: boolean;
      version: number;
      updated_at: string;
    }>>();

  if (error) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: error.message }, { status: 500 }),
    );
  }

  await appendVpsEvent({
    projectId: loaded.project.id,
    userId: loaded.session.user.id,
    action: "env_update",
    status: "succeeded",
    message: `${normalizedVariables.length} variavel(is) atualizada(s).`,
    requestPayload: {
      count: normalizedVariables.length,
      environments: [...new Set(normalizedVariables.map((item) => item.environment))],
      keys: normalizedVariables.map((item) => item.key),
    },
  });

  await requestVpsAgent({
    project: loaded.project,
    method: "POST",
    path: `/v1/vps/${loaded.project.vps_code}/env`,
    body: {
      variables: normalizedVariables.map((item) => ({
        environment: item.environment,
        key: item.key,
        value: item.value,
        sensitive: item.sensitive,
      })),
    },
    timeoutMs: Math.min(30_000, 8_000 + normalizedVariables.length * 120),
  }).catch(() => null);

  return applyNoStoreHeaders(
    NextResponse.json({
      ok: true,
      envVar: data?.[0] || null,
      envVars: data || [],
      count: data?.length || 0,
    }),
  );
}

export async function DELETE(request: NextRequest, { params }: RouteProps) {
  const { code } = await params;
  const loaded = await load(code);
  if (!loaded) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "VPS nao encontrada." }, { status: 404 }),
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "number" && Number.isFinite(body.id) ? body.id : null;
  const environment = normalizeEnvironment(body.environment);
  const key = readString(body.key);

  let query = getSupabaseAdminClientOrThrow()
    .from("hosting_vps_env_vars")
    .delete()
    .eq("hosting_project_id", loaded.project.id);

  if (id) query = query.eq("id", id);
  else if (environment && key) query = query.eq("environment", environment).eq("key", key);
  else {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "Variavel invalida." }, { status: 400 }),
    );
  }

  const { error } = await query;
  if (error) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: error.message }, { status: 500 }),
    );
  }

  await appendVpsEvent({
    projectId: loaded.project.id,
    userId: loaded.session.user.id,
    action: "env_update",
    status: "succeeded",
    message: `Variavel ${key || id} removida.`,
  });

  return applyNoStoreHeaders(NextResponse.json({ ok: true }));
}
