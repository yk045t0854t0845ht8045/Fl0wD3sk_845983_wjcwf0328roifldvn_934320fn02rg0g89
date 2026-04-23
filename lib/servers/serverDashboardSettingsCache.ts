type DashboardSettingsCacheEntry<TValue> = {
  expiresAt: number;
  value: TValue;
};

const dashboardSettingsCache = new Map<
  string,
  DashboardSettingsCacheEntry<unknown>
>();

function cloneJsonValue<TValue>(value: TValue) {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

function extractGuildIdFromCacheKey(key: string) {
  const firstSeparatorIndex = key.indexOf(":");
  if (firstSeparatorIndex === -1) return null;
  const secondSeparatorIndex = key.indexOf(":", firstSeparatorIndex + 1);
  if (secondSeparatorIndex === -1) return null;
  return key.slice(firstSeparatorIndex + 1, secondSeparatorIndex) || null;
}

export function buildDashboardSettingsCacheKey(input: {
  userId: number;
  guildId: string;
  dashboardPermissions: "full" | Set<string>;
}) {
  const permissionsKey =
    input.dashboardPermissions === "full"
      ? "full"
      : Array.from(input.dashboardPermissions).sort().join(",");
  return `${input.userId}:${input.guildId}:${permissionsKey}`;
}

export function readDashboardSettingsCache<TValue>(key: string) {
  const cached = dashboardSettingsCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardSettingsCache.delete(key);
    return null;
  }
  return cloneJsonValue(cached.value as TValue);
}

export function writeDashboardSettingsCache<TValue>(
  key: string,
  value: TValue,
  ttlMs: number,
) {
  dashboardSettingsCache.set(key, {
    value: cloneJsonValue(value),
    expiresAt: Date.now() + ttlMs,
  });
}

export function invalidateDashboardSettingsCache(input?: {
  guildId?: string | null;
}) {
  const guildId = input?.guildId?.trim() || null;
  if (!guildId) {
    dashboardSettingsCache.clear();
    return;
  }

  for (const key of dashboardSettingsCache.keys()) {
    if (extractGuildIdFromCacheKey(key) === guildId) {
      dashboardSettingsCache.delete(key);
    }
  }
}
