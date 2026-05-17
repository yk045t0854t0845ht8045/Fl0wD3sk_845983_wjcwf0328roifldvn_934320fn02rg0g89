import {
  buildBrowserRoutingTargetFromInternalPath,
  detectCanonicalHostFromHostname,
  detectWorkspaceAreaFromExternalPath,
  getWorkspaceAreaInternalPath,
} from "@/lib/routing/subdomains";

export const DISCORD_AUTH_START_PATH = "/api/auth/discord";
export const GOOGLE_AUTH_START_PATH = "/api/auth/google";
export const MICROSOFT_AUTH_START_PATH = "/api/auth/microsoft";
export const LOGIN_PATH = "/login";

export type LoginIntentMode = "login" | "link";

export function getCurrentBrowserInternalPath(fallbackPath = "/dashboard") {
  if (typeof window === "undefined") return fallbackPath;

  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const canonicalHost = detectCanonicalHostFromHostname(window.location.hostname);
  const workspaceArea = canonicalHost
    ? detectWorkspaceAreaFromExternalPath(canonicalHost, window.location.pathname)
    : null;

  if (!workspaceArea) return currentPath || fallbackPath;

  const internalPathname = getWorkspaceAreaInternalPath(
    workspaceArea,
    window.location.pathname,
  );
  return `${internalPathname}${window.location.search}${window.location.hash}`;
}

function resolveBrowserAuthHref(
  path: string,
  options?: {
    forceLoginHost?: boolean;
  },
) {
  const target = buildBrowserRoutingTargetFromInternalPath(path, {
    fallbackArea: options?.forceLoginHost ? "login" : undefined,
  });
  return target.href;
}

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

  if (!params.size) return resolveBrowserAuthHref(LOGIN_PATH);

  return resolveBrowserAuthHref(`${LOGIN_PATH}?${params.toString()}`);
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

  if (!params.size) {
    return resolveBrowserAuthHref(DISCORD_AUTH_START_PATH, {
      forceLoginHost: true,
    });
  }

  return resolveBrowserAuthHref(`${DISCORD_AUTH_START_PATH}?${params.toString()}`, {
    forceLoginHost: true,
  });
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

  if (!params.size) {
    return resolveBrowserAuthHref(GOOGLE_AUTH_START_PATH, {
      forceLoginHost: true,
    });
  }

  return resolveBrowserAuthHref(`${GOOGLE_AUTH_START_PATH}?${params.toString()}`, {
    forceLoginHost: true,
  });
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

  if (!params.size) {
    return resolveBrowserAuthHref(MICROSOFT_AUTH_START_PATH, {
      forceLoginHost: true,
    });
  }

  return resolveBrowserAuthHref(`${MICROSOFT_AUTH_START_PATH}?${params.toString()}`, {
    forceLoginHost: true,
  });
}
