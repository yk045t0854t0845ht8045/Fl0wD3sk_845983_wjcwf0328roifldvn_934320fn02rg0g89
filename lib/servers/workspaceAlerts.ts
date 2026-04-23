import type { ManagedServer } from "@/lib/servers/managedServersShared";

export function resolveServersWorkspaceAlertMessage(input: {
  isEditingServer: boolean;
  selectedServer: ManagedServer | null;
  servers: ManagedServer[];
}) {
  if (input.isEditingServer) {
    if (!input.selectedServer) return null;
    if (input.selectedServer.status === "paid") return null;
    return "Plano da conta expirado neste servidor. O bot sera reativado automaticamente apos a aprovacao do pagamento.";
  }

  const hasExpiredAccountServer = input.servers.some(
    (server) =>
      server.isPanelVisible &&
      server.accessMode === "owner" &&
      (server.status === "expired" ||
        server.status === "off" ||
        server.status === "pending_payment"),
  );

  return hasExpiredAccountServer
    ? "Plano da conta expirado. Regularize sua assinatura para manter seus servidores ativos no Flowdesk."
    : null;
}

export function resolveDashboardWorkspaceAlertMessage(servers: ManagedServer[]) {
  const hasExpiredAccountServer = servers.some(
    (server) =>
      server.isPanelVisible &&
      server.accessMode === "owner" &&
      (server.status === "expired" ||
        server.status === "off" ||
        server.status === "pending_payment"),
  );

  return hasExpiredAccountServer
    ? "Plano da conta expirado. Regularize sua assinatura para manter seus servidores ativos no Flowdesk."
    : null;
}
