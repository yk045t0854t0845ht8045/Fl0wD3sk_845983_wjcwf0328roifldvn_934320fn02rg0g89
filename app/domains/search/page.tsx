import type { Metadata } from "next";
import { DomainsPageShell } from "../DomainsPageShell";
import { buildFlowCwvMetadata } from "@/lib/seo/flowCwv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = buildFlowCwvMetadata({
  title: "Busca de dominios",
  description: "Pagina de busca e consulta de dominios da Flowdesk.",
  pathname: "/domains/search",
  noIndex: true,
  keywords: ["busca de dominios", "consulta de dominios"],
});

export default async function DomainRegisterSearchPage() {
  return <DomainsPageShell initialMode="register" />;
}
