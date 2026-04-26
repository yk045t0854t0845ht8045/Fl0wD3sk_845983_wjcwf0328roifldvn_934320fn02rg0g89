import { ServerSalesSettingsPage } from "../SalesSettingsPage";

type ServersSalesCouponsGiftsPageProps = {
  params: Promise<{
    guildId: string;
  }>;
};

export default async function ServersSalesCouponsGiftsPage({
  params,
}: ServersSalesCouponsGiftsPageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_coupons_gifts"
    />
  );
}
