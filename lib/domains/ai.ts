import { searchDomains } from "@/lib/openprovider/domains";
import type { DomainSearchResponse } from "@/lib/openprovider/types";
import { getServerEnv, getServerEnvList } from "@/lib/serverEnv";

const unavailableModelCache = new Map<string, number>();

type OpenAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DomainIdea = {
  name: string;
  rationale: string;
};

type DomainAiModelPayload = {
  company_summary?: string;
  style_notes?: string;
  suggestions?: Array<{
    name?: string;
    rationale?: string;
  }>;
};

export type DomainAiSuggestion = {
  name: string;
  rationale: string;
  search: DomainSearchResponse;
};

export type DomainAiResponse = {
  prompt: string;
  companySummary: string;
  styleNotes: string;
  suggestions: DomainAiSuggestion[];
};

const AI_TLD_PRIORITY = ["com", "com.br", "io", "ai", "org", "net"];
const AI_CACHE_TTL_MS = 1000 * 60 * 5;
const aiResponseCache = new Map<string, { value: DomainAiResponse; expiresAt: number }>();
const inflightAiResponses = new Map<string, Promise<DomainAiResponse>>();

function nowMs() {
  return Date.now();
}

function cloneAiResponse(response: DomainAiResponse): DomainAiResponse {
  return {
    ...response,
    suggestions: response.suggestions.map((item) => ({
      ...item,
      search: {
        ...item.search,
        searchedTlds: [...item.search.searchedTlds],
        results: item.search.results.map((result) => ({ ...result })),
      },
    })),
  };
}

function normalizeText(value: string, maxLength = 1200) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeIdeaName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
}

function looksLikeModelAccessError(status: number, rawText: string) {
  const content = rawText.toLowerCase();
  return (
    status === 403 ||
    content.includes("model_not_found") ||
    content.includes("does not have access to model")
  );
}

function buildModelCandidates() {
  return Array.from(
    new Set(
      [
        getServerEnv("OPENAI_MODEL"),
        ...getServerEnvList("OPENAI_MODEL_FALLBACKS"),
        "gpt-4o-mini",
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

async function callOpenAi(messages: OpenAiMessage[], userId: string) {
  const apiKey = getServerEnv("OPENAI_API_KEY");
  const baseUrl = getServerEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY nao configurada para a IA de dominios.");
  }

  let lastError: Error | null = null;

  for (const model of buildModelCandidates()) {
    const blockedUntil = unavailableModelCache.get(model) || 0;
    if (blockedUntil > nowMs()) {
      continue;
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 650,
        response_format: { type: "json_object" },
        user: String(userId || "domain-ai").slice(0, 64),
      }),
    });

    const rawText = await response.text().catch(() => "");
    if (!response.ok) {
      lastError = new Error(
        `Falha ao chamar OpenAI com ${model}: ${response.status} ${response.statusText} ${rawText}`,
      );

      if (looksLikeModelAccessError(response.status, rawText)) {
        unavailableModelCache.set(model, nowMs() + 1000 * 60 * 30);
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        continue;
      }

      throw lastError;
    }

    let payload: { choices?: Array<{ message?: { content?: string } }> } | null = null;
    try {
      payload = JSON.parse(rawText);
    } catch (error) {
      lastError = new Error(
        `Resposta invalida da OpenAI com ${model}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const content = normalizeText(payload?.choices?.[0]?.message?.content || "", 6000);
    if (!content) {
      lastError = new Error(`Resposta vazia da OpenAI com ${model}.`);
      continue;
    }

    unavailableModelCache.delete(model);
    return content;
  }

  throw lastError || new Error("Nenhum modelo disponivel respondeu na IA de dominios.");
}

function buildDirectCandidate(prompt: string) {
  const normalizedPrompt = prompt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const anchoredMatch =
    normalizedPrompt.match(/\b(?:se chama|chamada|nome da empresa e|empresa chamada|marca chamada)\s+([a-z0-9\s-]{3,40})/) ||
    normalizedPrompt.match(/\b(?:empresa|marca|negocio)\s+([a-z0-9\s-]{3,28})/);

  const source =
    anchoredMatch?.[1] ||
    normalizedPrompt
      .replace(/https?:\/\//gi, " ")
      .replace(/\.[a-z]{2,}(?:\.[a-z]{2,})?/gi, " ")
      .replace(
        /\b(minha|minha empresa|empresa|marca|loja|startup|site|dominio|dominio|vende|para|com|que|se|chama|e|de|do|da|um|uma)\b/gi,
        " ",
      );

  const cleaned = normalizeIdeaName(source);

  if (cleaned.split("-").length > 3 || cleaned.length > 20) {
    return null;
  }

  if (cleaned.length < 3) {
    return null;
  }

  return cleaned;
}

function parseIdeas(rawContent: string) {
  const parsed = JSON.parse(rawContent) as DomainAiModelPayload;
  const ideas: DomainIdea[] = [];

  for (const item of parsed.suggestions || []) {
    const name = normalizeIdeaName(item?.name || "");
    if (name.length < 3) {
      continue;
    }

    ideas.push({
      name,
      rationale: normalizeText(item?.rationale || "", 180),
    });
  }

  return {
    companySummary: normalizeText(parsed.company_summary || "", 220),
    styleNotes: normalizeText(parsed.style_notes || "", 220),
    ideas,
  };
}

function dedupeIdeas(prompt: string, ideas: DomainIdea[]) {
  const directCandidate = buildDirectCandidate(prompt);
  const merged = [
    ...(directCandidate
      ? [
          {
            name: directCandidate,
            rationale: "Base direta extraida do nome da empresa ou do termo informado.",
          },
        ]
      : []),
    ...ideas,
  ];

  const unique = new Map<string, DomainIdea>();
  for (const idea of merged) {
    if (!unique.has(idea.name)) {
      unique.set(idea.name, idea);
    }
  }

  return Array.from(unique.values()).slice(0, 5);
}

function buildSystemPrompt() {
  return [
    "Atenda em PT-BR.",
    "Voce e o FlowAI de dominios da Flowdesk.",
    "Seu papel e entender o negocio descrito pelo usuario e sugerir nomes de dominio curtos, marcaveis, claros e profissionais.",
    "Leve em conta nome da empresa, nicho, proposta de valor, publico e sonoridade.",
    "Evite nomes genericos demais, confusos, longos demais ou com escrita ruim.",
    "Prefira nomes registraveis, faceis de lembrar e bons para marca.",
    "Quando o usuario informar o nome da empresa, use esse contexto como prioridade.",
    "Responda somente em JSON valido.",
    "Formato esperado: {\"company_summary\":\"...\",\"style_notes\":\"...\",\"suggestions\":[{\"name\":\"...\",\"rationale\":\"...\"}]}",
    "Retorne de 3 a 5 sugestoes.",
    "Cada campo name deve vir sem extensao, sem espacos e sem caracteres especiais fora de letras, numeros ou hifen.",
  ].join(" ");
}

function buildUserPrompt(prompt: string) {
  return [
    "Crie sugestoes de dominio com base nesta descricao de negocio.",
    `Entrada do usuario: ${prompt}`,
    "Se houver nome de empresa no texto, use-o como ancora da marca e gere variacoes inteligentes ao redor dele.",
    "Quando possivel, priorize nomes que tenham boa chance de funcionar primeiro em .com.",
    "Nao invente explicacoes longas. O rationale deve ser objetivo e util.",
  ].join("\n");
}

function getAiExtensionPriority(extension: string) {
  const index = AI_TLD_PRIORITY.indexOf(extension);
  return index === -1 ? AI_TLD_PRIORITY.length + 1 : index;
}

function prioritizeAiSearchResults(search: DomainSearchResponse): DomainSearchResponse {
  const prioritized = [...search.results].sort((left, right) => {
    if (left.isAvailable !== right.isAvailable) {
      return left.isAvailable ? -1 : 1;
    }

    return getAiExtensionPriority(left.extension) - getAiExtensionPriority(right.extension);
  });

  return {
    ...search,
    results: prioritized,
  };
}

function getSuggestionScore(search: DomainSearchResponse) {
  const best = search.results[0];
  if (!best) {
    return 0;
  }

  if (!best.isAvailable) {
    return 10 - getAiExtensionPriority(best.extension);
  }

  return 100 - getAiExtensionPriority(best.extension);
}

export async function generateDomainAiSuggestions(prompt: string, userId = "domain-ai") {
  const normalizedPrompt = normalizeText(prompt, 500);
  if (!normalizedPrompt) {
    throw new Error("Informe uma descricao para gerar dominios com IA.");
  }

  const cacheKey = normalizedPrompt.toLowerCase();
  const cached = aiResponseCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs()) {
    return cloneAiResponse(cached.value);
  }

  const inflight = inflightAiResponses.get(cacheKey);
  if (inflight) {
    return cloneAiResponse(await inflight);
  }

  const request = (async () => {

    const content = await callOpenAi(
      [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(normalizedPrompt) },
      ],
      userId,
    );

    const parsed = parseIdeas(content);
    const ideas = dedupeIdeas(normalizedPrompt, parsed.ideas);

    if (ideas.length === 0) {
      throw new Error("A IA nao retornou sugestoes validas de dominio.");
    }

    const searches = await Promise.all(
      ideas.map(async (idea) => ({
        name: idea.name,
        rationale: idea.rationale,
        search: prioritizeAiSearchResults(await searchDomains(idea.name)),
      })),
    );

    searches.sort((left, right) => {
      const scoreDiff = getSuggestionScore(right.search) - getSuggestionScore(left.search);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return left.name.localeCompare(right.name);
    });

    const response = {
      prompt: normalizedPrompt,
      companySummary:
        parsed.companySummary || "Sugestoes geradas pela IA com base no nome, nicho e posicionamento informado.",
      styleNotes: parsed.styleNotes || "Foco em nomes curtos, claros e com potencial de marca.",
      suggestions: searches,
    } satisfies DomainAiResponse;

    aiResponseCache.set(cacheKey, {
      value: response,
      expiresAt: nowMs() + AI_CACHE_TTL_MS,
    });

    return response;
  })();

  inflightAiResponses.set(cacheKey, request);

  try {
    return cloneAiResponse(await request);
  } finally {
    inflightAiResponses.delete(cacheKey);
  }
}
