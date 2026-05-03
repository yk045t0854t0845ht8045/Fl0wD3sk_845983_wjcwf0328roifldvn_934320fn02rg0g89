import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listAdminAuditLogs } from "@/lib/admin/read";

type AuditPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return value || "";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminAuditPage({
  searchParams,
}: AuditPageProps) {
  await requirePermission("audit.read");
  const rawQuery: Record<string, string | string[] | undefined> = searchParams
    ? await searchParams
    : {};
  const auditLogs = await listAdminAuditLogs(120);

  const search = takeFirstQueryValue(rawQuery.q).trim().toLowerCase();
  const risk = takeFirstQueryValue(rawQuery.risk).trim().toLowerCase();

  const filteredLogs = auditLogs.filter((entry) => {
    if (search) {
      const haystack = [
        entry.actorLabel,
        entry.action,
        entry.targetType,
        entry.targetId || "",
        entry.metadataPreview,
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(search)) {
        return false;
      }
    }

    if (risk && entry.riskLevel.toLowerCase() !== risk) {
      return false;
    }

    return true;
  });

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="Confianca operacional"
        title="Auditoria"
        description="Consulta direta da trilha administrativa persistida no backend, com contexto de ator, alvo, risco e metadata resumida para investigacao inicial."
      />

      <form
        action="/admin/audit"
        className="mt-[24px] rounded-[24px] border border-[#141414] bg-[#090909] px-[18px] py-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.22)]"
      >
        <div className="grid gap-[12px] xl:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.7fr)_auto]">
          <input
            type="text"
            name="q"
            defaultValue={takeFirstQueryValue(rawQuery.q)}
            placeholder="Buscar por ator, acao, alvo ou metadata..."
            className="rounded-[16px] border border-[#141414] bg-[#0C0C0C] px-[14px] py-[12px] text-[14px] text-[#E7E7E7] outline-none placeholder:text-[#5E5E5E] focus:border-[#242424]"
          />
          <select
            name="risk"
            defaultValue={takeFirstQueryValue(rawQuery.risk)}
            className="rounded-[16px] border border-[#141414] bg-[#0C0C0C] px-[14px] py-[12px] text-[14px] text-[#D8D8D8] outline-none focus:border-[#242424]"
          >
            <option value="">Todos os riscos</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <button
            type="submit"
            className="rounded-[16px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] px-[18px] py-[12px] text-[14px] font-semibold text-[#252525] transition-transform hover:scale-[1.01]"
          >
            Filtrar
          </button>
        </div>
      </form>

      <div className="mt-[18px]">
        <AdminDataTable
          title="Log administrativo"
          description={`${filteredLogs.length} evento(s) exibidos com base na trilha persistida.`}
          headers={["Quando", "Ator", "Acao", "Alvo", "Risco", "Metadata"]}
          rows={filteredLogs.map((entry) => [
            <span key={`${entry.id}-created-at`} className="text-[12px] text-[#757575]">
              {formatDateTime(entry.createdAt)}
            </span>,
            <span key={`${entry.id}-actor`} className="text-[#E8E8E8]">
              {entry.actorLabel}
            </span>,
            <span key={`${entry.id}-action`} className="font-medium text-[#EFEFEF]">
              {entry.action}
            </span>,
            <span key={`${entry.id}-target`} className="text-[#C7C7C7]">
              {entry.targetId ? `${entry.targetType} · ${entry.targetId}` : entry.targetType}
            </span>,
            <AdminStatusBadge key={`${entry.id}-risk`} status={entry.riskLevel} />,
            <span key={`${entry.id}-metadata`} className="max-w-[320px] text-[12px] leading-[1.7] text-[#9A9A9A]">
              {entry.metadataPreview}
            </span>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem resultado"
              title="Nenhum log encontrado"
              description="Ajuste a busca textual ou o filtro de risco para localizar outro evento administrativo."
            />
          }
        />
      </div>
    </section>
  );
}
