import { ServerSalesSettingsPage } from "../../SalesSettingsPage";

type ServersSalesCouponsGiftsCreatePageProps = {
  params: Promise<{
    guildId: string;
  }>;
};

export default async function ServersSalesCouponsGiftsCreatePage({
  params,
}: ServersSalesCouponsGiftsCreatePageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_coupons_gifts_create"
    />
  );
}
