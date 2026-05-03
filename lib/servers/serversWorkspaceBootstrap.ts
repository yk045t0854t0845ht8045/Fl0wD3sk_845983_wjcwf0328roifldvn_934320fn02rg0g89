import { redirect } from "next/navigation";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { ensureUserPaymentDeliveryReady } from "@/lib/payments/paymentReadiness";
import {
  DEFAULT_MANAGED_SERVERS_SYNC_STATE,
  getPanelManagedServersSnapshotForCurrentSession,
} from "@/lib/servers/managedServers";
import { getUserTeamsSnapshotForUser } from "@/lib/teams/userTeams";
import { withServerDeadline } from "@/lib/performance/serverData";

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

  void ensureUserPaymentDeliveryReady({
    userId: user.id,
    source: "servers_workspace_bootstrap",
    limit: 3,
  }).catch(() => null);

  const [serversDeadline, teamsDeadline] = await Promise.all([
    withServerDeadline(
      getPanelManagedServersSnapshotForCurrentSession(),
      1450,
    ),
    withServerDeadline(
      getUserTeamsSnapshotForUser({
        authUserId: user.id,
        discordUserId: user.discord_user_id,
      }),
      900,
    ),
  ]);
  const serversSnapshot = serversDeadline.ok
    ? serversDeadline.value
    : {
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
      };
  const teamsSnapshot = teamsDeadline.ok
    ? teamsDeadline.value
    : { teams: [], pendingInvites: [] };

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
