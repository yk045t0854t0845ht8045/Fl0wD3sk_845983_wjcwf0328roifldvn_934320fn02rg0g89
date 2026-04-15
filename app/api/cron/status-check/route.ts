import { NextResponse } from "next/server";
import {
  checkApiStatus,
  checkDiscordBotStatus,
  checkDomainsStatus,
  checkFlowAiStatus,
  checkScheduledTasksStatus,
  stabilizeFlowAiStatusResponse,
  stabilizeStatusCheckResult,
} from "@/lib/status/monitors";
import { generateIncidentInvestigationNote } from "@/lib/status/intelligence";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import type { SystemStatus } from "@/lib/status/types";

/**
 * GET /api/cron/status-check
 * Runs all service health checks, applies a strikes-based stability gate,
 * updates component statuses in DB, and records daily history with immutable
 * severity (the worst status of the day survives, never regresses to operational).
 *
 * Protected by CRON_SECRET. Call from Vercel Cron or cron-job.org every 1-2 minutes.
 */
export const maxDuration = 60;

const STRIKE_THRESHOLD = 3; // consecutive failures before declaring outage

// In-process strike counters (reset on deploy, but that's fine — it's a best-effort gate)
const strikeCounters: Record<string, number> = {};

function applyStrike(key: string, failed: boolean): { count: number; triggered: boolean } {
  if (failed) {
    strikeCounters[key] = (strikeCounters[key] || 0) + 1;
  } else {
    strikeCounters[key] = 0;
  }
  return { count: strikeCounters[key], triggered: strikeCounters[key] >= STRIKE_THRESHOLD };
}

type CheckEntry = {
  name: string;
  rawStatus: SystemStatus;
  stableStatus: SystemStatus;
  latencyMs: number | null;
  message: string | null;
};

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const now = new Date();
  const dateIso = now.toISOString().slice(0, 10);

  try {
    // Run all checks in parallel
    const [apiResult, flowAiResult, scheduledResult, domainsResult, discordResult] =
      await Promise.allSettled([
        checkApiStatus(),
        checkFlowAiStatus(),
        checkScheduledTasksStatus(),
        checkDomainsStatus(),
        checkDiscordBotStatus(),
      ]);

    const api = apiResult.status === "fulfilled" ? apiResult.value : null;
    const flowAi = flowAiResult.status === "fulfilled" ? flowAiResult.value : null;
    const scheduled = scheduledResult.status === "fulfilled" ? scheduledResult.value : null;
    const domains = domainsResult.status === "fulfilled" ? domainsResult.value : null;
    const discord = discordResult.status === "fulfilled" ? discordResult.value : null;

    const apiStable = api ? stabilizeStatusCheckResult("api", api) : null;
    const flowAiStable = flowAi ? stabilizeFlowAiStatusResponse(flowAi) : null;
    const scheduledStable = scheduled ? stabilizeStatusCheckResult("scheduled_tasks", scheduled) : null;
    const domainsStable = domains ? stabilizeStatusCheckResult("domains", domains) : null;
    const discordStable = discord ? stabilizeStatusCheckResult("discord", discord) : null;

    const checks: Array<{ key: string; componentName: string; status: SystemStatus; latencyMs: number | null; message: string | null }> = [
      {
        key: "api",
        componentName: "API",
        status: apiStable?.status || "degraded_performance",
        latencyMs: apiStable?.latencyMs ?? null,
        message: apiStable?.message ?? null,
      },
      {
        key: "flowai",
        componentName: "Flow AI",
        status: flowAiStable?.overall.status || "degraded_performance",
        latencyMs: flowAiStable?.overall.latencyMs ?? null,
        message: flowAiStable?.overall.message ?? null,
      },
      {
        key: "scheduled_tasks",
        componentName: "Tarefas agendadas",
        status: scheduledStable?.status || "operational",
        latencyMs: scheduledStable?.latencyMs ?? null,
        message: scheduledStable?.message ?? null,
      },
      {
        key: "domains",
        componentName: "Registro de domínio",
        status: domainsStable?.status || "operational",
        latencyMs: domainsStable?.latencyMs ?? null,
        message: domainsStable?.message ?? null,
      },
      {
        key: "discord",
        componentName: "DISCORD BOT",
        status: discordStable?.status || "degraded_performance",
        latencyMs: discordStable?.latencyMs ?? null,
        message: discordStable?.message ?? null,
      },
    ];

    const results: CheckEntry[] = [];

    for (const check of checks) {
      const isFailing = check.status !== "operational" && check.status !== "degraded_performance";
      const isDegraded = check.status === "degraded_performance";
      const { triggered } = applyStrike(check.key, isFailing);

      // Apply strikes gate: only escalate to partial_outage/major_outage after threshold
      let finalStatus: SystemStatus = check.status;
      if (isFailing && !triggered) {
        // Downgrade to degraded until threshold is hit
        finalStatus = "degraded_performance";
      }
      if (!isFailing && !isDegraded) {
        finalStatus = "operational";
      }

      results.push({
        name: check.componentName,
        rawStatus: check.status,
        stableStatus: finalStatus,
        latencyMs: check.latencyMs,
        message: check.message,
      });
    }

    // Persist to DB
    for (const result of results) {
      const { data: comp } = await supabase
        .from("system_components")
        .select("id")
        .eq("name", result.name)
        .single();

      if (!comp) continue;

      // Update current component status
      await supabase
        .from("system_components")
        .update({
          status: result.stableStatus,
          updated_at: now.toISOString(),
        })
        .eq("id", comp.id);

      // Upsert daily history — the DB trigger will preserve the worst status of the day
      await supabase.from("system_status_history").upsert(
        {
          component_id: comp.id,
          recorded_at: dateIso,
          status: result.stableStatus,
        },
        { onConflict: "component_id,recorded_at" }
      );

      // Record raw ping
      await supabase.from("system_health_pings").insert({
        component_name: result.name,
        status: result.rawStatus,
        latency_ms: result.latencyMs,
      });
    }

    // Auto-create incident if a strike-threshold outage was detected  
    const outages = results.filter(r => r.rawStatus === "major_outage");
    if (outages.length > 0) {
      const investigationNote = await generateIncidentInvestigationNote(
        outages.map((outage) => ({
          name: outage.name,
          status: outage.rawStatus,
          latencyMs: outage.latencyMs,
          detail: outage.message,
        })),
      );
      const openaiKey = "";
      const openaiBase = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
      const model = process.env.OPENAI_STATUS_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

      let title = `Falha crítica detectada em: ${outages.map(o => o.name).join(", ")}`;
      let message = `Nossa equipe detectou indisponibilidade em ${outages.map(o => o.name).join(", ")} e iniciou a investigação imediata.`;

      title = investigationNote.title;
      message = investigationNote.message;

      if (openaiKey) {
        try {
          const aiRes = await fetch(`${openaiBase}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              temperature: 0.2,
              max_tokens: 200,
              messages: [
                { role: "system", content: "Você escreve comunicados de status page. Responda somente JSON com chaves title e message. Tom: profissional, transparente, sem culpar terceiros, em português do Brasil." },
                { role: "user", content: JSON.stringify({ affectedComponents: outages.map(o => ({ name: o.name, status: o.rawStatus, latencyMs: o.latencyMs, detail: o.message })), titleMaxWords: 9, messageMaxWords: 40 }) }
              ]
            }),
            cache: "no-store"
          });
          if (aiRes.ok) {
            const aiJson = await aiRes.json().catch(() => null);
            const content: string = aiJson?.choices?.[0]?.message?.content || "";
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
              const parsed = JSON.parse(match[0]) as { title?: string; message?: string };
              if (parsed.title) title = parsed.title;
              if (parsed.message) message = parsed.message;
            }
          }
        } catch { /* use fallback */ }
      }

      // Only create if no open incident exists for today
      const { data: existingToday } = await supabase
        .from("system_incidents")
        .select("id")
        .gt("created_at", `${dateIso}T00:00:00Z`)
        .neq("status", "resolved")
        .limit(1);

      if (!existingToday || existingToday.length === 0) {
        const { data: incident } = await supabase
          .from("system_incidents")
          .insert({ title, impact: "critical", status: "investigating", public_summary: message, ai_summary: message })
          .select("id")
          .single();

        if (incident) {
          // Link components
          for (const outage of outages) {
            const { data: comp } = await supabase.from("system_components").select("id").eq("name", outage.name).single();
            if (comp) {
              await supabase.from("system_incident_components").insert({ incident_id: incident.id, component_id: comp.id });
            }
          }
          await supabase.from("system_incident_updates").insert({ incident_id: incident.id, status: "investigating", message });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      checkedAt: now.toISOString(),
      results: results.map(r => ({ name: r.name, rawStatus: r.rawStatus, stableStatus: r.stableStatus, latencyMs: r.latencyMs })),
    });

  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Erro desconhecido no status-check cron."
    }, { status: 500 });
  }
}
