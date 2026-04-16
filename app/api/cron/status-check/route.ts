import { NextResponse } from "next/server";
import { generateIncidentInvestigationNote } from "@/lib/status/intelligence";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  collectLiveStatusSnapshot,
  inferComponentSourceKey,
  type MonitorSignal,
} from "@/lib/status/service";
import { buildResolvedUpdateFromContext, buildTextSignature } from "@/lib/status/copy";
import type { IncidentStatus, SystemStatus } from "@/lib/status/types";

export const maxDuration = 60;

type ComponentRow = {
  id: string;
  name: string;
};

type EvaluatedComponent = {
  id: string;
  name: string;
  sourceKey: string;
  signal: MonitorSignal;
};

type OpenIncidentRow = {
  id: string;
  status: IncidentStatus;
  impact: "critical" | "warning" | "info";
  public_summary?: string | null;
  signal_snapshot?: { signature?: string | null } | null;
  system_incident_components?: Array<{ component_id?: string | null }> | null;
  updates?: Array<{
    id: string;
    status: IncidentStatus;
    message: string;
    created_at: string;
  }> | null;
};

// Apenas partial_outage e major_outage criam incidentes.
// degraded_performance sozinho é WARNING, não gera card nem alerta crítico.
function isVisibleIncidentStatus(status: SystemStatus) {
  return status === "partial_outage" || status === "major_outage";
}

function isMissingOptionalComponentColumnError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String((error as { message?: string })?.message || error || "");
  return /status_message|last_checked_at|last_raw_status|last_raw_checked_at|latency_ms|source_key/i.test(
    message,
  );
}

function isMissingMonitorSnapshotError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String((error as { message?: string })?.message || error || "");
  return /system_status_monitor_snapshots|stable_status|component_name|component_id/i.test(message);
}

function isMissingIncidentSignalSnapshotError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String((error as { message?: string })?.message || error || "");
  return /signal_snapshot/i.test(message);
}

function isMissingDailyLockTableError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String((error as { message?: string })?.message || error || "");
  // Tabela não existe ou coluna day_key não existe
  return /system_incident_daily_lock|day_key/i.test(message);
}

function hasMatchingIncidentUpdate(
  incident: OpenIncidentRow | null,
  message: string,
  status: IncidentStatus,
) {
  if (!incident?.updates?.length) return false;
  const signature = buildTextSignature(message);
  return incident.updates.some(
    (update) =>
      update.status === status &&
      buildTextSignature(update.message) === signature,
  );
}

function buildIncidentEvidence(components: EvaluatedComponent[], checkedAt: string) {
  const normalized = components
    .map((component) => ({
      componentId: component.id,
      componentName: component.name,
      sourceKey: component.sourceKey,
      status: component.signal.status,
      message: component.signal.message || null,
      latencyMs: component.signal.latencyMs ?? null,
      checkedAt: component.signal.checkedAt || checkedAt,
    }))
    .sort((left, right) => left.componentName.localeCompare(right.componentName));

  return {
    checkedAt,
    signature: normalized
      .map((component) =>
        [
          component.componentId,
          component.sourceKey,
          component.status,
          buildTextSignature(component.message || ""),
        ].join("|"),
      )
      .join("::"),
    components: normalized,
  };
}

async function persistComponentState(
  supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>,
  component: ComponentRow,
  sourceKey: string,
  signal: MonitorSignal,
  checkedAt: string,
) {
  const payload = {
    status: signal.status,
    latency_ms: signal.latencyMs,
    source_key: sourceKey,
    status_message: signal.message,
    last_checked_at: signal.checkedAt || checkedAt,
    last_raw_status: signal.status,
    last_raw_checked_at: signal.checkedAt || checkedAt,
    updated_at: checkedAt,
  };

  const fullUpdate = await supabase
    .from("system_components")
    .update(payload)
    .eq("id", component.id);

  if (!fullUpdate.error) return;
  if (!isMissingOptionalComponentColumnError(fullUpdate.error)) throw fullUpdate.error;

  const reducedUpdate = await supabase
    .from("system_components")
    .update({
      status: signal.status,
      latency_ms: signal.latencyMs,
      source_key: sourceKey,
      updated_at: checkedAt,
    })
    .eq("id", component.id);

  if (!reducedUpdate.error) return;
  if (!isMissingOptionalComponentColumnError(reducedUpdate.error)) throw reducedUpdate.error;

  const finalUpdate = await supabase
    .from("system_components")
    .update({ status: signal.status, updated_at: checkedAt })
    .eq("id", component.id);

  if (finalUpdate.error) throw finalUpdate.error;
}

async function insertMonitorSnapshot(
  supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>,
  component: ComponentRow,
  sourceKey: string,
  signal: MonitorSignal,
  checkedAt: string,
) {
  const snapshotInsert = await supabase
    .from("system_status_monitor_snapshots")
    .insert({
      source_key: sourceKey,
      component_id: component.id,
      component_name: component.name,
      status: signal.status,
      stable_status: signal.status,
      latency_ms: signal.latencyMs,
      message: signal.message,
      observed_at: signal.checkedAt || checkedAt,
      metadata: { sourceKey },
    });

  if (snapshotInsert.error && !isMissingMonitorSnapshotError(snapshotInsert.error)) {
    throw snapshotInsert.error;
  }
}

async function persistHealthPing(
  supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>,
  component: ComponentRow,
  signal: MonitorSignal,
) {
  const pingInsert = await supabase.from("system_health_pings").insert({
    component_name: component.name,
    status: signal.status,
    latency_ms: signal.latencyMs,
  });

  if (pingInsert.error) throw pingInsert.error;
}

async function loadOpenIncidents(supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>) {
  const result = await supabase
    .from("system_incidents")
    .select(
      "id, status, impact, public_summary, signal_snapshot, system_incident_components(component_id), updates:system_incident_updates(id, status, message, created_at)",
    )
    .neq("status", "resolved")
    .order("created_at", { ascending: false });

  if (result.error) {
    if (isMissingIncidentSignalSnapshotError(result.error)) {
      const fallback = await supabase
        .from("system_incidents")
        .select(
          "id, status, impact, public_summary, system_incident_components(component_id), updates:system_incident_updates(id, status, message, created_at)",
        )
        .neq("status", "resolved")
        .order("created_at", { ascending: false });

      if (fallback.error) throw fallback.error;
      return (fallback.data || []) as OpenIncidentRow[];
    }
    throw result.error;
  }

  return (result.data || []) as OpenIncidentRow[];
}

/**
 * Busca o incidente do dia via tabela de lock.
 * Fallback: se a tabela não existir, busca direto em system_incidents pela data.
 * Garante sempre 1 incidente por dia, mesmo sem a migration rodada.
 */
async function loadDailyLockedIncident(
  supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>,
  dayKey: string,
): Promise<OpenIncidentRow | null> {
  // Tenta pela tabela de lock primeiro
  const lockResult = await supabase
    .from("system_incident_daily_lock")
    .select("incident_id")
    .eq("day_key", dayKey)
    .maybeSingle();

  if (lockResult.error && !isMissingDailyLockTableError(lockResult.error)) {
    throw lockResult.error;
  }

  // Se achou o lock, busca o incidente pelo ID registrado
  if (!lockResult.error && lockResult.data?.incident_id) {
    const incidentResult = await supabase
      .from("system_incidents")
      .select(
        "id, status, impact, public_summary, signal_snapshot, system_incident_components(component_id), updates:system_incident_updates(id, status, message, created_at)",
      )
      .eq("id", lockResult.data.incident_id)
      .maybeSingle();

    if (incidentResult.error && !isMissingIncidentSignalSnapshotError(incidentResult.error)) {
      throw incidentResult.error;
    }
    if (incidentResult.data) {
      return incidentResult.data as OpenIncidentRow;
    }
  }

  // Fallback: tabela de lock não existe ou não tem entrada — busca diretamente por data
  // Isso evita duplicatas mesmo antes da migration 081 ser executada
  const directResult = await supabase
    .from("system_incidents")
    .select(
      "id, status, impact, public_summary, signal_snapshot, system_incident_components(component_id), updates:system_incident_updates(id, status, message, created_at)",
    )
    .gte("created_at", `${dayKey}T00:00:00Z`)
    .lt("created_at", `${dayKey}T23:59:59Z`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (directResult.error) {
    if (isMissingIncidentSignalSnapshotError(directResult.error)) {
      const fallback = await supabase
        .from("system_incidents")
        .select(
          "id, status, impact, public_summary, system_incident_components(component_id), updates:system_incident_updates(id, status, message, created_at)",
        )
        .gte("created_at", `${dayKey}T00:00:00Z`)
        .lt("created_at", `${dayKey}T23:59:59Z`)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      return (fallback.data as OpenIncidentRow) || null;
    }
    throw directResult.error;
  }

  return (directResult.data as OpenIncidentRow) || null;
}

/**
 * Registra o incidente na tabela de lock.
 * Usa upsert para ser idempotente — se já existe, apenas confirma.
 */
async function registerDailyLock(
  supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>,
  dayKey: string,
  incidentId: string,
) {
  const result = await supabase
    .from("system_incident_daily_lock")
    .upsert(
      { day_key: dayKey, incident_id: incidentId, updated_at: new Date().toISOString() },
      { onConflict: "day_key", ignoreDuplicates: false },
    );

  // Ignora silenciosamente se a tabela não existir ainda
  if (result.error && !isMissingDailyLockTableError(result.error)) {
    console.warn("[status-check] Aviso ao registrar daily lock:", result.error.message);
  }
}

async function replaceIncidentLinks(
  supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>,
  incidentId: string,
  componentIds: string[],
) {
  const deleteResult = await supabase
    .from("system_incident_components")
    .delete()
    .eq("incident_id", incidentId);

  if (deleteResult.error) throw deleteResult.error;
  if (!componentIds.length) return;

  const insertResult = await supabase.from("system_incident_components").insert(
    componentIds.map((componentId) => ({
      incident_id: incidentId,
      component_id: componentId,
    })),
  );

  if (insertResult.error) throw insertResult.error;
}

async function createIncident(
  supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>,
  payload: {
    title: string;
    impact: "critical" | "warning";
    message: string;
    evidence: ReturnType<typeof buildIncidentEvidence>;
    checkedAt: string;
  },
) {
  const preferredInsert = await supabase
    .from("system_incidents")
    .insert({
      title: payload.title,
      impact: payload.impact,
      status: "investigating",
      public_summary: payload.message,
      ai_summary: payload.message,
      signal_snapshot: payload.evidence,
      created_at: payload.checkedAt,
      updated_at: payload.checkedAt,
    })
    .select("id")
    .single();

  if (!preferredInsert.error) return preferredInsert.data;

  if (!isMissingIncidentSignalSnapshotError(preferredInsert.error)) {
    throw preferredInsert.error;
  }

  const fallbackInsert = await supabase
    .from("system_incidents")
    .insert({
      title: payload.title,
      impact: payload.impact,
      status: "investigating",
      public_summary: payload.message,
      ai_summary: payload.message,
      created_at: payload.checkedAt,
      updated_at: payload.checkedAt,
    })
    .select("id")
    .single();

  if (fallbackInsert.error) throw fallbackInsert.error;
  return fallbackInsert.data;
}

async function updateIncident(
  supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>,
  incidentId: string,
  payload: {
    title: string;
    impact: "critical" | "warning";
    message: string;
    evidence: ReturnType<typeof buildIncidentEvidence>;
    checkedAt: string;
    status?: IncidentStatus;
  },
) {
  const preferredUpdate = await supabase
    .from("system_incidents")
    .update({
      title: payload.title,
      impact: payload.impact,
      status: payload.status || "investigating",
      public_summary: payload.message,
      ai_summary: payload.message,
      signal_snapshot: payload.evidence,
      updated_at: payload.checkedAt,
    })
    .eq("id", incidentId);

  if (!preferredUpdate.error) return;
  if (!isMissingIncidentSignalSnapshotError(preferredUpdate.error)) throw preferredUpdate.error;

  const fallbackUpdate = await supabase
    .from("system_incidents")
    .update({
      title: payload.title,
      impact: payload.impact,
      status: payload.status || "investigating",
      public_summary: payload.message,
      ai_summary: payload.message,
      updated_at: payload.checkedAt,
    })
    .eq("id", incidentId);

  if (fallbackUpdate.error) throw fallbackUpdate.error;
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClientOrThrow();

  try {
    const snapshot = await collectLiveStatusSnapshot();
    const checkedAt = snapshot.checkedAt;
    const dateIso = checkedAt.slice(0, 10); // 'YYYY-MM-DD'

    const { data: componentRows, error: componentError } = await supabase
      .from("system_components")
      .select("id, name")
      .order("display_order", { ascending: true });

    if (componentError) throw componentError;

    const evaluatedComponents: EvaluatedComponent[] = ((componentRows || []) as ComponentRow[])
      .map((component) => {
        const sourceKey = inferComponentSourceKey(component.name);
        const signal = sourceKey ? snapshot.signals[sourceKey] : null;
        if (!sourceKey || !signal) return null;

        return { id: component.id, name: component.name, sourceKey, signal };
      })
      .filter((component): component is EvaluatedComponent => Boolean(component));

    for (const component of evaluatedComponents) {
      await persistComponentState(
        supabase,
        { id: component.id, name: component.name },
        component.sourceKey,
        component.signal,
        checkedAt,
      );

      await supabase.from("system_status_history").upsert(
        {
          component_id: component.id,
          recorded_at: dateIso,
          status: component.signal.status,
        },
        { onConflict: "component_id,recorded_at" },
      );

      await persistHealthPing(
        supabase,
        { id: component.id, name: component.name },
        component.signal,
      );

      await insertMonitorSnapshot(
        supabase,
        { id: component.id, name: component.name },
        component.sourceKey,
        component.signal,
        checkedAt,
      );
    }

    // ─── Identifica componentes com problema ─────────────────────────────────
    const activeComponents = evaluatedComponents.filter((component) =>
      isVisibleIncidentStatus(component.signal.status),
    );

    // ─── GUARDIÃO PRINCIPAL: busca o incidente DO DIA pelo lock de banco ──────
    // Isso garante 1 único card por dia independente de quantas vezes o cron rodar.
    const lockedIncident = await loadDailyLockedIncident(supabase, dateIso);

    // Também carrega incidentes abertos para o fluxo de resolução
    const openIncidents = lockedIncident
      ? [lockedIncident].filter((i) => i.status !== "resolved")
      : await loadOpenIncidents(supabase);

    // ─── Tudo operacional: resolver incidentes abertos ────────────────────────
    if (!activeComponents.length) {
      const incidentsToResolve = lockedIncident
        ? lockedIncident.status !== "resolved" ? [lockedIncident] : []
        : openIncidents;

      for (const incident of incidentsToResolve) {
        const linkedComponentIds = (incident.system_incident_components || [])
          .map((link) => String(link.component_id || "").trim())
          .filter(Boolean);

        const linkedNames = evaluatedComponents
          .filter((component) => linkedComponentIds.includes(component.id))
          .map((component) => component.name);

        const resolvedMessage = buildResolvedUpdateFromContext(
          linkedNames.length ? linkedNames : ["os componentes afetados"],
        );

        await supabase
          .from("system_incidents")
          .update({ status: "resolved", updated_at: checkedAt })
          .eq("id", incident.id);

        if (!hasMatchingIncidentUpdate(incident, resolvedMessage, "resolved")) {
          // Atualiza o único update existente para "resolved" em vez de criar novo
          const existingUpdateId = incident.updates?.[0]?.id;
          if (existingUpdateId) {
            await supabase
              .from("system_incident_updates")
              .update({ status: "resolved", message: resolvedMessage, created_at: checkedAt })
              .eq("id", existingUpdateId);
          } else {
            await supabase.from("system_incident_updates").insert({
              incident_id: incident.id,
              status: "resolved",
              message: resolvedMessage,
              created_at: checkedAt,
            });
          }
        }
      }

      return NextResponse.json(
        {
          ok: true,
          checkedAt,
          incidents: {
            active: 0,
            lockedIncidentId: lockedIncident?.id || null,
            action: incidentsToResolve.length ? "resolved" : "all_ok",
          },
          results: evaluatedComponents.map((component) => ({
            name: component.name,
            sourceKey: component.sourceKey,
            status: component.signal.status,
            latencyMs: component.signal.latencyMs,
          })),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // ─── Há problemas: calcular evidência ────────────────────────────────────
    const impact: "critical" | "warning" =
      activeComponents.some((component) => component.signal.status === "major_outage")
        ? "critical"
        : "warning";
    const evidence = buildIncidentEvidence(activeComponents, checkedAt);

    // ─── ANTI-DUPLICATA: se já tem o incidente do dia e a assinatura não mudou → não faz nada ──
    if (lockedIncident) {
      const previousSignature = String(lockedIncident.signal_snapshot?.signature || "");
      if (previousSignature === evidence.signature) {
        return NextResponse.json(
          {
            ok: true,
            checkedAt,
            incidents: {
              active: activeComponents.length,
              lockedIncidentId: lockedIncident.id,
              action: "no_changes",
            },
            results: evaluatedComponents.map((component) => ({
              name: component.name,
              sourceKey: component.sourceKey,
              status: component.signal.status,
              latencyMs: component.signal.latencyMs,
            })),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    // ─── Só chama IA se há mudança real (economiza tokens) ───────────────────
    const note = await generateIncidentInvestigationNote(
      activeComponents.map((component) => ({
        name: component.name,
        status: component.signal.status,
        latencyMs: component.signal.latencyMs ?? null,
        detail: component.signal.message,
      })),
    );

    if (!lockedIncident) {
      // ─── CRIA 1 único card para o dia ─────────────────────────────────────
      const createdIncident = await createIncident(supabase, {
        title: note.title,
        impact,
        message: note.message,
        evidence,
        checkedAt,
      });

      await replaceIncidentLinks(
        supabase,
        createdIncident.id,
        activeComponents.map((component) => component.id),
      );

      await supabase.from("system_incident_updates").insert({
        incident_id: createdIncident.id,
        status: "investigating",
        message: note.message,
        created_at: checkedAt,
      });

      // Registra o lock no banco — a partir daqui nenhum outro card será criado hoje
      await registerDailyLock(supabase, dateIso, createdIncident.id);
    } else {
      // ─── REUTILIZA o card do dia (nunca cria outro) ────────────────────────
      await updateIncident(supabase, lockedIncident.id, {
        title: note.title,
        impact,
        message: note.message,
        evidence,
        checkedAt,
        status: "investigating",
      });

      await replaceIncidentLinks(
        supabase,
        lockedIncident.id,
        activeComponents.map((component) => component.id),
      );

      // Edita o update único existente em vez de inserir um novo
      const existingUpdateId = lockedIncident.updates?.[0]?.id;
      if (existingUpdateId) {
        await supabase
          .from("system_incident_updates")
          .update({ message: note.message, created_at: checkedAt, status: "investigating" })
          .eq("id", existingUpdateId);
      } else {
        await supabase.from("system_incident_updates").insert({
          incident_id: lockedIncident.id,
          status: "investigating",
          message: note.message,
          created_at: checkedAt,
        });
      }
    }

    return NextResponse.json(
      {
        ok: true,
        checkedAt,
        incidents: {
          active: activeComponents.length,
          lockedIncidentId: lockedIncident?.id || "just_created",
          action: lockedIncident ? "updated_existing" : "created_new",
        },
        results: evaluatedComponents.map((component) => ({
          name: component.name,
          sourceKey: component.sourceKey,
          status: component.signal.status,
          latencyMs: component.signal.latencyMs,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido no status-check cron.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
