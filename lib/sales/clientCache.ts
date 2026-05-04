"use client";

type ClientCacheEntry<TValue> = {
  timestamp: number;
  value: TValue;
};

const memoryCache = new Map<string, ClientCacheEntry<unknown>>();
const inflightCache = new Map<string, Promise<unknown>>();

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function cloneValue<TValue>(value: TValue) {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

function readStorageEntry<TValue>(key: string) {
  if (!canUseStorage()) return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as ClientCacheEntry<TValue>;
  } catch {
    return null;
  }
}

function writeStorageEntry<TValue>(key: string, entry: ClientCacheEntry<TValue>) {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Storage can be unavailable in private windows or full quotas.
  }
}

function deleteStorageEntry(key: string) {
  if (!canUseStorage()) return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // noop
  }
}

export function readClientCache<TValue>(key: string, ttlMs: number) {
  const memoryEntry = memoryCache.get(key) as ClientCacheEntry<TValue> | undefined;
  if (memoryEntry && Date.now() - memoryEntry.timestamp <= ttlMs) {
    return cloneValue(memoryEntry.value);
  }

  const storageEntry = readStorageEntry<TValue>(key);
  if (!storageEntry || Date.now() - storageEntry.timestamp > ttlMs) {
    memoryCache.delete(key);
    deleteStorageEntry(key);
    return null;
  }

  memoryCache.set(key, storageEntry);
  return cloneValue(storageEntry.value);
}

export function writeClientCache<TValue>(key: string, value: TValue) {
  const entry = {
    timestamp: Date.now(),
    value: cloneValue(value),
  };
  memoryCache.set(key, entry);
  writeStorageEntry(key, entry);
}

export function invalidateClientCache(prefix: string) {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }

  if (!canUseStorage()) return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) window.localStorage.removeItem(key);
    }
  } catch {
    // noop
  }
}

export async function coalescedClientFetch<TValue>(
  key: string,
  loader: () => Promise<TValue>,
) {
  const inflight = inflightCache.get(key) as Promise<TValue> | undefined;
  if (inflight) return inflight;

  const promise = loader();
  inflightCache.set(key, promise);

  try {
    return await promise;
  } finally {
    inflightCache.delete(key);
  }
}
