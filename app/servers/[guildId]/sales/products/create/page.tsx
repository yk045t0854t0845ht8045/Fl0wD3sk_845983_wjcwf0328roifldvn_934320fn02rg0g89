import { ServerSalesSettingsPage } from "../../SalesSettingsPage";

type ServersSalesProductCreatePageProps = {
  params: Promise<{
    guildId: string;
  }>;
};

export default async function ServersSalesProductCreatePage({
  params,
}: ServersSalesProductCreatePageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_product_create"
    />
  );
}
