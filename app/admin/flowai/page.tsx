import { Bot, Cpu, FileClock, Gauge } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listAdminFlowAiJobs, listAdminFlowAiRequests } from "@/lib/admin/operations";

function formatDateTime(value: string | null) {
  if (!value) return "Sem registro";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminFlowAiPage() {
  await requirePermission("flowai.read");
  const [jobs, requests] = await Promise.all([
    listAdminFlowAiJobs(60),
    listAdminFlowAiRequests(60),
  ]);
  const activeJobs = jobs.filter((job) => job.status === "pending" || job.status === "processing").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const errorRequests = requests.filter((request) => request.responseStatus >= 400).length;

  return (
    <section className="min-w-0 space-y-[18px]">
      <AdminPageHeader
        eyebrow="Operacao"
        title="FlowAI"
        description="Observabilidade institucional sobre a fila `flowai_job_queue` e os eventos de uso registrados em `flowai_api_request_events`."
      />

      <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Jobs carregados"
          value={String(jobs.length)}
          description="Fila operacional mais recente da FlowAI."
          icon={<Bot className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Jobs ativos"
          value={String(activeJobs)}
          description="Itens pendentes ou em processamento agora."
          icon={<FileClock className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Falhas"
          value={String(failedJobs)}
          description="Jobs que encerraram em erro nesta janela."
          icon={<Cpu className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Requests com erro"
          value={String(errorRequests)}
          description="Eventos de API com status HTTP 4xx/5xx."
          icon={<Gauge className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <AdminDataTable
        title="Fila de jobs"
        description="Jobs de IA reais com usuario, prioridade, tentativas e status atual."
        headers={[
          "Job",
          "Usuario",
          "Task",
          "Status",
          "Tentativas",
          "Datas",
        ]}
        rows={jobs.map((job) => [
          <div key={`job-${job.id}`} className="space-y-[6px]">
            <p className="font-medium text-[#EFEFEF]">{job.id}</p>
            <p className="text-[12px] text-[#6D6D6D]">Prioridade {job.priority}</p>
          </div>,
          <span key={`job-user-${job.id}`} className="text-[#DCDCDC]">
            {job.userLabel}
          </span>,
          <span key={`job-task-${job.id}`} className="text-[#D5D5D5]">
            {job.taskKey}
          </span>,
          <AdminStatusBadge key={`job-status-${job.id}`} status={job.status} />,
          <span key={`job-attempts-${job.id}`} className="text-[#E3E3E3]">
            {job.attempts}/{job.maxAttempts}
          </span>,
          <div key={`job-dates-${job.id}`} className="space-y-[6px] text-[12px] text-[#7B7B7B]">
            <p>Criado: {formatDateTime(job.createdAt)}</p>
            <p>Atualizado: {formatDateTime(job.updatedAt)}</p>
            <p>Completo: {formatDateTime(job.completedAt)}</p>
          </div>,
        ])}
        emptyState={
          <AdminEmptyState
            badgeLabel="Sem jobs"
            title="Nenhum job FlowAI encontrado"
            description="A fila de IA aparecera aqui assim que o backend registrar novas tarefas."
          />
        }
      />

      <AdminDataTable
        title="Eventos de request"
        description="Telemetria recente das chamadas FlowAI, com task, status HTTP, provedor e latencia."
        headers={[
          "Quando",
          "Usuario",
          "Task",
          "HTTP",
          "Modelo",
          "Latencia",
        ]}
        rows={requests.map((request) => [
          <span key={`request-date-${request.id}`} className="text-[12px] text-[#757575]">
            {formatDateTime(request.createdAt)}
          </span>,
          <span key={`request-user-${request.id}`} className="text-[#DCDCDC]">
            {request.userLabel}
          </span>,
          <span key={`request-task-${request.id}`} className="text-[#D5D5D5]">
            {request.taskKey}
          </span>,
          <AdminStatusBadge
            key={`request-status-${request.id}`}
            status={request.responseStatus >= 400 ? "high" : "active"}
            label={String(request.responseStatus)}
          />,
          <div key={`request-model-${request.id}`} className="space-y-[6px]">
            <p className="text-[#E2E2E2]">{request.model || "Nao informado"}</p>
            <p className="text-[12px] text-[#7D7D7D]">{request.provider || "provider n/a"}</p>
          </div>,
          <span key={`request-latency-${request.id}`} className="text-[#E3E3E3]">
            {typeof request.latencyMs === "number" ? `${request.latencyMs} ms` : "n/a"}
          </span>,
        ])}
        emptyState={
          <AdminEmptyState
            badgeLabel="Sem requests"
            title="Nenhum evento FlowAI encontrado"
            description="Os eventos de uso da IA aparecerao aqui assim que forem persistidos."
          />
        }
      />
    </section>
  );
}
