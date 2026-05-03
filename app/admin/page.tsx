import {
  Activity,
  BadgeCheck,
  CreditCard,
  Shield,
  Ticket,
  Users,
} from "lucide-react";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { AdminAuditTimeline } from "@/components/admin/AdminAuditTimeline";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { getAdminOverviewData } from "@/lib/admin/read";

const NUMBER_FORMATTER = new Intl.NumberFormat("pt-BR");

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || "BRL"}`;
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminOverviewPage() {
  await requirePermission("admin.overview.read");
  const overview = await getAdminOverviewData();
  const metricById = new Map(overview.metrics.map((metric) => [metric.id, metric]));
  const customers = metricById.get("customers");
  const staff = metricById.get("staff");
  const servers = metricById.get("servers");
  const incidents = metricById.get("incidents");
  const tickets = metricById.get("tickets");
  const ipRequests = metricById.get("ip_requests");
  const approvals = metricById.get("access_requests");
  const certificates = metricById.get("certificates");

  if (
    !customers ||
    !staff ||
    !servers ||
    !incidents ||
    !tickets ||
    !ipRequests ||
    !approvals ||
    !certificates
  ) {
    throw new Error("O overview administrativo nao conseguiu resolver todas as metricas base.");
  }

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="Flowdesk Internal"
        title="Painel Administrativo"
        description="Visao operacional da plataforma com dados reais de autenticacao, pagamentos, suporte, status publico e trilha administrativa."
      />

      <div className="mt-[26px] grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <LandingReveal delay={0}>
          <div>
            <AdminStatCard
              label={customers.label}
              value={NUMBER_FORMATTER.format(customers.value)}
              description={customers.detail}
              icon={<Users className="h-[20px] w-[20px]" strokeWidth={1.9} />}
            />
          </div>
        </LandingReveal>
        <LandingReveal delay={40}>
          <div>
            <AdminStatCard
              label={staff.label}
              value={NUMBER_FORMATTER.format(staff.value)}
              description={staff.detail}
              icon={<Shield className="h-[20px] w-[20px]" strokeWidth={1.9} />}
            />
          </div>
        </LandingReveal>
        <LandingReveal delay={80}>
          <div>
            <AdminStatCard
              label={servers.label}
              value={NUMBER_FORMATTER.format(servers.value)}
              description={servers.detail}
              icon={<Activity className="h-[20px] w-[20px]" strokeWidth={1.9} />}
            />
          </div>
        </LandingReveal>
        <LandingReveal delay={120}>
          <div>
            <AdminStatCard
              label={incidents.label}
              value={NUMBER_FORMATTER.format(incidents.value)}
              description={incidents.detail}
              icon={<BadgeCheck className="h-[20px] w-[20px]" strokeWidth={1.9} />}
            />
          </div>
        </LandingReveal>
      </div>

      <div className="mt-[14px] grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <LandingReveal delay={160}>
          <div>
            <AdminStatCard
              label={tickets.label}
              value={NUMBER_FORMATTER.format(tickets.value)}
              description={tickets.detail}
              icon={<Ticket className="h-[20px] w-[20px]" strokeWidth={1.9} />}
            />
          </div>
        </LandingReveal>
        <LandingReveal delay={200}>
          <div>
            <AdminStatCard
              label={ipRequests.label}
              value={NUMBER_FORMATTER.format(ipRequests.value)}
              description={ipRequests.detail}
              icon={<Shield className="h-[20px] w-[20px]" strokeWidth={1.9} />}
            />
          </div>
        </LandingReveal>
        <LandingReveal delay={240}>
          <div>
            <AdminStatCard
              label={approvals.label}
              value={NUMBER_FORMATTER.format(approvals.value)}
              description={approvals.detail}
              icon={<Shield className="h-[20px] w-[20px]" strokeWidth={1.9} />}
            />
          </div>
        </LandingReveal>
        <LandingReveal delay={280}>
          <div>
            <AdminStatCard
              label={certificates.label}
              value={NUMBER_FORMATTER.format(certificates.value)}
              description={certificates.detail}
              icon={<BadgeCheck className="h-[20px] w-[20px]" strokeWidth={1.9} />}
            />
          </div>
        </LandingReveal>
      </div>

      <div className="mt-[18px] grid gap-[14px] xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <LandingReveal delay={320}>
          <div>
            <AdminDataTable
              title="Pagamentos recentes"
              description="Ultimas ordens registradas no billing atual da Flowdesk."
              headers={["Pedido", "Cliente", "Plano", "Status", "Valor", "Criado em"]}
              rows={overview.recentPayments.map((payment) => [
                <div key={`order-${payment.id}`}>
                  <p className="font-medium text-[#EFEFEF]">#{payment.orderNumber}</p>
                  <p className="mt-[6px] text-[12px] text-[#6F6F6F]">ID {payment.id}</p>
                </div>,
                <div key={`customer-${payment.id}`}>
                  <p className="font-medium text-[#E5E5E5]">{payment.customerLabel}</p>
                </div>,
                <div key={`plan-${payment.id}`}>
                  <p className="text-[#CDCDCD]">{payment.planName || "Sem plano vinculado"}</p>
                </div>,
                <AdminStatusBadge key={`status-${payment.id}`} status={payment.status} />,
                <div key={`amount-${payment.id}`}>
                  <p className="font-medium text-[#EFEFEF]">
                    {formatMoney(payment.amount, payment.currency)}
                  </p>
                </div>,
                <span key={`created-${payment.id}`} className="text-[12px] text-[#747474]">
                  {formatDateTime(payment.createdAt)}
                </span>,
              ])}
              emptyState={
                <AdminEmptyState
                  badgeLabel="Sem ordens"
                  title="Nenhum pagamento recente"
                  description="Assim que novas transacoes forem registradas no billing, elas aparecerao aqui."
                />
              }
            />
          </div>
        </LandingReveal>

        <LandingReveal delay={360}>
          <div className="overflow-hidden rounded-[24px] border border-[#141414] bg-[#090909] shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
            <div className="border-b border-[#141414] px-[20px] py-[18px]">
              <h2 className="text-[20px] leading-none font-medium tracking-[-0.03em] text-[#F1F1F1]">
                Alertas criticos
              </h2>
              <p className="mt-[10px] text-[13px] leading-[1.6] text-[#737373]">
                Incidentes publicos ainda ativos no status page institucional.
              </p>
            </div>

            {overview.openAlerts.length ? (
              <div className="divide-y divide-[#141414]">
                {overview.openAlerts.map((alert) => (
                  <article key={alert.id} className="px-[20px] py-[18px]">
                    <div className="flex flex-col gap-[10px] md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-[#EEEEEE]">{alert.title}</p>
                        <p className="mt-[6px] text-[12px] text-[#6D6D6D]">
                          Atualizado em {formatDateTime(alert.updatedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-[10px]">
                        <AdminStatusBadge status={alert.impact} />
                        <AdminStatusBadge status={alert.status} />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="px-[20px] py-[20px]">
                <AdminEmptyState
                  badgeLabel="Tudo estavel"
                  title="Nenhum incidente aberto"
                  description="No momento, o status publico nao possui alertas ativos registrados."
                />
              </div>
            )}
          </div>
        </LandingReveal>
      </div>

      <div className="mt-[18px]">
        <LandingReveal delay={400}>
          <div>
            <AdminAuditTimeline entries={overview.recentAuditEntries} />
          </div>
        </LandingReveal>
      </div>

      <div className="mt-[18px] rounded-[24px] border border-[#141414] bg-[#090909] px-[20px] py-[20px] shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
        <div className="flex flex-col gap-[12px] md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h2 className="text-[20px] leading-none font-medium tracking-[-0.03em] text-[#F1F1F1]">
              Base pronta para os proximos modulos
            </h2>
            <p className="mt-[10px] text-[13px] leading-[1.7] text-[#737373]">
              O shell administrativo, a protecao de acesso, o catalogo inicial de RBAC e a espinha dorsal de FLWIP/Test Variables ja estao conectados. Os modulos operacionais entram agora sobre esta mesma base, sem trocar o visual da Flowdesk.
            </p>
          </div>

          <div className="flex items-center gap-[10px] rounded-[18px] border border-[#171717] bg-[#0D0D0D] px-[14px] py-[12px]">
            <CreditCard className="h-[18px] w-[18px] text-[#BFBFBF]" strokeWidth={1.9} />
            <p className="text-[13px] text-[#AFAFAF]">
              Overview ativo com dados reais de auth, billing, tickets, status e auditoria.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
