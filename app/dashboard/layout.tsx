import { redirect } from "next/navigation";
import { DashboardWorkspace } from "@/components/dashboard/DashboardWorkspace";
import { MaintenanceGate } from "@/components/common/MaintenanceGate";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { getManagedServersForCurrentSession } from "@/lib/servers/managedServers";
import { resolveDashboardWorkspaceAlertMessage } from "@/lib/servers/workspaceAlerts";
import { getUserTeamsSnapshotForUser } from "@/lib/teams/userTeams";

function buildDiscordAvatarUrl(
  discordUserId: string | null,
  avatarHash: string | null,
) {
  if (!avatarHash || !discordUserId) return null;
  const extension = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=96`;
}

async function DashboardLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  const [managedServers, teamsSnapshot] = await Promise.all([
    user.discord_user_id
      ? getManagedServersForCurrentSession().catch(() => [])
      : Promise.resolve([]),
    getUserTeamsSnapshotForUser({
      authUserId: user.id,
      discordUserId: user.discord_user_id,
    }).catch(() => ({ teams: [], pendingInvites: [] })),
  ]);

  const workspaceAlertMessage = resolveDashboardWorkspaceAlertMessage(managedServers);

  return (
    <DashboardWorkspace
      currentAccount={{
        authUserId: user.id,
        discordUserId: user.discord_user_id,
        displayName: user.display_name,
        username: user.username,
        avatarUrl: buildDiscordAvatarUrl(user.discord_user_id, user.avatar),
      }}
      initialServers={managedServers}
      initialTeams={teamsSnapshot.teams}
      initialPendingInvites={teamsSnapshot.pendingInvites}
      workspaceAlertMessage={workspaceAlertMessage}
    >
      {children}
    </DashboardWorkspace>
  );
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MaintenanceGate area="dashboard">
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </MaintenanceGate>
  );
}
