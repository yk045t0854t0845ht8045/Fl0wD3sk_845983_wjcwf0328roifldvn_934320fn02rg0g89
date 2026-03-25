"use client";

import { useEffect, useRef } from "react";
import Lenis from "@studio-freight/lenis";

function resolveHashTarget(hash: string) {
  const normalizedHash = hash.replace(/^#/, "").toLowerCase();
  const resolvedId = normalizedHash === "pricing" ? "plans" : normalizedHash;

  if (!resolvedId) {
    return null;
  }

  return document.getElementById(resolvedId);
}

function getHeaderOffset() {
  const headerElement = document.querySelector("header");

  if (!(headerElement instanceof HTMLElement)) {
    return -28;
  }

  return -(headerElement.offsetHeight + 18);
}

export function LandingSmoothScroll() {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const reduceMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );

    if (reduceMotionQuery.matches) {
      return;
    }

    const lenis = new Lenis({
      lerp: 0.085,
      smoothWheel: true,
      duration: 1.15,
      wheelMultiplier: 0.94,
      touchMultiplier: 1,
      autoResize: false,
    });

    lenisRef.current = lenis;

    let animationFrameId = 0;
    let resizeFrameId = 0;
    let resizeTimeoutId: number | null = null;

    const raf = (time: number) => {
      lenis.raf(time);
      animationFrameId = window.requestAnimationFrame(raf);
    };

    animationFrameId = window.requestAnimationFrame(raf);

    const scheduleResize = () => {
      if (resizeFrameId !== 0) {
        window.cancelAnimationFrame(resizeFrameId);
      }

      resizeFrameId = window.requestAnimationFrame(() => {
        lenis.resize();
        resizeFrameId = 0;
      });
    };

    const scheduleResizeBurst = () => {
      scheduleResize();

      if (resizeTimeoutId) {
        window.clearTimeout(resizeTimeoutId);
      }

      resizeTimeoutId = window.setTimeout(() => {
        scheduleResize();
      }, 160);
    };

    const scrollToHash = (hash: string, replaceState = false) => {
      const targetElement = resolveHashTarget(hash);

      if (!targetElement) {
        return;
      }

      const nextHash = hash.replace(/^#pricing$/i, "#plans");
      const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;

      if (replaceState) {
        window.history.replaceState(null, "", nextUrl);
      } else if (window.location.hash !== nextHash) {
        window.history.pushState(null, "", nextUrl);
      }

      lenis.scrollTo(targetElement, {
        offset: getHeaderOffset(),
        duration: 1.2,
        easing: (value: number) => 1 - Math.pow(1 - value, 4),
      });
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;

      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }

      const href = anchor.getAttribute("href");

      if (!href || !href.includes("#")) {
        return;
      }

      const resolvedUrl = new URL(href, window.location.href);

      if (
        resolvedUrl.origin !== window.location.origin ||
        resolvedUrl.pathname !== window.location.pathname ||
        !resolvedUrl.hash
      ) {
        return;
      }

      const targetElement = resolveHashTarget(resolvedUrl.hash);

      if (!targetElement) {
        return;
      }

      event.preventDefault();
      scrollToHash(resolvedUrl.hash);
    };

    const handleHashChange = () => {
      if (!window.location.hash) {
        return;
      }

      scrollToHash(window.location.hash, true);
    };

    const handleWindowResize = () => {
      scheduleResizeBurst();
    };

    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("load", handleWindowResize);
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("pageshow", handleWindowResize);
    window.addEventListener("orientationchange", handleWindowResize);

    const resizeObserver = new ResizeObserver(() => {
      scheduleResizeBurst();
    });

    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(document.body);

    void document.fonts?.ready.then(() => {
      scheduleResizeBurst();
    });

    scheduleResizeBurst();

    window.requestAnimationFrame(() => {
      scheduleResizeBurst();
    });

    if (window.location.hash) {
      window.requestAnimationFrame(() => {
        scrollToHash(window.location.hash, true);
      });
    }

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("load", handleWindowResize);
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("pageshow", handleWindowResize);
      window.removeEventListener("orientationchange", handleWindowResize);
      resizeObserver.disconnect();
      if (resizeTimeoutId) {
        window.clearTimeout(resizeTimeoutId);
      }
      if (resizeFrameId !== 0) {
        window.cancelAnimationFrame(resizeFrameId);
      }
      window.cancelAnimationFrame(animationFrameId);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return null;
}
