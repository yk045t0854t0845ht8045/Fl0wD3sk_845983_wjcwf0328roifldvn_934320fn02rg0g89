import {
  fetchGuildSummaryByBot,
  getAccessibleGuildsForSession,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import type { DiscordGuild } from "@/lib/auth/discord";
import {
  getLockedGuildLicenseMap,
} from "@/lib/payments/licenseStatus";
import { reconcileRecentPaymentOrders } from "@/lib/payments/reconciliation";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import {
  getPlanGuildsForUser,
  resolveGuildLicenseFromUserPlanState,
} from "@/lib/plans/planGuilds";
import { getUserPlanState } from "@/lib/plans/state";
import { getAcceptedTeamGuildIdsForUser } from "@/lib/teams/userTeams";

export type ManagedServerStatus = "paid" | "expired" | "off";

export type ManagedServer = {
  guildId: string;
  guildName: string;
  iconUrl: string | null;
  status: ManagedServerStatus;
  accessMode: "owner" | "viewer";
  canManage: boolean;
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

  try {
    await cleanupExpiredUnpaidServerSetups({
      userId: sessionData.authSession.user.id,
      source: "auth_servers",
    });
  } catch {
    // melhor esforco; nao bloquear dashboard por limpeza de onboarding
  }

  try {
    await reconcileRecentPaymentOrders({
      userId: sessionData.authSession.user.id,
      limit: 6,
      source: "auth_servers",
    });
  } catch {
    // melhor esforco; nao bloquear dashboard por reconciliacao oportunista
  }

  const [userPlanState, ownedPlanGuilds] = await Promise.all([
    getUserPlanState(sessionData.authSession.user.id),
    getPlanGuildsForUser(sessionData.authSession.user.id),
  ]);
  const ownedPlanGuildsByGuildId = new Map(
    ownedPlanGuilds.map((record) => [record.guild_id, record]),
  );
  const ownedPlanGuildIds = new Set(ownedPlanGuilds.map((record) => record.guild_id));
  const ownedPlanCoverage = resolveGuildLicenseFromUserPlanState({
    userPlanState,
    guildLicensed: ownedPlanGuildIds.size > 0,
  });

  const accessibleGuilds = await getAccessibleGuildsForSession({
    authSession: sessionData.authSession,
    accessToken: sessionData.accessToken,
  });
  const accessibleGuildLookup = buildGuildLookup(accessibleGuilds);
  const sessionGuildLookup = buildGuildLookup(
    sessionData.authSession.discordGuildsCache,
  );

  const acceptedTeamGuildIds = new Set(
    await getAcceptedTeamGuildIdsForUser({
      authUserId: sessionData.authSession.user.id,
      discordUserId: sessionData.authSession.user.discord_user_id,
    }),
  );
  const guildIdsForLookup = Array.from(
    new Set([
      ...accessibleGuilds.map((guild) => guild.id),
      ...acceptedTeamGuildIds,
      ...ownedPlanGuildIds,
    ]),
  );
  const missingTeamGuildIds = Array.from(acceptedTeamGuildIds).filter(
    (guildId) => !accessibleGuildLookup.has(guildId),
  );

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
        // fallback local abaixo; nao bloquear a listagem inteira por um resumo individual
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

  const lockedGuildMap = await getLockedGuildLicenseMap(guildIdsForLookup);

  if (!ownedPlanGuildIds.size && !lockedGuildMap.size) {
    return Array.from(guildCatalog.values())
      .filter((guild) => acceptedTeamGuildIds.has(guild.id))
      .map((guild) => ({
        guildId: guild.id,
        guildName: guild.name,
        iconUrl: buildGuildIconUrl(guild.id, guild.icon),
        status: "off" as const,
        accessMode: guild.owner ? ("owner" as const) : ("viewer" as const),
        canManage: acceptedTeamGuildIds.has(guild.id) || guild.owner,
        licenseOwnerUserId: sessionData.authSession.user.id,
        licensePaidAt: new Date().toISOString(),
        licenseExpiresAt: new Date().toISOString(),
        graceExpiresAt: new Date().toISOString(),
        daysUntilExpire: 0,
        daysUntilOff: 0,
      }));
  }

  return Array.from(guildCatalog.values())
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
      const accessMode: ManagedServer["accessMode"] = guild.owner ? "owner" : "viewer";

      const status: ManagedServerStatus = currentLicenseBelongsToViewer
        ? lockedRecord?.status || "off"
        : ownedPlanGuild
          ? ownedPlanCoverage.status === "paid" || ownedPlanCoverage.status === "expired"
            ? ownedPlanCoverage.status
            : "off"
          : "off";
      const referencePaidAt = currentLicenseBelongsToViewer
        ? lockedRecord?.paidAt || null
        : ownedPlanGuild?.activated_at || null;
      const referenceCreatedAt = currentLicenseBelongsToViewer
        ? lockedRecord?.createdAt || null
        : ownedPlanGuild?.created_at || null;
      const licenseExpiresAt = currentLicenseBelongsToViewer
        ? lockedRecord?.licenseExpiresAt || null
        : ownedPlanGuild
          ? ownedPlanCoverage.expiresAt || null
          : null;
      const graceExpiresAt = currentLicenseBelongsToViewer
        ? lockedRecord?.graceExpiresAt || null
        : ownedPlanGuild
          ? ownedPlanCoverage.graceExpiresAt || null
          : null;
      const licenseExpiresAtMs = licenseExpiresAt
        ? Date.parse(licenseExpiresAt)
        : Number.NaN;
      const graceExpiresAtMs = graceExpiresAt
        ? Date.parse(graceExpiresAt)
        : Number.NaN;

      return {
        guildId: guild.id,
        guildName: guild.name,
        iconUrl: buildGuildIconUrl(guild.id, guild.icon),
        status,
        accessMode,
        canManage:
          accessibleGuildLookup.has(guild.id) || acceptedTeamGuildIds.has(guild.id),
        licenseOwnerUserId:
          lockedRecord?.userId || sessionData.authSession.user.id,
        licensePaidAt:
          referencePaidAt || referenceCreatedAt || new Date().toISOString(),
        licenseExpiresAt:
          licenseExpiresAt || referenceCreatedAt || new Date().toISOString(),
        graceExpiresAt:
          graceExpiresAt || referenceCreatedAt || new Date().toISOString(),
        daysUntilExpire: Number.isFinite(licenseExpiresAtMs)
          ? daysLeft(licenseExpiresAtMs)
          : 0,
        daysUntilOff: Number.isFinite(graceExpiresAtMs)
          ? daysLeft(graceExpiresAtMs)
          : 0,
      };
    })
    .sort((a, b) => {
      const priority = {
        paid: 0,
        expired: 1,
        off: 2,
      } as const;

      const statusDiff = priority[a.status] - priority[b.status];
      if (statusDiff !== 0) return statusDiff;

      return a.guildName.localeCompare(b.guildName, "pt-BR");
    });
}
