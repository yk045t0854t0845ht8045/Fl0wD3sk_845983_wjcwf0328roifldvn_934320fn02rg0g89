import { redirect } from "next/navigation";
import { ServersWorkspace } from "@/components/servers/ServersWorkspace";
import { getServersWorkspaceBootstrap } from "@/lib/servers/serversWorkspaceBootstrap";

type ServersByGuildPageProps = {
  params: Promise<{
    guildId: string;
  }>;
  searchParams?: Promise<{
    tab?: string | string[];
  }>;
};

function normalizeGuildId(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

function normalizeServerTab() {
  return "settings" as const;
}

export default async function ServersByGuildPage({
  params,
  searchParams,
}: ServersByGuildPageProps) {
  const workspace = await getServersWorkspaceBootstrap();

  const routeParams = await params;
  const safeGuildId = normalizeGuildId(routeParams.guildId);

  if (!safeGuildId) {
    redirect("/servers/");
  }

  if (searchParams) {
    await searchParams;
  }
  const tab = normalizeServerTab();

  return (
    <ServersWorkspace
      displayName={workspace.displayName}
      currentAccount={workspace.currentAccount}
      initialServers={workspace.initialServers}
      initialTeams={workspace.initialTeams}
      initialPendingInvites={workspace.initialPendingInvites}
      initialGuildId={safeGuildId}
      initialTab={tab}
    />
  );
}
