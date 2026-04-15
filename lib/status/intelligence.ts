import { runFlowAiJson } from "@/lib/flowai/service";
import type { ComponentStatus, StatusTeamNote } from "./types";

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
      topMessages ||
      `Detectamos indisponibilidade em ${affectedComponents.join(", ")}. Nossa equipe tecnica ja iniciou a analise e esta aplicando a estabilizacao do ambiente.`,
    source: "fallback",
    generated_at: new Date().toISOString(),
    affected_components: affectedComponents,
  };
}

function buildFallbackIncidentSummary(
  day: string,
  components: Array<{ name: string; status: string }>,
) {
  const dayLabel = new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return {
    title: `Instabilidade detectada em ${components.map((component) => component.name).join(", ")}`,
    summary: `Em ${dayLabel}, identificamos instabilidade em ${components.map((component) => component.name).join(", ")}. Nossa equipe monitorou e os servicos foram normalizados.`,
    updateMessage:
      "Incidente resolvido. A estabilidade dos sistemas foi confirmada pela nossa equipe de monitoramento.",
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
      temperature: 0.2,
      maxTokens: 180,
      cacheKey: `status-note:${cacheKey}`,
      cacheTtlMs: 30_000,
      messages: [
        {
          role: "system",
          content:
            "Voce escreve comunicados curtos para pagina de status. Responda somente JSON com as chaves title e description. O texto deve ser profissional, simples, sem exagero, sem culpar terceiros e sem prometer prazo.",
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
                descriptionMaxWords: 38,
              },
            },
            null,
            2,
          ),
        },
      ],
    });

    const title = String(result.object?.title || "").trim();
    const description = String(result.object?.description || "").trim();

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
): Promise<{ title: string; summary: string; updateMessage: string }> {
  const fallback = buildFallbackIncidentSummary(day, components);
  const dayLabel = new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  try {
    const result = await runFlowAiJson<{
      title?: string;
      summary?: string;
      updateMessage?: string;
    }>({
      taskKey: "status_incident_summary",
      temperature: 0.3,
      maxTokens: 250,
      cacheKey: `status-incident:${day}:${components
        .map((component) => `${component.name}:${component.status}`)
        .join("|")}`,
      cacheTtlMs: 30_000,
      messages: [
        {
          role: "system",
          content:
            "Voce e um engenheiro de SRE escrevendo resumos para uma pagina de status. Responda apenas JSON com title, summary e updateMessage. Use um tom profissional, transparente e em portugues do Brasil.",
        },
        {
          role: "user",
          content: JSON.stringify({
            date: dayLabel,
            affectedComponents: components,
            instructions:
              "Gere um titulo curto, um resumo do que aconteceu em 2 frases, e uma mensagem final de resolucao.",
          }),
        },
      ],
    });

    return {
      title: String(result.object?.title || fallback.title).trim() || fallback.title,
      summary:
        String(result.object?.summary || fallback.summary).trim() || fallback.summary,
      updateMessage:
        String(result.object?.updateMessage || fallback.updateMessage).trim() ||
        fallback.updateMessage,
    };
  } catch {
    return fallback;
  }
}

export async function generateIncidentInvestigationNote(
  components: Array<{ name: string; status: string; latencyMs?: number | null; detail?: string | null }>,
): Promise<{ title: string; message: string }> {
  const fallback = {
    title: `Falha critica detectada em: ${components.map((component) => component.name).join(", ")}`,
    message: `Nossa equipe detectou indisponibilidade em ${components.map((component) => component.name).join(", ")} e iniciou a investigacao imediata.`,
  };

  try {
    const result = await runFlowAiJson<{ title?: string; message?: string }>({
      taskKey: "status_investigation_note",
      temperature: 0.2,
      maxTokens: 200,
      cacheKey: `status-investigation:${components
        .map((component) => `${component.name}:${component.status}:${component.latencyMs || ""}`)
        .join("|")}`,
      cacheTtlMs: 30_000,
      messages: [
        {
          role: "system",
          content:
            "Voce escreve comunicados de status page. Responda somente JSON com chaves title e message. Tom: profissional, transparente, sem culpar terceiros, em portugues do Brasil.",
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
      title: String(result.object?.title || fallback.title).trim() || fallback.title,
      message: String(result.object?.message || fallback.message).trim() || fallback.message,
    };
  } catch {
    return fallback;
  }
}
