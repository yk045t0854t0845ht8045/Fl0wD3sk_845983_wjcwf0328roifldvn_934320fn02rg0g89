import { ServerSalesSettingsPage } from "../SalesSettingsPage";

type ServersSalesOverviewPageProps = {
  params: Promise<{
    guildId: string;
  }>;
};

export default async function ServersSalesOverviewPage({
  params,
}: ServersSalesOverviewPageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_overview"
    />
  );
}
