"use client";

const TEAM_SELECTION_STORAGE_PREFIX = "flowdesk_selected_team_v1";

function buildStorageKey(workspaceCacheKey: string) {
  return `${TEAM_SELECTION_STORAGE_PREFIX}:${workspaceCacheKey}`;
}

export function readStoredSelectedTeamId(workspaceCacheKey: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(buildStorageKey(workspaceCacheKey));
    if (!raw) {
      return null;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredSelectedTeamId(
  workspaceCacheKey: string,
  teamId: number | null,
) {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = buildStorageKey(workspaceCacheKey);

  try {
    if (typeof teamId === "number" && Number.isFinite(teamId) && teamId > 0) {
      window.localStorage.setItem(storageKey, String(teamId));
      return;
    }

    window.localStorage.removeItem(storageKey);
  } catch {
    // noop
  }
}
