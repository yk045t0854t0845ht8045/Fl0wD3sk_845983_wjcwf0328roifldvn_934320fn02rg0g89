import { BadgeDollarSign, CircleAlert, CreditCard, Wallet } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listAdminPaymentOrders } from "@/lib/admin/operations";

function formatDateTime(value: string | null) {
  if (!value) return "Sem registro";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export default async function AdminPaymentsPage() {
  await requirePermission("payments.read");
  const payments = await listAdminPaymentOrders(100);
  const approvedCount = payments.filter((payment) => payment.status === "approved").length;
  const pendingCount = payments.filter((payment) => payment.status === "pending").length;
  const attentionCount = payments.filter((payment) =>
    ["failed", "rejected", "cancelled", "expired"].includes(payment.status),
  ).length;

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="Financeiro"
        title="Pagamentos"
        description="Camada administrativa sobre `payment_orders` e o fluxo real do Mercado Pago, sem criar um billing paralelo nem inventar dados de concilicao."
      />

      <div className="mt-[24px] grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Ordens carregadas"
          value={String(payments.length)}
          description="Janela operacional mais recente das transacoes."
          icon={<Wallet className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Aprovadas"
          value={String(approvedCount)}
          description="Pagamentos confirmados pelo fluxo atual."
          icon={<BadgeDollarSign className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Pendentes"
          value={String(pendingCount)}
          description="Ordens ainda em processamento ou aguardando conclusao."
          icon={<CreditCard className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Exigem atencao"
          value={String(attentionCount)}
          description="Falhas, expiracoes, cancelamentos ou rejeicoes recentes."
          icon={<CircleAlert className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <div className="mt-[18px]">
        <AdminDataTable
          title="Ordens recentes"
          description="Cada registro abaixo vem do billing real da Flowdesk, incluindo metodo, plano, estado atual e status do provedor."
          headers={[
            "Pedido",
            "Cliente",
            "Metodo / Plano",
            "Status",
            "Datas",
            "Valor",
          ]}
          rows={payments.map((payment) => [
            <div key={`payment-${payment.id}`} className="space-y-[6px]">
              <p className="font-medium text-[#EFEFEF]">#{payment.orderNumber}</p>
              <p className="text-[12px] text-[#6D6D6D]">ID {payment.id}</p>
              {payment.guildId ? (
                <p className="text-[12px] text-[#858585]">Guild {payment.guildId}</p>
              ) : null}
            </div>,
            <div key={`payment-user-${payment.id}`} className="space-y-[6px]">
              <p className="text-[#E4E4E4]">{payment.customerLabel}</p>
              <p className="text-[12px] text-[#717171]">Usuario #{payment.userId}</p>
            </div>,
            <div key={`payment-plan-${payment.id}`} className="space-y-[8px]">
              <AdminStatusBadge status={payment.paymentMethod} />
              <p className="text-[12px] text-[#7D7D7D]">
                {payment.planName || "Sem plano vinculado"}
              </p>
            </div>,
            <div key={`payment-status-${payment.id}`} className="space-y-[8px]">
              <AdminStatusBadge status={payment.status} />
              {payment.providerStatus ? (
                <p className="text-[12px] text-[#7D7D7D]">
                  Provedor: {payment.providerStatus}
                </p>
              ) : null}
            </div>,
            <div key={`payment-dates-${payment.id}`} className="space-y-[6px] text-[12px] text-[#7B7B7B]">
              <p>Criado: {formatDateTime(payment.createdAt)}</p>
              <p>Pago: {formatDateTime(payment.paidAt)}</p>
            </div>,
            <span key={`payment-amount-${payment.id}`} className="font-medium text-[#EFEFEF]">
              {formatMoney(payment.amount, payment.currency)}
            </span>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem pagamentos"
              title="Nenhuma ordem encontrada"
              description="Assim que novas transacoes forem persistidas em `payment_orders`, elas aparecerao aqui."
            />
          }
        />
      </div>
    </section>
  );
}
