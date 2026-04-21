"use client";

import type { ManagedServer } from "@/lib/servers/managedServersShared";
import type { PendingTeamInvite, UserTeam } from "@/lib/teams/userTeams";

const WORKSPACE_CACHE_TTL_MS = 90_000;

type CachedServersEntry = {
  timestamp: number;
  servers: ManagedServer[];
};

type CachedTeamsEntry = {
  timestamp: number;
  teams: UserTeam[];
  pendingInvites: PendingTeamInvite[];
};

const serversMemoryCache = new Map<string, CachedServersEntry>();
const teamsMemoryCache = new Map<string, CachedTeamsEntry>();

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function isFresh(timestamp: number) {
  return Date.now() - timestamp <= WORKSPACE_CACHE_TTL_MS;
}

function getServersStorageKey(accountKey: string) {
  return `flowdesk_servers_workspace_cache_v2:${accountKey}`;
}

function getTeamsStorageKey(accountKey: string) {
  return `flowdesk_teams_workspace_cache_v1:${accountKey}`;
}

function readStorageEntry<T>(storageKey: string) {
  if (!canUseStorage()) return null;

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeStorageEntry(storageKey: string, value: unknown) {
  if (!canUseStorage()) return;

  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // noop
  }
}

function deleteStorageEntry(storageKey: string) {
  if (!canUseStorage()) return;

  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // noop
  }
}

export function readCachedManagedServers(accountKey: string) {
  const storageKey = getServersStorageKey(accountKey);
  const memoryEntry = serversMemoryCache.get(accountKey);
  if (memoryEntry && isFresh(memoryEntry.timestamp)) {
    return memoryEntry.servers;
  }

  const storageEntry = readStorageEntry<CachedServersEntry>(storageKey);
  if (!storageEntry || !isFresh(storageEntry.timestamp)) {
    deleteStorageEntry(storageKey);
    return null;
  }

  serversMemoryCache.set(accountKey, storageEntry);
  return storageEntry.servers;
}

export function readManagedServersMemoryCache(accountKey: string) {
  const memoryEntry = serversMemoryCache.get(accountKey);
  if (!memoryEntry || !isFresh(memoryEntry.timestamp)) {
    return null;
  }

  return memoryEntry.servers;
}

export function storeCachedManagedServers(
  accountKey: string,
  servers: ManagedServer[],
) {
  const entry: CachedServersEntry = {
    timestamp: Date.now(),
    servers,
  };

  serversMemoryCache.set(accountKey, entry);
  writeStorageEntry(getServersStorageKey(accountKey), entry);
}

export function readCachedTeamsSnapshot(accountKey: string) {
  const storageKey = getTeamsStorageKey(accountKey);
  const memoryEntry = teamsMemoryCache.get(accountKey);
  if (memoryEntry && isFresh(memoryEntry.timestamp)) {
    return {
      teams: memoryEntry.teams,
      pendingInvites: memoryEntry.pendingInvites,
    };
  }

  const storageEntry = readStorageEntry<CachedTeamsEntry>(storageKey);
  if (!storageEntry || !isFresh(storageEntry.timestamp)) {
    deleteStorageEntry(storageKey);
    return null;
  }

  teamsMemoryCache.set(accountKey, storageEntry);
  return {
    teams: storageEntry.teams,
    pendingInvites: storageEntry.pendingInvites,
  };
}

export function readTeamsSnapshotMemoryCache(accountKey: string) {
  const memoryEntry = teamsMemoryCache.get(accountKey);
  if (!memoryEntry || !isFresh(memoryEntry.timestamp)) {
    return null;
  }

  return {
    teams: memoryEntry.teams,
    pendingInvites: memoryEntry.pendingInvites,
  };
}

export function storeCachedTeamsSnapshot(
  accountKey: string,
  teams: UserTeam[],
  pendingInvites: PendingTeamInvite[],
) {
  const entry: CachedTeamsEntry = {
    timestamp: Date.now(),
    teams,
    pendingInvites,
  };

  teamsMemoryCache.set(accountKey, entry);
  writeStorageEntry(getTeamsStorageKey(accountKey), entry);
}
