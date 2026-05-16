import {
  fetchGuildSummaryByBot,
  getAccessibleGuildsForSession,
  isDiscordRelinkRequiredError,
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
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
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

type ManagedServersSnapshotOptions = {
  forceFresh?: boolean;
};

type ConfiguredGuildRecord = {
  guild_id: string | null;
};

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

function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number,
  fallback: TValue,
) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<TValue>((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

async function withManagedServersFallback<TValue>(
  promise: Promise<TValue>,
  fallback: TValue,
  context: string,
) {
  try {
    return {
      ok: true as const,
      value: await promise,
      usedFallback: false,
    };
  } catch (error) {
    console.warn("managed servers optional read failed", {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false as const,
      value: fallback,
      usedFallback: true,
    };
  }
}

function isMissingConfiguredGuildLookupTableError(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message =
    typeof error?.message === "string" ? error.message.toLowerCase() : "";

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("relation") ||
    message.includes("does not exist")
  );
}

async function getConfiguredGuildIdsForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const setupTables = [
    "guild_ticket_settings",
    "guild_ticket_staff_settings",
    "guild_welcome_settings",
    "guild_antilink_settings",
    "guild_autorole_settings",
    "guild_sales_settings",
    "guild_settings_secure_snapshots",
  ];

  const readGuildIds = async (table: string, userColumn: string) => {
    const result = await supabase
      .from(table)
      .select("guild_id")
      .eq(userColumn, userId)
      .returns<ConfiguredGuildRecord[]>();

    if (result.error) {
      if (isMissingConfiguredGuildLookupTableError(result.error)) {
        return [] as string[];
      }

      console.warn("managed servers configured guild lookup failed", {
        table,
        error: result.error.message,
      });
      return [] as string[];
    }

    return toUniqueManagedGuildIds(
      (result.data || []).map((record) => record.guild_id),
    );
  };

  const results = await Promise.all([
    ...setupTables.map((table) => readGuildIds(table, "configured_by_user_id")),
    readGuildIds("guild_plan_settings", "user_id"),
  ]);

  return toUniqueManagedGuildIds(results.flat());
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

export async function getManagedServersSnapshotForCurrentSession(
  options: ManagedServersSnapshotOptions = {},
): Promise<ManagedServersSnapshot> {
  const sessionData = await resolveSessionAccessToken();

  if (!sessionData?.authSession) {
    throw new Error("Nao autenticado.");
  }

  const userId = sessionData.authSession.user.id;
  const cached = managedServersCache.get(userId);
  if (cached && !options.forceFresh) {
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
    return await fetchManagedServersFresh(sessionData, options);
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

export function filterPanelVisibleManagedServers(servers: ManagedServer[]) {
  return servers.filter((server) => server.isPanelVisible);
}

export function filterTeamCatalogManagedServers(servers: ManagedServer[]) {
  return servers.filter(
    (server) =>
      server.isPanelVisible &&
      (server.canLinkToTeam || server.isLinkedToTeam),
  );
}

export async function getPanelManagedServersSnapshotForCurrentSession(
  options: ManagedServersSnapshotOptions = {},
): Promise<ManagedServersSnapshot> {
  const snapshot = await getManagedServersSnapshotForCurrentSession(options);
  return {
    ...snapshot,
    servers: filterPanelVisibleManagedServers(snapshot.servers),
  };
}

export async function getPanelManagedServersForCurrentSession(
  options: ManagedServersSnapshotOptions = {},
): Promise<ManagedServer[]> {
  const snapshot = await getPanelManagedServersSnapshotForCurrentSession(options);
  return snapshot.servers;
}

export function invalidateManagedServersCacheForUser(userId: number) {
  managedServersCache.delete(userId);
  refreshingUserIds.delete(userId);
}

async function fetchManagedServersFresh(
  sessionData: Awaited<ReturnType<typeof resolveSessionAccessToken>>,
  options: ManagedServersSnapshotOptions = {},
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
      }, {
        forceFresh: options.forceFresh,
        allowStaleCache: !options.forceFresh,
      })
    : Promise.resolve<DiscordGuild[]>([]);

  const [
    userPlanStateResult,
    scheduledChangeResult,
    accessibleGuildsResult,
    acceptedTeamGuildIdsResult,
    ownedPlanGuildsResult,
    lockedGuildMapResult,
    downgradeEnforcementResult,
    configuredGuildIdsResult,
  ] = await Promise.all([
    withManagedServersFallback(
      getUserPlanState(userId),
      null,
      "user_plan_state",
    ),
    withManagedServersFallback(
      getUserPlanScheduledChange(userId),
      null,
      "user_plan_scheduled_change",
    ),
    accessibleGuildsPromise
      .then((guilds) => ({ ok: true as const, guilds }))
      .catch((error) => ({ ok: false as const, error })),
    withManagedServersFallback(
      getAcceptedTeamGuildIdsForUser({
        authUserId: userId,
        discordUserId,
      }),
      [] as string[],
      "accepted_team_guild_ids",
    ),
    withManagedServersFallback(
      getPlanGuildsForUser(userId, { includeInactive: true }),
      [] as Awaited<ReturnType<typeof getPlanGuildsForUser>>,
      "plan_guilds",
    ),
    withManagedServersFallback(
      getLockedGuildLicenseMapByUserId(userId),
      new Map() as Awaited<ReturnType<typeof getLockedGuildLicenseMapByUserId>>,
      "locked_guild_license_map",
    ),
    withManagedServersFallback(
      getDowngradeEnforcementSummaryForUser(userId),
      null,
      "downgrade_enforcement",
    ),
    withManagedServersFallback(
      getConfiguredGuildIdsForUser(userId),
      [] as string[],
      "configured_guild_ids",
    ),
  ]);

  const userPlanState = userPlanStateResult.value;
  const scheduledChange = scheduledChangeResult.value;
  const acceptedTeamGuildIdsList = acceptedTeamGuildIdsResult.value;
  const ownedPlanGuilds = ownedPlanGuildsResult.value;
  const lockedGuildMap = lockedGuildMapResult.value;
  const downgradeEnforcement = downgradeEnforcementResult.value;
  const configuredGuildIdsList = configuredGuildIdsResult.value;
  const usedOptionalFallback =
    userPlanStateResult.usedFallback ||
    scheduledChangeResult.usedFallback ||
    acceptedTeamGuildIdsResult.usedFallback ||
    ownedPlanGuildsResult.usedFallback ||
    lockedGuildMapResult.usedFallback ||
    downgradeEnforcementResult.usedFallback ||
    configuredGuildIdsResult.usedFallback;

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
  const discordOAuthRevoked =
    !accessibleGuildsResult.ok &&
    isDiscordRelinkRequiredError(accessibleGuildsResult.error);
  const effectiveRequiresDiscordRelink =
    requiresDiscordRelink || discordOAuthRevoked;
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
  const configuredGuildIds = new Set(
    toUniqueManagedGuildIds(configuredGuildIdsList),
  );
  const activeGuildIds = toUniqueManagedGuildIds([authSession.activeGuildId]);
  const coveredGuildIds = toUniqueManagedGuildIds([
    ...activeGuildIds,
    ...Array.from(acceptedTeamGuildIds),
    ...Array.from(configuredGuildIds),
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

  const supplementalGuildFetchLimit = options.forceFresh ? missingCoveredGuildIds.length : 8;
  const supplementalGuildIdsToFetch = missingCoveredGuildIds.slice(0, supplementalGuildFetchLimit);
  const supplementalGuildIdsFallbackOnly = missingCoveredGuildIds.slice(supplementalGuildFetchLimit);
  const supplementalGuilds = await Promise.all(
    supplementalGuildIdsToFetch.map(async (guildId) => {
      const cachedGuild = sessionGuildLookup.get(guildId);
      if (cachedGuild) {
        return cachedGuild;
      }

      const botGuild = await withTimeout(
        fetchGuildSummaryByBot(guildId),
        options.forceFresh ? 2400 : 900,
        null,
      );
      if (botGuild) {
        return {
          id: botGuild.id,
          name: botGuild.name,
          icon: botGuild.icon,
          owner: ownedPlanGuildIds.has(guildId),
        };
      }

      return {
        id: guildId,
        name: buildFallbackGuildName(guildId),
        icon: null,
        owner: ownedPlanGuildIds.has(guildId),
      };
    }),
  );
  const supplementalFallbackGuilds = supplementalGuildIdsFallbackOnly.map((guildId) => ({
    id: guildId,
    name: sessionGuildLookup.get(guildId)?.name || buildFallbackGuildName(guildId),
    icon: sessionGuildLookup.get(guildId)?.icon || null,
    owner: ownedPlanGuildIds.has(guildId),
  }));

  const guildCatalog = new Map(
    [
      ...accessibleGuilds.map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner: guild.owner,
      })),
      ...supplementalGuilds,
      ...supplementalFallbackGuilds,
    ].map((guild) => [guild.id, guild]),
  );

  const guildIdsForLookup = Array.from(guildCatalog.keys());
  const globalTeamLinkedGuildIdsResult = await withManagedServersFallback(
    getGlobalTeamLinkedGuildIds(guildIdsForLookup),
    new Set<string>(),
    "global_team_linked_guild_ids",
  );
  const globalTeamLinkedGuildIds = globalTeamLinkedGuildIdsResult.value;

  const servers = Array.from(guildCatalog.values())
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
      const isLinkedToTeam = globalTeamLinkedGuildIds.has(guild.id);
      const hasPanelRegistration = Boolean(
        acceptedTeamGuildIds.has(guild.id) ||
          configuredGuildIds.has(guild.id) ||
          ownedPlanGuildIds.has(guild.id) ||
          lockedRecord,
      );
      const isPanelVisible = hasPanelRegistration;
      const canLinkToTeam = Boolean(
        !currentLicenseBelongsToViewer &&
          !isLinkedToTeam &&
          hasPanelRegistration,
      );
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
        isPanelVisible,
        isLinkedToTeam,
        canManage:
          !currentLicenseBelongsToViewer &&
          (
            ownedPlanGuildIds.has(guild.id) ||
            acceptedTeamGuildIds.has(guild.id) ||
            configuredGuildIds.has(guild.id)
          ),
        canLinkToTeam,
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
  const hasDatabaseCoverage = coveredGuildCount > 0;
  const shouldMarkDiscordSyncFailed =
    !effectiveRequiresDiscordRelink &&
    !hasDatabaseCoverage &&
    (!accessibleGuildsResult.ok || accessibleGuilds.length === 0);
  const shouldMarkOptionalReadDegraded =
    usedOptionalFallback || globalTeamLinkedGuildIdsResult.usedFallback;
  const sync = buildManagedServersSyncState({
    authUserId: userId,
    accessibleGuildCount: accessibleGuilds.length,
    coveredGuildCount,
    degraded:
      effectiveRequiresDiscordRelink ||
      shouldMarkDiscordSyncFailed ||
      shouldMarkOptionalReadDegraded,
    reason: effectiveRequiresDiscordRelink
      ? discordOAuthRevoked
        ? "discord_oauth_revoked"
        : baseSyncReason
      : shouldMarkDiscordSyncFailed || shouldMarkOptionalReadDegraded
        ? "discord_sync_failed"
        : "ok",
    requiresDiscordRelink: effectiveRequiresDiscordRelink,
    usedDatabaseFallback:
      coveredGuildCount > accessibleGuilds.length ||
      effectiveRequiresDiscordRelink ||
      !accessibleGuildsResult.ok ||
      shouldMarkOptionalReadDegraded,
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
