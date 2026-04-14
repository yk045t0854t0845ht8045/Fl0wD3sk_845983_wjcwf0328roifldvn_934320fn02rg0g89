"use client";

import { useState } from "react";
import { LandingReveal } from "@/components/landing/LandingReveal";

const DOMAIN_FAQ = [
  {
    question: "Quanto tempo leva para meu domínio ser ativado?",
    answer: "A ativação é quase instantânea após a confirmação do pagamento. No entanto, a propagação total do DNS pode levar de 1 a 24 horas em alguns casos raros."
  },
  {
    question: "O que é privacidade WHOIS e por que preciso dela?",
    answer: "WHOIS é um banco de dados público que lista os dados do dono do domínio. Nossa proteção oculta seu nome, e-mail e telefone desses registros, protegendo você contra spam e assédio."
  },
  {
    question: "Posso transferir um domínio que já possuo para o Flowdesk?",
    answer: "Com certeza! Você precisará apenas do código de autorização (EPP Code) do seu provedor atual. O processo geralmente leva de 5 a 7 dias úteis."
  },
  {
    question: "Como configuro meu domínio no meu bot de Discord?",
    answer: "Oferecemos um painel de DNS simples onde você pode apontar registros A, CNAME ou TXT necessários para verificar seu domínio em qualquer serviço de automação ou hospedagem."
  },
  {
    question: "O que acontece se eu esquecer de renovar meu domínio?",
    answer: "Enviaremos múltiplos lembretes antes do vencimento. Se expirar, há um período de carência (Grace Period) onde você ainda pode renovar sem custos extras antes que ele entre em redenção."
  }
];

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`h-[22px] w-[22px] shrink-0 text-[rgba(218,218,218,0.7)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isOpen ? "rotate-180" : "rotate-0"
      }`}
      fill="none"
    >
      <path
        d="M6.5 9.5L12 15L17.5 9.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DomainFaq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="mx-auto mt-32 w-full max-w-[1124px] pb-20">
      <LandingReveal delay={200}>
        <div className="mb-16 text-center">
            <h2 className="text-[32px] font-bold text-white md:text-[40px]">Dúvidas Frequentes</h2>
            <p className="mt-4 text-[#666]">Tudo o que você precisa saber para começar sua jornada online.</p>
        </div>
      </LandingReveal>

      <div className="divide-y divide-[rgba(255,255,255,0.03)] border-t border-[rgba(255,255,255,0.03)]">
        {DOMAIN_FAQ.map((item, index) => {
          const isOpen = openIndex === index;
          return (
            <div key={index} className="group overflow-hidden">
              <button
                onClick={() => setOpenIndex(isOpen ? null : index)}
                className="flex w-full items-center justify-between py-8 text-left transition-all"
              >
                <span className={`text-[17px] font-medium transition-colors duration-300 md:text-[19px] ${isOpen ? "text-white" : "text-[#888] group-hover:text-[#AAA]"}`}>
                  {item.question}
                </span>
                <ChevronIcon isOpen={isOpen} />
              </button>
              
              <div
                className={`grid transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <p className="pb-8 pr-12 text-[15px] leading-relaxed text-[#666] md:text-[16px]">
                    {item.answer}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
