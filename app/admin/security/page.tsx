import { Lock, Shield, ShieldAlert, Siren } from "lucide-react";
import { AdminAuditTimeline } from "@/components/admin/AdminAuditTimeline";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { can, requirePermission } from "@/lib/admin/auth";
import { listAdminAuditLogs } from "@/lib/admin/read";
import {
  listAdminIpAllowlist,
  listAdminSecurityEvents,
} from "@/lib/admin/operations";
import {
  listDevCertificates,
  listTestVariableReadLogs,
} from "@/lib/test-variables/service";

function formatDateTime(value: string | null) {
  if (!value) return "Sem registro";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminSecurityPage() {
  await requirePermission("security.read");
  const auditVisible = await can("audit.read");
  const [events, allowlist, certificates, readLogs, auditLogs] = await Promise.all([
    listAdminSecurityEvents(80),
    listAdminIpAllowlist(60),
    listDevCertificates(),
    listTestVariableReadLogs(40),
    auditVisible ? listAdminAuditLogs(18) : Promise.resolve([]),
  ]);

  const activeAllowlist = allowlist.filter((entry) => entry.status === "active").length;
  const activeCertificates = certificates.filter(
    (certificate) => certificate.status === "active",
  ).length;
  const blockedReads = readLogs.filter((log) => log.result === "blocked").length;

  return (
    <section className="min-w-0 space-y-[18px]">
      <AdminPageHeader
        eyebrow="Seguranca"
        title="Seguranca"
        description="Painel conjunto de eventos `auth_security_events`, allowlist FLWIP, certificados ativos e leituras bloqueadas de test variables."
      />

      <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Eventos de seguranca"
          value={String(events.length)}
          description="Janela recente de acoes auditadas pelo request security."
          icon={<Shield className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="IPs credenciados"
          value={String(activeAllowlist)}
          description="Entradas ativas na allowlist do ambiente dev."
          icon={<Lock className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="FLWIP ativos"
          value={String(activeCertificates)}
          description="Certificados ainda validos para consumo de test variables."
          icon={<ShieldAlert className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Pulls bloqueados"
          value={String(blockedReads)}
          description="Leituras recusadas por grant, IP ou certificado."
          icon={<Siren className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <AdminDataTable
        title="Eventos recentes de request security"
        description="Telemetria original do mecanismo de seguranca da aplicacao."
        headers={["Quando", "Usuario", "Acao", "Resultado", "Rota"]}
        rows={events.map((event) => [
          <span key={`${event.id}-date`} className="text-[12px] text-[#757575]">
            {formatDateTime(event.createdAt)}
          </span>,
          <span key={`${event.id}-user`} className="text-[#E2E2E2]">
            {event.userLabel}
          </span>,
          <span key={`${event.id}-action`} className="text-[#D6D6D6]">
            {event.action}
          </span>,
          <AdminStatusBadge
            key={`${event.id}-outcome`}
            status={event.outcome === "failed" ? "high" : "active"}
            label={event.outcome}
          />,
          <div key={`${event.id}-route`} className="space-y-[6px]">
            <p className="text-[13px] text-[#CECECE]">
              {event.requestPath || "Sem rota"}
            </p>
            {event.ipFingerprint ? (
              <p className="text-[12px] text-[#767676]">{event.ipFingerprint}</p>
            ) : null}
          </div>,
        ])}
        emptyState={
          <AdminEmptyState
            badgeLabel="Sem eventos"
            title="Nenhum evento de seguranca encontrado"
            description="Os eventos do request security aparecerao aqui assim que forem registrados."
          />
        }
      />

      <div className="grid gap-[18px] xl:grid-cols-2">
        <AdminDataTable
          title="Allowlist FLWIP"
          description="IPs aprovados para ambientes dev com status e expiracao."
          headers={["Entrada", "Usuario", "Ambiente", "Status", "Expira em"]}
          rows={allowlist.map((entry) => [
            <div key={entry.id} className="space-y-[6px]">
              <p className="font-medium text-[#EFEFEF]">{entry.id}</p>
              <p className="text-[12px] text-[#6D6D6D]">
                Projeto {entry.projectId || "global"}
              </p>
            </div>,
            <span key={`${entry.id}-user`} className="text-[#E2E2E2]">
              Usuario #{entry.authUserId}
            </span>,
            <AdminStatusBadge key={`${entry.id}-environment`} status={entry.environment} />,
            <AdminStatusBadge key={`${entry.id}-status`} status={entry.status} />,
            <span key={`${entry.id}-expires`} className="text-[12px] text-[#757575]">
              {formatDateTime(entry.expiresAt)}
            </span>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem allowlist"
              title="Nenhum IP credenciado"
              description="A allowlist aparecera aqui quando houver aprovacoes FLWIP emitidas."
            />
          }
        />

        <AdminDataTable
          title="Certificados FLWIP"
          description="Estado atual dos certificados ligados ao ambiente de desenvolvimento."
          headers={["Fingerprint", "Usuario", "Ambiente", "Status", "Ultimo uso"]}
          rows={certificates.map((certificate) => [
            <div key={certificate.id} className="space-y-[6px]">
              <p className="font-medium text-[#EFEFEF]">{certificate.fingerprint}</p>
              <p className="text-[12px] text-[#6D6D6D]">{certificate.id}</p>
            </div>,
            <span key={`${certificate.id}-user`} className="text-[#E2E2E2]">
              Usuario #{certificate.authUserId}
            </span>,
            <AdminStatusBadge key={`${certificate.id}-environment`} status={certificate.environment} />,
            <AdminStatusBadge key={`${certificate.id}-status`} status={certificate.status} />,
            <span key={`${certificate.id}-last-used`} className="text-[12px] text-[#757575]">
              {formatDateTime(certificate.lastUsedAt)}
            </span>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem FLWIP"
              title="Nenhum certificado emitido"
              description="Os certificados serao exibidos aqui conforme o fluxo de aprovacao for utilizado."
            />
          }
        />
      </div>

      <AdminDataTable
        title="Leituras recentes de Test Variables"
        description="Tentativas de pull permitidas, parciais ou bloqueadas registradas pelo backend."
        headers={["Quando", "Ator", "Ambiente", "Resultado", "Chaves entregues"]}
        rows={readLogs.map((log) => [
          <span key={`${log.id}-date`} className="text-[12px] text-[#757575]">
            {formatDateTime(log.createdAt)}
          </span>,
          <span key={`${log.id}-actor`} className="text-[#E2E2E2]">
            {log.actorUserId ? `Usuario #${log.actorUserId}` : "Sistema"}
          </span>,
          <span key={`${log.id}-environment`} className="text-[#D5D5D5]">
            {log.environment || "n/a"}
          </span>,
          <AdminStatusBadge key={`${log.id}-result`} status={log.result} />,
          <div key={`${log.id}-keys`} className="space-y-[6px]">
            <p className="text-[13px] text-[#CECECE]">
              {log.deliveredKeys.length
                ? log.deliveredKeys.join(", ")
                : "Nenhuma chave entregue"}
            </p>
            {log.blockReason ? (
              <p className="text-[12px] text-[#767676]">{log.blockReason}</p>
            ) : null}
          </div>,
        ])}
      />

      {auditVisible && auditLogs.length ? (
        <AdminAuditTimeline
          entries={auditLogs.map((log) => ({
            id: log.id,
            actorLabel: log.actorLabel,
            action: log.action,
            targetLabel: log.targetId
              ? `${log.targetType} · ${log.targetId}`
              : log.targetType,
            riskLevel: log.riskLevel,
            createdAt: log.createdAt,
          }))}
        />
      ) : null}
    </section>
  );
}
