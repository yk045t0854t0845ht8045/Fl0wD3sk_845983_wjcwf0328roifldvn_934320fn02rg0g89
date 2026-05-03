import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { AdminTestVariableActions } from "@/components/admin/AdminTestVariableActions";
import { requirePermission } from "@/lib/admin/auth";
import {
  listAdminTestVariables,
  listTestVariableGroups,
  listTestVariableProjects,
} from "@/lib/test-variables/service";

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-[14px] border border-[#1B1B1B] bg-[#101010] px-[14px] py-[11px] text-[13px] font-medium text-[#E5E5E5] transition-colors hover:border-[#262626] hover:bg-[#141414]"
    >
      {label}
    </Link>
  );
}

export default async function AdminTestVariablesPage() {
  await requirePermission("test_variables.read");
  const [projects, groups, variables] = await Promise.all([
    listTestVariableProjects(),
    listTestVariableGroups(),
    listAdminTestVariables(),
  ]);

  return (
    <div className="space-y-[22px]">
      <AdminPageHeader
        eyebrow="Dev Environment"
        title="Test Variables"
        description="Catalogo criptografado de projetos, grupos e chaves liberadas para test, staging e sandbox, sempre com leitura auditada e valor mascarado no painel."
        actions={
          <>
            <ActionLink href="/admin/test-variables/approvals" label="Aprovacoes" />
            <ActionLink href="/admin/test-variables/certificates" label="Certificados" />
            <ActionLink href="/admin/test-variables/logs" label="Logs" />
          </>
        }
      />

      <div className="grid gap-[12px] md:grid-cols-3">
        <div className="rounded-[20px] border border-[#141414] bg-[#090909] p-[18px]">
          <p className="text-[13px] text-[#6F6F6F]">Projetos ativos</p>
          <p className="mt-[12px] text-[28px] font-semibold tracking-[-0.05em] text-[#F4F4F4]">
            {projects.filter((project) => project.isActive).length}
          </p>
        </div>
        <div className="rounded-[20px] border border-[#141414] bg-[#090909] p-[18px]">
          <p className="text-[13px] text-[#6F6F6F]">Grupos por ambiente</p>
          <p className="mt-[12px] text-[28px] font-semibold tracking-[-0.05em] text-[#F4F4F4]">
            {groups.length}
          </p>
        </div>
        <div className="rounded-[20px] border border-[#141414] bg-[#090909] p-[18px]">
          <p className="text-[13px] text-[#6F6F6F]">Variaveis cadastradas</p>
          <p className="mt-[12px] text-[28px] font-semibold tracking-[-0.05em] text-[#F4F4F4]">
            {variables.length}
          </p>
        </div>
      </div>

      <AdminDataTable
        title="Catalogo atual"
        description="Cada linha representa uma chave efetivamente armazenada com grupo, ambiente, sensibilidade e ultima rotacao visiveis para operacao interna."
        headers={[
          "Projeto / Variavel",
          "Grupo / Ambiente",
          "Sensibilidade",
          "Valor mascarado",
          "Atualizacao",
        ]}
        rows={variables.map((variable) => [
          <div key={`${variable.id}-key`} className="space-y-[4px]">
            <p className="font-medium text-[#F0F0F0]">{variable.key}</p>
            <p className="text-[12px] text-[#6B6B6B]">
              {variable.projectName} ({variable.projectCode})
            </p>
            {variable.description ? (
              <p className="text-[12px] leading-[1.5] text-[#888888]">
                {variable.description}
              </p>
            ) : null}
          </div>,
          <div key={`${variable.id}-group`} className="space-y-[6px]">
            <p className="text-[#E5E5E5]">{variable.groupName}</p>
            <AdminStatusBadge status={variable.environment} />
          </div>,
          <div key={`${variable.id}-sensitivity`} className="space-y-[8px]">
            <AdminStatusBadge status={variable.sensitivityLevel} />
            <AdminStatusBadge
              status={variable.isActive ? "active" : "disabled"}
              label={variable.isActive ? "Ativa" : "Desativada"}
            />
          </div>,
          <code key={`${variable.id}-value`} className="text-[12px] text-[#D9D9D9]">
            {variable.maskedValue}
          </code>,
          <div key={`${variable.id}-updated`} className="space-y-[4px] text-[12px] text-[#8A8A8A]">
            <p>{new Date(variable.updatedAt).toLocaleString("pt-BR")}</p>
            <p>
              {variable.rotatedAt
                ? `Rotacionada em ${new Date(variable.rotatedAt).toLocaleString("pt-BR")}`
                : "Sem rotacao registrada"}
            </p>
          </div>,
        ])}
        emptyState={
          <AdminEmptyState
            badgeLabel="Catalogo vazio"
            title="Nenhuma Test Variable cadastrada"
            description="Crie o primeiro projeto, grupo e variavel criptografada para iniciar o fluxo de desenvolvimento seguro."
          />
        }
      />

      <AdminTestVariableActions
        projects={projects}
        groups={groups}
        variables={variables}
      />
    </div>
  );
}
