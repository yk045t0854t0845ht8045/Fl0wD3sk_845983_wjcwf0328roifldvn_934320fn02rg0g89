import { NextResponse } from "next/server";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { generateIncidentSummary } from "@/lib/status/intelligence";

/**
 * POST /api/admin/backfill-incidents
 * Reads historical status anomalies with no linked incident and generates
 * AI-written incident reports for each one.
 * Protected by CRON_SECRET.
 */
export async function POST(req: Request) {
  const secret = req.headers.get("x-admin-token") || "";
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const openaiKey = "";
  const openaiBase = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_STATUS_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  try {
    // 1. Load all non-operational history entries from the last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);

    const { data: anomalies, error: histErr } = await supabase
      .from("system_status_history")
      .select("id, component_id, status, recorded_at, system_components(name)")
      .neq("status", "operational")
      .gte("recorded_at", ninetyDaysAgo.toISOString().slice(0, 10))
      .order("recorded_at", { ascending: false });

    if (histErr) throw histErr;
    if (!anomalies || anomalies.length === 0) {
      return NextResponse.json({ ok: true, message: "Nenhuma anomalia historica encontrada." });
    }

    // 2. Load existing incidents to avoid duplicates by date+component
    const { data: existingIncidents } = await supabase
      .from("system_incidents")
      .select("id, created_at, system_incident_components(component_id)")
      .gte("created_at", ninetyDaysAgo.toISOString());

    const existingKeys = new Set<string>();
    for (const inc of existingIncidents || []) {
      const day = inc.created_at?.slice(0, 10);
      for (const link of (inc as Record<string, unknown[]>).system_incident_components as Array<{ component_id: string }> || []) {
        existingKeys.add(`${day}::${link.component_id}`);
      }
    }

    // 3. Group anomalies by date
    const byDate = new Map<string, Array<{ component_id: string; name: string; status: string }>>();
    for (const row of anomalies) {
      const day = (row.recorded_at as string).slice(0, 10);
      const compName = (row.system_components as unknown as { name: string } | null)?.name || "Componente desconhecido";
      const key = `${day}::${row.component_id}`;
      if (existingKeys.has(key)) continue;
      const list = byDate.get(day) || [];
      if (!list.find(l => l.component_id === row.component_id)) {
        list.push({ component_id: row.component_id, name: compName, status: row.status });
      }
      byDate.set(day, list);
    }

    if (byDate.size === 0) {
      return NextResponse.json({ ok: true, message: "Todos os incidentes historicos ja existem." });
    }

    let created = 0;

    // 4. For each unique date group, generate AI narrative and persist
    for (const [day, components] of byDate.entries()) {
      const worstStatus = components.reduce((worst, c) => {
        const rank: Record<string, number> = { operational: 0, degraded_performance: 1, partial_outage: 2, major_outage: 3 };
        return rank[c.status] > rank[worst] ? c.status : worst;
      }, "operational");

      const impact: "critical" | "warning" | "info" =
        worstStatus === "major_outage" ? "critical" :
        worstStatus === "partial_outage" ? "warning" : "info";

      const dayLabel = new Date(day + "T12:00:00Z").toLocaleDateString("pt-BR", {
        day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
      });

      // Generate AI narrative
      let title = `Anomalia detectada em ${components.map(c => c.name).join(", ")} — ${dayLabel}`;
      let summary = `Em ${dayLabel}, identificamos instabilidade em ${components.map(c => c.name).join(", ")}. A equipe monitorou e a situação foi normalizada.`;
      let updateMessage = summary;
      const aiNarrative = await generateIncidentSummary(
        day,
        components.map((component) => ({
          name: component.name,
          status: component.status,
        })),
      );

      title = aiNarrative.title;
      summary = aiNarrative.summary;
      updateMessage = aiNarrative.updateMessage;

      if (openaiKey) {
        try {
          const aiRes = await fetch(`${openaiBase}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              temperature: 0.35,
              max_tokens: 320,
              messages: [
                {
                  role: "system",
                  content: "Você escreve relatórios de incidentes de plataforma. Responda somente JSON com as chaves title, summary, updateMessage. Tom: profissional, transparente, claro, sem culpar terceiros, em português do Brasil."
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    objective: "Gerar um incidente de status page completo para falha historica detectada.",
                    date: dayLabel,
                    affectedComponents: components.map(c => ({ name: c.name, status: c.status })),
                    instructions: {
                      title: "Titulo do incidente, maximo 10 palavras, descritivo.",
                      summary: "Resumo publico do incidente em 2-3 frases: o que ocorreu, impacto e como foi resolvido. Maximo 60 palavras.",
                      updateMessage: "Mensagem de update final (resolved): detalhes tecnicos simples, o que a equipe fez para corrigir, quando foi resolvido. Maximo 55 palavras."
                    }
                  }, null, 2)
                }
              ]
            }),
            cache: "no-store"
          });

          if (aiRes.ok) {
            const aiJson = await aiRes.json().catch(() => null);
            const content: string = aiJson?.choices?.[0]?.message?.content || "";
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]) as { title?: string; summary?: string; updateMessage?: string };
              if (parsed.title) title = parsed.title;
              if (parsed.summary) summary = parsed.summary;
              if (parsed.updateMessage) updateMessage = parsed.updateMessage;
            }
          }
        } catch {
          // Use fallback text
        }
      }

      // Persist incident
      const incidentTime = `${day}T12:00:00Z`;
      const { data: incident, error: incErr } = await supabase
        .from("system_incidents")
        .insert({
          title,
          impact,
          status: "resolved",
          public_summary: summary,
          ai_summary: summary,
          created_at: incidentTime,
          updated_at: incidentTime,
        })
        .select("id")
        .single();

      if (incErr || !incident) continue;

      // Link components
      await supabase.from("system_incident_components").insert(
        components.map(c => ({ incident_id: incident.id, component_id: c.component_id }))
      );

      // Insert a resolved update
      await supabase.from("system_incident_updates").insert({
        incident_id: incident.id,
        status: "resolved",
        message: updateMessage,
        created_at: `${day}T23:59:00Z`,
      });

      // Insert initial investigating update
      await supabase.from("system_incident_updates").insert({
        incident_id: incident.id,
        status: "investigating",
        message: `Nossa equipe de monitoramento identificou instabilidade em ${components.map(c => c.name).join(", ")} e iniciou a investigação.`,
        created_at: `${day}T12:00:00Z`,
      });

      created++;
    }

    return NextResponse.json({ ok: true, created, total: byDate.size });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Erro interno no backfill."
    }, { status: 500 });
  }
}
