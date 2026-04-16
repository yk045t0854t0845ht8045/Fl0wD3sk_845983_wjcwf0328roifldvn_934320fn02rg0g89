import { MaintenanceGate } from "@/components/common/MaintenanceGate";

export default function ConfigLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MaintenanceGate area="servers">{children}</MaintenanceGate>;
}
