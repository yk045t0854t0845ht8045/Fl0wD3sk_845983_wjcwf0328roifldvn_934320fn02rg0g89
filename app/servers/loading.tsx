import { WorkspaceRouteLoading } from "@/components/workspace/WorkspaceRouteLoading";

export default function ServersLoading() {
  return (
    <WorkspaceRouteLoading
      eyebrow="Flow Boost Loading"
      title="Carregando servidores"
      subtitle="Sincronizando projetos, aquecendo configuracoes e priorizando a navegação."
    />
  );
}
