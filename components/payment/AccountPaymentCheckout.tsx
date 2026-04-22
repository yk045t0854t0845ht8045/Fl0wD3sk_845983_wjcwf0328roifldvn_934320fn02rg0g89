import { ConfigStepFour } from "@/components/config/ConfigStepFour";
import type { PlanBillingPeriodCode, PlanCode } from "@/lib/plans/catalog";

type AccountPaymentCheckoutProps = {
  displayName: string;
  initialPlanCode: PlanCode;
  initialBillingPeriodCode: PlanBillingPeriodCode;
  forceFreshCheckout?: boolean;
};

export function AccountPaymentCheckout({
  displayName,
  initialPlanCode,
  initialBillingPeriodCode,
  forceFreshCheckout = false,
}: AccountPaymentCheckoutProps) {
  return (
    <ConfigStepFour
      displayName={displayName}
      guildId={null}
      initialPlanCode={initialPlanCode}
      initialBillingPeriodCode={initialBillingPeriodCode}
      hasExplicitInitialPlan
      forceFreshCheckout={forceFreshCheckout}
    />
  );
}
