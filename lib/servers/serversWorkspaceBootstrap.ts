import { redirect } from "next/navigation";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { getManagedServersForCurrentSession } from "@/lib/servers/managedServers";
import { getUserTeamsSnapshotForUser } from "@/lib/teams/userTeams";

function buildDiscordAvatarUrl(discordUserId: string, avatarHash: string | null) {
  if (!avatarHash) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

export async function getServersWorkspaceBootstrap() {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  const [initialServers, teamsSnapshot] = await Promise.all([
    getManagedServersForCurrentSession().catch(() => []),
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
    initialServers,
    initialTeams: teamsSnapshot.teams,
    initialPendingInvites: teamsSnapshot.pendingInvites,
  };
}
