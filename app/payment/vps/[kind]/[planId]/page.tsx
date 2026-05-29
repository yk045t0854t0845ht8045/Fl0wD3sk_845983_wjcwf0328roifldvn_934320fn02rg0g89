import {
  renderHostingPaymentPage,
} from "../../../hosting/[kind]/[planId]/page";

type VpsPaymentPageProps = {
  params: Promise<{
    kind: string;
    planId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VpsPaymentPage(props: VpsPaymentPageProps) {
  return renderHostingPaymentPage({
    ...props,
    surface: "vps",
  });
}
