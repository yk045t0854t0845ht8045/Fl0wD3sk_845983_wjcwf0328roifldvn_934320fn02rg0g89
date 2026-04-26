import { ServerSalesSettingsPage } from "../SalesSettingsPage";

type ServersSalesCategoriesPageProps = {
  params: Promise<{
    guildId: string;
  }>;
};

export default async function ServersSalesCategoriesPage({
  params,
}: ServersSalesCategoriesPageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_categories"
    />
  );
}
