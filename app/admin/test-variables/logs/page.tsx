import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listTestVariableReadLogs } from "@/lib/test-variables/service";

export default async function AdminTestVariableLogsPage() {
  await requirePermission("test_variables.view_logs");
  const logs = await listTestVariableReadLogs(120);

  return (
    <div className="space-y-[22px]">
      <AdminPageHeader
        eyebrow="Dev Environment"
        title="Logs de leitura"
        description="Cada pull autorizado ou bloqueado deixa a trilha de quem tentou ler, quais chaves foram pedidas e o motivo do bloqueio quando houver."
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
        title="Timeline de consumo"
        description="O backend registra tanto leituras liberadas quanto tentativas bloqueadas por falta de grant, allowlist ou certificado."
        headers={["Quando", "Ator", "Projeto", "Resultado", "Chaves"]}
        rows={logs.map((log) => [
          <p key={`${log.id}-created`} className="text-[12px] text-[#8A8A8A]">
            {new Date(log.createdAt).toLocaleString("pt-BR")}
          </p>,
          <p key={`${log.id}-actor`} className="text-[#E5E5E5]">
            {log.actorUserId ? `Usuario #${log.actorUserId}` : "sistema"}
          </p>,
          <div key={`${log.id}-project`} className="space-y-[4px]">
            <p className="text-[#E5E5E5]">{log.projectId || "nao vinculado"}</p>
            <p className="text-[12px] text-[#6B6B6B]">{log.environment || "sem ambiente"}</p>
          </div>,
          <div key={`${log.id}-result`} className="space-y-[8px]">
            <AdminStatusBadge status={log.result} />
            {log.blockReason ? (
              <p className="max-w-[220px] text-[12px] leading-[1.5] text-[#8A8A8A]">
                {log.blockReason}
              </p>
            ) : null}
          </div>,
          <div key={`${log.id}-keys`} className="space-y-[4px] text-[12px] text-[#8A8A8A]">
            <p>Pedidas: {(log.requestedKeys || []).join(", ") || "todas"}</p>
            <p>Entregues: {(log.deliveredKeys || []).join(", ") || "nenhuma"}</p>
          </div>,
        ])}
        emptyState={
          <AdminEmptyState
            badgeLabel="Sem consumo"
            title="Nenhuma leitura registrada"
            description="Os logs de consumo aparecem aqui assim que o primeiro pull autorizado ou bloqueado acontecer."
          />
        }
      />
    </div>
  );
}
