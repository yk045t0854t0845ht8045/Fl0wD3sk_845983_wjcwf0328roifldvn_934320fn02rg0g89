import type { IncidentStatus, SystemStatus } from "./types";

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[*_>#~]/g, " ");
}

function stripTrailingPunctuation(value: string) {
  return value.replace(/[.!?;:,]+$/g, "").trim();
}

function cleanText(value: string | null | undefined) {
  return normalizeWhitespace(stripMarkdown(String(value || "")));
}

function splitSentences(value: string) {
  return cleanText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function clampWords(value: string, maxWords: number) {
  const words = cleanText(value).split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }

  return words.slice(0, maxWords).join(" ");
}

function ensureSentence(value: string) {
  const trimmed = cleanText(value);
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function buildNamesList(names: string[]) {
  const unique = Array.from(
    new Set(
      names
        .map((name) => cleanText(name))
        .filter(Boolean),
    ),
  );

  if (unique.length === 0) return "os servicos monitorados";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} e ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} e ${unique[unique.length - 1]}`;
}

function formatUtcDateLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function mapStatusToHeadline(status: SystemStatus) {
  if (status === "major_outage") return "Falha critica";
  if (status === "partial_outage") return "Instabilidade";
  if (status === "degraded_performance") return "Degradacao";
  return "Operacao normal";
}

function mapStatusToNoun(status: SystemStatus) {
  if (status === "major_outage") return "falha critica";
  if (status === "partial_outage") return "instabilidade";
  if (status === "degraded_performance") return "degradacao";
  return "operacao normal";
}

export function inferSystemStatusFromIncidentStatus(
  incidentStatus: IncidentStatus,
  impact?: "critical" | "warning" | "info",
): SystemStatus {
  if (impact === "critical") return "major_outage";
  if (impact === "warning") return "partial_outage";
  if (incidentStatus === "identified" || incidentStatus === "monitoring") {
    return "partial_outage";
  }
  if (incidentStatus === "resolved") return "degraded_performance";
  return "degraded_performance";
}

export function buildIncidentTitleFromContext(
  components: string[],
  status: SystemStatus,
) {
  const title = `${mapStatusToHeadline(status)} em ${buildNamesList(components)}`;
  return finalizeIncidentTitle(title, "Incidente registrado");
}

export function buildIncidentSummaryFromContext(
  day: string,
  components: string[],
  status: SystemStatus,
) {
  const summary = `Em ${formatUtcDateLabel(day)}, detectamos ${mapStatusToNoun(status)} em ${buildNamesList(components)} e a operacao foi normalizada pela equipe.`;
  return finalizeIncidentSummary(summary, "Incidente resolvido com estabilidade restabelecida.");
}

export function buildInvestigationUpdateFromContext(
  components: string[],
  status: SystemStatus,
) {
  const message = `Detectamos ${mapStatusToNoun(status)} em ${buildNamesList(components)} e iniciamos a investigacao.`;
  return finalizeIncidentUpdate(message, "Investigacao iniciada pela equipe.");
}

export function buildIdentifiedUpdateFromContext(components: string[]) {
  const message = `Identificamos a causa principal do incidente em ${buildNamesList(components)} e seguimos aplicando a correcao.`;
  return finalizeIncidentUpdate(message, "Causa identificada e correcao em andamento.");
}

export function buildMonitoringUpdateFromContext(components: string[]) {
  const message = `Aplicamos a correcao em ${buildNamesList(components)} e seguimos monitorando a estabilidade.`;
  return finalizeIncidentUpdate(message, "Correcao aplicada e monitoramento em andamento.");
}

export function buildResolvedUpdateFromContext(components: string[]) {
  const message = `A estabilidade de ${buildNamesList(components)} foi restabelecida e seguimos monitorando o ambiente.`;
  return finalizeIncidentUpdate(message, "Incidente resolvido e ambiente estabilizado.");
}

export function finalizeIncidentTitle(value: string | null | undefined, fallback: string) {
  const candidate = stripTrailingPunctuation(clampWords(cleanText(value), 8));
  const base = stripTrailingPunctuation(clampWords(cleanText(fallback), 8));
  return candidate || base || "Incidente registrado";
}

export function finalizeIncidentSummary(
  value: string | null | undefined,
  fallback: string,
) {
  const sentences = splitSentences(value || "");
  const candidate = ensureSentence(clampWords(sentences[0] || "", 24));
  const base = ensureSentence(clampWords(fallback, 24));
  return candidate || base || "Incidente registrado.";
}

export function finalizeIncidentUpdate(
  value: string | null | undefined,
  fallback: string,
) {
  const sentences = splitSentences(value || "");
  const candidate = ensureSentence(clampWords(sentences[0] || "", 18));
  const base = ensureSentence(clampWords(fallback, 18));
  return candidate || base || "Atualizacao registrada.";
}

export function buildTextSignature(value: string | null | undefined) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
