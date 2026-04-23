"use client";

import { useSyncExternalStore } from "react";
import {
  WorkspaceRouteContentLoading,
  WorkspaceRouteLoading,
} from "@/components/workspace/WorkspaceRouteLoading";

type AdaptiveWorkspaceVariant = "account" | "dashboard";

const WORKSPACE_SHELL_READY_EVENT = "flowdesk:workspace-shell-ready";
const WORKSPACE_SHELL_READY_ATTR: Record<AdaptiveWorkspaceVariant, string> = {
  account: "data-flowdesk-account-shell-ready",
  dashboard: "data-flowdesk-dashboard-shell-ready",
};

function subscribeToShellReady(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener(WORKSPACE_SHELL_READY_EVENT, onStoreChange);

  return () => {
    window.removeEventListener(WORKSPACE_SHELL_READY_EVENT, onStoreChange);
  };
}

function readShellReadyState(variant: AdaptiveWorkspaceVariant) {
  if (typeof document === "undefined") {
    return false;
  }

  return (
    document.documentElement.getAttribute(WORKSPACE_SHELL_READY_ATTR[variant]) ===
    "1"
  );
}

export function setWorkspaceShellReadyState(
  variant: AdaptiveWorkspaceVariant,
  isReady: boolean,
) {
  if (typeof document === "undefined") {
    return;
  }

  const attr = WORKSPACE_SHELL_READY_ATTR[variant];
  if (isReady) {
    document.documentElement.setAttribute(attr, "1");
  } else {
    document.documentElement.removeAttribute(attr);
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WORKSPACE_SHELL_READY_EVENT));
  }
}

export function WorkspaceRouteAdaptiveLoading({
  variant,
}: {
  variant: AdaptiveWorkspaceVariant;
}) {
  const hasMountedShell = useSyncExternalStore(
    subscribeToShellReady,
    () => readShellReadyState(variant),
    () => false,
  );

  if (hasMountedShell) {
    return <WorkspaceRouteContentLoading variant={variant} />;
  }

  return <WorkspaceRouteLoading variant={variant} />;
}
