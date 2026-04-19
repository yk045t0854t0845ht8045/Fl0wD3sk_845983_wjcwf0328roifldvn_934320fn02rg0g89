import { redirect } from "next/navigation";
import { ConfigFlow } from "@/components/config/ConfigFlow";
import { buildLoginHref } from "@/lib/auth/paths";
import { buildServersPlansPath } from "@/lib/plans/addServerFlow";
import { buildAccountPlanUsageSnapshot } from "@/lib/plans/accountPlanUsage";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import {
  buildConfigPlanPath,
  normalizePlanCodeFromSlug,
  resolvePlanDefinition,
} from "@/lib/plans/catalog";
import {
  shouldBlockConfigServerSelection,
  shouldBypassConfigServerSelectionBlock,
} from "@/lib/plans/configServerSelection";
import {
  buildConfigPaymentRequiredHref,
  hasActivePaidConfigPlan,
} from "@/lib/plans/configAccess";
import { buildConfigCheckoutEntryHref } from "@/lib/plans/configRouting";
import { countPlanGuildsForUser } from "@/lib/plans/planGuilds";
import { getUserPlanState } from "@/lib/plans/state";

type ConfigPlanPageProps = {
  params: Promise<{
    planSlug: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ConfigPlanPage({
  params,
  searchParams,
}: ConfigPlanPageProps) {
  const routeParams = await params;
  const query = searchParams ? await searchParams : {};
  const initialPlanCode = normalizePlanCodeFromSlug(routeParams.planSlug, "pro");
  const resolvedPlan = resolvePlanDefinition(initialPlanCode);
  const canonicalPath = buildConfigCheckoutEntryHref({
    planCode: initialPlanCode,
    billingPeriodCode: resolvedPlan.isTrial ? "monthly" : "monthly",
    searchParams: query,
    omitSearchParamKeys: ["plan", "billing"],
  });
  const canonicalPathname = buildConfigPlanPath(initialPlanCode);
  const user = await getCurrentUserFromSessionCookie({ fullContext: true });

  if (!user) {
    redirect(buildLoginHref(canonicalPath));
  }

  const userPlanState = await getUserPlanState(user.id);
  if (!hasActivePaidConfigPlan(userPlanState)) {
    redirect(
      buildConfigPaymentRequiredHref({
        planCode: resolvedPlan.code,
        billingPeriodCode: "monthly",
        searchParams: query,
        omitSearchParamKeys: ["plan", "billing"],
        returnPath: canonicalPath,
      }),
    );
  }

  if (`/config/${routeParams.planSlug}`.toLowerCase() !== canonicalPathname.toLowerCase()) {
    redirect(canonicalPath);
  }

  const licensedServersCount = await countPlanGuildsForUser(user.id);
  const usage = buildAccountPlanUsageSnapshot(userPlanState, licensedServersCount);

  if (
    shouldBlockConfigServerSelection({
      userPlanState,
      licensedServersCount: usage.licensedServersCount,
      targetPlanMaxLicensedServers: resolvedPlan.entitlements.maxLicensedServers,
    })
    && !shouldBypassConfigServerSelectionBlock({
      userPlanState,
      targetPlanCode: resolvedPlan.code,
      searchParams: query,
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
