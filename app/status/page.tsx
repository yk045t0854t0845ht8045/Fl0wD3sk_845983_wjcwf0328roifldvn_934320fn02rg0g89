import type { Metadata } from "next";
import { MaintenanceGate } from "@/components/common/MaintenanceGate";
import StatusPageClient from "@/components/status/StatusPageClient";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingFrameLines } from "@/components/landing/LandingFrameLines";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Status - Flowdesk",
  description: "Acompanhe o status de todos os servicos da Flowdesk em tempo real.",
};

export default function StatusPage() {
  return (
    <MaintenanceGate area="status">
      <StatusPageContent />
    </MaintenanceGate>
  );
}

function StatusPageContent() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <LandingFrameLines />
      <StatusPageClient />
      <LandingFooter baseDelay={0} bottomDelay={0} />
    </div>
  );
}
