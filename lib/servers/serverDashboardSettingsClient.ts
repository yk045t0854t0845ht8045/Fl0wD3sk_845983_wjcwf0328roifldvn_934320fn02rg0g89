"use client";

import type { TicketPanelLayout } from "@/lib/servers/ticketPanelBuilder";

type SelectOption = {
  id: string;
  name: string;
};

type ServerDashboardSettingsPayload = {
  ok: true;
  guild: {
    id: string;
    name: string;
  };
  channels: {
    text: Array<{ id: string; name: string; type: number; position: number }>;
    categories: Array<{ id: string; name: string; type: number; position: number }>;
  };
  roles: Array<{ id: string; name: string; color: number; position: number }>;
  ticketSettings: {
    menuChannelId: string | null;
    ticketsCategoryId: string | null;
    logsCreatedChannelId: string | null;
    logsClosedChannelId: string | null;
    panelLayout: TicketPanelLayout;
    panelTitle: string;
    panelDescription: string;
    panelButtonLabel: string;
    updatedAt: string | null;
  } | null;
  staffSettings: {
    adminRoleId: string | null;
    claimRoleIds: string[];
    closeRoleIds: string[];
    notifyRoleIds: string[];
    updatedAt: string | null;
  } | null;
};

type ServerDashboardSettingsApiResponse =
  | ServerDashboardSettingsPayload
  | {
      ok: false;
      message?: string;
    };

const SERVER_DASHBOARD_SETTINGS_CACHE_TTL_MS = 30_000;
const SERVER_DASHBOARD_SETTINGS_STORAGE_KEY =
  "flowdesk_server_dashboard_settings_cache_v1";

const dashboardSettingsCache = new Map<
  string,
  {
    timestamp: number;
    payload: ServerDashboardSettingsPayload;
  }
>();

const dashboardSettingsInflight = new Map<
  string,
  Promise<ServerDashboardSettingsPayload>
>();

function canUseStorage() {
  return (
    typeof window !== "undefined" &&
    typeof window.sessionStorage !== "undefined"
  );
}

function readStorageCache() {
  if (!canUseStorage()) return {};

  try {
    const raw = window.sessionStorage.getItem(
      SERVER_DASHBOARD_SETTINGS_STORAGE_KEY,
    );
    if (!raw) return {};
    return JSON.parse(raw) as Record<
      string,
      {
        timestamp: number;
        payload: ServerDashboardSettingsPayload;
      }
    >;
  } catch {
    return {};
  }
}

function writeStorageCache(
  cache: Record<
    string,
    {
      timestamp: number;
      payload: ServerDashboardSettingsPayload;
    }
  >,
) {
  if (!canUseStorage()) return;

  try {
    window.sessionStorage.setItem(
      SERVER_DASHBOARD_SETTINGS_STORAGE_KEY,
      JSON.stringify(cache),
    );
  } catch {
    // noop
  }
}

function readFreshCachedPayload(guildId: string) {
  const cached = dashboardSettingsCache.get(guildId);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > SERVER_DASHBOARD_SETTINGS_CACHE_TTL_MS) {
    dashboardSettingsCache.delete(guildId);
    return null;
  }
  return cached.payload;
}

function readFreshStoragePayload(guildId: string) {
  const cache = readStorageCache();
  const cached = cache[guildId];
  if (!cached) return null;
  if (Date.now() - cached.timestamp > SERVER_DASHBOARD_SETTINGS_CACHE_TTL_MS) {
    delete cache[guildId];
    writeStorageCache(cache);
    return null;
  }
  return cached.payload;
}

function storePayload(guildId: string, payload: ServerDashboardSettingsPayload) {
  dashboardSettingsCache.set(guildId, {
    timestamp: Date.now(),
    payload,
  });

  const cache = readStorageCache();
  cache[guildId] = {
    timestamp: Date.now(),
    payload,
  };
  writeStorageCache(cache);
}

async function requestServerDashboardSettings(
  guildId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/auth/me/guilds/dashboard-settings?guildId=${encodeURIComponent(guildId)}`,
    {
      cache: "no-store",
      signal,
    },
  );

  const payload = (await response.json()) as ServerDashboardSettingsApiResponse;

  if (!response.ok || !payload.ok) {
    const message =
      "message" in payload ? payload.message : undefined;
    throw new Error(message || "Falha ao carregar configuracoes do servidor.");
  }

  storePayload(guildId, payload);
  return payload;
}

export function readCachedServerDashboardSettings(guildId: string) {
  const memoryPayload = readFreshCachedPayload(guildId);
  if (memoryPayload) {
    return memoryPayload;
  }

  const storagePayload = readFreshStoragePayload(guildId);
  if (storagePayload) {
    dashboardSettingsCache.set(guildId, {
      timestamp: Date.now(),
      payload: storagePayload,
    });
    return storagePayload;
  }

  return null;
}

export async function getServerDashboardSettings(
  guildId: string,
  options?: { signal?: AbortSignal; preferCache?: boolean },
) {
  const preferCache = options?.preferCache ?? true;
  if (preferCache) {
    const cached = readFreshCachedPayload(guildId);
    if (cached) {
      return cached;
    }
  }

  if (!options?.signal) {
    const inflight = dashboardSettingsInflight.get(guildId);
    if (inflight) {
      return inflight;
    }
  }

  const requestPromise = requestServerDashboardSettings(guildId, options?.signal);

  if (!options?.signal) {
    dashboardSettingsInflight.set(guildId, requestPromise);
  }

  try {
    return await requestPromise;
  } finally {
    if (!options?.signal) {
      dashboardSettingsInflight.delete(guildId);
    }
  }
}

export async function prefetchServerDashboardSettings(guildId: string) {
  const cached = readCachedServerDashboardSettings(guildId);
  if (cached) return;

  const inflight = dashboardSettingsInflight.get(guildId);
  if (inflight) {
    try {
      await inflight;
    } catch {
      // noop
    }
    return;
  }

  try {
    await getServerDashboardSettings(guildId, { preferCache: false });
  } catch {
    // melhor esforco; nao bloquear a navegacao por prefetch
  }
}

export type {
  SelectOption,
  ServerDashboardSettingsPayload,
};
