import type { Metadata } from "next";
import StatusPageClient from "@/components/status/StatusPageClient";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingFrameLines } from "@/components/landing/LandingFrameLines";

export const metadata: Metadata = {
  title: "Status - Flowdesk",
  description: "Acompanhe o status de todos os servicos da Flowdesk em tempo real.",
};

export default function StatusPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <LandingFrameLines />
      <StatusPageClient />
      <LandingFooter baseDelay={0} bottomDelay={0} />
    </div>
  );
}
