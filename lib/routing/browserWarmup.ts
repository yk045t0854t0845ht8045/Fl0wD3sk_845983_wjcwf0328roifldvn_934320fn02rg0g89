"use client";

import { buildBrowserRoutingTargetFromInternalPath } from "@/lib/routing/subdomains";

type RouterPrefetchLike = {
  prefetch: (href: string) => void | Promise<void>;
};

type WarmBrowserRouteOptions = {
  router?: RouterPrefetchLike | null;
  prefetchDocument?: boolean;
};

type ScheduleWarmBrowserRoutesOptions = WarmBrowserRouteOptions & {
  delayMs?: number;
};

const ORIGIN_HINT_TTL_MS = 10 * 60_000;
const DOCUMENT_HINT_TTL_MS = 45_000;
const ROUTER_PREFETCH_TTL_MS = 35_000;

const warmedOrigins = new Map<string, number>();
const warmedHints = new Map<string, number>();
const warmedSameOriginPaths = new Map<string, number>();

function canUseBrowserWarmup() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isWarmEntryActive(cache: Map<string, number>, key: string) {
  const expiresAt = cache.get(key);
  if (!expiresAt) {
    return false;
  }

  if (expiresAt <= Date.now()) {
    cache.delete(key);
    return false;
  }

  return true;
}

function markWarmEntry(cache: Map<string, number>, key: string, ttlMs: number) {
  cache.set(key, Date.now() + ttlMs);
}

function removeExistingHintLink(key: string) {
  if (!canUseBrowserWarmup()) {
    return;
  }

  document
    .querySelectorAll<HTMLLinkElement>("link[data-flowdesk-warmup]")
    .forEach((link) => {
      if (link.dataset.flowdeskWarmup === key) {
        link.remove();
      }
    });
}

function appendHintLink(
  key: string,
  configure: (link: HTMLLinkElement) => void,
  ttlMs: number,
) {
  if (!canUseBrowserWarmup() || isWarmEntryActive(warmedHints, key)) {
    return;
  }

  markWarmEntry(warmedHints, key, ttlMs);
  removeExistingHintLink(key);
  const link = document.createElement("link");
  configure(link);
  link.dataset.flowdeskWarmup = key;
  document.head.appendChild(link);
}

function warmOrigin(origin: string) {
  if (!canUseBrowserWarmup() || isWarmEntryActive(warmedOrigins, origin)) {
    return;
  }

  markWarmEntry(warmedOrigins, origin, ORIGIN_HINT_TTL_MS);

  const url = new URL(origin);
  appendHintLink(`dns:${url.host}`, (link) => {
    link.rel = "dns-prefetch";
    link.href = `//${url.host}`;
  }, ORIGIN_HINT_TTL_MS);

  appendHintLink(`preconnect:${origin}`, (link) => {
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "use-credentials";
  }, ORIGIN_HINT_TTL_MS);
}

function warmDocument(href: string, crossOrigin: boolean) {
  appendHintLink(`document:${href}`, (link) => {
    link.rel = "prefetch";
    link.as = "document";
    link.href = href;
    if (crossOrigin) {
      link.crossOrigin = "use-credentials";
    }
  }, DOCUMENT_HINT_TTL_MS);
}

export function warmBrowserRoute(
  href: string,
  options?: WarmBrowserRouteOptions,
) {
  const target = buildBrowserRoutingTargetFromInternalPath(href);

  if (!canUseBrowserWarmup()) {
    return target;
  }

  if (!target.sameOrigin) {
    warmOrigin(new URL(target.href).origin);
  }

  if (options?.prefetchDocument !== false) {
    warmDocument(target.href, !target.sameOrigin);
  }

  if (
    target.sameOrigin &&
    options?.router &&
    !isWarmEntryActive(warmedSameOriginPaths, target.path)
  ) {
    markWarmEntry(
      warmedSameOriginPaths,
      target.path,
      ROUTER_PREFETCH_TTL_MS,
    );
    void options.router.prefetch(target.path);
  }

  return target;
}

export function scheduleWarmBrowserRoutes(
  hrefs: string[],
  options?: ScheduleWarmBrowserRoutesOptions,
) {
  if (!canUseBrowserWarmup() || !hrefs.length) {
    return () => {};
  }

  let cancelled = false;
  const runWarmup = () => {
    if (cancelled) return;
    hrefs.forEach((href) => {
      warmBrowserRoute(href, options);
    });
  };

  const requestIdleCallbackRef = window.requestIdleCallback;
  if (typeof requestIdleCallbackRef === "function") {
    const idleHandle = requestIdleCallbackRef(runWarmup, {
      timeout: options?.delayMs ?? 120,
    });

    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
    };
  }

  const timeoutHandle = window.setTimeout(
    runWarmup,
    options?.delayMs ?? 40,
  );

  return () => {
    cancelled = true;
    window.clearTimeout(timeoutHandle);
  };
}
