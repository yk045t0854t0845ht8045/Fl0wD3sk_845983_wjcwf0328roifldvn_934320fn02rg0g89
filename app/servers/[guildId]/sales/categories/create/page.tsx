import { ServerSalesSettingsPage } from "../../SalesSettingsPage";

type ServersSalesCategoryCreatePageProps = {
  params: Promise<{
    guildId: string;
  }>;
};

export default async function ServersSalesCategoryCreatePage({
  params,
}: ServersSalesCategoryCreatePageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_category_create"
    />
  );
}
