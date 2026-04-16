import { MaintenanceGate } from "@/components/common/MaintenanceGate";

export default function ServersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MaintenanceGate area="servers">{children}</MaintenanceGate>;
}
