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

const warmedOrigins = new Set<string>();
const warmedDocuments = new Set<string>();
const warmedSameOriginPaths = new Set<string>();

function canUseBrowserWarmup() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function appendHintLink(
  key: string,
  configure: (link: HTMLLinkElement) => void,
) {
  if (!canUseBrowserWarmup() || warmedDocuments.has(key)) {
    return;
  }

  warmedDocuments.add(key);
  const link = document.createElement("link");
  configure(link);
  link.dataset.flowdeskWarmup = key;
  document.head.appendChild(link);
}

function warmOrigin(origin: string) {
  if (!canUseBrowserWarmup() || warmedOrigins.has(origin)) {
    return;
  }

  warmedOrigins.add(origin);

  const url = new URL(origin);
  appendHintLink(`dns:${url.host}`, (link) => {
    link.rel = "dns-prefetch";
    link.href = `//${url.host}`;
  });

  appendHintLink(`preconnect:${origin}`, (link) => {
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "use-credentials";
  });
}

function warmDocument(href: string, crossOrigin: boolean) {
  appendHintLink(`document:${href}`, (link) => {
    link.rel = "prefetch";
    link.as = "document";
    link.href = href;
    if (crossOrigin) {
      link.crossOrigin = "use-credentials";
    }
  });
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
    !warmedSameOriginPaths.has(target.path)
  ) {
    warmedSameOriginPaths.add(target.path);
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
      timeout: options?.delayMs ?? 180,
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
    options?.delayMs ?? 60,
  );

  return () => {
    cancelled = true;
    window.clearTimeout(timeoutHandle);
  };
}
