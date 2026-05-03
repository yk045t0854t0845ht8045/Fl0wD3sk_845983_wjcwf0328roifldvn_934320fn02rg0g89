import { CircleDot, CreditCard, Layers, ReceiptText } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listAdminBillingStates } from "@/lib/admin/operations";

function formatDateTime(value: string | null) {
  if (!value) return "Sem registro";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminBillingPage() {
  await requirePermission("billing.read");
  const states = await listAdminBillingStates(80);
  const activePlans = states.filter((state) => state.planStatus === "active").length;
  const storedMethods = states.reduce(
    (total, state) => total + state.storedPaymentMethods,
    0,
  );
  const activeMethods = states.reduce(
    (total, state) => total + state.activePaymentMethods,
    0,
  );

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="Financeiro"
        title="Billing"
        description="Painel operacional para `auth_user_plan_state`, meios salvos e entrega corrente de licencas, sempre em cima da modelagem oficial ja existente no projeto."
      />

      <div className="mt-[24px] grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Estados de plano"
          value={String(states.length)}
          description="Contas com estado de billing carregado nesta visao."
          icon={<Layers className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Planos ativos"
          value={String(activePlans)}
          description="Estados marcados como ativos no licenciamento atual."
          icon={<CircleDot className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Metodos salvos"
          value={String(storedMethods)}
          description="Total de meios de pagamento persistidos nas contas listadas."
          icon={<CreditCard className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Metodos ativos"
          value={String(activeMethods)}
          description="Metodos ainda marcados como ativos no fluxo de billing."
          icon={<ReceiptText className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <div className="mt-[18px]">
        <AdminDataTable
          title="Estados de billing"
          description="A visao abaixo resume entrega de plano, vigencia e meios salvos por conta, usando o estado de plano realmente mantido pela plataforma."
          headers={[
            "Conta",
            "Plano",
            "Vigencia",
            "Ultima ordem",
            "Metodos salvos",
          ]}
          rows={states.map((state) => [
            <div key={`billing-user-${state.userId}`} className="space-y-[6px]">
              <p className="font-medium text-[#EFEFEF]">{state.customerLabel}</p>
              <p className="text-[12px] text-[#6D6D6D]">Usuario #{state.userId}</p>
            </div>,
            <div key={`billing-status-${state.userId}`} className="space-y-[8px]">
              {state.planStatus ? (
                <AdminStatusBadge status={state.planStatus} />
              ) : (
                <span className="text-[12px] text-[#6E6E6E]">Sem plano sincronizado</span>
              )}
            </div>,
            <div key={`billing-dates-${state.userId}`} className="space-y-[6px] text-[12px] text-[#7B7B7B]">
              <p>Ativado: {formatDateTime(state.activatedAt)}</p>
              <p>Expira: {formatDateTime(state.expiresAt)}</p>
            </div>,
            <span key={`billing-order-${state.userId}`} className="text-[#DFDFDF]">
              {state.lastPaymentOrderId ? `#${state.lastPaymentOrderId}` : "Sem ordem vinculada"}
            </span>,
            <div key={`billing-methods-${state.userId}`} className="space-y-[6px]">
              <p className="text-[#E5E5E5]">
                {state.activePaymentMethods}/{state.storedPaymentMethods} ativos
              </p>
              <p className="text-[12px] text-[#787878]">
                {state.latestPaymentMethodLabel || "Sem metodo salvo"}
              </p>
            </div>,
          ])}
          emptyState={
            <AdminEmptyState
              badgeLabel="Sem billing"
              title="Nenhum estado de plano retornado"
              description="Quando `auth_user_plan_state` estiver populada, esta visao refletira a entrega operacional real."
            />
          }
        />
      </div>
    </section>
  );
}
