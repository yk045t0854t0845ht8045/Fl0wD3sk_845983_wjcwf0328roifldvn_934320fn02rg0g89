import { redirect } from "next/navigation";
import { ConfigFlow } from "@/components/config/ConfigFlow";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import {
  buildConfigCheckoutPath,
  normalizePlanCodeFromSlug,
  resolvePlanDefinition,
} from "@/lib/plans/catalog";

type ConfigPlanPageProps = {
  params: Promise<{
    planSlug: string;
  }>;
};

export default async function ConfigPlanPage({ params }: ConfigPlanPageProps) {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    redirect("/login");
  }

  const routeParams = await params;
  const initialPlanCode = normalizePlanCodeFromSlug(routeParams.planSlug, "pro");
  const resolvedPlan = resolvePlanDefinition(initialPlanCode);
  const canonicalPath = buildConfigCheckoutPath({
    planCode: initialPlanCode,
    billingPeriodCode: resolvedPlan.isTrial ? "monthly" : "monthly",
  });

  if (`/config/${routeParams.planSlug}`.toLowerCase() !== canonicalPath.toLowerCase()) {
    redirect(canonicalPath);
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
