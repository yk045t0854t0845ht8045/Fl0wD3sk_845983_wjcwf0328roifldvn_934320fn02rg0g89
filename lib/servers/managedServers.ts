import {
  fetchGuildSummaryByBot,
  getAccessibleGuildsForSession,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import type { DiscordGuild } from "@/lib/auth/discord";
import { getLockedGuildLicenseMapByUserId } from "@/lib/payments/licenseStatus";
import { reconcileRecentPaymentOrders } from "@/lib/payments/reconciliation";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import { getUserPlanScheduledChange } from "@/lib/plans/change";
import {
  ensureDowngradeEnforcementForUser,
  getDowngradeEnforcementSummaryForUser,
} from "@/lib/plans/downgradeEnforcement";
import {
  getPlanGuildsForUser,
  resolveGuildLicenseFromUserPlanState,
} from "@/lib/plans/planGuilds";
import {
  getUserPlanState,
  repairOrphanPlanGuildLinkForUser,
} from "@/lib/plans/state";
import { buildFlowSecureDiagnosticFingerprint } from "@/lib/security/flowSecure";
import {
  getAcceptedTeamGuildIdsForUser,
  getGlobalTeamLinkedGuildIds,
} from "@/lib/teams/userTeams";
import {
  DEFAULT_MANAGED_SERVERS_SYNC_STATE,
  type ManagedServer,
  type ManagedServerStatus,
  type ManagedServersSnapshot,
  type ManagedServersSyncReason,
  type ManagedServersSyncState,
} from "@/lib/servers/managedServersShared";

export {
  DEFAULT_MANAGED_SERVERS_SYNC_STATE,
  type ManagedServer,
  type ManagedServerStatus,
  type ManagedServersSnapshot,
  type ManagedServersSyncReason,
  type ManagedServersSyncState,
} from "@/lib/servers/managedServersShared";

const managedServersCache = new Map<
  number,
  { snapshot: ManagedServersSnapshot; timestamp: number }
>();
const refreshingUserIds = new Set<number>();
const CACHE_TTL_MS = 600000;
const STALE_THRESHOLD_MS = 20000;

function buildGuildIconUrl(guildId: string, icon: string | null) {
  if (!icon) return null;

  const extension = icon.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${extension}?size=64`;
}

function daysLeft(targetMs: number) {
  const diff = targetMs - Date.now();
  const rounded = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return Math.max(0, rounded);
}

function buildFallbackGuildName(guildId: string) {
  return `Servidor ${guildId.slice(-6)}`;
}

function isManagedGuildId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{10,25}$/.test(value);
}

function toUniqueManagedGuildIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(isManagedGuildId)));
}

function buildGuildLookup(guilds: DiscordGuild[] | null) {
  return new Map(
    (guilds || []).map((guild) => [
      guild.id,
      {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner: guild.owner,
      },
    ]),
  );
}

function buildManagedServersSyncState(input: {
  authUserId: number;
  accessibleGuildCount: number;
  coveredGuildCount: number;
  degraded: boolean;
  reason: ManagedServersSyncReason;
  requiresDiscordRelink: boolean;
  usedDatabaseFallback: boolean;
}) {
  const syncState: ManagedServersSyncState = {
    degraded: input.degraded,
    requiresDiscordRelink: input.requiresDiscordRelink,
    usedDatabaseFallback: input.usedDatabaseFallback,
    reason: input.reason,
    diagnosticsFingerprint: null,
  };

  if (!syncState.degraded && !syncState.requiresDiscordRelink) {
    return syncState;
  }

  syncState.diagnosticsFingerprint = buildFlowSecureDiagnosticFingerprint(
    {
      authUserId: input.authUserId,
      accessibleGuildCount: input.accessibleGuildCount,
      coveredGuildCount: input.coveredGuildCount,
      degraded: syncState.degraded,
      reason: syncState.reason,
      requiresDiscordRelink: syncState.requiresDiscordRelink,
      usedDatabaseFallback: syncState.usedDatabaseFallback,
    },
    {
      prefix: "serversync",
      subcontext: "managed_servers",
    },
  );

  return syncState;
}

export async function getManagedServersSnapshotForCurrentSession(): Promise<ManagedServersSnapshot> {
  const sessionData = await resolveSessionAccessToken();

  if (!sessionData?.authSession) {
    throw new Error("Nao autenticado.");
  }

  const userId = sessionData.authSession.user.id;
  const cached = managedServersCache.get(userId);
  if (cached) {
    const cacheAgeMs = Date.now() - cached.timestamp;
    const cacheTtlMs =
      cached.snapshot.sync.degraded || cached.snapshot.sync.requiresDiscordRelink
        ? 15000
        : CACHE_TTL_MS;
    const staleThresholdMs =
      cached.snapshot.sync.degraded || cached.snapshot.sync.requiresDiscordRelink
        ? 3000
        : STALE_THRESHOLD_MS;

    if (cacheAgeMs >= cacheTtlMs) {
      managedServersCache.delete(userId);
    } else {
      const isStale = cacheAgeMs > staleThresholdMs;

      if (isStale && !refreshingUserIds.has(userId)) {
        refreshingUserIds.add(userId);
        void fetchManagedServersFresh(sessionData)
          .catch(() => null)
          .finally(() => refreshingUserIds.delete(userId));
      }

      return cached.snapshot;
    }
  }

  try {
    return await fetchManagedServersFresh(sessionData);
  } catch (error) {
    if (cached) {
      return cached.snapshot;
    }

    throw error;
  }
}

export async function getManagedServersForCurrentSession(): Promise<ManagedServer[]> {
  const snapshot = await getManagedServersSnapshotForCurrentSession();
  return snapshot.servers;
}

async function fetchManagedServersFresh(
  sessionData: Awaited<ReturnType<typeof resolveSessionAccessToken>>,
): Promise<ManagedServersSnapshot> {
  if (!sessionData?.authSession) {
    return {
      servers: [],
      sync: DEFAULT_MANAGED_SERVERS_SYNC_STATE,
    };
  }

  const authSession = sessionData.authSession;
  const userId = authSession.user.id;
  const discordUserId = authSession.user.discord_user_id;
  const requiresDiscordRelink = !discordUserId || !sessionData.accessToken;
  const baseSyncReason: ManagedServersSyncReason = !discordUserId
    ? "discord_not_linked"
    : !sessionData.accessToken
      ? "discord_oauth_missing"
      : "ok";

  void cleanupExpiredUnpaidServerSetups({
    userId,
    source: "auth_servers",
  }).catch(() => null);
  void reconcileRecentPaymentOrders({
    userId,
    limit: 6,
    source: "auth_servers",
  }).catch(() => null);

  const accessibleGuildsPromise = sessionData.accessToken
    ? getAccessibleGuildsForSession({
        authSession,
        accessToken: sessionData.accessToken,
      })
    : Promise.resolve<DiscordGuild[]>([]);

  const [
    userPlanState,
    scheduledChange,
    accessibleGuildsResult,
    acceptedTeamGuildIdsList,
    ownedPlanGuilds,
    lockedGuildMap,
    downgradeEnforcement,
  ] = await Promise.all([
    getUserPlanState(userId),
    getUserPlanScheduledChange(userId),
    accessibleGuildsPromise
      .then((guilds) => ({ ok: true as const, guilds }))
      .catch((error) => ({ ok: false as const, error })),
    getAcceptedTeamGuildIdsForUser({
      authUserId: userId,
      discordUserId,
    }),
    getPlanGuildsForUser(userId, { includeInactive: true }),
    getLockedGuildLicenseMapByUserId(userId),
    getDowngradeEnforcementSummaryForUser(userId),
  ]);

  void repairOrphanPlanGuildLinkForUser({
    userId,
    userPlanState,
    source: "managed_servers_session",
  }).catch(() => null);
  void ensureDowngradeEnforcementForUser({
    userId,
    userPlanState,
    scheduledChange,
  }).catch(() => null);

  const accessibleGuilds = accessibleGuildsResult.ok ? accessibleGuildsResult.guilds : [];
  const accessibleGuildLookup = buildGuildLookup(accessibleGuilds);
  const sessionGuildLookup = buildGuildLookup(authSession.discordGuildsCache);

  const acceptedTeamGuildIds = new Set(
    toUniqueManagedGuildIds(acceptedTeamGuildIdsList),
  );
  const normalizedOwnedPlanGuilds = ownedPlanGuilds.filter((record) =>
    isManagedGuildId(record.guild_id),
  );
  const ownedPlanGuildsByGuildId = new Map(
    normalizedOwnedPlanGuilds.map((record) => [record.guild_id, record]),
  );
  const ownedPlanGuildIds = new Set(
    normalizedOwnedPlanGuilds.map((record) => record.guild_id),
  );
  const ownedActivePlanGuildIds = new Set(
    normalizedOwnedPlanGuilds
      .filter((record) => record.is_active !== false)
      .map((record) => record.guild_id),
  );
  const normalizedLockedGuildMap = new Map(
    Array.from(lockedGuildMap.entries()).filter(([guildId]) =>
      isManagedGuildId(guildId),
    ),
  );
  const coveredGuildIds = toUniqueManagedGuildIds([
    ...Array.from(acceptedTeamGuildIds),
    ...Array.from(ownedPlanGuildIds),
    ...Array.from(normalizedLockedGuildMap.keys()),
  ]);

  const hasPendingDowngradePayment = Boolean(
    downgradeEnforcement &&
      (downgradeEnforcement.status === "selection_required" ||
        downgradeEnforcement.status === "awaiting_payment"),
  );

  const ownedPlanCoverage = resolveGuildLicenseFromUserPlanState({
    userPlanState,
    guildLicensed: ownedPlanGuildIds.size > 0 || ownedActivePlanGuildIds.size > 0,
  });

  const missingCoveredGuildIds = coveredGuildIds.filter(
    (guildId) => !accessibleGuildLookup.has(guildId),
  );

  const supplementalGuilds = await Promise.all(
    missingCoveredGuildIds.map(async (guildId) => {
      const cachedGuild = sessionGuildLookup.get(guildId);
      if (cachedGuild) {
        return cachedGuild;
      }

      try {
        const botGuild = await fetchGuildSummaryByBot(guildId);
        if (botGuild) {
          return {
            id: botGuild.id,
            name: botGuild.name,
            icon: botGuild.icon,
            owner: ownedPlanGuildIds.has(guildId),
          };
        }
      } catch {
        // fallback local
      }

      return {
        id: guildId,
        name: buildFallbackGuildName(guildId),
        icon: null,
        owner: ownedPlanGuildIds.has(guildId),
      };
    }),
  );

  const guildCatalog = new Map(
    [
      ...accessibleGuilds.map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner: guild.owner,
      })),
      ...supplementalGuilds,
    ].map((guild) => [guild.id, guild]),
  );

  const guildIdsForLookup = Array.from(guildCatalog.keys());
  const globalTeamLinkedGuildIds = await getGlobalTeamLinkedGuildIds(guildIdsForLookup);

  const servers = Array.from(guildCatalog.values())
    .filter(
      (guild) =>
        ownedPlanGuildIds.has(guild.id) ||
        normalizedLockedGuildMap.has(guild.id) ||
        acceptedTeamGuildIds.has(guild.id),
    )
    .map((guild) => {
      const ownedPlanGuild = ownedPlanGuildsByGuildId.get(guild.id) || null;
      const lockedRecord = normalizedLockedGuildMap.get(guild.id) || null;
      const currentLicenseBelongsToViewer = Boolean(
        lockedRecord && lockedRecord.userId !== authSession.user.id,
      );
      const selfAccountLockedRecord =
        lockedRecord && lockedRecord.userId === authSession.user.id
          ? lockedRecord
          : null;
      const accessMode: ManagedServer["accessMode"] =
        ownedPlanGuildIds.has(guild.id) || guild.owner ? "owner" : "viewer";
      const isOwnedPlanGuildInactive = Boolean(
        !currentLicenseBelongsToViewer &&
          ownedPlanGuild &&
          ownedPlanGuild.is_active === false,
      );
      const isPendingDowngradePayment = Boolean(
        !currentLicenseBelongsToViewer &&
          ownedPlanGuild &&
          hasPendingDowngradePayment,
      );

      const status: ManagedServerStatus = currentLicenseBelongsToViewer
        ? lockedRecord?.isActive === false
          ? "off"
          : lockedRecord?.status || "off"
        : isPendingDowngradePayment
          ? "pending_payment"
          : ownedPlanGuild
            ? ownedPlanCoverage.status === "paid" || ownedPlanCoverage.status === "expired"
              ? ownedPlanCoverage.status
              : "off"
            : selfAccountLockedRecord
              ? selfAccountLockedRecord.isActive === false
                ? "off"
                : selfAccountLockedRecord.status
              : "off";

      const referencePaidAt = currentLicenseBelongsToViewer
        ? lockedRecord?.paidAt || null
        : ownedPlanGuild?.activated_at || selfAccountLockedRecord?.paidAt || null;
      const referenceCreatedAt = currentLicenseBelongsToViewer
        ? lockedRecord?.createdAt || null
        : ownedPlanGuild?.created_at || selfAccountLockedRecord?.createdAt || null;
      const licenseExpiresAt = currentLicenseBelongsToViewer
        ? lockedRecord?.licenseExpiresAt || null
        : ownedPlanGuild
          ? ownedPlanCoverage.expiresAt || null
          : selfAccountLockedRecord?.licenseExpiresAt || null;
      const graceExpiresAt = currentLicenseBelongsToViewer
        ? lockedRecord?.graceExpiresAt || null
        : ownedPlanGuild
          ? ownedPlanCoverage.graceExpiresAt || null
          : selfAccountLockedRecord?.graceExpiresAt || null;
      const licenseExpiresAtMs = licenseExpiresAt ? Date.parse(licenseExpiresAt) : Number.NaN;
      const graceExpiresAtMs = graceExpiresAt ? Date.parse(graceExpiresAt) : Number.NaN;

      return {
        guildId: guild.id,
        guildName: guild.name,
        iconUrl: buildGuildIconUrl(guild.id, guild.icon),
        status,
        accessMode,
        canManage:
          ownedPlanGuildIds.has(guild.id) ||
          acceptedTeamGuildIds.has(guild.id) ||
          (!globalTeamLinkedGuildIds.has(guild.id) && (guild.owner || false)),
        blockedByPlanLimit: isOwnedPlanGuildInactive || isPendingDowngradePayment,
        pendingDowngradePayment: isPendingDowngradePayment,
        licenseOwnerUserId: lockedRecord?.userId || authSession.user.id,
        licensePaidAt: referencePaidAt || referenceCreatedAt || new Date().toISOString(),
        licenseExpiresAt: licenseExpiresAt || referenceCreatedAt || new Date().toISOString(),
        graceExpiresAt: graceExpiresAt || referenceCreatedAt || new Date().toISOString(),
        daysUntilExpire: Number.isFinite(licenseExpiresAtMs) ? daysLeft(licenseExpiresAtMs) : 0,
        daysUntilOff: Number.isFinite(graceExpiresAtMs) ? daysLeft(graceExpiresAtMs) : 0,
      };
    })
    .sort((a, b) => {
      const priority = { paid: 0, expired: 1, pending_payment: 2, off: 3 } as const;
      const statusDiff = priority[a.status] - priority[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.guildName.localeCompare(b.guildName, "pt-BR");
    });

  const coveredGuildCount = coveredGuildIds.length;
  const shouldMarkDiscordSyncFailed =
    !requiresDiscordRelink &&
    (!accessibleGuildsResult.ok ||
      (ownedPlanGuildIds.size > 0 && accessibleGuilds.length === 0));
  const sync = buildManagedServersSyncState({
    authUserId: userId,
    accessibleGuildCount: accessibleGuilds.length,
    coveredGuildCount,
    degraded: requiresDiscordRelink || shouldMarkDiscordSyncFailed,
    reason: requiresDiscordRelink
      ? baseSyncReason
      : shouldMarkDiscordSyncFailed
        ? "discord_sync_failed"
        : "ok",
    requiresDiscordRelink,
    usedDatabaseFallback:
      coveredGuildCount > accessibleGuilds.length ||
      requiresDiscordRelink ||
      !accessibleGuildsResult.ok,
  });
  const snapshot = {
    servers,
    sync,
  } satisfies ManagedServersSnapshot;

  managedServersCache.set(userId, {
    snapshot,
    timestamp: Date.now(),
  });

  return snapshot;
}
