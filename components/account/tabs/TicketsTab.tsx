"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Filter,
  LifeBuoy,
  Search,
} from "lucide-react";

type Ticket = {
  id: number;
  protocol: string;
  status: "open" | "closed" | "in_progress" | string;
  guild_id: string | null;
  opened_at: string;
  closed_at: string | null;
  opened_reason?: string | null;
  transcript_file?: string | null;
  closed_by?: string | null;
  access_code?: string | null;
};

function resolveTicketStatus(status: string) {
  const normalizedStatus = (status || "").toLowerCase();
  if (
    normalizedStatus === "open" ||
    normalizedStatus === "in_progress" ||
    normalizedStatus === "active"
  ) {
    return {
      label: "Aberto",
      color: "text-[#34A853] bg-[rgba(52,168,83,0.10)]",
      icon: AlertCircle,
    };
  }

  if (normalizedStatus === "closed" || normalizedStatus === "resolved") {
    return {
      label: "Resolvido",
      color: "text-[#DB4646] bg-[rgba(219,70,70,0.10)]",
      icon: CheckCircle2,
    };
  }

  return {
    label: status || "Indefinido",
    color: "text-[#888] bg-[rgba(255,255,255,0.05)]",
    icon: FileText,
  };
}

function formatDate(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "Data indisponivel";
  }

  return parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTranscriptHref(ticket: Ticket) {
  const rawTranscriptFile =
    typeof ticket.transcript_file === "string" ? ticket.transcript_file.trim() : "";
  if (!rawTranscriptFile) return null;

  let pathname = rawTranscriptFile;
  if (/^https?:\/\//i.test(rawTranscriptFile)) {
    try {
      pathname = new URL(rawTranscriptFile).pathname || rawTranscriptFile;
    } catch {
      pathname = rawTranscriptFile;
    }
  }

  const accessCode = typeof ticket.access_code === "string" ? ticket.access_code.trim() : "";
  return accessCode ? `${pathname}?code=${encodeURIComponent(accessCode)}` : pathname;
}

export function TicketsTab({ initialTickets }: { initialTickets?: Ticket[] }) {
  const hasInitialTickets = Array.isArray(initialTickets);
  const { data, error, isLoading } = useSWR<Ticket[]>(
    "/api/auth/me/support-tickets",
    async (url: string) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.message || "Erro ao carregar tickets");
      }

      const payload = await response.json();
      return (Array.isArray(payload.tickets) ? payload.tickets : []) as Ticket[];
    },
    {
      fallbackData: hasInitialTickets ? initialTickets : undefined,
      revalidateOnMount: !hasInitialTickets,
      revalidateIfStale: !hasInitialTickets,
      revalidateOnFocus: false,
      shouldRetryOnError: !hasInitialTickets,
      errorRetryCount: hasInitialTickets ? 0 : 3,
    },
  );

  const tickets = useMemo(() => data ?? [], [data]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [expandedTicketId, setExpandedTicketId] = useState<number | null>(null);

  if (error) {
    console.error("[TicketsTab] SWR Error:", error);
  }

  const filteredTickets = useMemo(() => {
    const normalizedSearch = searchQuery.toLowerCase();
    return tickets.filter((ticket: Ticket) => {
      const matchesSearch =
        (ticket.protocol || "").toLowerCase().includes(normalizedSearch) ||
        (ticket.guild_id && ticket.guild_id.includes(searchQuery)) ||
        (ticket.opened_reason || "").toLowerCase().includes(normalizedSearch);

      const normalizedStatus = (ticket.status || "").toLowerCase();
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "open" && normalizedStatus !== "closed") ||
        (statusFilter === "closed" && normalizedStatus === "closed");

      return matchesSearch && matchesStatus;
    });
  }, [tickets, searchQuery, statusFilter]);

  if (isLoading && !tickets.length) {
    return (
      <div className="space-y-[12px]">
        <div className="flowdesk-shimmer h-[70px] w-full rounded-[18px] border border-[#141414] bg-[#0A0A0A]" />
        {[...Array(3)].map((_, index) => (
          <div
            key={index}
            className="flowdesk-shimmer h-[90px] w-full rounded-[18px] border border-[#141414] bg-[#0A0A0A]"
          />
        ))}
      </div>
    );
  }

  if (error && !tickets.length) {
    return (
      <div className="rounded-[22px] border border-[rgba(219,70,70,0.22)] bg-[rgba(42,12,12,0.82)] p-[20px]">
        <p className="text-[15px] font-semibold text-[#F1D3D3]">
          Nao foi possivel carregar os tickets.
        </p>
        <p className="mt-[8px] text-[13px] leading-[1.55] text-[#C78F8F]">
          {error.message || "Tente atualizar a pagina em alguns segundos."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-[32px] space-y-[16px]">
      <div className="rounded-[22px] border border-[#141414] bg-[#0A0A0A] p-[20px]">
        <div className="flex flex-col gap-[16px] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-[12px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] px-[16px] py-[12px] transition-all focus-within:border-[#222] focus-within:bg-[#0F0F0F]">
            <Search className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]" strokeWidth={1.8} />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar por protocolo ou ID do servidor..."
              className="w-full bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#4A4A4A]"
            />
          </div>

          <div className="flex items-center gap-[10px]">
            <div className="flex items-center gap-[6px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] p-[4px]">
              {(["all", "open", "closed"] as const).map((option) => {
                const isActive = statusFilter === option;
                return (
                  <button
                    key={option}
                    onClick={() => setStatusFilter(option)}
                    className={`rounded-[10px] px-[16px] py-[8px] text-[13px] font-semibold transition-all ${
                      isActive
                        ? "bg-[#1A1A1A] text-[#EEEEEE] shadow-sm"
                        : "text-[#666666] hover:bg-[#111111] hover:text-[#A6A6A6]"
                    }`}
                  >
                    {option === "all" ? "Todos" : option === "open" ? "Abertos" : "Fechados"}
                  </button>
                );
              })}
            </div>

            <button
              className="flex h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-[#141414] bg-[#0D0D0D] text-[#6F6F6F] transition-all hover:border-[#1F1F1F] hover:bg-[#111111] hover:text-[#D5D5D5]"
              title="Mais filtros"
            >
              <Filter className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </div>

      {filteredTickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[18px] border border-[#141414] bg-[#090909] px-[20px] py-[48px] text-center">
          <div className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-[#111111]">
            <LifeBuoy className="h-[20px] w-[20px] text-[#555]" />
          </div>
          <p className="mt-[16px] text-[15px] font-medium text-[#E5E5E5]">
            Nenhum ticket encontrado
          </p>
        </div>
      ) : (
        <div className="space-y-[10px]">
          {filteredTickets.map((ticket) => {
            const { label, color, icon: StatusIcon } = resolveTicketStatus(ticket.status);
            const isExpanded = expandedTicketId === ticket.id;
            const transcriptHref = buildTranscriptHref(ticket);

            return (
              <div
                key={ticket.id}
                className={`group flex flex-col overflow-hidden rounded-[18px] border transition-all duration-300 ${
                  isExpanded
                    ? "border-[#222] bg-[#0C0C0C] ring-1 ring-[#1A1A1A]"
                    : "border-[#141414] bg-[#090909] hover:border-[#1C1C1C]"
                }`}
              >
                <div
                  onClick={() => setExpandedTicketId(isExpanded ? null : ticket.id)}
                  className="cursor-pointer flex flex-col gap-[12px] p-[18px] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-[16px]">
                    <div
                      className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full transition-transform duration-300 ${
                        isExpanded ? "scale-110" : ""
                      } ${color}`}
                    >
                      <StatusIcon className="h-[20px] w-[20px]" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-[8px]">
                        <h3 className="text-[15px] font-bold tracking-tight text-[#EEEEEE] transition group-hover:text-white">
                          {ticket.protocol}
                        </h3>
                        {ticket.opened_reason && !isExpanded ? (
                          <span className="max-w-[200px] truncate text-[12px] font-medium text-[#666]">
                            - {ticket.opened_reason}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-[3px] text-[13px] text-[#6F6F6F]">
                        Aberto em {formatDate(ticket.opened_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-[16px] sm:justify-end">
                    <span className={`rounded-[8px] px-[10px] py-[4px] text-[12px] font-bold ${color}`}>
                      {label}
                    </span>
                    <ChevronDown
                      className={`h-[18px] w-[18px] text-[#444] transition-transform duration-300 ${
                        isExpanded ? "rotate-180 text-[#888]" : ""
                      }`}
                    />
                  </div>
                </div>

                {isExpanded ? (
                  <div className="animate-in slide-in-from-top-2 border-t border-[#161616] bg-[rgba(255,255,255,0.01)] p-[24px] duration-300">
                    <div className="grid gap-[24px] md:grid-cols-3">
                      <div className="space-y-[16px]">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">
                            Motivo de Abertura
                          </p>
                          <p className="mt-[4px] break-words text-[14px] font-medium text-[#D1D1D1]">
                            {ticket.opened_reason || "Nenhum motivo fornecido"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">
                            ID do Servidor
                          </p>
                          <p className="mt-[4px] font-mono text-[14px] font-medium text-[#D1D1D1]">
                            {ticket.guild_id}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-[16px]">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">
                            Datas
                          </p>
                          <p className="mt-[4px] text-[13px] text-[#A6A6A6]">
                            <span className="mr-1 select-none font-medium text-[#555]">
                              Abertura:
                            </span>
                            {formatDate(ticket.opened_at)}
                          </p>
                          {ticket.closed_at ? (
                            <p className="mt-[2px] text-[13px] text-[#A6A6A6]">
                              <span className="mr-1 select-none font-medium text-[#555]">
                                Fechamento:
                              </span>
                              {formatDate(ticket.closed_at)}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-[16px]">
                        {ticket.closed_by ? (
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">
                              Atendido por
                            </p>
                            <p className="mt-[4px] font-mono text-[13px] text-[#D1D1D1]">
                              {ticket.closed_by}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-[24px] border-t border-[rgba(255,255,255,0.02)] pt-[20px]">
                      {transcriptHref ? (
                        <a
                          href={transcriptHref}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex w-fit items-center gap-[10px] rounded-[12px] border border-[#222] bg-[rgba(255,255,255,0.05)] px-[18px] py-[12px] text-[14px] font-bold text-white transition-all hover:bg-[rgba(255,255,255,0.08)]"
                        >
                          <FileText className="h-[18px] w-[18px] text-[#A0A0A0]" />
                          Visualizar Transcript
                        </a>
                      ) : (
                        <div className="flex w-fit cursor-not-allowed items-center gap-[10px] rounded-[12px] border border-dashed border-[#222] bg-[rgba(255,255,255,0.02)] px-[18px] py-[12px] text-[14px] font-medium italic text-[#444]">
                          Transcript nao disponivel
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
