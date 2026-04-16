import { runFlowAiJson } from "@/lib/flowai/service";
import type { ComponentStatus, StatusTeamNote } from "./types";
import {
  buildIncidentSummaryFromContext,
  buildIncidentTitleFromContext,
  buildInvestigationUpdateFromContext,
  buildResolvedUpdateFromContext,
  finalizeIncidentSummary,
  finalizeIncidentTitle,
  finalizeIncidentUpdate,
} from "./copy";

type StatusNoteCache = {
  key: string;
  expiresAt: number;
  note: StatusTeamNote;
};

let latestStatusNoteCache: StatusNoteCache | null = null;

function buildFingerprint(criticalComponents: ComponentStatus[]) {
  return criticalComponents
    .map((component) =>
      [
        component.name,
        component.status,
        component.status_message || "",
        component.latency_ms ?? "",
      ].join("|"),
    )
    .sort()
    .join("::");
}

function buildFallbackNote(criticalComponents: ComponentStatus[]): StatusTeamNote {
  const affectedComponents = criticalComponents.map((component) => component.name);
  const topMessages = criticalComponents
    .map((component) => component.status_message)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");

  return {
    title: "Estamos investigando uma falha critica",
    description:
      finalizeIncidentSummary(
        topMessages ||
          `Detectamos indisponibilidade em ${affectedComponents.join(", ")} e iniciamos a estabilizacao do ambiente.`,
        `Detectamos indisponibilidade em ${affectedComponents.join(", ")} e iniciamos a estabilizacao do ambiente.`,
      ),
    source: "fallback",
    generated_at: new Date().toISOString(),
    affected_components: affectedComponents,
  };
}

function buildFallbackIncidentSummary(
  day: string,
  components: Array<{ name: string; status: string }>,
  evidenceNotes: string[] = [],
) {
  const componentNames = components.map((component) => component.name);
  const worstStatus =
    components.some((component) => component.status === "major_outage")
      ? "major_outage"
      : components.some((component) => component.status === "partial_outage")
        ? "partial_outage"
        : "degraded_performance";

  return {
    title: buildIncidentTitleFromContext(componentNames, worstStatus),
    summary: finalizeIncidentSummary(
      evidenceNotes[0] || buildIncidentSummaryFromContext(day, componentNames, worstStatus),
      buildIncidentSummaryFromContext(day, componentNames, worstStatus),
    ),
    updateMessage: buildResolvedUpdateFromContext(componentNames),
  };
}

export async function generateCriticalTeamNote(
  criticalComponents: ComponentStatus[],
): Promise<StatusTeamNote> {
  const fallbackNote = buildFallbackNote(criticalComponents);
  const cacheKey = buildFingerprint(criticalComponents);
  const now = Date.now();

  if (
    latestStatusNoteCache &&
    latestStatusNoteCache.key === cacheKey &&
    latestStatusNoteCache.expiresAt > now
  ) {
    return latestStatusNoteCache.note;
  }

  try {
    const result = await runFlowAiJson<{ title?: string; description?: string }>({
      taskKey: "status_note",
      temperature: 0.1,
      maxTokens: 120,
      cacheKey: `status-note:${cacheKey}`,
      cacheTtlMs: 30_000,
      messages: [
        {
          role: "system",
          content:
            "Voce escreve comunicados curtos para pagina de status. Responda somente JSON com as chaves title e description. Use portugues do Brasil, sem exagero, sem dramatizacao, sem enrolacao e sem prometer prazo. Title com no maximo 8 palavras. Description com 1 frase curta.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              objective:
                "Gerar uma nota curta para falha critica na pagina de status, em portugues do Brasil simples.",
              affectedComponents: criticalComponents.map((component) => ({
                name: component.name,
                status: component.status,
                latencyMs: component.latency_ms ?? null,
                detail: component.status_message || null,
              })),
              constraints: {
                titleMaxWords: 8,
                descriptionMaxWords: 22,
              },
            },
            null,
            2,
          ),
        },
      ],
    });

    const title = finalizeIncidentTitle(
      String(result.object?.title || "").trim(),
      fallbackNote.title,
    );
    const description = finalizeIncidentSummary(
      String(result.object?.description || "").trim(),
      fallbackNote.description,
    );

    if (!title || !description) {
      throw new Error("Resposta da IA incompleta.");
    }

    const aiNote: StatusTeamNote = {
      title,
      description,
      source: "ai",
      generated_at: new Date().toISOString(),
      affected_components: criticalComponents.map((component) => component.name),
    };

    latestStatusNoteCache = {
      key: cacheKey,
      expiresAt: now + 30_000,
      note: aiNote,
    };

    return aiNote;
  } catch {
    latestStatusNoteCache = {
      key: cacheKey,
      expiresAt: now + 30_000,
      note: fallbackNote,
    };
    return fallbackNote;
  }
}

export async function generateIncidentSummary(
  day: string,
  components: Array<{ name: string; status: string }>,
  evidenceNotes: string[] = [],
): Promise<{ title: string; summary: string; updateMessage: string }> {
  const fallback = buildFallbackIncidentSummary(day, components, evidenceNotes);

  try {
    const result = await runFlowAiJson<{
      title?: string;
      summary?: string;
      updateMessage?: string;
    }>({
      taskKey: "status_incident_summary",
      temperature: 0.1,
      maxTokens: 140,
      cacheKey: `status-incident:${day}:${components
        .map((component) => `${component.name}:${component.status}`)
        .join("|")}`,
      cacheTtlMs: 30_000,
      messages: [
        {
          role: "system",
          content:
            "Voce escreve textos curtos para uma pagina de status. Responda apenas JSON com title, summary e updateMessage. Use portugues do Brasil, 1 frase curta por campo, sem repeticao, sem excesso de detalhes, sem culpar terceiros.",
        },
        {
          role: "user",
          content: JSON.stringify({
            date: day,
            affectedComponents: components,
            evidenceNotes: evidenceNotes.slice(0, 3),
            instructions:
              "Gere um titulo curto, um resumo publico com 1 frase e uma mensagem final de resolucao com 1 frase. Seja objetivo.",
          }),
        },
      ],
    });

    return {
      title: finalizeIncidentTitle(
        String(result.object?.title || fallback.title).trim(),
        fallback.title,
      ),
      summary: finalizeIncidentSummary(
        String(result.object?.summary || fallback.summary).trim(),
        fallback.summary,
      ),
      updateMessage: finalizeIncidentUpdate(
        String(result.object?.updateMessage || fallback.updateMessage).trim(),
        fallback.updateMessage,
      ),
    };
  } catch {
    return fallback;
  }
}

export async function generateIncidentInvestigationNote(
  components: Array<{ name: string; status: string; latencyMs?: number | null; detail?: string | null }>,
): Promise<{ title: string; message: string }> {
  const componentNames = components.map((component) => component.name);
  const worstStatus =
    components.some((component) => component.status === "major_outage")
      ? "major_outage"
      : components.some((component) => component.status === "partial_outage")
        ? "partial_outage"
        : "degraded_performance";
  const fallback = {
    title: buildIncidentTitleFromContext(componentNames, worstStatus),
    message: buildInvestigationUpdateFromContext(componentNames, worstStatus),
  };

  try {
    const result = await runFlowAiJson<{ title?: string; message?: string }>({
      taskKey: "status_investigation_note",
      temperature: 0.1,
      maxTokens: 120,
      cacheKey: `status-investigation:${components
        .map((component) => `${component.name}:${component.status}:${component.latencyMs || ""}`)
        .join("|")}`,
      cacheTtlMs: 30_000,
      messages: [
        {
          role: "system",
          content:
            "Voce escreve comunicados curtos de status page. Responda somente JSON com chaves title e message. Use portugues do Brasil, 1 frase curta, sem excesso de detalhes, sem culpar terceiros.",
        },
        {
          role: "user",
          content: JSON.stringify({
            affectedComponents: components,
            titleMaxWords: 9,
            messageMaxWords: 40,
          }),
        },
      ],
    });

    return {
      title: finalizeIncidentTitle(
        String(result.object?.title || fallback.title).trim(),
        fallback.title,
      ),
      message: finalizeIncidentUpdate(
        String(result.object?.message || fallback.message).trim(),
        fallback.message,
      ),
    };
  } catch {
    return fallback;
  }
}
