const AUTH_EMAIL_REGEX =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function titleCaseSegment(value: string) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function normalizeAuthEmail(value: unknown) {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  if (!AUTH_EMAIL_REGEX.test(normalized)) return null;

  const [localPart = "", domainPart = ""] = normalized.split("@");
  if (!localPart || !domainPart) return null;
  if (localPart.length > 64 || domainPart.length > 253) return null;
  if (localPart.startsWith(".") || localPart.endsWith(".")) return null;
  if (normalized.includes("..")) return null;

  const domainLabels = domainPart.split(".");
  if (domainLabels.some((label) => !label || label.length > 63)) {
    return null;
  }

  return normalized;
}

export function maskAuthEmail(value: string | null | undefined) {
  const normalized = normalizeAuthEmail(value);
  if (!normalized) return "seu email";

  const [localPart, domain = ""] = normalized.split("@");
  const [domainLabel = "", ...domainRest] = domain.split(".");
  const localPreview =
    localPart.length <= 2
      ? `${localPart.charAt(0) || "*"}*`
      : `${localPart.slice(0, 2)}${"*".repeat(Math.max(1, localPart.length - 2))}`;
  const domainPreview = domainLabel
    ? `${domainLabel.charAt(0)}${"*".repeat(Math.max(1, domainLabel.length - 1))}`
    : "***";

  return `${localPreview}@${[domainPreview, ...domainRest].filter(Boolean).join(".")}`;
}

export function buildEmailUsername(email: string) {
  const normalized = normalizeAuthEmail(email);
  if (!normalized) return "flowdesk-user";

  const [localPart] = normalized.split("@");
  const sanitized = localPart
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 32);

  return sanitized || "flowdesk-user";
}

export function buildEmailDisplayName(email: string) {
  const normalized = normalizeAuthEmail(email);
  if (!normalized) return "Conta Flowdesk";

  const [localPart] = normalized.split("@");
  const prettified = localPart
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!prettified) return "Conta Flowdesk";

  const titled = prettified
    .split(" ")
    .filter(Boolean)
    .map((segment) => titleCaseSegment(segment))
    .join(" ")
    .slice(0, 64);

  return titled || "Conta Flowdesk";
}
