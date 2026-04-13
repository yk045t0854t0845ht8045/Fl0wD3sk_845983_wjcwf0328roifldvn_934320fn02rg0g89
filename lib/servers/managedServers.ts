import {
  fetchGuildSummaryByBot,
  getAccessibleGuildsForSession,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import type { DiscordGuild } from "@/lib/auth/discord";
import {
  getLockedGuildLicenseMap,
  getLockedGuildLicenseMapByUserId,
} from "@/lib/payments/licenseStatus";
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
import { 
  getAcceptedTeamGuildIdsForUser,
  getGlobalTeamLinkedGuildIds
} from "@/lib/teams/userTeams";

const managedServersCache = new Map<number, { servers: ManagedServer[]; timestamp: number }>();
const refreshingUserIds = new Set<number>();
const CACHE_TTL_MS = 600000; // 10 minutos (TTL global)
const STALE_THRESHOLD_MS = 20000; // 20 segundos (tempo até disparar refresh em background)


export type ManagedServerStatus = "paid" | "expired" | "off" | "pending_payment";

export type ManagedServer = {
  guildId: string;
  guildName: string;
  iconUrl: string | null;
  status: ManagedServerStatus;
  accessMode: "owner" | "viewer";
  canManage: boolean;
  blockedByPlanLimit: boolean;
  pendingDowngradePayment: boolean;
  licenseOwnerUserId: number;
  licensePaidAt: string;
  licenseExpiresAt: string;
  graceExpiresAt: string;
  daysUntilExpire: number;
  daysUntilOff: number;
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

export async function getManagedServersForCurrentSession(): Promise<ManagedServer[]> {
  const sessionData = await resolveSessionAccessToken();

  if (!sessionData?.authSession) {
    throw new Error("Nao autenticado.");
  }

  if (!sessionData.accessToken) {
    throw new Error("Token OAuth ausente na sessao.");
  }

  const userId = sessionData.authSession.user.id;

  // 1. Verificar Cache (SWR Pattern)
  const cached = managedServersCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    const isStale = Date.now() - cached.timestamp > STALE_THRESHOLD_MS;

    // Se estiver "stale" (velho demais pro tempo ideal), atualiza em background
    if (isStale && !refreshingUserIds.has(userId)) {
      refreshingUserIds.add(userId);
      // Fire and forget: atualiza o cache silenciosamente
      void fetchManagedServersFresh(sessionData)
        .catch(() => null)
        .finally(() => refreshingUserIds.delete(userId));
    }

    return cached.servers;
  }

  // Se for MISS (primeira vez ou expirou tudo), espera o fresh carregar
  return fetchManagedServersFresh(sessionData);
}

// Helper para carga TOTALMENTE PARALELA (Fase Única)
async function fetchManagedServersFresh(
  sessionData: Awaited<ReturnType<typeof resolveSessionAccessToken>>,
): Promise<ManagedServer[]> {
  if (!sessionData?.authSession) return [];
  if (!sessionData.accessToken) {
    throw new Error("Token OAuth ausente na sessao.");
  }
  const userId = sessionData.authSession.user.id;

  void cleanupExpiredUnpaidServerSetups({ userId, source: "auth_servers" }).catch(() => null);
  void reconcileRecentPaymentOrders({ userId, limit: 6, source: "auth_servers" }).catch(() => null);

  // DISPARAR TUDO EM PARALELO (Fase Única - Estilo Microsoft/Google)
  const [
    userPlanState,
    scheduledChange,
    accessibleGuilds,
    acceptedTeamGuildIdsList,
    ownedPlanGuilds,
    lockedGuildMap,
    downgradeEnforcement,
  ] = await Promise.all([
    getUserPlanState(userId),
    getUserPlanScheduledChange(userId),
    getAccessibleGuildsForSession({
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    }),
    getAcceptedTeamGuildIdsForUser({
      authUserId: userId,
      discordUserId: sessionData.authSession.user.discord_user_id,
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

  const acceptedTeamGuildIds = new Set(acceptedTeamGuildIdsList);
  const ownedPlanGuildsByGuildId = new Map(
    ownedPlanGuilds.map((record) => [record.guild_id, record]),
  );
  const ownedPlanGuildIds = new Set(ownedPlanGuilds.map((record) => record.guild_id));
  const ownedActivePlanGuildIds = new Set(
    ownedPlanGuilds
      .filter((record) => record.is_active !== false)
      .map((record) => record.guild_id),
  );

  const hasPendingDowngradePayment = Boolean(
    downgradeEnforcement &&
      (downgradeEnforcement.status === "selection_required" ||
        downgradeEnforcement.status === "awaiting_payment"),
  );

  const ownedPlanCoverage = resolveGuildLicenseFromUserPlanState({
    userPlanState,
    guildLicensed: ownedPlanGuildIds.size > 0 || ownedActivePlanGuildIds.size > 0,
  });

  const accessibleGuildLookup = buildGuildLookup(accessibleGuilds);
  const sessionGuildLookup = buildGuildLookup(
    sessionData.authSession.discordGuildsCache,
  );

  const missingTeamGuildIds = Array.from(acceptedTeamGuildIds).filter(
    (guildId) => !accessibleGuildLookup.has(guildId),
  );

  // 5. Resolvê Guildas de Time Suplementares
  const supplementalTeamGuilds = await Promise.all(
    missingTeamGuildIds.map(async (guildId) => {
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
            owner: false,
          };
        }
      } catch {
        // fallback local
      }

      return {
        id: guildId,
        name: buildFallbackGuildName(guildId),
        icon: null,
        owner: false,
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
      ...supplementalTeamGuilds,
    ].map((guild) => [guild.id, guild]),
  );

  const guildIdsForLookup = Array.from(guildCatalog.keys());
  const globalTeamLinkedGuildIds = await getGlobalTeamLinkedGuildIds(guildIdsForLookup);

  const servers = Array.from(guildCatalog.values())
    .filter(
      (guild) =>
        ownedPlanGuildIds.has(guild.id) ||
        lockedGuildMap.has(guild.id) ||
        acceptedTeamGuildIds.has(guild.id),
    )
    .map((guild) => {
      const ownedPlanGuild = ownedPlanGuildsByGuildId.get(guild.id) || null;
      const lockedRecord = lockedGuildMap.get(guild.id) || null;
      const currentLicenseBelongsToViewer = Boolean(
        lockedRecord && lockedRecord.userId !== sessionData.authSession.user.id,
      );
      const selfAccountLockedRecord =
        lockedRecord && lockedRecord.userId === sessionData.authSession.user.id
          ? lockedRecord
          : null;
      const accessMode: ManagedServer["accessMode"] = guild.owner ? "owner" : "viewer";
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
        licenseOwnerUserId: lockedRecord?.userId || sessionData.authSession.user.id,
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

  // Atualizar Cache
  managedServersCache.set(userId, {
    servers,
    timestamp: Date.now(),
  });

  return servers;
}
