import { notFound } from "next/navigation";
import { HostingWorkspace } from "@/components/dashboard/HostingWorkspace";
import {
  HOSTING_STEP_BY_PATH_SEGMENT,
  type HostingStep,
} from "@/lib/hosting/catalog";

type DashboardHostingStepPageProps = {
  params: Promise<{
    step: string;
  }>;
};

export default async function DashboardHostingStepPage({
  params,
}: DashboardHostingStepPageProps) {
  const { step } = await params;
  const initialStep = HOSTING_STEP_BY_PATH_SEGMENT[step] as HostingStep | undefined;

  if (!initialStep) {
    notFound();
  }

  return <HostingWorkspace initialStep={initialStep} forceOnboarding />;
}
