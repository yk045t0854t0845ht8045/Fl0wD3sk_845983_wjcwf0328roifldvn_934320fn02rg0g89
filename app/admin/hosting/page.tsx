import { ActivitySquare, Layers2, ServerCog, TimerReset } from "lucide-react";
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

export default async function AdminHostingPage() {
  await requirePermission("hosting.read");
  const status = await getAdminStatusSlice(["squarecloud", "api", "scheduled_tasks"]);
  const degradedComponents = status.components.filter(
    (component) => component.status !== "operational",
  ).length;

  return (
    <section className="min-w-0 space-y-[18px]">
      <AdminPageHeader
        eyebrow="Operacao"
        title="Hospedagem"
        description="Visao de runtime e infraestrutura reaproveitando os monitores reais de API, hospedagem e tarefas agendadas que ja alimentam o status oficial."
      />

      <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Status geral"
          value={status.overallStatus}
          description="Saude agregada da fatia de hosting e runtime."
          icon={<ServerCog className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Checks ativos"
          value={String(status.components.length)}
          description="Componentes de API, hospedagem e tarefas monitorados."
          icon={<Layers2 className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Com degradacao"
          value={String(degradedComponents)}
          description="Itens operacionais fora do estado ideal."
          icon={<ActivitySquare className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Incidentes"
          value={String(status.incidents.length)}
          description="Incidentes recentes conectados ao runtime."
          icon={<TimerReset className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      {status.teamNote ? (
        <section className="rounded-[24px] border border-[#141414] bg-[#090909] px-[20px] py-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
          <div className="flex flex-col gap-[10px] md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-[20px] leading-none font-medium tracking-[-0.03em] text-[#F1F1F1]">
                {status.teamNote.title}
              </h2>
              <p className="mt-[10px] text-[13px] leading-[1.7] text-[#737373]">
                {status.teamNote.description}
              </p>
            </div>
            <AdminStatusBadge status="active" label={`Fonte ${status.teamNote.source}`} />
          </div>
        </section>
      ) : null}

      <AdminDataTable
        title="Componentes de runtime"
        description="Estado vivo dos componentes que sustentam API, tarefas e hospedagem observados pelos checks oficiais."
        headers={["Componente", "Status", "Origem", "Latencia", "Atualizado em"]}
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
          <span key={`${component.id}-latency`} className="text-[#E3E3E3]">
            {typeof component.latency_ms === "number" ? `${component.latency_ms} ms` : "n/a"}
          </span>,
          <span key={`${component.id}-updated`} className="text-[12px] text-[#757575]">
            {formatDateTime(component.updated_at)}
          </span>,
        ])}
        emptyState={
          <AdminEmptyState
            badgeLabel="Sem runtime"
            title="Nenhum componente de hosting encontrado"
            description="Os componentes de API, hospedagem e tarefas aparecerao aqui conforme o status institucional os expuser."
          />
        }
      />
    </section>
  );
}
