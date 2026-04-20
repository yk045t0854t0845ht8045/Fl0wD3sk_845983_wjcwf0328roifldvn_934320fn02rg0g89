export const ACCOUNT_RETURN_QUERY_PARAM = "returnTo";
const ACCOUNT_RETURN_STORAGE_KEY = "flowdesk_account_return_to_v1";
const ACCOUNT_ALLOWED_RETURN_PREFIXES = ["/dashboard", "/servers"] as const;

function canUseBrowserStorage() {
  return typeof window !== "undefined";
}

export function getCurrentBrowserPath() {
  if (!canUseBrowserStorage()) {
    return "/dashboard";
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function sanitizeAccountReturnPath(value: string | null | undefined) {
  if (!value) return null;

  const normalized = value.trim();
  if (!normalized) return null;

  try {
    const baseOrigin = canUseBrowserStorage()
      ? window.location.origin
      : "https://flwdesk.com";
    const resolved = new URL(normalized, baseOrigin);

    if (resolved.origin !== baseOrigin) {
      return null;
    }

    const resolvedPath = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    const isAllowed = ACCOUNT_ALLOWED_RETURN_PREFIXES.some((prefix) => {
      return resolved.pathname === prefix || resolved.pathname.startsWith(`${prefix}/`);
    });

    if (!isAllowed) {
      return null;
    }

    return resolvedPath;
  } catch {
    return null;
  }
}

export function buildAccountPathWithReturn(returnTo: string | null | undefined) {
  const normalizedReturnTo = sanitizeAccountReturnPath(returnTo);
  if (!normalizedReturnTo) {
    return "/account";
  }

  const params = new URLSearchParams();
  params.set(ACCOUNT_RETURN_QUERY_PARAM, normalizedReturnTo);
  return `/account?${params.toString()}`;
}

export function storeAccountReturnPath(returnTo: string | null | undefined) {
  if (!canUseBrowserStorage()) {
    return null;
  }

  const normalizedReturnTo = sanitizeAccountReturnPath(returnTo);

  try {
    if (normalizedReturnTo) {
      window.sessionStorage.setItem(
        ACCOUNT_RETURN_STORAGE_KEY,
        normalizedReturnTo,
      );
    } else {
      window.sessionStorage.removeItem(ACCOUNT_RETURN_STORAGE_KEY);
    }
  } catch {
    return normalizedReturnTo;
  }

  return normalizedReturnTo;
}

export function readStoredAccountReturnPath() {
  if (!canUseBrowserStorage()) {
    return null;
  }

  try {
    return sanitizeAccountReturnPath(
      window.sessionStorage.getItem(ACCOUNT_RETURN_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export function getAccountReturnLabel(returnTo: string | null | undefined) {
  const normalizedReturnTo = sanitizeAccountReturnPath(returnTo);

  if (!normalizedReturnTo) {
    return "Dashboard";
  }

  if (
    normalizedReturnTo === "/servers" ||
    normalizedReturnTo.startsWith("/servers/")
  ) {
    return "Central de servidores";
  }

  return "Dashboard";
}
