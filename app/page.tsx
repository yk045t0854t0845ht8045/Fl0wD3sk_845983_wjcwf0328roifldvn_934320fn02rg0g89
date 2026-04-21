export const dynamic = "force-dynamic";
export const revalidate = 0;

import type { Metadata } from "next";
import { MaintenanceGate } from "@/components/common/MaintenanceGate";
import { LandingRuntimeShell } from "@/components/landing/LandingRuntimeShell";
import { FlowCwvStructuredData } from "@/components/seo/FlowCwvStructuredData";
import {
  buildFlowCwvHomeGraph,
  buildFlowCwvMetadata,
} from "@/lib/seo/flowCwv";

export default async function HomePage() {
  return (
    <MaintenanceGate area="landing">
      <HomePageContent />
    </MaintenanceGate>
  );
}

export const metadata: Metadata = buildFlowCwvMetadata({
  title: "Hospedagem, VPS, dominios e bot Discord com IA",
  description:
    "Flowdesk entrega tecnologia para quem precisa de hospedagem, VPS, maquinas virtuais, dominios, infraestrutura, bot Discord com IA e ferramentas para developers em uma operacao web mais rapida e segura.",
  pathname: "/",
  keywords: [
    "hospedagem para developers",
    "vps brasil",
    "maquinas virtuais",
    "registro de dominios",
    "dominios com ia",
    "discord bot com ia",
    "infraestrutura para discord",
  ],
});

async function HomePageContent() {
  return (
    <>
      <FlowCwvStructuredData
        id="flowcwv-home-graph"
        payload={buildFlowCwvHomeGraph()}
      />
      <LandingRuntimeShell />
    </>
  );
}
