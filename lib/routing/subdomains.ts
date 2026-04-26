export type CanonicalHost =
  | "public"
  | "login"
  | "config"
  | "status"
  | "dashboard"
  | "servers"
  | "pay";
export type WorkspaceArea =
  | "login"
  | "config"
  | "status"
  | "dashboard"
  | "servers"
  | "account";
type CanonicalRoutingFallbackOptions = {
  fallbackHost?: CanonicalHost | null;
  fallbackArea?: WorkspaceArea | "public" | null;
};

type RequestLike = Pick<Request, "headers" | "url">;

type CanonicalHostConfig = {
  subdomain: string | null;
  legacySubdomains?: string[];
};

type WorkspaceAreaConfig = {
  canonicalHost: CanonicalHost;
  internalBasePath: `/${string}`;
  externalBasePath: `/${string}`;
};

type RuntimeContext =
  | {
      mode: "local";
      baseDomain: string;
      publicHost: string;
      port: string;
    }
  | {
      mode: "production";
      baseDomain: string;
      publicHost: string;
      port: "";
    }
  | {
      mode: "isolated";
      baseDomain: null;
      publicHost: null;
      port: string;
    };

const CANONICAL_HOST_CONFIG: Record<CanonicalHost, CanonicalHostConfig> = {
  public: {
    subdomain: null,
  },
  login: {
    subdomain: "account",
    legacySubdomains: ["login"],
  },
  config: {
    subdomain: "config",
  },
  status: {
    subdomain: "status",
  },
  dashboard: {
    subdomain: "fdesk",
  },
  servers: {
    subdomain: "fdesk",
    legacySubdomains: ["servers"],
  },
  pay: {
    subdomain: "pay",
  },
};

const WORKSPACE_AREA_CONFIG: Record<WorkspaceArea, WorkspaceAreaConfig> = {
  login: {
    canonicalHost: "login",
    internalBasePath: "/login",
    externalBasePath: "/",
  },
  config: {
    canonicalHost: "config",
    internalBasePath: "/config",
    externalBasePath: "/",
  },
  status: {
    canonicalHost: "status",
    internalBasePath: "/status",
    externalBasePath: "/",
  },
  dashboard: {
    canonicalHost: "dashboard",
    internalBasePath: "/dashboard",
    externalBasePath: "/",
  },
  servers: {
    canonicalHost: "dashboard",
    internalBasePath: "/servers",
    externalBasePath: "/servers",
  },
  account: {
    canonicalHost: "dashboard",
    internalBasePath: "/account",
    externalBasePath: "/account",
  },
};

const DEFAULT_PRODUCTION_BASE_DOMAIN = "flwdesk.com";
const DEFAULT_PRODUCTION_PUBLIC_HOST = "www.flwdesk.com";
const DEFAULT_LOCAL_BASE_DOMAIN = "localhost";
const LEGACY_PRODUCTION_HOSTS = new Set(["flowdeskbot.vercel.app", "flwdesk.com"]);
const WORKSPACE_AREAS_IN_MATCH_ORDER = (
  Object.keys(WORKSPACE_AREA_CONFIG) as WorkspaceArea[]
).sort(
  (left, right) =>
    WORKSPACE_AREA_CONFIG[right].internalBasePath.length -
    WORKSPACE_AREA_CONFIG[left].internalBasePath.length,
);

export const AUTH_HOST: CanonicalHost = "login";
export const PAYMENT_HOST: CanonicalHost = "pay";
export const CANONICAL_PUBLIC_PATH_PREFIXES = [
  "/privacy",
  "/terms",
  "/affiliates",
  "/payment",
  "/transcripts",
  "/discord",
  "/domains",
] as const;
const DASHBOARD_EMBEDDED_PATH_PREFIXES = ["/domains"] as const;

function normalizeHostCandidate(value: string | null | undefined) {
  return value?.split(",")[0]?.trim().toLowerCase() || "";
}

function parseHost(rawHost: string) {
  const normalized = normalizeHostCandidate(rawHost);

  if (!normalized) {
    return {
      hostname: "",
      port: "",
    };
  }

  if (normalized.startsWith("[")) {
    const endIndex = normalized.indexOf("]");
    if (endIndex >= 0) {
      const hostname = normalized.slice(1, endIndex);
      const port =
        normalized.charAt(endIndex + 1) === ":"
          ? normalized.slice(endIndex + 2)
          : "";
      return {
        hostname,
        port,
      };
    }
  }

  const colonCount = normalized.split(":").length - 1;
  if (colonCount > 1) {
    return {
      hostname: normalized,
      port: "",
    };
  }

  const [hostname, port = ""] = normalized.split(":");
  return {
    hostname,
    port,
  };
}

function normalizeOriginProtocol(value: string | null | undefined) {
  const normalized = value?.split(",")[0]?.trim().toLowerCase() || "";

  if (normalized === "https" || normalized === "https:") {
    return "https";
  }

  if (normalized === "http" || normalized === "http:") {
    return "http";
  }

  return "";
}

function extractHostFromUrl(value: string | null | undefined) {
  if (!value) return "";

  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeConfiguredHost(value: string | null | undefined) {
  const host = normalizeHostCandidate(value);
  if (!host) return "";

  if (LEGACY_PRODUCTION_HOSTS.has(host)) {
    return DEFAULT_PRODUCTION_PUBLIC_HOST;
  }

  return host;
}

function normalizeConfiguredHostname(value: string | null | undefined) {
  const hostname = parseHost(value || "").hostname;
  if (!hostname) return "";

  if (LEGACY_PRODUCTION_HOSTS.has(hostname)) {
    return parseHost(DEFAULT_PRODUCTION_PUBLIC_HOST).hostname;
  }

  return hostname;
}

function resolveConfiguredProductionBaseDomain() {
  const directValue =
    process.env.APP_BASE_DOMAIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_BASE_DOMAIN?.trim() ||
    process.env.APP_COOKIE_BASE_DOMAIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_COOKIE_BASE_DOMAIN?.trim() ||
    "";

  if (directValue) {
    return directValue.toLowerCase().replace(/^\.+/, "");
  }

  const publicHostname = normalizeConfiguredHostname(
    process.env.APP_PUBLIC_HOST ||
      process.env.NEXT_PUBLIC_APP_PUBLIC_HOST ||
      process.env.APP_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      process.env.SITE_URL,
  );

  if (publicHostname && publicHostname !== "localhost") {
    return publicHostname.replace(/^www\./, "");
  }

  return DEFAULT_PRODUCTION_BASE_DOMAIN;
}

function resolveConfiguredProductionPublicHost() {
  const explicitHost = normalizeConfiguredHost(
    process.env.APP_PUBLIC_HOST ||
      process.env.NEXT_PUBLIC_APP_PUBLIC_HOST,
  );

  if (explicitHost) {
    return explicitHost;
  }

  const derivedHost = normalizeConfiguredHost(
    extractHostFromUrl(
      process.env.APP_PUBLIC_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_URL ||
        process.env.SITE_URL,
    ),
  );

  if (derivedHost) {
    return derivedHost;
  }

  return DEFAULT_PRODUCTION_PUBLIC_HOST;
}

function resolveConfiguredLocalBaseDomain() {
  return (
    process.env.APP_LOCAL_BASE_DOMAIN?.trim() ||
    process.env.NEXT_PUBLIC_APP_LOCAL_BASE_DOMAIN?.trim() ||
    DEFAULT_LOCAL_BASE_DOMAIN
  )
    .toLowerCase()
    .replace(/^\.+/, "");
}

function isIpv4Hostname(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function isIpv6Hostname(hostname: string) {
  return hostname.includes(":");
}

function isIpHostname(hostname: string) {
  return isIpv4Hostname(hostname) || isIpv6Hostname(hostname);
}

function isDomainMatch(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isLoopbackHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1"
  );
}

function isBareLoopbackHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1"
  );
}

function isLocalSingleHostRequest(request: RequestLike) {
  const currentHost = parseHost(getRequestHost(request));
  const runtime = resolveHostRuntimeContext(currentHost.hostname, currentHost.port);
  return runtime.mode === "local" && isBareLoopbackHostname(currentHost.hostname);
}

function ensureLeadingSlash(pathname: string) {
  if (!pathname) return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function trimTrailingSlash(pathname: string) {
  if (pathname === "/") return pathname;
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function isPathWithinBase(pathname: string, basePath: string) {
  const normalizedPathname = trimTrailingSlash(ensureLeadingSlash(pathname));
  const normalizedBasePath = trimTrailingSlash(ensureLeadingSlash(basePath));

  return (
    normalizedPathname === normalizedBasePath ||
    normalizedPathname.startsWith(`${normalizedBasePath}/`)
  );
}

function getPathSuffix(pathname: string, basePath: string) {
  const normalizedPathname = ensureLeadingSlash(pathname);
  const normalizedBasePath = trimTrailingSlash(ensureLeadingSlash(basePath));

  if (trimTrailingSlash(normalizedPathname) === normalizedBasePath) {
    return "";
  }

  if (normalizedPathname.startsWith(`${normalizedBasePath}/`)) {
    return normalizedPathname.slice(normalizedBasePath.length);
  }

  return normalizedPathname;
}

export function getWorkspaceAreaBasePath(area: WorkspaceArea) {
  return WORKSPACE_AREA_CONFIG[area].internalBasePath;
}

export function getWorkspaceAreaCanonicalHost(area: WorkspaceArea) {
  return WORKSPACE_AREA_CONFIG[area].canonicalHost;
}

export function getWorkspaceAreaExternalPath(
  area: WorkspaceArea,
  pathname: string,
) {
  const normalizedPathname = ensureLeadingSlash(pathname);
  const internalBasePath = WORKSPACE_AREA_CONFIG[area].internalBasePath;
  const externalBasePath = WORKSPACE_AREA_CONFIG[area].externalBasePath;
  const suffix = getPathSuffix(normalizedPathname, internalBasePath);

  if (externalBasePath === "/") {
    return suffix || "/";
  }

  return suffix ? `${externalBasePath}${suffix}` : externalBasePath;
}

export function getWorkspaceAreaInternalPath(
  area: WorkspaceArea,
  pathname: string,
) {
  const normalizedPathname = ensureLeadingSlash(pathname);
  const internalBasePath = WORKSPACE_AREA_CONFIG[area].internalBasePath;
  const externalBasePath = WORKSPACE_AREA_CONFIG[area].externalBasePath;

  if (isPathWithinBase(normalizedPathname, internalBasePath)) {
    return normalizedPathname;
  }

  if (externalBasePath === "/") {
    return normalizedPathname === "/"
      ? internalBasePath
      : `${internalBasePath}${normalizedPathname}`;
  }

  const suffix = getPathSuffix(normalizedPathname, externalBasePath);
  return suffix ? `${internalBasePath}${suffix}` : internalBasePath;
}

export function detectWorkspaceAreaFromPath(pathname: string) {
  for (const area of WORKSPACE_AREAS_IN_MATCH_ORDER) {
    if (isPathWithinBase(pathname, WORKSPACE_AREA_CONFIG[area].internalBasePath)) {
      return area;
    }
  }

  return null;
}

export function getRequestHost(request: RequestLike) {
  const forwardedHost = normalizeHostCandidate(
    request.headers.get("x-forwarded-host"),
  );
  if (forwardedHost) return forwardedHost;

  const headerHost = normalizeHostCandidate(request.headers.get("host"));
  if (headerHost) return headerHost;

  return new URL(request.url).host.toLowerCase();
}

export function getRequestHostname(request: RequestLike) {
  return parseHost(getRequestHost(request)).hostname;
}

export function getRequestPort(request: RequestLike) {
  return parseHost(getRequestHost(request)).port;
}

export function getRequestProtocol(request: RequestLike) {
  const forwardedProtocol = normalizeOriginProtocol(
    request.headers.get("x-forwarded-proto"),
  );
  if (forwardedProtocol) return forwardedProtocol;

  const urlProtocol = normalizeOriginProtocol(new URL(request.url).protocol);
  return urlProtocol || "http";
}

export function getRequestOrigin(request: RequestLike) {
  return `${getRequestProtocol(request)}://${getRequestHost(request)}`;
}

export function resolveHostRuntimeContext(hostname: string, port = ""): RuntimeContext {
  const normalizedHostname = hostname.toLowerCase();
  const localBaseDomain = resolveConfiguredLocalBaseDomain();
  const productionBaseDomain = resolveConfiguredProductionBaseDomain();
  const productionPublicHost = resolveConfiguredProductionPublicHost();

  if (
    normalizedHostname === localBaseDomain ||
    isDomainMatch(normalizedHostname, localBaseDomain) ||
    isLoopbackHostname(normalizedHostname)
  ) {
    return {
      mode: "local",
      baseDomain: localBaseDomain,
      publicHost: localBaseDomain,
      port,
    };
  }

  if (
    isDomainMatch(normalizedHostname, productionBaseDomain) ||
    normalizedHostname === parseHost(productionPublicHost).hostname ||
    LEGACY_PRODUCTION_HOSTS.has(normalizedHostname)
  ) {
    return {
      mode: "production",
      baseDomain: productionBaseDomain,
      publicHost: productionPublicHost,
      port: "",
    };
  }

  return {
    mode: "isolated",
    baseDomain: null,
    publicHost: null,
    port,
  };
}

export function areHostsWithinSameFirstPartySite(
  leftHost: string,
  rightHost: string,
) {
  const left = parseHost(leftHost);
  const right = parseHost(rightHost);
  const leftRuntime = resolveHostRuntimeContext(left.hostname, left.port);
  const rightRuntime = resolveHostRuntimeContext(right.hostname, right.port);

  if (leftRuntime.mode === "isolated" || rightRuntime.mode === "isolated") {
    return false;
  }

  return (
    leftRuntime.mode === rightRuntime.mode &&
    leftRuntime.baseDomain === rightRuntime.baseDomain
  );
}

export function detectCanonicalHostFromHostname(hostname: string) {
  const { hostname: normalizedHostname } = parseHost(hostname);
  const runtime = resolveHostRuntimeContext(normalizedHostname);

  if (runtime.mode === "isolated") {
    return null;
  }

  if (
    normalizedHostname === parseHost(runtime.publicHost).hostname ||
    normalizedHostname === runtime.baseDomain ||
    LEGACY_PRODUCTION_HOSTS.has(normalizedHostname)
  ) {
    return "public";
  }

  for (const host of Object.keys(CANONICAL_HOST_CONFIG) as CanonicalHost[]) {
    const { subdomain, legacySubdomains = [] } = CANONICAL_HOST_CONFIG[host];
    const hostnames = [subdomain, ...legacySubdomains].filter(Boolean);

    if (
      hostnames.some(
        (candidateSubdomain) =>
          normalizedHostname === `${candidateSubdomain}.${runtime.baseDomain}`,
      )
    ) {
      return host;
    }
  }

  return null;
}

export function detectCanonicalHostFromRequest(request: RequestLike) {
  return detectCanonicalHostFromHostname(getRequestHostname(request));
}

export function detectWorkspaceAreaFromRequestHost(request: RequestLike) {
  const host = detectCanonicalHostFromRequest(request);

  switch (host) {
    case "login":
      return "login";
    case "config":
      return "config";
    case "status":
      return "status";
    case "dashboard":
      return "dashboard";
    case "servers":
      return "servers";
    default:
      return null;
  }
}

export function detectWorkspaceAreaFromExternalPath(
  host: CanonicalHost,
  pathname: string,
) {
  const normalizedPathname = ensureLeadingSlash(pathname);

  switch (host) {
    case "login":
      return "login";
    case "config":
      return "config";
    case "status":
      return "status";
    case "dashboard":
      if (normalizedPathname === "/account" || normalizedPathname.startsWith("/account/")) {
        return "account";
      }
      if (normalizedPathname === "/servers" || normalizedPathname.startsWith("/servers/")) {
        return "servers";
      }
      return "dashboard";
    case "servers":
      if (normalizedPathname === "/account" || normalizedPathname.startsWith("/account/")) {
        return "account";
      }
      return "servers";
    default:
      return null;
  }
}

export function resolveCanonicalHostOrigin(
  request: RequestLike,
  host: CanonicalHost,
) {
  const currentHost = parseHost(getRequestHost(request));
  const runtime = resolveHostRuntimeContext(currentHost.hostname, currentHost.port);

  if (runtime.mode === "isolated") {
    return null;
  }

  if (isLocalSingleHostRequest(request)) {
    return getRequestOrigin(request);
  }

  const protocol = runtime.mode === "production" ? "https" : getRequestProtocol(request);
  const portSegment =
    runtime.mode === "local" && runtime.port ? `:${runtime.port}` : "";

  if (host === "public") {
    const targetHost =
      runtime.mode === "local"
        ? `${runtime.publicHost}${portSegment}`
        : runtime.publicHost;
    return `${protocol}://${targetHost}`;
  }

  const subdomain = CANONICAL_HOST_CONFIG[host].subdomain;
  if (!subdomain) {
    return null;
  }

  const targetHost = `${subdomain}.${runtime.baseDomain}${portSegment}`;
  return `${protocol}://${targetHost}`;
}

export function resolveWorkspaceOrigin(
  request: RequestLike,
  area: WorkspaceArea,
) {
  return resolveCanonicalHostOrigin(
    request,
    getWorkspaceAreaCanonicalHost(area),
  );
}

export function resolvePublicOrigin(request: RequestLike) {
  return resolveCanonicalHostOrigin(request, "public");
}

export function resolveAuthOrigin(request: RequestLike) {
  return resolveCanonicalHostOrigin(request, AUTH_HOST) || getRequestOrigin(request);
}

export function resolvePaymentOrigin(request: RequestLike) {
  return resolveCanonicalHostOrigin(request, PAYMENT_HOST) || getRequestOrigin(request);
}

export function buildCanonicalPaymentUrl(
  request: RequestLike,
  pathname = "/payment",
  search = "",
) {
  const origin = resolvePaymentOrigin(request);
  if (!origin) return null;

  return new URL(`${ensureLeadingSlash(pathname)}${search}`, origin).toString();
}

export function resolveCookieDomainForHostname(hostname: string) {
  const { hostname: normalizedHostname } = parseHost(hostname);

  if (
    !normalizedHostname ||
    isIpHostname(normalizedHostname) ||
    isBareLoopbackHostname(normalizedHostname)
  ) {
    return null;
  }

  const runtime = resolveHostRuntimeContext(normalizedHostname);
  return runtime.baseDomain;
}

export function resolveCookieDomainForRequest(request: RequestLike) {
  return resolveCookieDomainForHostname(getRequestHostname(request));
}

export function buildCanonicalWorkspaceUrl(
  request: RequestLike,
  area: WorkspaceArea,
  externalPath = "/",
  search = "",
) {
  const origin = resolveWorkspaceOrigin(request, area);
  if (!origin) return null;

  const pathname = ensureLeadingSlash(externalPath);
  const resolvedPathname = isLocalSingleHostRequest(request)
    ? getWorkspaceAreaInternalPath(area, pathname)
    : pathname;

  return new URL(`${resolvedPathname}${search}`, origin).toString();
}

export function buildCanonicalPublicUrl(
  request: RequestLike,
  pathname = "/",
  search = "",
) {
  const origin = resolvePublicOrigin(request);
  if (!origin) return null;

  return new URL(`${ensureLeadingSlash(pathname)}${search}`, origin).toString();
}

export function buildCanonicalUrlFromInternalPath(
  request: RequestLike,
  internalPath: string,
  options?: CanonicalRoutingFallbackOptions,
) {
  const resolvedUrl = new URL(internalPath, getRequestOrigin(request));
  const suffix = `${resolvedUrl.search}${resolvedUrl.hash}`;
  const pathArea = detectWorkspaceAreaFromPath(resolvedUrl.pathname);
  const fallbackHost =
    options?.fallbackHost ??
    (options?.fallbackArea
      ? options.fallbackArea === "public"
        ? "public"
        : getWorkspaceAreaCanonicalHost(options.fallbackArea)
      : null);

  if (pathArea) {
    const externalPath = getWorkspaceAreaExternalPath(
      pathArea,
      resolvedUrl.pathname,
    );

    if (
      isCanonicalPublicPath(externalPath) &&
      !(pathArea === "dashboard" && isDashboardEmbeddedPath(externalPath))
    ) {
      return (
        buildCanonicalPublicUrl(request, externalPath, suffix) ||
        resolvedUrl.toString()
      );
    }

    return (
      buildCanonicalWorkspaceUrl(
        request,
        pathArea,
        externalPath,
        suffix,
      ) || resolvedUrl.toString()
    );
  }

  if (isCanonicalPublicPath(resolvedUrl.pathname)) {
    return (
      buildCanonicalPublicUrl(
        request,
        resolvedUrl.pathname,
        suffix,
      ) || resolvedUrl.toString()
    );
  }

  if (fallbackHost === "public") {
    return (
      buildCanonicalPublicUrl(request, resolvedUrl.pathname, suffix) ||
      resolvedUrl.toString()
    );
  }

  if (fallbackHost) {
    const origin = resolveCanonicalHostOrigin(request, fallbackHost);
    return origin
      ? new URL(`${ensureLeadingSlash(resolvedUrl.pathname)}${suffix}`, origin).toString()
      : resolvedUrl.toString();
  }

  return resolvedUrl.toString();
}

function createBrowserRequestLike(): RequestLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  const headers = new Headers();
  headers.set("host", window.location.host);
  headers.set("x-forwarded-proto", window.location.protocol.replace(/:$/, ""));

  return {
    headers,
    url: window.location.href,
  };
}

export function buildBrowserRoutingTargetFromInternalPath(
  internalPath: string,
  options?: CanonicalRoutingFallbackOptions,
) {
  if (typeof window === "undefined") {
    return {
      href: internalPath,
      sameOrigin: true,
      path: internalPath,
    };
  }

  const requestLike = createBrowserRequestLike();
  const href = requestLike
    ? buildCanonicalUrlFromInternalPath(requestLike, internalPath, options)
    : internalPath;
  const resolvedUrl = new URL(href, window.location.href);

  return {
    href: resolvedUrl.toString(),
    sameOrigin: resolvedUrl.origin === window.location.origin,
    path: `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`,
  };
}

export function isCanonicalPublicPath(pathname: string) {
  const normalizedPathname = ensureLeadingSlash(pathname);

  return CANONICAL_PUBLIC_PATH_PREFIXES.some((prefix) => {
    if (normalizedPathname === prefix) return true;
    return normalizedPathname.startsWith(`${prefix}/`);
  });
}

export function isDashboardEmbeddedPath(pathname: string) {
  const normalizedPathname = ensureLeadingSlash(pathname);

  return DASHBOARD_EMBEDDED_PATH_PREFIXES.some((prefix) => {
    if (normalizedPathname === prefix) return true;
    return normalizedPathname.startsWith(`${prefix}/`);
  });
}
