import { getServerEnv, getServerEnvList } from "@/lib/serverEnv";

export type FlowAiProviderKey =
  | "openai"
  | "groq"
  | "openrouter"
  | "mistral";

export type FlowAiProviderConfig = {
  key: FlowAiProviderKey;
  label: string;
  baseUrl: string;
  apiKey: string;
  defaultModels: string[];
  headers?: Record<string, string>;
};

const DEFAULT_PROVIDER_ORDER: FlowAiProviderKey[] = [
  "openai",
  "groq",
  "openrouter",
  "mistral",
];

function normalizeTaskKey(taskKey: string) {
  const normalized = String(taskKey || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "generic";
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean))) as string[];
}

function getProviderOrder() {
  const configured = getServerEnv("FLOWAI_PROVIDER_ORDER");
  if (!configured) {
    return DEFAULT_PROVIDER_ORDER;
  }

  return configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(
      (value): value is FlowAiProviderKey =>
        value === "openai" ||
        value === "groq" ||
        value === "openrouter" ||
        value === "mistral",
    );
}

function buildProviderConfig(key: FlowAiProviderKey): FlowAiProviderConfig | null {
  if (key === "openai") {
    const apiKey = getServerEnv("OPENAI_API_KEY") || "";
    if (!apiKey) return null;

    return {
      key,
      label: "OpenAI",
      apiKey,
      baseUrl: (getServerEnv("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(
        /\/$/,
        "",
      ),
      defaultModels: unique([
        getServerEnv("OPENAI_MODEL"),
        ...getServerEnvList("OPENAI_MODEL_FALLBACKS"),
        "gpt-4o-mini",
        "gpt-4o",
      ]),
    };
  }

  if (key === "groq") {
    const apiKey = getServerEnv("GROQ_API_KEY") || "";
    if (!apiKey) return null;

    return {
      key,
      label: "Groq",
      apiKey,
      baseUrl: (getServerEnv("GROQ_BASE_URL") || "https://api.groq.com/openai/v1").replace(
        /\/$/,
        "",
      ),
      defaultModels: unique([
        getServerEnv("GROQ_MODEL"),
        ...getServerEnvList("GROQ_MODEL_FALLBACKS"),
        "llama-3.1-8b-instant",
        "llama-3.3-70b-versatile",
      ]),
    };
  }

  if (key === "openrouter") {
    const apiKey = getServerEnv("OPENROUTER_API_KEY") || "";
    if (!apiKey) return null;

    const siteUrl =
      getServerEnv("OPENROUTER_SITE_URL") ||
      getServerEnv("NEXT_PUBLIC_APP_URL") ||
      getServerEnv("APP_URL") ||
      "https://www.flwdesk.com";
    const appName = getServerEnv("OPENROUTER_APP_NAME") || "Flowdesk FlowAI";

    return {
      key,
      label: "OpenRouter",
      apiKey,
      baseUrl: (
        getServerEnv("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1"
      ).replace(/\/$/, ""),
      defaultModels: unique([
        getServerEnv("OPENROUTER_MODEL"),
        ...getServerEnvList("OPENROUTER_MODEL_FALLBACKS"),
        "openai/gpt-4o-mini",
        "anthropic/claude-3.5-haiku",
      ]),
      headers: {
        "HTTP-Referer": siteUrl,
        "X-Title": appName,
      },
    };
  }

  const apiKey = getServerEnv("MISTRAL_API_KEY") || "";
  if (!apiKey) return null;

  return {
    key: "mistral",
    label: "Mistral",
    apiKey,
    baseUrl: (getServerEnv("MISTRAL_BASE_URL") || "https://api.mistral.ai/v1").replace(
      /\/$/,
      "",
    ),
    defaultModels: unique([
      getServerEnv("MISTRAL_MODEL"),
      ...getServerEnvList("MISTRAL_MODEL_FALLBACKS"),
      "mistral-small-latest",
      "open-mistral-nemo",
    ]),
  };
}

export function getConfiguredFlowAiProviders() {
  return getProviderOrder()
    .map((key) => buildProviderConfig(key))
    .filter((provider): provider is FlowAiProviderConfig => Boolean(provider));
}

export function resolveProviderModelCandidates(input: {
  provider: FlowAiProviderConfig;
  taskKey: string;
  preferredModel?: string | null;
}) {
  const normalizedTaskKey = normalizeTaskKey(input.taskKey);
  const taskEnvKey = normalizedTaskKey.toUpperCase();
  const providerEnvKey = input.provider.key.toUpperCase();

  return unique([
    input.preferredModel || null,
    getServerEnv(`FLOWAI_MODEL_${providerEnvKey}_${taskEnvKey}`),
    ...getServerEnvList(`FLOWAI_MODEL_${providerEnvKey}_${taskEnvKey}_FALLBACKS`),
    ...input.provider.defaultModels,
  ]);
}
