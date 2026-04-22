export function normalizeUtcTimestampInput(value: unknown) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/\s+UTC$/i, "Z");
  normalized = normalized.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");
  normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return `${normalized}T00:00:00.000Z`;
  }

  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized)
  ) {
    return `${normalized}Z`;
  }

  return normalized;
}

export function parseUtcTimestampMs(value: unknown) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  const normalized = normalizeUtcTimestampInput(value);
  if (!normalized) return Number.NaN;

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

export function normalizeUtcTimestampIso(value: unknown) {
  const timestamp = parseUtcTimestampMs(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
