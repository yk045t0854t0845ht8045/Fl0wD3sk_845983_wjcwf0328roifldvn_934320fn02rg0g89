import { redirect } from "next/navigation";
import { AppMaintenanceScreen } from "@/components/common/AppMaintenanceScreen";
import { AccountPaymentCheckout } from "@/components/payment/AccountPaymentCheckout";
import { buildLoginHref } from "@/lib/auth/paths";
import { getCurrentUserFromSessionCookieSafe } from "@/lib/auth/session";
import {
  normalizePlanBillingPeriodCodeFromSlug,
  normalizePlanCodeFromSlug,
  resolvePlanPricing,
} from "@/lib/plans/catalog";
import { buildPaymentCheckoutEntryHref } from "@/lib/payments/paymentRouting";

const PAYMENT_PROVIDER_RETURN_QUERY_KEYS = [
  "collection_id",
  "collection_status",
  "payment_id",
  "paymentId",
  "status",
  "external_reference",
  "payment_type",
  "merchant_order_id",
  "preference_id",
  "site_id",
  "processing_mode",
  "merchant_account_id",
] as const;

type PaymentPlanOrderPageProps = {
  params: Promise<{
    planSlug: string;
    billingSlug: string;
    orderSlug: string;
    cartSlug: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function isTruthyQueryFlag(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return false;
  const normalized = candidate.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export default async function PaymentPlanOrderPage({
  params,
  searchParams,
}: PaymentPlanOrderPageProps) {
  const routeParams = await params;
  const query = searchParams ? await searchParams : {};
  const initialPlanCode = normalizePlanCodeFromSlug(routeParams.planSlug, "pro");
  const initialBillingPeriodCode = normalizePlanBillingPeriodCodeFromSlug(
    routeParams.billingSlug,
    "monthly",
  );
  const resolvedPricing = resolvePlanPricing(
    initialPlanCode,
    initialBillingPeriodCode,
  );
  const canonicalHref = buildPaymentCheckoutEntryHref({
    planCode: resolvedPricing.code,
    billingPeriodCode: resolvedPricing.billingPeriodCode,
    orderNumber: routeParams.orderSlug,
    orderId: routeParams.cartSlug,
    searchParams: query,
    omitSearchParamKeys: [
      "plan",
      "billing",
      "guild",
      "code",
      "orderId",
      "cartId",
      ...PAYMENT_PROVIDER_RETURN_QUERY_KEYS,
    ],
  });
  const canonicalPathname = canonicalHref.split("?")[0] || canonicalHref;
  const currentPathname =
    `/payment/${routeParams.planSlug}/${routeParams.billingSlug}` +
    `/${routeParams.orderSlug}/${routeParams.cartSlug}`;
  const forceFreshCheckout = isTruthyQueryFlag(query.fresh);
  const sessionResult = await getCurrentUserFromSessionCookieSafe({
    fullContext: true,
  });

  if (sessionResult.degraded) {
    return (
      <AppMaintenanceScreen
        badgeLabel="Checkout protegido"
        title="Checkout temporariamente indisponivel"
        description="Estamos restabelecendo a conexao com a base antes de continuar com seu pagamento. Tente novamente em instantes."
        refreshLabel="Tentar novamente"
        fallbackHref="/"
      />
    );
  }

  const user = sessionResult.user;

  if (!user) {
    redirect(buildLoginHref(canonicalHref));
  }

  if (currentPathname.toLowerCase() !== canonicalPathname.toLowerCase()) {
    redirect(canonicalHref);
  }

  return (
    <AccountPaymentCheckout
      displayName={user.display_name}
      initialPlanCode={resolvedPricing.code}
      initialBillingPeriodCode={resolvedPricing.billingPeriodCode}
      forceFreshCheckout={forceFreshCheckout}
    />
  );
}
