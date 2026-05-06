import { ServerSalesSettingsPage } from "../../../SalesSettingsPage";

type ServersSalesStockEditPageProps = {
  params: Promise<{
    guildId: string;
    productCode: string;
  }>;
};

export default async function ServersSalesStockEditPage({
  params,
}: ServersSalesStockEditPageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_stock_edit"
    />
  );
}
