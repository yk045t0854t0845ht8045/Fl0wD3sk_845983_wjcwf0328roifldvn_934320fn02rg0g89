import { WorkspaceRouteLoading } from "@/components/workspace/WorkspaceRouteLoading";

export default function ServerByGuildLoading() {
  return (
    <WorkspaceRouteLoading
      eyebrow="Flow Boost Loading"
      title="Carregando configuracoes"
      subtitle="Preparando o editor do servidor, secoes laterais e dados prioritarios."
    />
  );
}
