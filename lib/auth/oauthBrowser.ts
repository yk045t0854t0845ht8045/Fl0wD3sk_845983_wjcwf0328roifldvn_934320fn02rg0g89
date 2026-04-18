const EMBEDDED_BROWSER_PATTERNS = [
  "discord",
  "instagram",
  "fban",
  "fbav",
  "messenger",
  "line/",
  "micromessenger",
  "tiktok",
  "snapchat",
  "twitter",
  "linkedinapp",
  "telegram",
  "wv",
  "; wv",
  " webview",
];

export function isLikelyEmbeddedAuthBrowser(userAgent: string | null | undefined) {
  const normalized = userAgent?.trim().toLowerCase() || "";
  if (!normalized) return false;

  return EMBEDDED_BROWSER_PATTERNS.some((pattern) => normalized.includes(pattern));
}
