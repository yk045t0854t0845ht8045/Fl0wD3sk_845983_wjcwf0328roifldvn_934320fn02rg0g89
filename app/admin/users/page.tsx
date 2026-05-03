import { CreditCard, Shield, Ticket, Users } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listAdminUserAccounts } from "@/lib/admin/operations";

function formatDateTime(value: string | null) {
  if (!value) return "Sem registro";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminUsersPage() {
  await requirePermission("users.read");
  const users = await listAdminUserAccounts(80);
  const activePlans = users.filter((user) => user.planStatus === "active").length;
  const staffAccounts = users.filter((user) => user.isStaff).length;
  const usersWithOpenTickets = users.filter((user) => user.openTicketCount > 0).length;

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="Operacao"
        title="Usuarios"
        description="Leitura institucional das contas reais do auth principal, com contexto de plano, pagamentos recentes, tickets abertos e eventual vinculo ao staff interno."
      />

      <div className="mt-[24px] grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Contas exibidas"
          value={String(users.length)}
          description="Janela operacional atual da base principal de auth."
          icon={<Users className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Planos ativos"
          value={String(activePlans)}
          description="Usuarios que hoje possuem estado de plano ativo."
          icon={<CreditCard className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Staff vinculado"
          value={String(staffAccounts)}
          description="Contas do auth principal que tambem possuem perfil administrativo."
          icon={<Shield className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Com tickets abertos"
          value={String(usersWithOpenTickets)}
          description="Usuarios com chamados ainda nao encerrados no suporte."
          icon={<Ticket className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <div className="mt-[18px]">
        <AdminDataTable
          title="Contas do auth principal"
          description="Sem criar um segundo sistema de usuarios: esta visao opera diretamente sobre `auth_users`, `auth_user_plan_state`, `payment_orders` e `tickets`."
          headers={[
            "Conta",
            "Plano",
            "Pagamentos",
            "Tickets",
            "Staff",
            "Criado em",
          ]}
          rows={users.map((user) => [
            <div key={`user-${user.id}`} className="space-y-[6px]">
              <p className="font-medium text-[#EFEFEF]">{user.displayName}</p>
              <p className="text-[12px] text-[#6D6D6D]">
                {user.email || `Usuario #${user.id}`}
              </p>
              {user.discordUserId ? (
                <p className="text-[12px] text-[#838383]">
                  Discord {user.discordUserId}
                </p>
              ) : null}
            </div>,
            <div key={`plan-${user.id}`} className="space-y-[8px]">
              {user.planStatus ? (
                <AdminStatusBadge status={user.planStatus} />
              ) : (
                <span className="text-[12px] text-[#6E6E6E]">Sem plano ativo</span>
              )}
              <p className="text-[12px] text-[#7D7D7D]">
                Expira: {formatDateTime(user.planExpiresAt)}
              </p>
            </div>,
            <div key={`payments-${user.id}`} className="space-y-[6px]">
              <p className="text-[#E4E4E4]">{user.paymentCount} ordem(ns)</p>
              {user.latestPaymentStatus ? (
                <AdminStatusBadge status={user.latestPaymentStatus} />
              ) : (
                <span className="text-[12px] text-[#6E6E6E]">Sem historico</span>
              )}
            </div>,
            <div key={`tickets-${user.id}`} className="space-y-[6px]">
              <p className="text-[#E4E4E4]">{user.openTicketCount} aberto(s)</p>
            </div>,
            <div key={`staff-${user.id}`} className="space-y-[8px]">
              {user.isStaff ? (
                <AdminStatusBadge status={user.staffStatus || "active"} label="Staff" />
              ) : (
                <span className="text-[12px] text-[#6E6E6E]">Cliente</span>
              )}
              {user.staffStatus ? (
                <p className="text-[12px] text-[#7D7D7D]">{user.staffStatus}</p>
              ) : null}
            </div>,
            <span key={`created-${user.id}`} className="text-[12px] text-[#757575]">
              {formatDateTime(user.createdAt)}
            </span>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem usuarios"
              title="Nenhuma conta encontrada"
              description="A base atual de auth nao retornou contas para esta visao administrativa."
            />
          }
        />
      </div>
    </section>
  );
}
