import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminIpApprovalActions } from "@/components/admin/AdminIpApprovalActions";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listPendingDevIpRequests } from "@/lib/test-variables/service";

export default async function AdminTestVariableApprovalsPage() {
  await requirePermission("test_variables.approve_ip");
  const requests = await listPendingDevIpRequests();
  const actionableRequests = requests.filter(
    (request) => request.status === "pending" || request.status === "review",
  );

  return (
    <div className="space-y-[22px]">
      <AdminPageHeader
        eyebrow="Dev Environment"
        title="Aprovacoes de FLWIP"
        description="Central de triagem para credenciamento de IP, concessao de grant e emissao controlada de certificado FLWIP por projeto e ambiente."
        actions={
          <Link
            href="/admin/test-variables"
            className="rounded-[14px] border border-[#1B1B1B] bg-[#101010] px-[14px] py-[11px] text-[13px] font-medium text-[#E5E5E5] transition-colors hover:border-[#262626] hover:bg-[#141414]"
          >
            Voltar ao catalogo
          </Link>
        }
      />

      <AdminDataTable
        title="Fila de solicitacoes"
        description="Pedidos recentes com IP mascarado, ambiente, contexto e estado atual antes da liberacao de grants ou certificados."
        headers={["Solicitante", "Ambiente", "IP", "Motivo", "Status"]}
        rows={requests.map((request) => [
          <div key={`${request.id}-user`} className="space-y-[4px]">
            <p className="font-medium text-[#F0F0F0]">Usuario #{request.authUserId}</p>
            <p className="text-[12px] text-[#6B6B6B]">
              Device: {request.deviceName}
            </p>
          </div>,
          <div key={`${request.id}-environment`} className="space-y-[4px]">
            <p className="text-[#E5E5E5]">{request.environment}</p>
            <p className="text-[12px] text-[#6B6B6B]">
              Projeto: {request.projectId || "nao vinculado"}
            </p>
          </div>,
          <code key={`${request.id}-ip`} className="text-[12px] text-[#D9D9D9]">
            {request.requestedIpMasked}
          </code>,
          <p key={`${request.id}-reason`} className="max-w-[360px] text-[13px] leading-[1.55] text-[#8A8A8A]">
            {request.reason}
          </p>,
          <AdminStatusBadge key={`${request.id}-status`} status={request.status} />,
        ])}
        emptyState={
          <AdminEmptyState
            badgeLabel="Fila limpa"
            title="Nenhuma solicitacao pendente"
            description="A fila de credenciamento de IP esta limpa neste momento."
          />
        }
      />

      {actionableRequests.length ? (
        <AdminIpApprovalActions requests={requests} />
      ) : null}
    </div>
  );
}
