import { redirect } from "next/navigation";
import { AppMaintenanceScreen } from "@/components/common/AppMaintenanceScreen";
import { AccountPaymentCheckout } from "@/components/payment/AccountPaymentCheckout";
import { buildLoginHref } from "@/lib/auth/paths";
import { getCurrentUserFromSessionCookieSafe } from "@/lib/auth/session";
import {
  HOSTING_PLANS,
  HOSTING_REGIONS,
  HOSTING_STEP_PATH_BY_STEP,
  getHostingKindLabel,
  type HostingKind,
} from "@/lib/hosting/catalog";

type HostingPaymentPageProps = {
  params: Promise<{
    kind: string;
    planId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSingleQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isTruthyQueryFlag(value: string | string[] | undefined) {
  const candidate = readSingleQueryValue(value);
  if (typeof candidate !== "string") return false;
  const normalized = candidate.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isHostingKind(value: string): value is HostingKind {
  return value === "site" || value === "bot" || value === "cdn";
}

function buildHostingPaymentHref(input: {
  surface: "hosting" | "vps";
  kind: HostingKind;
  planId: string;
  query: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (typeof value === "string") {
      params.set(key, value);
    }
  }
  const search = params.toString();
  return `/payment/${input.surface}/${input.kind}/${input.planId}${search ? `?${search}` : ""}`;
}

export async function renderHostingPaymentPage({
  params,
  searchParams,
  surface = "hosting",
}: HostingPaymentPageProps & { surface?: "hosting" | "vps" }) {
  const routeParams = await params;
  const query = searchParams ? await searchParams : {};
  const kind = isHostingKind(routeParams.kind) ? routeParams.kind : null;
  const plan = kind
    ? HOSTING_PLANS[kind].find((item) => item.id === routeParams.planId)
    : null;
  const regionId = readSingleQueryValue(query.hostingRegion) || HOSTING_REGIONS[0]?.id;
  const region = HOSTING_REGIONS.find((item) => item.id === regionId) || HOSTING_REGIONS[0];

  if (!kind || !plan || !region) {
    redirect(HOSTING_STEP_PATH_BY_STEP.plan);
  }

  const currentHref = buildHostingPaymentHref({
    surface,
    kind,
    planId: plan.id,
    query,
  });
  const repository = readSingleQueryValue(query.repository) || null;
  const forceFreshCheckout = isTruthyQueryFlag(query.fresh);
  const amount = plan.monthlyAmount;
  const currency = plan.currency;
  const purchaseContext = {
    type: "hosting" as const,
    title: `${plan.name} VPS`,
    subtitle: `${getHostingKindLabel(kind)} em ${region.city}, ${region.country}`,
    details: [
      `${amount.toLocaleString("pt-BR", { style: "currency", currency })}/mes`,
      region.name,
      repository ? `Repo ${repository}` : "Repositorio selecionado",
    ],
    amount,
    currency,
    hostingKind: kind,
    hostingPlan: plan.id,
    hostingRegion: region.id,
    repository,
  };
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
    redirect(buildLoginHref(currentHref));
  }

  return (
    <AccountPaymentCheckout
      displayName={user.display_name}
      initialPlanCode={plan.paymentPlanCode}
      initialBillingPeriodCode="monthly"
      forceFreshCheckout={forceFreshCheckout}
      purchaseContext={purchaseContext}
    />
  );
}

export default async function HostingPaymentPage(props: HostingPaymentPageProps) {
  return renderHostingPaymentPage({
    ...props,
    surface: "hosting",
  });
}
