import { ServerSalesSettingsPage } from "../SalesSettingsPage";

type ServersSalesPaymentMethodsPageProps = {
  params: Promise<{
    guildId: string;
  }>;
};

export default async function ServersSalesPaymentMethodsPage({
  params,
}: ServersSalesPaymentMethodsPageProps) {
  return (
    <ServerSalesSettingsPage
      params={params}
      settingsSection="sales_payment_methods"
    />
  );
}
