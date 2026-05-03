import { Boxes, PlugZap, Server, UserSquare2 } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listAdminLicensedServers } from "@/lib/admin/operations";

function formatDateTime(value: string | null) {
  if (!value) return "Sem registro";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminServersPage() {
  await requirePermission("servers.read");
  const servers = await listAdminLicensedServers(100);
  const activeServers = servers.filter((server) => server.isActive).length;
  const inactiveServers = servers.length - activeServers;
  const activatedServers = servers.filter((server) => Boolean(server.activatedAt)).length;

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="Operacao"
        title="Servidores"
        description="Leitura direta de `auth_user_plan_guilds`, preservando o vinculo real entre licenca, conta responsavel e status atual do servidor gerenciado."
      />

      <div className="mt-[24px] grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Servidores licenciados"
          value={String(servers.length)}
          description="Guildas carregadas da cobertura atual de licencas."
          icon={<Server className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Ativos"
          value={String(activeServers)}
          description="Vinculos marcados como ativos no estado atual."
          icon={<PlugZap className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Inativos"
          value={String(inactiveServers)}
          description="Licencas nao ativas ou aguardando regularizacao."
          icon={<Boxes className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Com ativacao"
          value={String(activatedServers)}
          description="Guildas que ja possuem timestamp de ativacao registrado."
          icon={<UserSquare2 className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <div className="mt-[18px]">
        <AdminDataTable
          title="Guildas licenciadas"
          description="Vista operacional do ownership de servidores ja provisionados no plano atual da plataforma."
          headers={[
            "Guild",
            "Responsavel",
            "Status",
            "Ativado em",
            "Vinculado em",
          ]}
          rows={servers.map((server) => [
            <div key={`server-${server.guildId}`} className="space-y-[6px]">
              <p className="font-medium text-[#EFEFEF]">{server.guildId}</p>
            </div>,
            <div key={`server-owner-${server.guildId}`} className="space-y-[6px]">
              <p className="text-[#E4E4E4]">{server.ownerLabel}</p>
              <p className="text-[12px] text-[#6D6D6D]">Usuario #{server.userId}</p>
            </div>,
            <AdminStatusBadge
              key={`server-status-${server.guildId}`}
              status={server.isActive ? "active" : "disabled"}
              label={server.isActive ? "Ativo" : "Inativo"}
            />,
            <span key={`server-activated-${server.guildId}`} className="text-[12px] text-[#757575]">
              {formatDateTime(server.activatedAt)}
            </span>,
            <span key={`server-linked-${server.guildId}`} className="text-[12px] text-[#757575]">
              {formatDateTime(server.linkedAt)}
            </span>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem guildas"
              title="Nenhum servidor licenciado encontrado"
              description="A tabela `auth_user_plan_guilds` ainda nao retornou guildas para esta visao."
            />
          }
        />
      </div>
    </section>
  );
}
