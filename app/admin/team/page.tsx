import { AdminTeamActions } from "@/components/admin/AdminTeamActions";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listAdminRoles, listAdminTeamMembers } from "@/lib/admin/read";

type TeamPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function takeFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return value || "";
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Sem atividade";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminTeamPage({
  searchParams,
}: TeamPageProps) {
  await requirePermission("team.read");
  const rawQuery: Record<string, string | string[] | undefined> = searchParams
    ? await searchParams
    : {};
  const [teamMembers, roles] = await Promise.all([
    listAdminTeamMembers(),
    listAdminRoles(),
  ]);

  const search = takeFirstQueryValue(rawQuery.q).trim().toLowerCase();
  const department = takeFirstQueryValue(rawQuery.department).trim().toLowerCase();
  const role = takeFirstQueryValue(rawQuery.role).trim().toLowerCase();
  const status = takeFirstQueryValue(rawQuery.status).trim().toLowerCase();

  const departmentOptions = Array.from(
    new Set(teamMembers.map((member) => member.department).filter(Boolean) as string[]),
  ).sort((left, right) => left.localeCompare(right, "pt-BR"));
  const roleOptions = Array.from(
    new Set(teamMembers.flatMap((member) => member.roleNames)),
  ).sort((left, right) => left.localeCompare(right, "pt-BR"));

  const filteredMembers = teamMembers.filter((member) => {
    if (search) {
      const haystack = [
        member.displayName,
        member.email || "",
        member.department || "",
        member.primaryRole || "",
        member.roleNames.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(search)) {
        return false;
      }
    }

    if (department && (member.department || "").toLowerCase() !== department) {
      return false;
    }

    if (
      role &&
      !member.roleNames.some((roleName) => roleName.toLowerCase() === role)
    ) {
      return false;
    }

    if (status && member.status.toLowerCase() !== status) {
      return false;
    }

    return true;
  });

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="Governanca interna"
        title="Equipe Administrativa"
        description="Leitura centralizada dos perfis internos ativos, seus cargos vigentes, departamentos e alcance efetivo de permissao sobre a plataforma."
      />

      <form
        action="/admin/team"
        className="mt-[24px] rounded-[24px] border border-[#141414] bg-[#090909] px-[18px] py-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.22)]"
      >
        <div className="grid gap-[12px] xl:grid-cols-4">
          <input
            type="text"
            name="q"
            defaultValue={takeFirstQueryValue(rawQuery.q)}
            placeholder="Buscar por nome, e-mail ou cargo..."
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
            name="role"
            defaultValue={takeFirstQueryValue(rawQuery.role)}
            className="rounded-[16px] border border-[#141414] bg-[#0C0C0C] px-[14px] py-[12px] text-[14px] text-[#D8D8D8] outline-none focus:border-[#242424]"
          >
            <option value="">Todos os cargos</option>
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <div className="flex gap-[10px]">
            <select
              name="status"
              defaultValue={takeFirstQueryValue(rawQuery.status)}
              className="min-w-0 flex-1 rounded-[16px] border border-[#141414] bg-[#0C0C0C] px-[14px] py-[12px] text-[14px] text-[#D8D8D8] outline-none focus:border-[#242424]"
            >
              <option value="">Todos os status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="disabled">Disabled</option>
              <option value="suspended">Suspended</option>
            </select>
            <button
              type="submit"
              className="rounded-[16px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] px-[18px] py-[12px] text-[14px] font-semibold text-[#252525] transition-transform hover:scale-[1.01]"
            >
              Filtrar
            </button>
          </div>
        </div>
      </form>

      <div className="mt-[18px]">
        <AdminDataTable
          title="Staff interno"
          description={`${filteredMembers.length} membro(s) exibidos com base no catalogo administrativo ativo.`}
          headers={["Membro", "Departamento", "Cargo principal", "Cargos ativos", "Permissoes", "Status", "Ultima atividade"]}
          rows={filteredMembers.map((member) => [
            <div key={member.id}>
              <p className="font-medium text-[#EFEFEF]">{member.displayName}</p>
              <p className="mt-[6px] text-[12px] text-[#6E6E6E]">
                {member.email || `auth_user_id ${member.authUserId}`}
              </p>
            </div>,
            <span key={`${member.id}-department`} className="text-[#CFCFCF]">
              {member.department || "Nao definido"}
            </span>,
            <span key={`${member.id}-primary-role`} className="text-[#E1E1E1]">
              {member.primaryRole || "Sem cargo ativo"}
            </span>,
            <div key={`${member.id}-roles`} className="max-w-[240px] space-y-[6px]">
              {member.roleNames.length ? (
                member.roleNames.map((roleName) => (
                  <p key={`${member.id}-${roleName}`} className="text-[12px] text-[#AFAFAF]">
                    {roleName}
                  </p>
                ))
              ) : (
                <p className="text-[12px] text-[#646464]">Sem atribuicoes vigentes</p>
              )}
            </div>,
            <span key={`${member.id}-permission-count`} className="text-[#EAEAEA]">
              {member.permissionCount}
            </span>,
            <AdminStatusBadge key={`${member.id}-status`} status={member.status} />,
            <span key={`${member.id}-updated-at`} className="text-[12px] text-[#757575]">
              {formatDateTime(member.lastRoleAssignedAt || member.updatedAt)}
            </span>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem resultado"
              title="Nenhum membro encontrado"
              description="Ajuste os filtros de equipe para localizar outro perfil administrativo."
            />
          }
        />
      </div>

      <AdminTeamActions members={teamMembers} roles={roles} />
    </section>
  );
}
