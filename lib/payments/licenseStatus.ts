import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type GuildLicenseStatus = "paid" | "expired" | "off" | "not_paid";

export const LICENSE_VALIDITY_DAYS = 30;
export const EXPIRED_GRACE_DAYS = 3;
export const LICENSE_RENEWAL_WINDOW_DAYS = 3;
export const LICENSE_VALIDITY_MS = LICENSE_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
export const EXPIRED_GRACE_MS = EXPIRED_GRACE_DAYS * 24 * 60 * 60 * 1000;
export const LICENSE_RENEWAL_WINDOW_MS =
  LICENSE_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

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

export async function getGuildLicenseStatus(guildId: string) {
  const approvedOrders = await getApprovedOrdersForGuild<ApprovedOrderRecord>(
    guildId,
    "paid_at, created_at",
  );
  return resolveGuildLicenseStatusFromApprovedOrders(approvedOrders);
}

export async function getLockedGuildLicenseByGuildId(guildId: string) {
  const approvedOrders = await getApprovedOrdersForGuild<ApprovedOrderWithUserRecord>(
    guildId,
    "guild_id, user_id, paid_at, created_at",
  );
  const latestCoverage = resolveLatestLicenseCoverageFromApprovedOrders(
    approvedOrders,
  );
  if (!latestCoverage) return null;
  if (latestCoverage.status !== "paid" && latestCoverage.status !== "expired") {
    return null;
  }

  return {
    guildId: latestCoverage.order.guild_id,
    userId: latestCoverage.order.user_id,
    status: latestCoverage.status,
    paidAt: latestCoverage.order.paid_at,
    createdAt: latestCoverage.order.created_at,
    licenseStartsAt: latestCoverage.licenseStartsAt,
    licenseExpiresAt: latestCoverage.licenseExpiresAt,
    graceExpiresAt: latestCoverage.graceExpiresAt,
    renewalWindowStartsAt: latestCoverage.renewalWindowStartsAt,
  } satisfies LockedGuildLicenseRecord;
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
      continue;
    }

    lockedMap.set(guildId, {
      guildId,
      userId: latestCoverage.order.user_id,
      status: latestCoverage.status,
      paidAt: latestCoverage.order.paid_at,
      createdAt: latestCoverage.order.created_at,
      licenseStartsAt: latestCoverage.licenseStartsAt,
      licenseExpiresAt: latestCoverage.licenseExpiresAt,
      graceExpiresAt: latestCoverage.graceExpiresAt,
      renewalWindowStartsAt: latestCoverage.renewalWindowStartsAt,
    });
  }

  return lockedMap;
}
