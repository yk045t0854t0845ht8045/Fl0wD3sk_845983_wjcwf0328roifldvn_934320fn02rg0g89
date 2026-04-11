import { useEffect, useState } from "react";
import { LifeBuoy, CheckCircle2, AlertCircle } from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";

export function SupportTicketsTab() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTickets() {
      try {
        const res = await fetch("/api/auth/me/support-tickets");
        const json = await res.json();
        if (json.ok) {
          setTickets(json.tickets || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadTickets();
  }, []);

  if (loading) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <ButtonLoader size={24} />
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="mt-[32px] flex flex-col items-center justify-center rounded-[18px] border border-[#141414] bg-[#090909] py-[40px] px-[20px] text-center">
        <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#111111]">
          <LifeBuoy className="text-[#888888] h-[24px] w-[24px]" />
        </div>
        <p className="mt-[16px] text-[15px] font-medium text-[#E5E5E5]">Nenhum ticket encontrado</p>
        <p className="mt-[4px] text-[14px] text-[#777777]">Você não possui histórico de tickets abertos.</p>
      </div>
    );
  }

  return (
    <div className="mt-[32px] space-y-[12px]">
      {tickets.map((ticket) => {
        const isOpen = ticket.status === "open";
        return (
          <div key={ticket.id} className="flex items-center justify-between rounded-[16px] border border-[#131313] bg-[#0A0A0A] p-[16px] transition hover:border-[#222222]">
             <div className="flex items-center gap-[16px]">
               <div className={`flex h-[40px] w-[40px] items-center justify-center rounded-full ${isOpen ? "bg-[rgba(242,200,35,0.1)] text-[#F2C823]" : "bg-[rgba(5,130,50,0.1)] text-[#34A853]"}`}>
                 {isOpen ? <AlertCircle className="h-[20px] w-[20px]" /> : <CheckCircle2 className="h-[20px] w-[20px]" />}
               </div>
               <div>
                  <p className="text-[15px] font-semibold text-[#EEEEEE]">
                    Protocolo #{ticket.protocol}
                  </p>
                  <p className="text-[13px] text-[#747474]">
                    Aberto em {new Date(ticket.opened_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
               </div>
             </div>
             <div className="text-right">
                <div className="mt-[4px] flex items-center gap-[6px] justify-end">
                   <span className="text-[12px] font-medium uppercase tracking-wide text-[#777777]">Servidor {ticket.guild_id}</span>
                   <span className="h-[4px] w-[4px] rounded-full bg-[#333333]"></span>
                   <span className={`text-[12px] font-medium ${isOpen ? 'text-[#F2C823]' : 'text-[#34A853]'}`}>
                      {isOpen ? "Aberto" : "Fechado"}
                   </span>
                </div>
             </div>
          </div>
        );
      })}
    </div>
  );
}
