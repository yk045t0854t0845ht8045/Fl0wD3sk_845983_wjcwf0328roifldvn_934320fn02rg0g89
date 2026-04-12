"use client";

import { useEffect, useState, useMemo } from "react";
import { LifeBuoy, Search, Filter, AlertCircle, CheckCircle2, FileText, ChevronDown } from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";

type Ticket = {
  id: number;
  protocol: string;
  status: "open" | "closed" | "in_progress" | string;
  guild_id: string | null;
  opened_at: string;
  closed_at: string | null;
  opened_reason?: string;
  transcript_file?: string | null;
  closed_by?: string | null;
};

function resolveTicketStatus(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "open" || s === "in_progress" || s === "active") {
    return { label: "Aberto", color: "text-[#34A853] bg-[rgba(52,168,83,0.10)]", icon: AlertCircle };
  }
  if (s === "closed" || s === "resolved") {
    return { label: "Resolvido", color: "text-[#DB4646] bg-[rgba(219,70,70,0.10)]", icon: CheckCircle2 };
  }
  return { label: status, color: "text-[#888] bg-[rgba(255,255,255,0.05)]", icon: FileText };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TicketsTab() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [expandedTicketId, setExpandedTicketId] = useState<number | null>(null);

  useEffect(() => {
    async function loadTickets() {
      try {
        const res = await fetch("/api/auth/me/support-tickets");
        const json = await res.json();
        if (json.ok) setTickets(json.tickets || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadTickets();
  }, []);

  const filteredTickets = useMemo(() => {
    if (!tickets) return [];
    return tickets.filter((ticket) => {
      const matchSearch = (ticket.protocol || "").toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (ticket.guild_id && ticket.guild_id.includes(searchQuery)) ||
                          (ticket.opened_reason && ticket.opened_reason.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const normalizedStatus = (ticket.status || "").toLowerCase();
      const matchStatus = statusFilter === "all" || 
                         (statusFilter === "open" && normalizedStatus !== "closed") || 
                         (statusFilter === "closed" && normalizedStatus === "closed");
      
      return matchSearch && matchStatus;
    });
  }, [tickets, searchQuery, statusFilter]);

  if (loading) {
    return (
      <div className="space-y-[12px]">
        {/* Filter skeleton */}
        <div className="flowdesk-shimmer h-[70px] w-full rounded-[18px] border border-[#141414] bg-[#0A0A0A]" />
        {[...Array(3)].map((_, i) => (
           <div key={i} className="flowdesk-shimmer h-[90px] w-full rounded-[18px] border border-[#141414] bg-[#0A0A0A]" />
        ))}
      </div>
    );
  }

  return (
    <div className="mt-[32px] space-y-[16px]">
      {/* Filter Card */}
      <div className="rounded-[22px] border border-[#141414] bg-[#0A0A0A] p-[20px]">
        <div className="flex flex-col gap-[16px] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-[12px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] px-[16px] py-[12px] transition-all focus-within:border-[#222] focus-within:bg-[#0F0F0F]">
            <Search className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]" strokeWidth={1.8} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por protocolo ou ID do servidor..."
              className="w-full bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#4A4A4A]"
            />
          </div>
          
          <div className="flex items-center gap-[10px]">
            <div className="flex items-center gap-[6px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] p-[4px]">
              {(["all", "open", "closed"] as const).map((opt) => {
                const isActive = statusFilter === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => setStatusFilter(opt)}
                    className={`rounded-[10px] px-[16px] py-[8px] text-[13px] font-semibold transition-all ${
                      isActive
                        ? "bg-[#1A1A1A] text-[#EEEEEE] shadow-sm"
                        : "text-[#666666] hover:bg-[#111111] hover:text-[#A6A6A6]"
                    }`}
                  >
                    {opt === "all" ? "Todos" : opt === "open" ? "Abertos" : "Fechados"}
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
        <div className="flex flex-col items-center justify-center rounded-[18px] border border-[#141414] bg-[#090909] py-[48px] px-[20px] text-center">
          <div className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-[#111111]">
            <LifeBuoy className="text-[#555] h-[20px] w-[20px]" />
          </div>
          <p className="mt-[16px] text-[15px] font-medium text-[#E5E5E5]">Nenhum ticket encontrado</p>
        </div>
      ) : (
        <div className="space-y-[10px]">
          {filteredTickets.map((ticket) => {
            const { label, color, icon: StatusIcon } = resolveTicketStatus(ticket.status);
            const isExpanded = expandedTicketId === ticket.id;
            return (
              <div
                key={ticket.id}
                className={`group flex flex-col overflow-hidden rounded-[18px] border transition-all duration-300 ${
                  isExpanded ? "border-[#222] bg-[#0C0C0C] ring-1 ring-[#1A1A1A]" : "border-[#141414] bg-[#090909] hover:border-[#1C1C1C]"
                }`}
              >
                <div 
                  onClick={() => setExpandedTicketId(isExpanded ? null : ticket.id)}
                  className="flex flex-col gap-[12px] p-[18px] sm:flex-row sm:items-center sm:justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-[16px]">
                    <div className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full transition-transform duration-300 ${isExpanded ? "scale-110" : ""} ${color}`}>
                      <StatusIcon className="h-[20px] w-[20px]" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-[8px]">
                        <h3 className="text-[15px] font-bold text-[#EEEEEE] tracking-tight group-hover:text-white transition">
                          {ticket.protocol}
                        </h3>
                        {ticket.opened_reason && !isExpanded && (
                          <span className="text-[12px] text-[#666] font-medium truncate max-w-[200px]">
                            • {ticket.opened_reason}
                          </span>
                        )}
                      </div>
                      <p className="mt-[3px] text-[13px] text-[#6F6F6F]">
                        Aberto em {formatDate(ticket.opened_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-[16px] justify-between sm:justify-end">
                    <span className={`rounded-[8px] px-[10px] py-[4px] text-[12px] font-bold ${color}`}>
                      {label}
                    </span>
                    <ChevronDown className={`h-[18px] w-[18px] text-[#444] transition-transform duration-300 ${isExpanded ? "rotate-180 text-[#888]" : ""}`} />
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-[#161616] bg-[rgba(255,255,255,0.01)] p-[24px] animate-in slide-in-from-top-2 duration-300">
                    <div className="grid gap-[24px] md:grid-cols-3">
                      <div className="space-y-[16px]">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Motivo de Abertura</p>
                          <p className="mt-[4px] text-[14px] font-medium text-[#D1D1D1] break-words">
                            {ticket.opened_reason || "Nenhum motivo fornecido"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">ID do Servidor</p>
                          <p className="mt-[4px] text-[14px] font-medium text-[#D1D1D1] font-mono">{ticket.guild_id}</p>
                        </div>
                      </div>

                      <div className="space-y-[16px]">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Datas</p>
                          <p className="mt-[4px] text-[13px] text-[#A6A6A6]">
                            <span className="text-[#555] font-medium mr-1 select-none">Abertura:</span> {formatDate(ticket.opened_at)}
                          </p>
                          {ticket.closed_at && (
                            <p className="mt-[2px] text-[13px] text-[#A6A6A6]">
                              <span className="text-[#555] font-medium mr-1 select-none">Fechamento:</span> {formatDate(ticket.closed_at)}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-[16px]">
                        {ticket.closed_by && (
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Atendido por</p>
                            <p className="mt-[4px] text-[13px] font-mono text-[#D1D1D1]">{ticket.closed_by}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-[24px] pt-[20px] border-t border-[rgba(255,255,255,0.02)]">
                      {ticket.transcript_file ? (
                        <a 
                          href={ticket.transcript_file}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex items-center gap-[10px] rounded-[12px] bg-[rgba(255,255,255,0.05)] border border-[#222] px-[18px] py-[12px] text-[14px] font-bold text-white transition-all hover:bg-[rgba(255,255,255,0.08)] w-fit"
                        >
                          <FileText className="h-[18px] w-[18px] text-[#A0A0A0]" />
                          Visualizar Transcript
                        </a>
                      ) : (
                        <div className="flex items-center gap-[10px] rounded-[12px] bg-[rgba(255,255,255,0.02)] border border-dashed border-[#222] px-[18px] py-[12px] text-[14px] font-medium text-[#444] w-fit italic cursor-not-allowed">
                          Transcript não disponível
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
