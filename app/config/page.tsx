import { redirect } from "next/navigation";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { ConfigFlow } from "@/components/config/ConfigFlow";
import { buildLoginHref } from "@/lib/auth/paths";
import { buildServersPlansPath } from "@/lib/plans/addServerFlow";
import { buildAccountPlanUsageSnapshot } from "@/lib/plans/accountPlanUsage";
import {
  buildConfigCheckoutPath,
  normalizePlanBillingPeriodCode,
  normalizePlanCode,
  resolvePlanPricing,
} from "@/lib/plans/catalog";
import { shouldBlockConfigServerSelection } from "@/lib/plans/configServerSelection";
import { countPlanGuildsForUser } from "@/lib/plans/planGuilds";
import { getUserPlanState } from "@/lib/plans/state";

type ConfigPageProps = {
  searchParams?: Promise<{
    plan?: string | string[];
    billing?: string | string[];
  }>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export default async function ConfigPage({ searchParams }: ConfigPageProps) {
  const query = searchParams ? await searchParams : {};
  const requestedPlan = takeFirstQueryValue(query.plan);
  const requestedBilling = takeFirstQueryValue(query.billing);
  const requestedNextPath = requestedPlan
    ? buildConfigCheckoutPath({
        planCode: requestedPlan,
        billingPeriodCode: requestedBilling,
        fallbackPlanCode: "pro",
      })
    : "/config";
  const user = await getCurrentUserFromSessionCookie({ fullContext: true });

  if (!user) {
    redirect(buildLoginHref(requestedNextPath));
  }

  if (requestedPlan) {
    redirect(requestedNextPath);
  }

  const [userPlanState, licensedServersCount] = await Promise.all([
    getUserPlanState(user.id),
    countPlanGuildsForUser(user.id),
  ]);
  const usage = buildAccountPlanUsageSnapshot(userPlanState, licensedServersCount);
  const defaultPlan = resolvePlanPricing("pro", "monthly");

  if (
    shouldBlockConfigServerSelection({
      userPlanState,
      licensedServersCount: usage.licensedServersCount,
      targetPlanMaxLicensedServers: defaultPlan.entitlements.maxLicensedServers,
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
