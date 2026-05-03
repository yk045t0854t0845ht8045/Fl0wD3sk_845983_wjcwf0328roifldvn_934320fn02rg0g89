import { Inbox, LifeBuoy, MessageCircleWarning, Ticket } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { can } from "@/lib/admin/auth";
import {
  listAdminSupportTickets,
  type AdminSupportTicketSummary,
} from "@/lib/admin/operations";

function formatDateTime(value: string | null) {
  if (!value) return "Sem registro";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function AdminSupportPage() {
  const canReadSupport = await can("support.read");
  let tickets: AdminSupportTicketSummary[] = [];
  let loadErrorMessage: string | null = null;

  if (canReadSupport) {
    try {
      tickets = await listAdminSupportTickets(100);
    } catch (error) {
      loadErrorMessage =
        error instanceof Error
          ? error.message
          : "Falha desconhecida ao carregar tickets.";
      console.error("[Admin Support] Failed to load tickets:", error);
    }
  }

  const openTickets = tickets.filter(
    (ticket) => !["closed", "resolved"].includes(ticket.status),
  ).length;
  const closedTickets = tickets.length - openTickets;
  const escalationCandidates = tickets.filter(
    (ticket) => ticket.status === "pending" || ticket.status === "review",
  ).length;

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="Operacao"
        title="Suporte"
        description="Leitura institucional dos tickets reais da Flowdesk, com foco em fila aberta, protocolo, guilda de origem e contexto textual do chamado."
      />

      <div className="mt-[24px] grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Tickets carregados"
          value={String(tickets.length)}
          description="Janela operacional mais recente do suporte."
          icon={<Ticket className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Ainda abertos"
          value={String(openTickets)}
          description="Chamados que seguem em fluxo operacional."
          icon={<Inbox className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Encerrados"
          value={String(closedTickets)}
          description="Tickets fechados ou resolvidos nesta janela."
          icon={<LifeBuoy className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Pedem triagem"
          value={String(escalationCandidates)}
          description="Chamados pendentes ou em review para priorizacao."
          icon={<MessageCircleWarning className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <div className="mt-[18px]">
        {!canReadSupport ? (
          <AdminEmptyState
            badgeLabel="Permissao ausente"
            title="Acesso ao suporte nao liberado"
            description="Sua sessao administrativa esta ativa, mas o cargo atual nao possui a permissao `support.read`."
          />
        ) : loadErrorMessage ? (
          <AdminEmptyState
            badgeLabel="Leitura indisponivel"
            title="Tickets nao puderam ser carregados"
            description={loadErrorMessage}
          />
        ) : (
          <AdminDataTable
            title="Fila de suporte"
            description="Camada administrativa conectada a `tickets`, respeitando o backend real ja usado pelo portal do cliente."
            headers={[
              "Protocolo",
              "Solicitante",
              "Guild",
              "Status",
              "Abertura / Fechamento",
              "Motivo",
            ]}
            rows={tickets.map((ticket) => [
              <div key={`ticket-${ticket.id}`} className="space-y-[6px]">
                <p className="font-medium text-[#EFEFEF]">{ticket.protocol}</p>
                <p className="text-[12px] text-[#6D6D6D]">ID {ticket.id}</p>
              </div>,
              <span key={`ticket-user-${ticket.id}`} className="text-[#E2E2E2]">
                {ticket.requesterId || "Usuario nao informado"}
              </span>,
              <span key={`ticket-guild-${ticket.id}`} className="text-[#D1D1D1]">
                {ticket.guildId || "Sem guilda"}
              </span>,
              <AdminStatusBadge key={`ticket-status-${ticket.id}`} status={ticket.status} />,
              <div key={`ticket-dates-${ticket.id}`} className="space-y-[6px] text-[12px] text-[#7B7B7B]">
                <p>Aberto: {formatDateTime(ticket.openedAt)}</p>
                <p>Fechado: {formatDateTime(ticket.closedAt)}</p>
              </div>,
              <div key={`ticket-reason-${ticket.id}`} className="max-w-[280px] space-y-[6px]">
                <p className="text-[13px] leading-[1.55] text-[#CFCFCF]">
                  {ticket.openedReason || "Sem motivo registrado"}
                </p>
                {ticket.closedBy ? (
                  <p className="text-[12px] text-[#7B7B7B]">Fechado por {ticket.closedBy}</p>
                ) : null}
              </div>,
            ])}
            emptyState={
            <AdminEmptyState
              badgeLabel="Sem fila"
              title="Nenhum ticket encontrado"
              description="Os tickets do suporte aparecerao aqui assim que forem registrados no backend atual."
            />
            }
          />
        )}
      </div>
    </section>
  );
}
