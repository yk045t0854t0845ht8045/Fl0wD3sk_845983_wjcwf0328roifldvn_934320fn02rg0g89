import { redirect } from "next/navigation";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { ensureUserPaymentDeliveryReady } from "@/lib/payments/paymentReadiness";
import {
  DEFAULT_MANAGED_SERVERS_SYNC_STATE,
  getPanelManagedServersSnapshotForCurrentSession,
} from "@/lib/servers/managedServers";
import { getUserTeamsSnapshotForUser } from "@/lib/teams/userTeams";

function buildDiscordAvatarUrl(
  discordUserId: string | null,
  avatarHash: string | null,
) {
  if (!avatarHash || !discordUserId) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

export async function getServersWorkspaceBootstrap() {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  await ensureUserPaymentDeliveryReady({
    userId: user.id,
    source: "servers_workspace_bootstrap",
  });

  const [serversSnapshot, teamsSnapshot] = await Promise.all([
    getPanelManagedServersSnapshotForCurrentSession().catch(() => ({
      servers: [],
      sync: !user.discord_user_id
        ? {
            ...DEFAULT_MANAGED_SERVERS_SYNC_STATE,
            degraded: true,
            reason: "discord_not_linked" as const,
            requiresDiscordRelink: true,
            usedDatabaseFallback: true,
          }
        : DEFAULT_MANAGED_SERVERS_SYNC_STATE,
    })),
    getUserTeamsSnapshotForUser({
      authUserId: user.id,
      discordUserId: user.discord_user_id,
    }).catch(() => ({ teams: [], pendingInvites: [] })),
  ]);

  return {
    displayName: user.display_name,
    currentAccount: {
      authUserId: user.id,
      discordUserId: user.discord_user_id,
      displayName: user.display_name,
      username: user.username,
      avatarUrl: buildDiscordAvatarUrl(user.discord_user_id, user.avatar),
    },
    initialServers: serversSnapshot.servers,
    initialServersSync: serversSnapshot.sync,
    initialTeams: teamsSnapshot.teams,
    initialPendingInvites: teamsSnapshot.pendingInvites,
  };
}
