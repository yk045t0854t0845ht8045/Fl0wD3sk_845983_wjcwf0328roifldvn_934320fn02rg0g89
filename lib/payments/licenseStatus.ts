import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type GuildLicenseStatus = "paid" | "expired" | "off" | "not_paid";

export const LICENSE_VALIDITY_DAYS = 30;
export const EXPIRED_GRACE_DAYS = 3;
export const LICENSE_RENEWAL_WINDOW_DAYS = 3;
export const LICENSE_VALIDITY_MS = LICENSE_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
export const EXPIRED_GRACE_MS = EXPIRED_GRACE_DAYS * 24 * 60 * 60 * 1000;
export const LICENSE_RENEWAL_WINDOW_MS =
  LICENSE_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const LICENSE_STATUS_CACHE_TTL_MS = 12_000;
const LOCKED_GUILD_LICENSE_CACHE_TTL_MS = 12_000;

type CacheEntry<TValue> = {
  expiresAtMs: number;
  value: TValue;
};

type LicenseStatusQueryOptions = {
  forceFresh?: boolean;
};

type ApprovedOrderRecord = {
  paid_at: string | null;
  created_at: string;
};

type ApprovedOrderWithUserRecord = ApprovedOrderRecord & {
  guild_id: string;
  user_id: number;
};

export type LicenseApprovedOrderRecord = ApprovedOrderRecord & {
  id?: number;
  order_number?: number;
  guild_id?: string;
  user_id?: number;
};

export type ResolvedLicenseCoverage<
  TOrder extends LicenseApprovedOrderRecord = LicenseApprovedOrderRecord,
> = {
  order: TOrder;
  status: "paid" | "expired" | "off";
  paidAt: string | null;
  createdAt: string;
  licenseStartsAt: string;
  licenseExpiresAt: string;
  graceExpiresAt: string;
  renewalWindowStartsAt: string;
  renewalEligible: boolean;
};

export type LockedGuildLicenseRecord = {
  guildId: string;
  userId: number;
  status: "paid" | "expired";
  paidAt: string | null;
  createdAt: string;
  licenseStartsAt: string;
  licenseExpiresAt: string;
  graceExpiresAt: string;
  renewalWindowStartsAt: string;
};

const guildLicenseStatusCache = new Map<
  string,
  CacheEntry<GuildLicenseStatus>
>();
const guildLicenseStatusInflight = new Map<string, Promise<GuildLicenseStatus>>();
const lockedGuildLicenseCache = new Map<
  string,
  CacheEntry<LockedGuildLicenseRecord | null>
>();
const lockedGuildLicenseInflight = new Map<
  string,
  Promise<LockedGuildLicenseRecord | null>
>();

function readCacheEntry<TValue>(
  cache: Map<string, CacheEntry<TValue>>,
  key: string,
): TValue | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAtMs <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

function writeCacheEntry<TValue>(
  cache: Map<string, CacheEntry<TValue>>,
  key: string,
  value: TValue,
  ttlMs: number,
) {
  cache.set(key, {
    value,
    expiresAtMs: Date.now() + ttlMs,
  });
}

export function invalidateGuildLicenseCaches(guildId?: string) {
  if (typeof guildId === "string" && guildId.trim().length > 0) {
    guildLicenseStatusCache.delete(guildId);
    guildLicenseStatusInflight.delete(guildId);
    lockedGuildLicenseCache.delete(guildId);
    lockedGuildLicenseInflight.delete(guildId);
    return;
  }

  guildLicenseStatusCache.clear();
  guildLicenseStatusInflight.clear();
  lockedGuildLicenseCache.clear();
  lockedGuildLicenseInflight.clear();
}

export function resolveLicenseBaseTimestamp(order: ApprovedOrderRecord) {
  const paidAtMs = order.paid_at ? Date.parse(order.paid_at) : Number.NaN;
  if (Number.isFinite(paidAtMs)) return paidAtMs;

  const createdAtMs = Date.parse(order.created_at);
  if (Number.isFinite(createdAtMs)) return createdAtMs;

  return Date.now();
}

export function resolveLicenseCoverageForApprovedOrders<
  TOrder extends LicenseApprovedOrderRecord,
>(approvedOrders: TOrder[], nowMs = Date.now()) {
  const sortedOrders = [...approvedOrders].sort((left, right) => {
    const timestampDiff =
      resolveLicenseBaseTimestamp(left) - resolveLicenseBaseTimestamp(right);
    if (timestampDiff !== 0) return timestampDiff;

    const leftCreatedAt = Date.parse(left.created_at);
    const rightCreatedAt = Date.parse(right.created_at);
    if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt)) {
      return leftCreatedAt - rightCreatedAt;
    }

    return 0;
  });

  const coverages: Array<ResolvedLicenseCoverage<TOrder>> = [];
  let previousCoverage: ResolvedLicenseCoverage<TOrder> | null = null;

  for (const order of sortedOrders) {
    const paidTimestampMs = resolveLicenseBaseTimestamp(order);
    let licenseStartsAtMs = paidTimestampMs;

    if (previousCoverage) {
      const previousLicenseExpiresAtMs = Date.parse(previousCoverage.licenseExpiresAt);
      const previousGraceExpiresAtMs = Date.parse(previousCoverage.graceExpiresAt);

      if (
        Number.isFinite(previousLicenseExpiresAtMs) &&
        Number.isFinite(previousGraceExpiresAtMs)
      ) {
        const previousRenewalWindowStartsAtMs =
          previousLicenseExpiresAtMs - LICENSE_RENEWAL_WINDOW_MS;

        if (
          paidTimestampMs >= previousRenewalWindowStartsAtMs &&
          paidTimestampMs <= previousGraceExpiresAtMs
        ) {
          licenseStartsAtMs = previousLicenseExpiresAtMs;
        }
      }
    }

    const licenseExpiresAtMs = licenseStartsAtMs + LICENSE_VALIDITY_MS;
    const graceExpiresAtMs = licenseExpiresAtMs + EXPIRED_GRACE_MS;
    const renewalWindowStartsAtMs =
      licenseExpiresAtMs - LICENSE_RENEWAL_WINDOW_MS;

    let status: "paid" | "expired" | "off" = "off";
    if (nowMs <= licenseExpiresAtMs) {
      status = "paid";
    } else if (nowMs <= graceExpiresAtMs) {
      status = "expired";
    }

    const coverage: ResolvedLicenseCoverage<TOrder> = {
      order,
      status,
      paidAt: order.paid_at,
      createdAt: order.created_at,
      licenseStartsAt: new Date(licenseStartsAtMs).toISOString(),
      licenseExpiresAt: new Date(licenseExpiresAtMs).toISOString(),
      graceExpiresAt: new Date(graceExpiresAtMs).toISOString(),
      renewalWindowStartsAt: new Date(renewalWindowStartsAtMs).toISOString(),
      renewalEligible:
        nowMs >= renewalWindowStartsAtMs && nowMs <= graceExpiresAtMs,
    };

    coverages.push(coverage);
    previousCoverage = coverage;
  }

  return coverages;
}

export function resolveLatestLicenseCoverageFromApprovedOrders<
  TOrder extends LicenseApprovedOrderRecord,
>(approvedOrders: TOrder[], nowMs = Date.now()) {
  const coverages = resolveLicenseCoverageForApprovedOrders(
    approvedOrders,
    nowMs,
  );
  return coverages.length ? coverages[coverages.length - 1] : null;
}

export function resolveCoverageForApprovedOrder<
  TOrder extends LicenseApprovedOrderRecord,
>(approvedOrders: TOrder[], targetOrder: TOrder, nowMs = Date.now()) {
  const coverages = resolveLicenseCoverageForApprovedOrders(
    approvedOrders,
    nowMs,
  );
  return (
    coverages.find((coverage) => coverage.order === targetOrder) ||
    coverages.find((coverage) => {
      if (
        typeof coverage.order.id === "number" &&
        typeof targetOrder.id === "number"
      ) {
        return coverage.order.id === targetOrder.id;
      }

      if (
        typeof coverage.order.order_number === "number" &&
        typeof targetOrder.order_number === "number"
      ) {
        return coverage.order.order_number === targetOrder.order_number;
      }

      return (
        coverage.order.created_at === targetOrder.created_at &&
        coverage.order.paid_at === targetOrder.paid_at
      );
    }) ||
    null
  );
}

export function isLicenseCoverageActive(
  coverage: ResolvedLicenseCoverage<LicenseApprovedOrderRecord> | null | undefined,
) {
  return coverage?.status === "paid";
}

export function isLicenseCoverageUsable(
  coverage: ResolvedLicenseCoverage<LicenseApprovedOrderRecord> | null | undefined,
) {
  return coverage?.status === "paid" || coverage?.status === "expired";
}

export function resolveGuildLicenseStatusFromApprovedOrders<
  TOrder extends LicenseApprovedOrderRecord,
>(approvedOrders: TOrder[], nowMs = Date.now()): GuildLicenseStatus {
  const latestCoverage = resolveLatestLicenseCoverageFromApprovedOrders(
    approvedOrders,
    nowMs,
  );
  return latestCoverage ? latestCoverage.status : "not_paid";
}

export function resolveRenewalPaymentDecision<
  TOrder extends LicenseApprovedOrderRecord,
>(
  currentCoverage: ResolvedLicenseCoverage<TOrder> | null,
  paymentTimestampMs = Date.now(),
) {
  if (!currentCoverage) {
    return {
      allowed: true as const,
      reason: "new_cycle" as const,
      licenseStartsAtMs: paymentTimestampMs,
    };
  }

  const renewalWindowStartsAtMs = Date.parse(
    currentCoverage.renewalWindowStartsAt,
  );
  const licenseExpiresAtMs = Date.parse(currentCoverage.licenseExpiresAt);
  const graceExpiresAtMs = Date.parse(currentCoverage.graceExpiresAt);

  if (
    Number.isFinite(renewalWindowStartsAtMs) &&
    paymentTimestampMs < renewalWindowStartsAtMs
  ) {
    return {
      allowed: false as const,
      reason: "too_early" as const,
      licenseStartsAtMs: null,
    };
  }

  if (
    Number.isFinite(graceExpiresAtMs) &&
    paymentTimestampMs <= graceExpiresAtMs &&
    Number.isFinite(licenseExpiresAtMs)
  ) {
    return {
      allowed: true as const,
      reason:
        paymentTimestampMs <= licenseExpiresAtMs
          ? ("renewal_window" as const)
          : ("grace_window" as const),
      licenseStartsAtMs: licenseExpiresAtMs,
    };
  }

  return {
    allowed: true as const,
    reason: "new_cycle" as const,
    licenseStartsAtMs: paymentTimestampMs,
  };
}

export async function getApprovedOrdersForGuild<
  TOrder extends LicenseApprovedOrderRecord,
>(guildId: string, selectColumns: string, limit = 120) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(selectColumns)
    .eq("guild_id", guildId)
    .eq("status", "approved")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<TOrder[]>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data || [];
}

export async function getLatestLicenseCoverageForGuild<
  TOrder extends LicenseApprovedOrderRecord,
>(guildId: string, selectColumns: string, nowMs = Date.now()) {
  const approvedOrders = await getApprovedOrdersForGuild<TOrder>(
    guildId,
    selectColumns,
  );
  return resolveLatestLicenseCoverageFromApprovedOrders(approvedOrders, nowMs);
}

export async function getOrderCoverageForGuild<
  TOrder extends LicenseApprovedOrderRecord,
>(
  guildId: string,
  targetOrder: TOrder,
  selectColumns: string,
  nowMs = Date.now(),
) {
  const approvedOrders = await getApprovedOrdersForGuild<TOrder>(
    guildId,
    selectColumns,
  );
  return resolveCoverageForApprovedOrder(approvedOrders, targetOrder, nowMs);
}

export async function getApprovedOrdersForGuilds<
  TOrder extends LicenseApprovedOrderRecord & { guild_id: string },
>(guildIds: string[], selectColumns: string) {
  const normalizedGuildIds = Array.from(
    new Set(
      guildIds.filter(
        (guildId): guildId is string =>
          typeof guildId === "string" && guildId.trim().length > 0,
      ),
    ),
  );

  const ordersByGuild = new Map<string, TOrder[]>();
  if (!normalizedGuildIds.length) {
    return ordersByGuild;
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(selectColumns)
    .in("guild_id", normalizedGuildIds)
    .eq("status", "approved")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<TOrder[]>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  for (const order of result.data || []) {
    const guildId = order.guild_id;
    const current = ordersByGuild.get(guildId) || [];
    current.push(order);
    ordersByGuild.set(guildId, current);
  }

  return ordersByGuild;
}

export function resolveLatestLicenseCoverageMapForGuilds<
  TOrder extends LicenseApprovedOrderRecord & { guild_id: string },
>(ordersByGuild: Map<string, TOrder[]>, nowMs = Date.now()) {
  const coverageByGuild = new Map<string, ResolvedLicenseCoverage<TOrder>>();

  for (const [guildId, orders] of ordersByGuild.entries()) {
    const latestCoverage = resolveLatestLicenseCoverageFromApprovedOrders(
      orders,
      nowMs,
    );
    if (latestCoverage) {
      coverageByGuild.set(guildId, latestCoverage);
    }
  }

  return coverageByGuild;
}

export function resolveGuildLicenseStatusFromLatestApprovedOrder(
  latestApprovedOrder: ApprovedOrderRecord | null,
  nowMs = Date.now(),
): GuildLicenseStatus {
  if (!latestApprovedOrder) return "not_paid";
  return resolveGuildLicenseStatusFromApprovedOrders([latestApprovedOrder], nowMs);
}

export async function getLatestApprovedOrderForGuild(guildId: string) {
  const orders = await getApprovedOrdersForGuild<ApprovedOrderRecord>(
    guildId,
    "paid_at, created_at",
    1,
  );
  return orders[0] || null;
}

export async function getGuildLicenseStatus(
  guildId: string,
  options?: LicenseStatusQueryOptions,
) {
  const normalizedGuildId = guildId.trim();
  if (!options?.forceFresh) {
    const cached = readCacheEntry(guildLicenseStatusCache, normalizedGuildId);
    if (cached) return cached;

    const inflight = guildLicenseStatusInflight.get(normalizedGuildId);
    if (inflight) {
      return inflight;
    }
  }

  const loadPromise = getApprovedOrdersForGuild<ApprovedOrderRecord>(
    normalizedGuildId,
    "paid_at, created_at",
  )
    .then((approvedOrders) => {
      const resolvedStatus =
        resolveGuildLicenseStatusFromApprovedOrders(approvedOrders);
      writeCacheEntry(
        guildLicenseStatusCache,
        normalizedGuildId,
        resolvedStatus,
        LICENSE_STATUS_CACHE_TTL_MS,
      );
      return resolvedStatus;
    })
    .finally(() => {
      guildLicenseStatusInflight.delete(normalizedGuildId);
    });

  guildLicenseStatusInflight.set(normalizedGuildId, loadPromise);
  return loadPromise;
}

export async function getLockedGuildLicenseByGuildId(
  guildId: string,
  options?: LicenseStatusQueryOptions,
) {
  const normalizedGuildId = guildId.trim();
  if (!options?.forceFresh) {
    const cached = readCacheEntry(lockedGuildLicenseCache, normalizedGuildId);
    if (cached !== null) {
      return cached;
    }

    if (lockedGuildLicenseCache.has(normalizedGuildId)) {
      return null;
    }

    const inflight = lockedGuildLicenseInflight.get(normalizedGuildId);
    if (inflight) {
      return inflight;
    }
  }

  const loadPromise = getApprovedOrdersForGuild<ApprovedOrderWithUserRecord>(
    normalizedGuildId,
    "guild_id, user_id, paid_at, created_at",
  )
    .then((approvedOrders) => {
      const latestCoverage = resolveLatestLicenseCoverageFromApprovedOrders(
        approvedOrders,
      );
      const resolvedStatus = latestCoverage ? latestCoverage.status : "not_paid";

      const lockedLicense =
        !latestCoverage ||
        (latestCoverage.status !== "paid" &&
          latestCoverage.status !== "expired")
          ? null
          : ({
              guildId: latestCoverage.order.guild_id,
              userId: latestCoverage.order.user_id,
              status: latestCoverage.status,
              paidAt: latestCoverage.order.paid_at,
              createdAt: latestCoverage.order.created_at,
              licenseStartsAt: latestCoverage.licenseStartsAt,
              licenseExpiresAt: latestCoverage.licenseExpiresAt,
              graceExpiresAt: latestCoverage.graceExpiresAt,
              renewalWindowStartsAt: latestCoverage.renewalWindowStartsAt,
            } satisfies LockedGuildLicenseRecord);

      writeCacheEntry(
        guildLicenseStatusCache,
        normalizedGuildId,
        resolvedStatus,
        LICENSE_STATUS_CACHE_TTL_MS,
      );
      writeCacheEntry(
        lockedGuildLicenseCache,
        normalizedGuildId,
        lockedLicense,
        LOCKED_GUILD_LICENSE_CACHE_TTL_MS,
      );

      return lockedLicense;
    })
    .finally(() => {
      lockedGuildLicenseInflight.delete(normalizedGuildId);
    });

  lockedGuildLicenseInflight.set(normalizedGuildId, loadPromise);
  return loadPromise;
}

export async function getLockedGuildLicenseMap(guildIds: string[]) {
  const lockedMap = new Map<string, LockedGuildLicenseRecord>();
  const ordersByGuild = await getApprovedOrdersForGuilds<ApprovedOrderWithUserRecord>(
    guildIds,
    "guild_id, user_id, paid_at, created_at",
  );

  if (!ordersByGuild.size) {
    return lockedMap;
  }

  for (const [guildId, orders] of ordersByGuild.entries()) {
    const latestCoverage = resolveLatestLicenseCoverageFromApprovedOrders(orders);
    if (!latestCoverage) continue;
    if (latestCoverage.status !== "paid" && latestCoverage.status !== "expired") {
      writeCacheEntry(
        guildLicenseStatusCache,
        guildId,
        latestCoverage.status,
        LICENSE_STATUS_CACHE_TTL_MS,
      );
      writeCacheEntry(
        lockedGuildLicenseCache,
        guildId,
        null,
        LOCKED_GUILD_LICENSE_CACHE_TTL_MS,
      );
      continue;
    }

    const lockedLicense = {
      guildId,
      userId: latestCoverage.order.user_id,
      status: latestCoverage.status,
      paidAt: latestCoverage.order.paid_at,
      createdAt: latestCoverage.order.created_at,
      licenseStartsAt: latestCoverage.licenseStartsAt,
      licenseExpiresAt: latestCoverage.licenseExpiresAt,
      graceExpiresAt: latestCoverage.graceExpiresAt,
      renewalWindowStartsAt: latestCoverage.renewalWindowStartsAt,
    } satisfies LockedGuildLicenseRecord;

    lockedMap.set(guildId, lockedLicense);
    writeCacheEntry(
      guildLicenseStatusCache,
      guildId,
      latestCoverage.status,
      LICENSE_STATUS_CACHE_TTL_MS,
    );
    writeCacheEntry(
      lockedGuildLicenseCache,
      guildId,
      lockedLicense,
      LOCKED_GUILD_LICENSE_CACHE_TTL_MS,
    );
  }

  return lockedMap;
}
