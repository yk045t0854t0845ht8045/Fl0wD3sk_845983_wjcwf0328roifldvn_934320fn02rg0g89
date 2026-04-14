import { DomainsPageShell } from "../../DomainsPageShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DomainAiSearchPage() {
  return <DomainsPageShell initialMode="ai" />;
}
