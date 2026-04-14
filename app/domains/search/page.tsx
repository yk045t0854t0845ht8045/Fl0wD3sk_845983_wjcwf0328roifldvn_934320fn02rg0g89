import { DomainsPageShell } from "../DomainsPageShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DomainRegisterSearchPage() {
  return <DomainsPageShell initialMode="register" />;
}
