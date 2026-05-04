import { ServerSalesSettingsPage } from "../SalesSettingsPage";

type ServersSalesStockPageProps = {
  params: Promise<{
    guildId: string;
  }>;
};

export default async function ServersSalesStockPage({
  params,
}: ServersSalesStockPageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_stock"
    />
  );
}
