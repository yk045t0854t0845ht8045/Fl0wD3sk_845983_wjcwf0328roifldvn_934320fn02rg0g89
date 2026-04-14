type TicketAiSettingsRecord = Partial<Record<string, unknown>>;

export type NormalizedTicketAiSettings = {
  aiRules: string;
  aiEnabled: boolean;
  aiCompanyName: string;
  aiCompanyBio: string;
  aiTone: "formal" | "friendly";
};

const ALLOWED_AI_TONES = new Set(["formal", "friendly"]);

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeTicketAiTone(value: unknown): "formal" | "friendly" {
  const normalized = normalizeText(value).toLowerCase();
  return ALLOWED_AI_TONES.has(normalized)
    ? (normalized as "formal" | "friendly")
    : "formal";
}

function parseLegacyTicketAiSettings(value: unknown) {
  const raw = normalizeText(value);
  if (!raw.startsWith("{")) {
    return {
      aiRules: raw,
      aiEnabled: false,
      aiCompanyName: "",
      aiCompanyBio: "",
      aiTone: "formal" as const,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      aiRules: normalizeText(parsed.rules),
      aiEnabled: parsed.enabled === true,
      aiCompanyName: normalizeText(parsed.companyName),
      aiCompanyBio: normalizeText(parsed.companyBio),
      aiTone: normalizeTicketAiTone(parsed.tone),
    };
  } catch {
    return {
      aiRules: raw,
      aiEnabled: false,
      aiCompanyName: "",
      aiCompanyBio: "",
      aiTone: "formal" as const,
    };
  }
}

export function normalizeTicketAiSettings(
  record: TicketAiSettingsRecord | null | undefined,
): NormalizedTicketAiSettings {
  const legacy = parseLegacyTicketAiSettings(record?.ai_rules);
  const rawRules = normalizeText(record?.ai_rules);
  const directRules = rawRules.startsWith("{") ? "" : rawRules;

  return {
    aiRules: directRules || legacy.aiRules,
    aiEnabled:
      typeof record?.ai_enabled === "boolean"
        ? record.ai_enabled
        : legacy.aiEnabled,
    aiCompanyName: normalizeText(record?.ai_company_name) || legacy.aiCompanyName,
    aiCompanyBio: normalizeText(record?.ai_company_bio) || legacy.aiCompanyBio,
    aiTone: normalizeTicketAiTone(record?.ai_tone || legacy.aiTone),
  };
}

export function encodeLegacyTicketAiSettings(
  settings: NormalizedTicketAiSettings,
) {
  return JSON.stringify({
    enabled: settings.aiEnabled,
    companyName: settings.aiCompanyName,
    companyBio: settings.aiCompanyBio,
    tone: settings.aiTone,
    rules: settings.aiRules,
  });
}

export function hasDedicatedTicketAiColumns(error: unknown) {
  return !isMissingDedicatedTicketAiColumnsError(error);
}

export function isMissingDedicatedTicketAiColumnsError(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message || "").toLowerCase()
      : String(error || "").toLowerCase();
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code || "").toLowerCase()
      : "";

  return (
    code === "42703" ||
    message.includes("ai_enabled") ||
    message.includes("ai_company_name") ||
    message.includes("ai_company_bio") ||
    message.includes("ai_tone")
  );
}
