import type { Metadata } from "next";
import StatusPageClient from "@/components/status/StatusPageClient";

export const metadata: Metadata = {
  title: "Status - Flowdesk",
  description: "Acompanhe o status de todos os serviços da Flowdesk em tempo real.",
};

export default function StatusPage() {
  return <StatusPageClient />;
}
