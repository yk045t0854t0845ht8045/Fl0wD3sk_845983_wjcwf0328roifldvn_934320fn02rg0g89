import { ServerSalesSettingsPage } from "../../../SalesSettingsPage";

type ServersSalesCouponsGiftsEditPageProps = {
  params: Promise<{
    guildId: string;
    discountCode: string;
  }>;
};

export default async function ServersSalesCouponsGiftsEditPage({
  params,
}: ServersSalesCouponsGiftsEditPageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_coupons_gifts_edit"
    />
  );
}
