import { redirect } from "next/navigation";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { ConfigFlow } from "@/components/config/ConfigFlow";
import { buildLoginHref } from "@/lib/auth/paths";
import { buildServersPlansPath } from "@/lib/plans/addServerFlow";
import { buildAccountPlanUsageSnapshot } from "@/lib/plans/accountPlanUsage";
import {
  normalizePlanBillingPeriodCode,
  normalizePlanCode,
  resolvePlanPricing,
} from "@/lib/plans/catalog";
import {
  shouldBlockConfigServerSelection,
  shouldBypassConfigServerSelectionBlock,
} from "@/lib/plans/configServerSelection";
import {
  buildConfigCheckoutEntryHref,
  buildConfigCheckoutSearchParams,
  buildConfigUrlWithHashRoute,
} from "@/lib/plans/configRouting";
import {
  buildConfigPaymentRequiredHref,
  hasActivePaidConfigPlan,
} from "@/lib/plans/configAccess";
import { countPlanGuildsForUser } from "@/lib/plans/planGuilds";
import { getUserPlanState } from "@/lib/plans/state";

type ConfigPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export default async function ConfigPage({ searchParams }: ConfigPageProps) {
  const query = searchParams ? await searchParams : {};
  const requestedPlan = takeFirstQueryValue(query.plan);
  const requestedBilling = takeFirstQueryValue(query.billing);
  const forwardedSearchParams = buildConfigCheckoutSearchParams({
    searchParams: query,
    omitKeys: ["plan", "billing"],
  });
  const requestedNextPath = requestedPlan
    ? buildConfigCheckoutEntryHref({
        planCode: requestedPlan,
        billingPeriodCode: requestedBilling,
        fallbackPlanCode: "pro",
        searchParams: forwardedSearchParams,
      })
    : buildConfigUrlWithHashRoute("/config", forwardedSearchParams.toString());
  const user = await getCurrentUserFromSessionCookie({ fullContext: true });

  if (!user) {
    redirect(buildLoginHref(requestedNextPath));
  }

  const userPlanState = await getUserPlanState(user.id);
  if (!hasActivePaidConfigPlan(userPlanState)) {
    redirect(
      buildConfigPaymentRequiredHref({
        planCode: requestedPlan || "pro",
        billingPeriodCode: requestedBilling || "monthly",
        searchParams: forwardedSearchParams,
        returnPath: requestedNextPath,
      }),
    );
  }

  if (requestedPlan) {
    redirect(requestedNextPath);
  }

  const licensedServersCount = await countPlanGuildsForUser(user.id);
  const usage = buildAccountPlanUsageSnapshot(userPlanState, licensedServersCount);
  const defaultPlan = resolvePlanPricing("pro", "monthly");

  if (
    shouldBlockConfigServerSelection({
      userPlanState,
      licensedServersCount: usage.licensedServersCount,
      targetPlanMaxLicensedServers: defaultPlan.entitlements.maxLicensedServers,
    })
    && !shouldBypassConfigServerSelectionBlock({
      userPlanState,
      targetPlanCode: defaultPlan.code,
      searchParams: query,
    })
  ) {
    redirect(buildServersPlansPath());
  }

  return (
    <ConfigFlow
      displayName={user.display_name}
      initialPlanCode={normalizePlanCode(null, "pro")}
      initialBillingPeriodCode={normalizePlanBillingPeriodCode(null, "monthly")}
      hasExplicitInitialPlan={false}
    />
  );
}
