export const dynamic = "force-dynamic";
export const revalidate = 0;

import { MaintenanceGate } from "@/components/common/MaintenanceGate";
import { LandingRuntimeShell } from "@/components/landing/LandingRuntimeShell";

export default async function HomePage() {
  return (
    <MaintenanceGate area="landing">
      <HomePageContent />
    </MaintenanceGate>
  );
}

async function HomePageContent() {
  return (
    <>
      <LandingRuntimeShell />
    </>
  );
}
