import { redirect } from "next/navigation";
import { ServersWorkspace } from "@/components/servers/ServersWorkspace";
import { getServersWorkspaceBootstrap } from "@/lib/servers/serversWorkspaceBootstrap";

type ServerSalesSettingsSection =
  | "sales_overview"
  | "sales_categories"
  | "sales_products"
  | "sales_payment_methods"
  | "sales_coupons_gifts";

type ServerSalesSettingsPageProps = {
  params: Promise<{
    guildId: string;
  }>;
  settingsSection: ServerSalesSettingsSection;
};

function normalizeGuildId(value: string | null) {
  if (!value) return null;
  const guildId = value.trim();
  return /^\d{10,25}$/.test(guildId) ? guildId : null;
}

export async function ServerSalesSettingsPage({
  params,
  settingsSection,
}: ServerSalesSettingsPageProps) {
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
      initialSettingsSection={settingsSection}
    />
  );
}
