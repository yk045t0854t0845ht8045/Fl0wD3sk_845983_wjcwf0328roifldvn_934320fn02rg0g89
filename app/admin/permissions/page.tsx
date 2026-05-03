import { AdminPermissionActions } from "@/components/admin/AdminPermissionActions";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listAdminPermissions } from "@/lib/admin/read";

type PermissionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return value || "";
}

export default async function AdminPermissionsPage({
  searchParams,
}: PermissionsPageProps) {
  await requirePermission("permissions.read");
  const rawQuery: Record<string, string | string[] | undefined> = searchParams
    ? await searchParams
    : {};
  const permissions = await listAdminPermissions();

  const search = takeFirstQueryValue(rawQuery.q).trim().toLowerCase();
  const moduleFilter = takeFirstQueryValue(rawQuery.module).trim().toLowerCase();
  const riskFilter = takeFirstQueryValue(rawQuery.risk).trim().toLowerCase();

  const moduleOptions = Array.from(
    new Set(permissions.map((permission) => permission.moduleKey)),
  ).sort((left, right) => left.localeCompare(right, "pt-BR"));

  const filteredPermissions = permissions.filter((permission) => {
    if (search) {
      const haystack = [
        permission.code,
        permission.description,
        permission.moduleKey,
        permission.roleNames.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(search)) {
        return false;
      }
    }

    if (moduleFilter && permission.moduleKey.toLowerCase() !== moduleFilter) {
      return false;
    }

    if (riskFilter && permission.riskLevel.toLowerCase() !== riskFilter) {
      return false;
    }

    return true;
  });

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="RBAC institucional"
        title="Permissoes"
        description="Leitura do catalogo granular de capacidades administrativas, com foco em modulo, nivel de risco e cargos que recebem cada direito hoje."
      />

      <form
        action="/admin/permissions"
        className="mt-[24px] rounded-[24px] border border-[#141414] bg-[#090909] px-[18px] py-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.22)]"
      >
        <div className="grid gap-[12px] xl:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.7fr)_minmax(220px,0.7fr)_auto]">
          <input
            type="text"
            name="q"
            defaultValue={takeFirstQueryValue(rawQuery.q)}
            placeholder="Buscar por codigo, descricao ou cargo..."
            className="rounded-[16px] border border-[#141414] bg-[#0C0C0C] px-[14px] py-[12px] text-[14px] text-[#E7E7E7] outline-none placeholder:text-[#5E5E5E] focus:border-[#242424]"
          />
          <select
            name="module"
            defaultValue={takeFirstQueryValue(rawQuery.module)}
            className="rounded-[16px] border border-[#141414] bg-[#0C0C0C] px-[14px] py-[12px] text-[14px] text-[#D8D8D8] outline-none focus:border-[#242424]"
          >
            <option value="">Todos os modulos</option>
            {moduleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
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
          title="Catalogo de permissoes"
          description={`${filteredPermissions.length} permissao(oes) exibidas conforme os filtros aplicados.`}
          headers={["Permissao", "Modulo", "Risco", "Descricao", "Cargos vinculados", "Total de cargos"]}
          rows={filteredPermissions.map((permission) => [
            <div key={permission.id}>
              <p className="font-medium text-[#EFEFEF]">{permission.code}</p>
            </div>,
            <span key={`${permission.id}-module`} className="text-[#D0D0D0]">
              {permission.moduleKey}
            </span>,
            <AdminStatusBadge key={`${permission.id}-risk`} status={permission.riskLevel} />,
            <span key={`${permission.id}-description`} className="max-w-[320px] text-[13px] leading-[1.7] text-[#B8B8B8]">
              {permission.description}
            </span>,
            <div key={`${permission.id}-roles`} className="space-y-[6px]">
              {permission.roleNames.length ? (
                permission.roleNames.slice(0, 5).map((roleName) => (
                  <p key={`${permission.id}-${roleName}`} className="text-[12px] text-[#AEAEAE]">
                    {roleName}
                  </p>
                ))
              ) : (
                <p className="text-[12px] text-[#646464]">Sem cargos vinculados</p>
              )}
            </div>,
            <span key={`${permission.id}-role-count`} className="text-[#E8E8E8]">
              {permission.roleCount}
            </span>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem resultado"
              title="Nenhuma permissao encontrada"
              description="Refine o modulo ou o nivel de risco para localizar outro conjunto de permissoes."
            />
          }
        />
      </div>

      <AdminPermissionActions permissions={permissions} />
    </section>
  );
}
