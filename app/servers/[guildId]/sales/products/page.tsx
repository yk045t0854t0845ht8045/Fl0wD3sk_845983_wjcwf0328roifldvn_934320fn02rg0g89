import { ServerSalesSettingsPage } from "../SalesSettingsPage";

type ServersSalesProductsPageProps = {
  params: Promise<{
    guildId: string;
  }>;
};

export default async function ServersSalesProductsPage({
  params,
}: ServersSalesProductsPageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_products"
    />
  );
}
