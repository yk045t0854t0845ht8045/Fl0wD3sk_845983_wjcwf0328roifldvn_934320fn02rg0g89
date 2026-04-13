import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { resolvePlanLicenseExpiresAtIso } from "@/lib/plans/cycle";

export type GuildLicenseStatus = "paid" | "expired" | "off" | "not_paid";

export const EXPIRED_GRACE_DAYS = 3;
export const LICENSE_RENEWAL_WINDOW_DAYS = 3;
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

type PlanGuildLinkRecord = {
  guild_id: string;
  user_id: number;
  activated_at: string | null;
  created_at: string;
  is_active: boolean;
};

type UserPlanStateStatusRecord = {
  user_id: number;
  status: "inactive" | "trial" | "active" | "expired";
  activated_at: string | null;
  expires_at: string | null;
};

type AccountBackedGuildStatusRecord = {
  guildId: string;
  userId: number;
  isActive: boolean;
  activatedAt: string | null;
  createdAt: string;
  status: GuildLicenseStatus;
  planActivatedAt: string | null;
  planExpiresAt: string | null;
  graceExpiresAt: string | null;
  renewalWindowStartsAt: string | null;
};

export type LicenseApprovedOrderRecord = ApprovedOrderRecord & {
  id?: number;
  order_number?: number;
  guild_id?: string;
  user_id?: number;
  plan_code?: string | null;
  plan_billing_cycle_days?: number | null;
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
  isActive: boolean;
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

function normalizeIsoOrNull(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function resolvePlanStateCoverage(
  planState: UserPlanStateStatusRecord | null | undefined,
  nowMs = Date.now(),
) {
  if (!planState || planState.status === "inactive") {
    return {
      status: "not_paid" as GuildLicenseStatus,
      activatedAt: null,
      expiresAt: null,
      graceExpiresAt: null,
      renewalWindowStartsAt: null,
    };
  }

  const activatedAt = normalizeIsoOrNull(planState.activated_at);
  const expiresAt = normalizeIsoOrNull(planState.expires_at);
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;

  if (!Number.isFinite(expiresAtMs)) {
    const fallbackStatus =
      planState.status === "expired" ? "expired" : "paid";
    return {
      status: fallbackStatus as GuildLicenseStatus,
      activatedAt,
      expiresAt: null,
      graceExpiresAt: null,
      renewalWindowStartsAt: null,
    };
  }

  const graceExpiresAt = new Date(expiresAtMs + EXPIRED_GRACE_MS).toISOString();
  const renewalWindowStartsAt = new Date(
    expiresAtMs - LICENSE_RENEWAL_WINDOW_MS,
  ).toISOString();

  if (nowMs <= expiresAtMs) {
    return {
      status: "paid" as GuildLicenseStatus,
      activatedAt,
      expiresAt,
      graceExpiresAt,
      renewalWindowStartsAt,
    };
  }

  if (nowMs <= expiresAtMs + EXPIRED_GRACE_MS) {
    return {
      status: "expired" as GuildLicenseStatus,
      activatedAt,
      expiresAt,
      graceExpiresAt,
      renewalWindowStartsAt,
    };
  }

  return {
    status: "off" as GuildLicenseStatus,
    activatedAt,
    expiresAt,
    graceExpiresAt,
    renewalWindowStartsAt,
  };
}

async function getUserPlanStateStatusMap(userIds: number[]) {
  const normalizedUserIds = Array.from(
    new Set(
      userIds.filter(
        (userId): userId is number =>
          typeof userId === "number" && Number.isFinite(userId),
      ),
    ),
  );
  const planStateByUserId = new Map<number, UserPlanStateStatusRecord>();

  if (!normalizedUserIds.length) {
    return planStateByUserId;
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_plan_state")
    .select("user_id, status, activated_at, expires_at")
    .in("user_id", normalizedUserIds)
    .returns<UserPlanStateStatusRecord[]>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  for (const row of result.data || []) {
    planStateByUserId.set(row.user_id, row);
  }

  return planStateByUserId;
}

async function getAccountBackedGuildStatusMap(
  guildIds: string[],
  nowMs = Date.now(),
) {
  const normalizedGuildIds = Array.from(
    new Set(
      guildIds.filter(
        (guildId): guildId is string =>
          typeof guildId === "string" && guildId.trim().length > 0,
      ),
    ),
  );
  const statusByGuild = new Map<string, AccountBackedGuildStatusRecord>();

  if (!normalizedGuildIds.length) {
    return statusByGuild;
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const planGuildResult = await supabase
    .from("auth_user_plan_guilds")
    .select("guild_id, user_id, activated_at, created_at, is_active")
    .in("guild_id", normalizedGuildIds)
    .returns<PlanGuildLinkRecord[]>();

  if (planGuildResult.error) {
    throw new Error(planGuildResult.error.message);
  }

  const planGuildByGuildId = new Map<string, PlanGuildLinkRecord>();
  for (const row of planGuildResult.data || []) {
    planGuildByGuildId.set(row.guild_id, row);
  }

  const missingGuildIds = normalizedGuildIds.filter(
    (guildId) => !planGuildByGuildId.has(guildId),
  );
  const legacyCoverageByGuild = new Map<
    string,
    ResolvedLicenseCoverage<ApprovedOrderWithUserRecord>
  >();

  if (missingGuildIds.length) {
    const legacyOrdersByGuild = await getApprovedOrdersForGuilds<ApprovedOrderWithUserRecord>(
      missingGuildIds,
      "guild_id, user_id, paid_at, created_at",
    );

    for (const [guildId, orders] of legacyOrdersByGuild.entries()) {
      const latestCoverage = resolveLatestLicenseCoverageFromApprovedOrders(
        orders,
        nowMs,
      );
      if (!latestCoverage) continue;
      legacyCoverageByGuild.set(guildId, latestCoverage);
    }
  }

  const ownerUserIds = new Set<number>();
  for (const row of planGuildByGuildId.values()) {
    ownerUserIds.add(row.user_id);
  }
  for (const coverage of legacyCoverageByGuild.values()) {
    ownerUserIds.add(coverage.order.user_id);
  }

  const planStateByUserId = await getUserPlanStateStatusMap([...ownerUserIds]);

  for (const guildId of normalizedGuildIds) {
    const planGuildLink = planGuildByGuildId.get(guildId) || null;
    const legacyCoverage = legacyCoverageByGuild.get(guildId) || null;
    const userId = planGuildLink?.user_id || legacyCoverage?.order.user_id || null;

    if (typeof userId !== "number" || !Number.isFinite(userId)) {
      continue;
    }

    const planState = planStateByUserId.get(userId) || null;
    const planCoverage = resolvePlanStateCoverage(planState, nowMs);
    const fallbackActivatedAt =
      planGuildLink?.activated_at ||
      legacyCoverage?.licenseStartsAt ||
      legacyCoverage?.order.paid_at ||
      legacyCoverage?.order.created_at ||
      null;
    const fallbackCreatedAt =
      planGuildLink?.created_at ||
      legacyCoverage?.order.created_at ||
      new Date(nowMs).toISOString();
    const status =
      planCoverage.status !== "not_paid"
        ? planCoverage.status
        : legacyCoverage?.status || "not_paid";

    statusByGuild.set(guildId, {
      guildId,
      userId,
      isActive: planGuildLink ? planGuildLink.is_active !== false : true,
      activatedAt: normalizeIsoOrNull(fallbackActivatedAt),
      createdAt: fallbackCreatedAt,
      status,
      planActivatedAt:
        planCoverage.activatedAt ||
        normalizeIsoOrNull(legacyCoverage?.licenseStartsAt || null),
      planExpiresAt:
        planCoverage.expiresAt ||
        normalizeIsoOrNull(legacyCoverage?.licenseExpiresAt || null),
      graceExpiresAt:
        planCoverage.graceExpiresAt ||
        normalizeIsoOrNull(legacyCoverage?.graceExpiresAt || null),
      renewalWindowStartsAt:
        planCoverage.renewalWindowStartsAt ||
        normalizeIsoOrNull(legacyCoverage?.renewalWindowStartsAt || null),
    });
  }

  return statusByGuild;
}

function resolveLicenseExpiresAtMs(
  order: LicenseApprovedOrderRecord,
  licenseStartsAtMs: number,
) {
  const expiresAtIso = resolvePlanLicenseExpiresAtIso({
    baseTimestamp: licenseStartsAtMs,
    billingCycleDays: order.plan_billing_cycle_days,
    planCode: order.plan_code,
  });
  const expiresAtMs = expiresAtIso ? Date.parse(expiresAtIso) : Number.NaN;
  return Number.isFinite(expiresAtMs) ? expiresAtMs : licenseStartsAtMs;
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

    const licenseExpiresAtMs = resolveLicenseExpiresAtMs(order, licenseStartsAtMs);
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
>(guildId: string | null, selectColumns: string, limit = 120) {
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
>(guildId: string | null, selectColumns: string, nowMs = Date.now()) {
  const approvedOrders = await getApprovedOrdersForGuild<TOrder>(
    guildId,
    selectColumns,
  );
  return resolveLatestLicenseCoverageFromApprovedOrders(approvedOrders, nowMs);
}

export async function getOrderCoverageForGuild<
  TOrder extends LicenseApprovedOrderRecord,
>(
  guildId: string | null,
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

export async function getLatestApprovedOrderForGuild(guildId: string | null) {
  const orders = await getApprovedOrdersForGuild<ApprovedOrderRecord>(
    guildId,
    "paid_at, created_at",
    1,
  );
  return orders[0] || null;
}

export async function getGuildLicenseStatus(
  guildId: string | null,
  options?: LicenseStatusQueryOptions,
) {
  if (!guildId) return "not_paid";
  const normalizedGuildId = guildId.trim();
  if (!options?.forceFresh) {
    const cached = readCacheEntry(guildLicenseStatusCache, normalizedGuildId);
    if (cached) return cached;

    const inflight = guildLicenseStatusInflight.get(normalizedGuildId);
    if (inflight) {
      return inflight;
    }
  }

  const loadPromise = getAccountBackedGuildStatusMap([normalizedGuildId])
    .then((statusByGuild) => {
      const guildStatus = statusByGuild.get(normalizedGuildId) || null;
      const resolvedStatus = !guildStatus
        ? "not_paid"
        : guildStatus.isActive !== true
          ? "off"
          : guildStatus.status === "not_paid"
            ? "off"
            : guildStatus.status;
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
  guildId: string | null,
  options?: LicenseStatusQueryOptions,
) {
  if (!guildId) return null;
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

  const loadPromise = getAccountBackedGuildStatusMap([normalizedGuildId])
    .then((statusByGuild) => {
      const guildStatus = statusByGuild.get(normalizedGuildId) || null;
      const resolvedStatus = !guildStatus
        ? "not_paid"
        : guildStatus.isActive !== true
          ? "off"
          : guildStatus.status === "not_paid"
            ? "off"
            : guildStatus.status;
      const paidAt = guildStatus?.planActivatedAt || guildStatus?.activatedAt || null;
      const createdAt = guildStatus?.createdAt || new Date().toISOString();

      const lockedLicense =
        !guildStatus ||
        (guildStatus.status !== "paid" && guildStatus.status !== "expired")
          ? null
          : ({
              guildId: guildStatus.guildId,
              userId: guildStatus.userId,
              status: guildStatus.status,
              paidAt,
              createdAt,
              licenseStartsAt: paidAt || createdAt,
              licenseExpiresAt:
                guildStatus.planExpiresAt || paidAt || createdAt,
              graceExpiresAt:
                guildStatus.graceExpiresAt ||
                guildStatus.planExpiresAt ||
                paidAt ||
                createdAt,
              renewalWindowStartsAt:
                guildStatus.renewalWindowStartsAt ||
                guildStatus.planExpiresAt ||
                paidAt ||
                createdAt,
              isActive: guildStatus.isActive,
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
  const statusByGuild = await getAccountBackedGuildStatusMap(guildIds);

  if (!statusByGuild.size) {
    return lockedMap;
  }

  for (const [guildId, guildStatus] of statusByGuild.entries()) {
    const resolvedStatus =
      guildStatus.isActive !== true
        ? "off"
        : guildStatus.status === "not_paid"
          ? "off"
          : guildStatus.status;

    if (guildStatus.status !== "paid" && guildStatus.status !== "expired") {
      writeCacheEntry(
        guildLicenseStatusCache,
        guildId,
        resolvedStatus,
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
      userId: guildStatus.userId,
      status: guildStatus.status,
      paidAt: guildStatus.planActivatedAt || guildStatus.activatedAt,
      createdAt: guildStatus.createdAt,
      licenseStartsAt:
        guildStatus.planActivatedAt ||
        guildStatus.activatedAt ||
        guildStatus.createdAt,
      licenseExpiresAt:
        guildStatus.planExpiresAt ||
        guildStatus.planActivatedAt ||
        guildStatus.activatedAt ||
        guildStatus.createdAt,
      graceExpiresAt:
        guildStatus.graceExpiresAt ||
        guildStatus.planExpiresAt ||
        guildStatus.planActivatedAt ||
        guildStatus.activatedAt ||
        guildStatus.createdAt,
      renewalWindowStartsAt:
        guildStatus.renewalWindowStartsAt ||
        guildStatus.planExpiresAt ||
        guildStatus.planActivatedAt ||
        guildStatus.activatedAt ||
        guildStatus.createdAt,
      isActive: guildStatus.isActive,
    } satisfies LockedGuildLicenseRecord;

    lockedMap.set(guildId, lockedLicense);
    writeCacheEntry(
      guildLicenseStatusCache,
      guildId,
      resolvedStatus,
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

export async function getLockedGuildLicenseMapByUserId(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();

  // Buscar todos os IDs de guildas vinculados a este usuário (seja diretamente ou via histórico)
  const [planGuildsResult, ordersResult] = await Promise.all([
    supabase
      .from("auth_user_plan_guilds")
      .select("guild_id")
      .eq("user_id", userId)
      .returns<{ guild_id: string }[]>(),
    supabase
      .from("payment_orders")
      .select("guild_id")
      .eq("user_id", userId)
      .eq("status", "approved")
      .not("guild_id", "is", null)
      .returns<{ guild_id: string }[]>(),
  ]);

  if (planGuildsResult.error) {
    throw new Error(`Erro ao buscar guilda de planos: ${planGuildsResult.error.message}`);
  }
  if (ordersResult.error) {
    throw new Error(`Erro ao buscar histórico de pedidos: ${ordersResult.error.message}`);
  }

  const guildIds = new Set([
    ...(planGuildsResult.data || []).map((r) => r.guild_id),
    ...(ordersResult.data || []).map((r) => r.guild_id),
  ]);

  return getLockedGuildLicenseMap(Array.from(guildIds));
}
