"use client";

import { useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";

import { resetBodyScrollLock } from "@/lib/ui/useBodyScrollLock";

function hasActiveModal() {
  return Boolean(
    document.querySelector(
      '[aria-modal="true"], [role="dialog"][aria-modal="true"]',
    ),
  );
}

function clearStaleInteractionLocks() {
  if (typeof document === "undefined" || hasActiveModal()) {
    return;
  }

  resetBodyScrollLock();
  document.body.style.pointerEvents = "";
  document.documentElement.style.pointerEvents = "";
  document.body.removeAttribute("inert");
  document.documentElement.removeAttribute("inert");
}

export function RouteInteractionRecovery() {
  const pathname = usePathname();

  const scheduleRecovery = useCallback(() => {
    window.requestAnimationFrame(() => {
      clearStaleInteractionLocks();
      window.setTimeout(clearStaleInteractionLocks, 90);
    });
  }, []);

  useEffect(() => {
    scheduleRecovery();
  }, [pathname, scheduleRecovery]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        scheduleRecovery();
      }
    }

    window.addEventListener("pageshow", scheduleRecovery);
    window.addEventListener("popstate", scheduleRecovery);
    window.addEventListener("focus", scheduleRecovery);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", scheduleRecovery);
      window.removeEventListener("popstate", scheduleRecovery);
      window.removeEventListener("focus", scheduleRecovery);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [scheduleRecovery]);

  return null;
}
