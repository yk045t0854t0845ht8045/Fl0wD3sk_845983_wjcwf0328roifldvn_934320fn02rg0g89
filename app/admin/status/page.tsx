import { Activity, AlertTriangle, GaugeCircle, HeartPulse } from "lucide-react";
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

export default async function AdminStatusPage() {
  await requirePermission("status.read");
  const status = await getAdminStatusSlice();
  const degradedComponents = status.components.filter(
    (component) => component.status !== "operational",
  ).length;

  return (
    <section className="min-w-0 space-y-[18px]">
      <AdminPageHeader
        eyebrow="Operacao"
        title="Status"
        description="Visao administrativa do sistema de status publico, incidents e componentes monitorados, mantendo total aderencia ao backend institucional ja existente."
      />

      <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Saude geral"
          value={status.overallStatus}
          description="Pior estado agregado entre os componentes monitorados."
          icon={<HeartPulse className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Componentes"
          value={String(status.components.length)}
          description="Itens ativos na topologia de status."
          icon={<Activity className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Com degradacao"
          value={String(degradedComponents)}
          description="Componentes fora de `operational` agora."
          icon={<GaugeCircle className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Incidentes"
          value={String(status.incidents.length)}
          description="Incidentes recentes ainda relevantes na timeline."
          icon={<AlertTriangle className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <AdminDataTable
        title="Incidentes recentes"
        description="Fonte primaria: `system_incidents` e `system_incident_updates`."
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
            badgeLabel="Sem incidentes"
            title="Nenhum incidente recente"
            description="O sistema de status nao retornou incidentes para o recorte atual."
          />
        }
      />

      <AdminDataTable
        title="Componentes monitorados"
        description="Recorte completo da saude operacional publicada pela Flowdesk."
        headers={["Componente", "Status", "Origem", "Mensagem", "Atualizado em"]}
        rows={status.components.map((component) => [
          <div key={component.id} className="space-y-[6px]">
            <p className="font-medium text-[#EFEFEF]">{component.name}</p>
            <p className="text-[12px] text-[#6D6D6D]">
              {component.description || "Sem descricao adicional"}
            </p>
          </div>,
          <AdminStatusBadge key={`${component.id}-status`} status={component.status} />,
          <span key={`${component.id}-source`} className="text-[#D6D6D6]">
            {component.source_key || "status"}
          </span>,
          <p key={`${component.id}-message`} className="max-w-[320px] text-[13px] leading-[1.6] text-[#CECECE]">
            {component.status_message || "Sem alerta textual no momento."}
          </p>,
          <span key={`${component.id}-updated`} className="text-[12px] text-[#757575]">
            {formatDateTime(component.updated_at)}
          </span>,
        ])}
      />
    </section>
  );
}
