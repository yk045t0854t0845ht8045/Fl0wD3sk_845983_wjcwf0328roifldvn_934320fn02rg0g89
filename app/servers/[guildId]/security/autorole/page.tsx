import { redirect } from "next/navigation";
import { ServersWorkspace } from "@/components/servers/ServersWorkspace";
import { getServersWorkspaceBootstrap } from "@/lib/servers/serversWorkspaceBootstrap";

type ServersSecurityAutoRolePageProps = {
  params: Promise<{
    guildId: string;
  }>;
};

function normalizeGuildId(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

export default async function ServersSecurityAutoRolePage({
  params,
}: ServersSecurityAutoRolePageProps) {
  const workspace = await getServersWorkspaceBootstrap();

  const routeParams = await params;
  const safeGuildId = normalizeGuildId(routeParams.guildId);

  if (!safeGuildId) {
    redirect("/servers/");
  }

  return (
    <ServersWorkspace
      displayName={workspace.displayName}
      currentAccount={workspace.currentAccount}
      initialServers={workspace.initialServers}
      initialTeams={workspace.initialTeams}
      initialPendingInvites={workspace.initialPendingInvites}
      initialGuildId={safeGuildId}
      initialTab="settings"
      initialSettingsSection="security_autorole"
    />
  );
}
