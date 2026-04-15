import type { Metadata } from "next";
import StatusPageClient from "@/components/status/StatusPageClient";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  title: "Status - Flowdesk",
  description: "Acompanhe o status de todos os servicos da Flowdesk em tempo real.",
};

export default function StatusPage() {
  return (
    <>
      <StatusPageClient />
      <LandingFooter baseDelay={0} bottomDelay={0} />
    </>
  );
}
