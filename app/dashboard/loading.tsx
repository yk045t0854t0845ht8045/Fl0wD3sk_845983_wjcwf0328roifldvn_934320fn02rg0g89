import { WorkspaceRouteLoading } from "@/components/workspace/WorkspaceRouteLoading";

export default function DashboardLoading() {
  return (
    <WorkspaceRouteLoading
      eyebrow="Flow Boost Loading"
      title="Carregando dashboard"
      subtitle="Aquecendo rotas, dados da conta e atalhos principais do painel."
    />
  );
}
