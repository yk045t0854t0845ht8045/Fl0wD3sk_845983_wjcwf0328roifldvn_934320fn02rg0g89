import type { Metadata } from "next";
import { DomainsPageShell } from "../../DomainsPageShell";
import { buildFlowCwvMetadata } from "@/lib/seo/flowCwv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = buildFlowCwvMetadata({
  title: "FlowAI para dominios",
  description:
    "Fluxo de busca de dominios com IA da Flowdesk para naming, marca, produto e tecnologia.",
  pathname: "/domains/flowai/search",
  noIndex: true,
  keywords: ["ia para dominios", "flowai", "naming com ia"],
});

export default async function DomainAiSearchPage() {
  return <DomainsPageShell initialMode="ai" />;
}
