"use client";

import { LifeBuoy } from "lucide-react";

export function TicketsTab() {
  return (
    <div className="flex flex-col items-center justify-center rounded-[18px] border border-[#141414] bg-[#090909] py-[48px] px-[20px] text-center">
      <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#111111]">
        <LifeBuoy className="text-[#888888] h-[26px] w-[26px]" />
      </div>
      <p className="mt-[16px] text-[16px] font-semibold text-[#E5E5E5]">Tickets de Suporte</p>
      <p className="mt-[6px] max-w-[360px] text-[14px] text-[#777777]">
        Sistema de tickets em breve. Você poderá abrir chamados e acompanhar o histórico de atendimentos aqui.
      </p>
    </div>
  );
}
