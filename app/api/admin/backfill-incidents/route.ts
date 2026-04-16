import { NextResponse } from "next/server";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { generateIncidentSummary } from "@/lib/status/intelligence";
import { buildTextSignature } from "@/lib/status/copy";
import { inferComponentSourceKey } from "@/lib/status/service";
import type { SystemStatus } from "@/lib/status/types";

const VISIBLE_ERROR_STATUSES: SystemStatus[] = ["partial_outage", "major_outage"];

function getStatusWeight(status: SystemStatus) {
  if (status === "major_outage") return 3;
  if (status === "partial_outage") return 2;
  if (status === "degraded_performance") return 1;
  return 0;
}

function isVisibleErrorStatus(status: string | null | undefined): status is SystemStatus {
  return VISIBLE_ERROR_STATUSES.includes((status || "") as SystemStatus);
}

function isMissingMonitorSnapshotRelation(error: unknown) {
  const message =
    error instanceof Error ? error.message : String((error as { message?: string })?.message || error || "");
  return /system_status_monitor_snapshots|stable_status|source_key|signal_snapshot/i.test(message);
}

async function loadDayEvidence(
  supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>,
  sourceKey: string,
  day: string,
) {
  const dayStart = `${day}T00:00:00Z`;
  const nextDay = new Date(`${day}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const snapshotResult = await supabase
    .from("system_status_monitor_snapshots")
    .select("status, stable_status, message, observed_at")
    .eq("source_key", sourceKey)
    .gte("observed_at", dayStart)
    .lt("observed_at", nextDay.toISOString())
    .order("observed_at", { ascending: true });

  if (snapshotResult.error) {
    if (isMissingMonitorSnapshotRelation(snapshotResult.error)) {
      return null;
    }
    throw snapshotResult.error;
  }

  const rows = (snapshotResult.data || []) as Array<{
    status?: SystemStatus | null;
    stable_status?: SystemStatus | null;
    message?: string | null;
    observed_at?: string | null;
  }>;

  const visibleRows = rows.filter((row) =>
    isVisibleErrorStatus(row.stable_status || row.status || null),
  );

  const bestStatus = visibleRows.reduce<SystemStatus>(
    (worst, row) => {
      const candidate = (row.stable_status || row.status || "operational") as SystemStatus;
      return getStatusWeight(candidate) > getStatusWeight(worst) ? candidate : worst;
    },
    "operational",
  );

  const confirmed =
    visibleRows.length >= 2 ||
    visibleRows.some((row) => (row.stable_status || row.status) === "major_outage");

  return {
    confirmed,
    bestStatus,
    noteCount: visibleRows.length,
    evidenceNotes: visibleRows
      .map((row) => String(row.message || "").trim())
      .filter(Boolean)
      .filter(
        (message, index, collection) =>
          collection.findIndex(
            (value) => buildTextSignature(value) === buildTextSignature(message),
          ) === index,
      )
      .slice(0, 3),
    observedAt: visibleRows[0]?.observed_at || null,
  };
}

/**
 * POST /api/admin/backfill-incidents
 * Backfills only historical incidents that have visible error evidence
 * in both the daily status squares and the raw monitor snapshots of the same day.
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-admin-token") || "";
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClientOrThrow();

  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);

    const { data: anomalies, error: histErr } = await supabase
      .from("system_status_history")
      .select("component_id, status, recorded_at, system_components(name, source_key)")
      .in("status", VISIBLE_ERROR_STATUSES)
      .gte("recorded_at", ninetyDaysAgo.toISOString().slice(0, 10))
      .order("recorded_at", { ascending: false });

    if (histErr) throw histErr;
    if (!anomalies || anomalies.length === 0) {
      return NextResponse.json({ ok: true, message: "Nenhum erro historico confirmado nos quadradinhos." });
    }

    const { data: existingIncidents } = await supabase
      .from("system_incidents")
      .select("id, created_at, system_incident_components(component_id)")
      .gte("created_at", ninetyDaysAgo.toISOString());

    const existingKeys = new Set<string>();
    for (const incident of existingIncidents || []) {
      const day = incident.created_at?.slice(0, 10);
      for (const link of ((incident as Record<string, unknown[]>).system_incident_components as Array<{ component_id: string }>) || []) {
        existingKeys.add(`${day}::${link.component_id}`);
      }
    }

    const evidenceCache = new Map<string, Awaited<ReturnType<typeof loadDayEvidence>>>();
    const confirmedByDay = new Map<
      string,
      Array<{ component_id: string; name: string; status: SystemStatus; evidenceNotes: string[] }>
    >();

    for (const row of anomalies as Array<{
      component_id: string;
      status: SystemStatus;
      recorded_at: string;
      system_components?: { name?: string | null; source_key?: string | null } | null;
    }>) {
      const day = String(row.recorded_at || "").slice(0, 10);
      const componentName = String(row.system_components?.name || "Componente desconhecido").trim();
      const sourceKey =
        String(row.system_components?.source_key || "").trim() ||
        inferComponentSourceKey(componentName) ||
        "";

      if (!day || !sourceKey) continue;
      if (existingKeys.has(`${day}::${row.component_id}`)) continue;

      const cacheKey = `${sourceKey}::${day}`;
      let evidence = evidenceCache.get(cacheKey);
      if (typeof evidence === "undefined") {
        evidence = await loadDayEvidence(supabase, sourceKey, day);
        evidenceCache.set(cacheKey, evidence);
      }

      if (!evidence?.confirmed) {
        continue;
      }

      const dayEntries = confirmedByDay.get(day) || [];
      if (!dayEntries.find((entry) => entry.component_id === row.component_id)) {
        dayEntries.push({
          component_id: row.component_id,
          name: componentName,
          status:
            getStatusWeight(evidence.bestStatus) > getStatusWeight(row.status)
              ? evidence.bestStatus
              : row.status,
          evidenceNotes: evidence.evidenceNotes,
        });
      }
      confirmedByDay.set(day, dayEntries);
    }

    if (confirmedByDay.size === 0) {
      return NextResponse.json({
        ok: true,
        message: "Nenhum incidente historico foi confirmado por snapshots confiaveis do mesmo dia.",
      });
    }

    let created = 0;

    for (const [day, components] of confirmedByDay.entries()) {
      const worstStatus = components.reduce<SystemStatus>((worst, component) => {
        return getStatusWeight(component.status) > getStatusWeight(worst) ? component.status : worst;
      }, "operational");

      const impact: "critical" | "warning" | "info" =
        worstStatus === "major_outage" ? "critical" : "warning";

      const evidenceNotes = components.flatMap((component) => component.evidenceNotes).filter(
        (message, index, collection) =>
          collection.findIndex(
            (value) => buildTextSignature(value) === buildTextSignature(message),
          ) === index,
      );

      const narrative = await generateIncidentSummary(
        day,
        components.map((component) => ({
          name: component.name,
          status: component.status,
        })),
        evidenceNotes,
      );

      const incidentTime = `${day}T12:00:00Z`;
      let { data: incident, error: incidentError } = await supabase
        .from("system_incidents")
        .insert({
          title: narrative.title,
          impact,
          status: "resolved",
          public_summary: narrative.summary,
          ai_summary: narrative.summary,
          signal_snapshot: {
            origin: "historical_backfill",
            confirmedDay: day,
            evidenceNotes,
            source: "system_status_monitor_snapshots",
          },
          created_at: incidentTime,
          updated_at: incidentTime,
        })
        .select("id")
        .single();

      if (incidentError && isMissingMonitorSnapshotRelation(incidentError)) {
        const fallbackInsert = await supabase
          .from("system_incidents")
          .insert({
            title: narrative.title,
            impact,
            status: "resolved",
            public_summary: narrative.summary,
            ai_summary: narrative.summary,
            created_at: incidentTime,
            updated_at: incidentTime,
          })
          .select("id")
          .single();

        incident = fallbackInsert.data;
        incidentError = fallbackInsert.error;
      }

      if (incidentError || !incident) {
        continue;
      }

      await supabase.from("system_incident_components").insert(
        components.map((component) => ({
          incident_id: incident.id,
          component_id: component.component_id,
        })),
      );

      await supabase.from("system_incident_updates").insert({
        incident_id: incident.id,
        status: "resolved",
        message: narrative.updateMessage,
        created_at: `${day}T23:59:00Z`,
      });

      created += 1;
    }

    return NextResponse.json({
      ok: true,
      created,
      total: confirmedByDay.size,
      message: "Backfill executado apenas com incidentes historicos confirmados por erro visivel e snapshot do mesmo dia.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erro interno no backfill.",
      },
      { status: 500 },
    );
  }
}
