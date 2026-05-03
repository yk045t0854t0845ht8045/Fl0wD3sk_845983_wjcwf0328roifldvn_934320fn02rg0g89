import { CreditCard, Ticket, UserRound } from "lucide-react";
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

export default async function AdminCustomersPage() {
  await requirePermission("customers.read");
  const accounts = await listAdminUserAccounts(120);
  const customers = accounts.filter(
    (account) =>
      !account.isStaff &&
      (account.paymentCount > 0 || account.planStatus || account.openTicketCount > 0),
  );
  const activePlans = customers.filter((customer) => customer.planStatus === "active").length;
  const customersWithPayments = customers.filter((customer) => customer.paymentCount > 0).length;
  const customersWithTickets = customers.filter((customer) => customer.openTicketCount > 0).length;

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="Operacao"
        title="Clientes"
        description="Vista focada nas contas com atividade comercial ou operacional, preservando `auth_users` como fonte primaria e evitando qualquer duplicacao da base de clientes."
      />

      <div className="mt-[24px] grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Clientes ativos na visao"
          value={String(customers.length)}
          description="Contas com plano, pagamento ou suporte recente."
          icon={<UserRound className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Com plano ativo"
          value={String(activePlans)}
          description="Clientes cujo estado de plano atual esta ativo."
          icon={<CreditCard className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Com pagamentos"
          value={String(customersWithPayments)}
          description="Clientes que ja possuem ordens registradas no billing."
          icon={<CreditCard className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Com tickets abertos"
          value={String(customersWithTickets)}
          description="Clientes que ainda exigem atencao do suporte."
          icon={<Ticket className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <div className="mt-[18px]">
        <AdminDataTable
          title="Carteira operacional"
          description="Contas nao-staff com sinais reais de uso da plataforma, pagamentos ou suporte."
          headers={[
            "Cliente",
            "Plano",
            "Pagamentos",
            "Tickets",
            "Ultima entrega",
          ]}
          rows={customers.map((customer) => [
            <div key={`customer-${customer.id}`} className="space-y-[6px]">
              <p className="font-medium text-[#EFEFEF]">{customer.displayName}</p>
              <p className="text-[12px] text-[#6D6D6D]">
                {customer.email || `Usuario #${customer.id}`}
              </p>
            </div>,
            <div key={`customer-plan-${customer.id}`} className="space-y-[8px]">
              {customer.planStatus ? (
                <AdminStatusBadge status={customer.planStatus} />
              ) : (
                <span className="text-[12px] text-[#6E6E6E]">Sem plano</span>
              )}
              <p className="text-[12px] text-[#7D7D7D]">
                Expira: {formatDateTime(customer.planExpiresAt)}
              </p>
            </div>,
            <div key={`customer-payments-${customer.id}`} className="space-y-[8px]">
              <p className="text-[#E4E4E4]">{customer.paymentCount} ordem(ns)</p>
              {customer.latestPaymentStatus ? (
                <AdminStatusBadge status={customer.latestPaymentStatus} />
              ) : null}
            </div>,
            <div key={`customer-tickets-${customer.id}`} className="space-y-[6px]">
              <p className="text-[#E4E4E4]">{customer.openTicketCount} aberto(s)</p>
            </div>,
            <span key={`customer-created-${customer.id}`} className="text-[12px] text-[#757575]">
              {formatDateTime(customer.updatedAt || customer.createdAt)}
            </span>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem carteira"
              title="Nenhum cliente operacional encontrado"
              description="Ainda nao ha contas com plano, pagamento ou suporte suficiente para esta visao."
            />
          }
        />
      </div>
    </section>
  );
}
