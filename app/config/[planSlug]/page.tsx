import { redirect } from "next/navigation";
import { ConfigFlow } from "@/components/config/ConfigFlow";
import { buildLoginHref } from "@/lib/auth/paths";
import { buildServersPlansPath } from "@/lib/plans/addServerFlow";
import { buildAccountPlanUsageSnapshot } from "@/lib/plans/accountPlanUsage";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import {
  buildConfigCheckoutPath,
  normalizePlanCodeFromSlug,
  resolvePlanDefinition,
} from "@/lib/plans/catalog";
import { shouldBlockConfigServerSelection } from "@/lib/plans/configServerSelection";
import { countPlanGuildsForUser } from "@/lib/plans/planGuilds";
import { getUserPlanState } from "@/lib/plans/state";

type ConfigPlanPageProps = {
  params: Promise<{
    planSlug: string;
  }>;
};

export default async function ConfigPlanPage({ params }: ConfigPlanPageProps) {
  const routeParams = await params;
  const initialPlanCode = normalizePlanCodeFromSlug(routeParams.planSlug, "pro");
  const resolvedPlan = resolvePlanDefinition(initialPlanCode);
  const canonicalPath = buildConfigCheckoutPath({
    planCode: initialPlanCode,
    billingPeriodCode: resolvedPlan.isTrial ? "monthly" : "monthly",
  });
  const user = await getCurrentUserFromSessionCookie({ fullContext: true });

  if (!user) {
    redirect(buildLoginHref(canonicalPath));
  }

  if (`/config/${routeParams.planSlug}`.toLowerCase() !== canonicalPath.toLowerCase()) {
    redirect(canonicalPath);
  }

  const [userPlanState, licensedServersCount] = await Promise.all([
    getUserPlanState(user.id),
    countPlanGuildsForUser(user.id),
  ]);
  const usage = buildAccountPlanUsageSnapshot(userPlanState, licensedServersCount);

  if (
    shouldBlockConfigServerSelection({
      userPlanState,
      licensedServersCount: usage.licensedServersCount,
      targetPlanMaxLicensedServers: resolvedPlan.entitlements.maxLicensedServers,
    })
  ) {
    redirect(buildServersPlansPath());
  }

  return (
    <ConfigFlow
      displayName={user.display_name}
      initialPlanCode={initialPlanCode}
      initialBillingPeriodCode="monthly"
      hasExplicitInitialPlan
    />
  );
}
