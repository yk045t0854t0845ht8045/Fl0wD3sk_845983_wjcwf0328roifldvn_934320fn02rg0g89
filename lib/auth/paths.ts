export const DISCORD_AUTH_START_PATH = "/api/auth/discord";
export const GOOGLE_AUTH_START_PATH = "/api/auth/google";
export const MICROSOFT_AUTH_START_PATH = "/api/auth/microsoft";
export const LOGIN_PATH = "/login";

export type LoginIntentMode = "login" | "link";

export function buildLoginHref(
  nextPath?: string | null,
  mode: LoginIntentMode = "login",
) {
  const params = new URLSearchParams();

  if (nextPath) {
    const normalizedNextPath = nextPath.trim();
    if (normalizedNextPath) {
      params.set("next", normalizedNextPath);
    }
  }

  if (mode === "link") {
    params.set("mode", mode);
  }

  if (!params.size) return LOGIN_PATH;

  return `${LOGIN_PATH}?${params.toString()}`;
}

export function buildDiscordAuthStartHref(
  nextPath?: string | null,
  mode: LoginIntentMode = "login",
) {
  const params = new URLSearchParams();
  if (nextPath) {
    const normalizedNextPath = nextPath.trim();
    if (normalizedNextPath) {
      params.set("next", normalizedNextPath);
    }
  }

  if (mode === "link") {
    params.set("mode", mode);
  }

  if (!params.size) return DISCORD_AUTH_START_PATH;

  return `${DISCORD_AUTH_START_PATH}?${params.toString()}`;
}

export function buildGoogleAuthStartHref(
  nextPath?: string | null,
  mode: LoginIntentMode = "login",
) {
  const params = new URLSearchParams();
  if (nextPath) {
    const normalizedNextPath = nextPath.trim();
    if (normalizedNextPath) {
      params.set("next", normalizedNextPath);
    }
  }

  if (mode === "link") {
    params.set("mode", mode);
  }

  if (!params.size) return GOOGLE_AUTH_START_PATH;

  return `${GOOGLE_AUTH_START_PATH}?${params.toString()}`;
}

export function buildMicrosoftAuthStartHref(
  nextPath?: string | null,
  mode: LoginIntentMode = "login",
) {
  const params = new URLSearchParams();
  if (nextPath) {
    const normalizedNextPath = nextPath.trim();
    if (normalizedNextPath) {
      params.set("next", normalizedNextPath);
    }
  }

  if (mode === "link") {
    params.set("mode", mode);
  }

  if (!params.size) return MICROSOFT_AUTH_START_PATH;

  return `${MICROSOFT_AUTH_START_PATH}?${params.toString()}`;
}
