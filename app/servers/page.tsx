import { redirect } from "next/navigation";
import { ServersWorkspace } from "@/components/servers/ServersWorkspace";
import { getServersWorkspaceBootstrap } from "@/lib/servers/serversWorkspaceBootstrap";

type ServersPageProps = {
  searchParams?: Promise<{
    guild?: string | string[];
    tab?: string | string[];
  }>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function normalizeGuildId(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

export default async function ServersPage({ searchParams }: ServersPageProps) {
  const workspace = await getServersWorkspaceBootstrap();

  const query = searchParams ? await searchParams : {};
  const legacyGuildId = normalizeGuildId(takeFirstQueryValue(query.guild));
  if (legacyGuildId) {
    redirect(`/servers/${legacyGuildId}/`);
  }

  return (
    <ServersWorkspace
      displayName={workspace.displayName}
      currentAccount={workspace.currentAccount}
      initialServers={workspace.initialServers}
      initialTeams={workspace.initialTeams}
      initialPendingInvites={workspace.initialPendingInvites}
    />
  );
}
