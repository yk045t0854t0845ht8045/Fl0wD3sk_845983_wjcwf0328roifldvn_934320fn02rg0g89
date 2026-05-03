import { ServerSalesSettingsPage } from "../../../SalesSettingsPage";

type ServersSalesProductEditPageProps = {
  params: Promise<{
    guildId: string;
    productCode: string;
  }>;
};

export default async function ServersSalesProductEditPage({
  params,
}: ServersSalesProductEditPageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_product_edit"
    />
  );
}
