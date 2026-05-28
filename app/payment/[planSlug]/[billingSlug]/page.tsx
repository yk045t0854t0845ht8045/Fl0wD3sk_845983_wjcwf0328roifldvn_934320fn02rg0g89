import { redirect } from "next/navigation";
import { AppMaintenanceScreen } from "@/components/common/AppMaintenanceScreen";
import { AccountPaymentCheckout } from "@/components/payment/AccountPaymentCheckout";
import { buildLoginHref } from "@/lib/auth/paths";
import { getCurrentUserFromSessionCookieSafe } from "@/lib/auth/session";
import {
  HOSTING_PLANS,
  HOSTING_REGIONS,
  getHostingKindLabel,
  type HostingKind,
} from "@/lib/hosting/catalog";
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

type PaymentPlanBillingPageProps = {
  params: Promise<{
    planSlug: string;
    billingSlug: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function isTruthyQueryFlag(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return false;
  const normalized = candidate.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function readSingleQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeCheckoutAmount(value: string | string[] | undefined) {
  const raw = readSingleQueryValue(value);
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().replace(/,/g, ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
}

function normalizeCurrencyCode(value: string | string[] | undefined) {
  const raw = readSingleQueryValue(value);
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function buildPurchaseContext(query: Record<string, string | string[] | undefined>) {
  if (readSingleQueryValue(query.source) !== "dashboard-hosting") return null;
  const hostingKind = readSingleQueryValue(query.hostingKind) as HostingKind | undefined;
  const hostingPlanId = readSingleQueryValue(query.hostingPlan);
  const hostingRegionId = readSingleQueryValue(query.hostingRegion);
  if (!hostingKind || !hostingPlanId || !hostingRegionId || !(hostingKind in HOSTING_PLANS)) {
    return null;
  }

  const plan = HOSTING_PLANS[hostingKind].find((item) => item.id === hostingPlanId);
  const region = HOSTING_REGIONS.find((item) => item.id === hostingRegionId);
  if (!plan || !region) return null;

  const repository = readSingleQueryValue(query.repository) || null;
  const amount = normalizeCheckoutAmount(query.amount) ?? plan.monthlyAmount;
  const currency = normalizeCurrencyCode(query.currency) ?? plan.currency;

  return {
    type: "hosting" as const,
    title: `${plan.name} VPS`,
    subtitle: `${getHostingKindLabel(hostingKind)} em ${region.city}, ${region.country}`,
    details: [
      `${amount.toLocaleString("pt-BR", { style: "currency", currency })}/mes`,
      region.name,
      repository ? `Repo ${repository}` : "Repositorio selecionado",
    ],
    amount,
    currency,
    hostingKind,
    hostingPlan: plan.id,
    hostingRegion: region.id,
    repository,
  };
}

export default async function PaymentPlanBillingPage({
  params,
  searchParams,
}: PaymentPlanBillingPageProps) {
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
  const currentPathname = `/payment/${routeParams.planSlug}/${routeParams.billingSlug}`;
  const forceFreshCheckout = isTruthyQueryFlag(query.fresh);
  const purchaseContext = buildPurchaseContext(query);
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
      purchaseContext={purchaseContext}
    />
  );
}
