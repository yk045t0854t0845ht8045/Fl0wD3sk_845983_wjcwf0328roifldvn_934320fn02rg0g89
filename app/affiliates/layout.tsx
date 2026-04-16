import { MaintenanceGate } from "@/components/common/MaintenanceGate";

export default function AffiliatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MaintenanceGate area="affiliates">{children}</MaintenanceGate>;
}
