import { AdminRoleActions } from "@/components/admin/AdminRoleActions";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import {
  listAdminPermissions,
  listAdminRoles,
  listAdminTeamMembers,
} from "@/lib/admin/read";

type RolesPageProps = {
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

export default async function AdminRolesPage({
  searchParams,
}: RolesPageProps) {
  await requirePermission("roles.read");
  const rawQuery: Record<string, string | string[] | undefined> = searchParams
    ? await searchParams
    : {};
  const [roles, permissions, teamMembers] = await Promise.all([
    listAdminRoles(),
    listAdminPermissions(),
    listAdminTeamMembers(),
  ]);

  const search = takeFirstQueryValue(rawQuery.q).trim().toLowerCase();
  const department = takeFirstQueryValue(rawQuery.department).trim().toLowerCase();
  const singletonFilter = takeFirstQueryValue(rawQuery.singleton).trim().toLowerCase();

  const departmentOptions = Array.from(
    new Set(roles.map((role) => role.department)),
  ).sort((left, right) => left.localeCompare(right, "pt-BR"));

  const filteredRoles = roles.filter((role) => {
    if (search) {
      const haystack = [
        role.name,
        role.code,
        role.department,
        role.description || "",
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(search)) {
        return false;
      }
    }

    if (department && role.department.toLowerCase() !== department) {
      return false;
    }

    if (singletonFilter === "singleton" && !role.isSingleton) {
      return false;
    }

    if (singletonFilter === "shared" && role.isSingleton) {
      return false;
    }

    return true;
  });

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="RBAC institucional"
        title="Cargos e Hierarquia"
        description="Leitura consolidada da hierarquia formal da Flowdesk, incluindo cargos singleton, departamentos e distribuicao atual de permission sets."
      />

      <form
        action="/admin/roles"
        className="mt-[24px] rounded-[24px] border border-[#141414] bg-[#090909] px-[18px] py-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.22)]"
      >
        <div className="grid gap-[12px] xl:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.7fr)_minmax(220px,0.7fr)_auto]">
          <input
            type="text"
            name="q"
            defaultValue={takeFirstQueryValue(rawQuery.q)}
            placeholder="Buscar por nome, codigo ou descricao..."
            className="rounded-[16px] border border-[#141414] bg-[#0C0C0C] px-[14px] py-[12px] text-[14px] text-[#E7E7E7] outline-none placeholder:text-[#5E5E5E] focus:border-[#242424]"
          />
          <select
            name="department"
            defaultValue={takeFirstQueryValue(rawQuery.department)}
            className="rounded-[16px] border border-[#141414] bg-[#0C0C0C] px-[14px] py-[12px] text-[14px] text-[#D8D8D8] outline-none focus:border-[#242424]"
          >
            <option value="">Todos os departamentos</option>
            {departmentOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            name="singleton"
            defaultValue={takeFirstQueryValue(rawQuery.singleton)}
            className="rounded-[16px] border border-[#141414] bg-[#0C0C0C] px-[14px] py-[12px] text-[14px] text-[#D8D8D8] outline-none focus:border-[#242424]"
          >
            <option value="">Todos os modelos</option>
            <option value="singleton">Apenas singleton</option>
            <option value="shared">Apenas compartilhados</option>
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
          title="Catalogo de cargos"
          description={`${filteredRoles.length} cargo(s) exibidos conforme os filtros atuais.`}
          headers={["Cargo", "Departamento", "Hierarquia", "Singleton", "Permissoes", "Ocupacao atual", "Atualizado"]}
          rows={filteredRoles.map((role) => [
            <div key={role.id}>
              <p className="font-medium text-[#EFEFEF]">{role.name}</p>
              <p className="mt-[6px] text-[12px] text-[#6E6E6E]">{role.code}</p>
              {role.description ? (
                <p className="mt-[6px] text-[12px] text-[#838383]">{role.description}</p>
              ) : null}
            </div>,
            <span key={`${role.id}-department`} className="text-[#CFCFCF]">
              {role.department}
            </span>,
            <span key={`${role.id}-hierarchy`} className="text-[#E8E8E8]">
              {role.hierarchyLevel}
            </span>,
            <AdminStatusBadge
              key={`${role.id}-singleton`}
              status={role.isSingleton ? "critical" : "low"}
              label={role.isSingleton ? "Singleton" : "Compartilhado"}
            />,
            <span key={`${role.id}-permissions`} className="text-[#E8E8E8]">
              {role.permissionCount}
            </span>,
            <div key={`${role.id}-holders`} className="space-y-[6px]">
              {role.currentHolders.length ? (
                role.currentHolders.map((holder) => (
                  <p key={`${role.id}-${holder}`} className="text-[12px] text-[#B2B2B2]">
                    {holder}
                  </p>
                ))
              ) : (
                <p className="text-[12px] text-[#646464]">Sem ocupante ativo</p>
              )}
            </div>,
            <span key={`${role.id}-updated-at`} className="text-[12px] text-[#757575]">
              {formatDateTime(role.updatedAt)}
            </span>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem resultado"
              title="Nenhum cargo encontrado"
              description="Ajuste o filtro por departamento ou modelo de hierarquia para localizar outro cargo."
            />
          }
        />
      </div>

      <AdminRoleActions
        roles={roles}
        permissions={permissions}
        members={teamMembers}
      />
    </section>
  );
}
