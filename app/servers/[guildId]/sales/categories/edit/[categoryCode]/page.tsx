import { ServerSalesSettingsPage } from "../../../SalesSettingsPage";

type ServersSalesCategoryEditPageProps = {
  params: Promise<{
    guildId: string;
    categoryCode: string;
  }>;
};

export default async function ServersSalesCategoryEditPage({
  params,
}: ServersSalesCategoryEditPageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_category_edit"
    />
  );
}
