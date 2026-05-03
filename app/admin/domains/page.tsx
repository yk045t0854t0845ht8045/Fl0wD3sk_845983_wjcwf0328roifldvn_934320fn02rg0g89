import { Globe, Radar, ShieldAlert, Wifi } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { getAdminStatusSlice } from "@/lib/admin/operations";

function formatDateTime(value: string | null) {
  if (!value) return "Sem registro";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminDomainsPage() {
  await requirePermission("domains.read");
  const status = await getAdminStatusSlice(["domains"]);
  const degradedComponents = status.components.filter(
    (component) => component.status !== "operational",
  ).length;

  return (
    <section className="min-w-0 space-y-[18px]">
      <AdminPageHeader
        eyebrow="Operacao"
        title="Dominios"
        description="Monitoramento institucional da camada de dominios e DNS reaproveitando os componentes reais do status e os checks ja existentes do ecossistema Flowdesk."
      />

      <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Status geral"
          value={status.overallStatus}
          description="Pior sinal observado na fatia de dominios."
          icon={<Globe className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Componentes"
          value={String(status.components.length)}
          description="Checks e componentes ligados a DNS, SSL e registro."
          icon={<Radar className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Com degradacao"
          value={String(degradedComponents)}
          description="Itens fora de `operational` neste momento."
          icon={<ShieldAlert className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Incidentes"
          value={String(status.incidents.length)}
          description="Incidentes recentes com componentes de dominio afetados."
          icon={<Wifi className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <AdminDataTable
        title="Saude dos componentes de dominio"
        description="Cada item abaixo vem da superficie real de status da plataforma."
        headers={["Componente", "Status", "Mensagem", "Latencia", "Atualizado em"]}
        rows={status.components.map((component) => [
          <div key={component.id} className="space-y-[6px]">
            <p className="font-medium text-[#EFEFEF]">{component.name}</p>
            <p className="text-[12px] text-[#6D6D6D]">
              {component.description || "Sem descricao adicional"}
            </p>
          </div>,
          <AdminStatusBadge key={`${component.id}-status`} status={component.status} />,
          <p key={`${component.id}-message`} className="max-w-[300px] text-[13px] leading-[1.6] text-[#CECECE]">
            {component.status_message || "Sem alerta textual no momento."}
          </p>,
          <span key={`${component.id}-latency`} className="text-[#E3E3E3]">
            {typeof component.latency_ms === "number" ? `${component.latency_ms} ms` : "n/a"}
          </span>,
          <span key={`${component.id}-updated`} className="text-[12px] text-[#757575]">
            {formatDateTime(component.updated_at)}
          </span>,
        ])}
        emptyState={
          <AdminEmptyState
            badgeLabel="Sem checks"
            title="Nenhum componente de dominio encontrado"
            description="Os componentes de dominio aparecerao aqui quando o status institucional os expuser."
          />
        }
      />

      <AdminDataTable
        title="Incidentes relacionados"
        description="Recortes de incidentes que efetivamente tocam a superficie de dominios."
        headers={["Incidente", "Impacto", "Status", "Atualizado em"]}
        rows={status.incidents.map((incident) => [
          <div key={incident.id} className="space-y-[6px]">
            <p className="font-medium text-[#EFEFEF]">{incident.title}</p>
            <p className="text-[12px] text-[#6D6D6D]">
              {incident.summary || "Sem resumo adicional"}
            </p>
          </div>,
          <AdminStatusBadge key={`${incident.id}-impact`} status={incident.impact} />,
          <AdminStatusBadge key={`${incident.id}-status`} status={incident.status} />,
          <span key={`${incident.id}-updated`} className="text-[12px] text-[#757575]">
            {formatDateTime(incident.updated_at)}
          </span>,
        ])}
        emptyState={
          <AdminEmptyState
            badgeLabel="Estavel"
            title="Nenhum incidente de dominio"
            description="No momento nao ha incidentes recentes afetando os componentes desta area."
          />
        }
      />
    </section>
  );
}
