import { MaintenanceGate } from "@/components/common/MaintenanceGate";

export default function DomainsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MaintenanceGate area="domains">{children}</MaintenanceGate>;
}
