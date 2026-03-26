import {
  getAccessibleGuildsForSession,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  getLockedGuildLicenseMap,
  resolveLatestLicenseCoverageMapForGuilds,
} from "@/lib/payments/licenseStatus";
import { reconcileRecentPaymentOrders } from "@/lib/payments/reconciliation";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { getAcceptedTeamGuildIdsForUser } from "@/lib/teams/userTeams";

export type ManagedServerStatus = "paid" | "expired" | "off";

export type ManagedServer = {
  guildId: string;
  guildName: string;
  iconUrl: string | null;
  status: ManagedServerStatus;
  accessMode: "owner" | "viewer";
  licenseOwnerUserId: number;
  licensePaidAt: string;
  licenseExpiresAt: string;
  graceExpiresAt: string;
  daysUntilExpire: number;
  daysUntilOff: number;
};

type ApprovedOrderRecord = {
  guild_id: string;
  paid_at: string | null;
  created_at: string;
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

export async function getManagedServersForCurrentSession(): Promise<ManagedServer[]> {
  const sessionData = await resolveSessionAccessToken();

  if (!sessionData?.authSession) {
    throw new Error("Nao autenticado.");
  }

  if (!sessionData.accessToken) {
    throw new Error("Token OAuth ausente na sessao.");
  }

  const supabase = getSupabaseAdminClientOrThrow();

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

  const approvedOrdersResult = await supabase
    .from("payment_orders")
    .select("guild_id, paid_at, created_at")
    .eq("user_id", sessionData.authSession.user.id)
    .eq("status", "approved")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<ApprovedOrderRecord[]>();

  if (approvedOrdersResult.error) {
    throw new Error(approvedOrdersResult.error.message);
  }

  const latestApprovedOrderByGuild = new Map<string, ApprovedOrderRecord[]>();
  for (const order of approvedOrdersResult.data || []) {
    const current = latestApprovedOrderByGuild.get(order.guild_id) || [];
    current.push(order);
    latestApprovedOrderByGuild.set(order.guild_id, current);
  }

  const latestOwnedCoverageByGuild =
    resolveLatestLicenseCoverageMapForGuilds(latestApprovedOrderByGuild);

  const accessibleGuilds = await getAccessibleGuildsForSession({
    authSession: sessionData.authSession,
    accessToken: sessionData.accessToken,
  });

  const lockedGuildMap = await getLockedGuildLicenseMap(
    accessibleGuilds.map((guild) => guild.id),
  );
  const acceptedTeamGuildIds = new Set(
    await getAcceptedTeamGuildIdsForUser({
      authUserId: sessionData.authSession.user.id,
      discordUserId: sessionData.authSession.user.discord_user_id,
    }),
  );

  if (!latestApprovedOrderByGuild.size && !lockedGuildMap.size) {
    return accessibleGuilds
      .filter((guild) => acceptedTeamGuildIds.has(guild.id))
      .map((guild) => ({
        guildId: guild.id,
        guildName: guild.name,
        iconUrl: buildGuildIconUrl(guild.id, guild.icon),
        status: "off" as const,
        accessMode: "viewer" as const,
        licenseOwnerUserId: sessionData.authSession.user.id,
        licensePaidAt: new Date().toISOString(),
        licenseExpiresAt: new Date().toISOString(),
        graceExpiresAt: new Date().toISOString(),
        daysUntilExpire: 0,
        daysUntilOff: 0,
      }));
  }

  return accessibleGuilds
    .filter(
      (guild) =>
        latestOwnedCoverageByGuild.has(guild.id) ||
        lockedGuildMap.has(guild.id) ||
        acceptedTeamGuildIds.has(guild.id),
    )
    .map((guild) => {
      const ownedCoverage = latestOwnedCoverageByGuild.get(guild.id) || null;
      const lockedRecord = lockedGuildMap.get(guild.id) || null;
      const currentLicenseBelongsToViewer =
        lockedRecord?.userId !== sessionData.authSession.user.id;
      const isLicenseOwner = lockedRecord
        ? !currentLicenseBelongsToViewer
        : Boolean(ownedCoverage);
      const accessMode: ManagedServer["accessMode"] = isLicenseOwner
        ? "owner"
        : "viewer";

      const status: ManagedServerStatus = currentLicenseBelongsToViewer
        ? lockedRecord?.status || "off"
        : ownedCoverage?.status || "off";
      const referencePaidAt = currentLicenseBelongsToViewer
        ? lockedRecord?.paidAt || null
        : ownedCoverage?.paidAt || null;
      const referenceCreatedAt = currentLicenseBelongsToViewer
        ? lockedRecord?.createdAt || null
        : ownedCoverage?.createdAt || null;
      const licenseExpiresAt = currentLicenseBelongsToViewer
        ? lockedRecord?.licenseExpiresAt || null
        : ownedCoverage?.licenseExpiresAt || null;
      const graceExpiresAt = currentLicenseBelongsToViewer
        ? lockedRecord?.graceExpiresAt || null
        : ownedCoverage?.graceExpiresAt || null;
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
