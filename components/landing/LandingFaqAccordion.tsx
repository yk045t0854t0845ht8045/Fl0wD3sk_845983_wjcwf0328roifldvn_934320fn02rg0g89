"use client";

import { useState, type CSSProperties } from "react";
import { LandingReveal } from "@/components/landing/LandingReveal";

const PRIMARY_FAQ_ITEMS = [
  {
    question: "Como funciona a integracao com o Discord?",
    answer:
      "A integracao e feita de forma simples e rapida. Basta adicionar o bot ao seu servidor e configurar os primeiros fluxos pelo painel. Em poucos minutos, voce ja pode comecar a automatizar atendimentos, organizar tickets e estruturar sua operacao.",
  },
  {
    question: "Preciso saber programar para usar o sistema?",
    answer:
      "Nao. A plataforma foi pensada para ser totalmente acessivel, permitindo que voce configure automacoes, tickets e pagamentos sem conhecimento tecnico. Tudo e feito por meio de uma interface intuitiva.",
  },
  {
    question: "E possivel automatizar atendimentos e respostas?",
    answer:
      "Sim. Voce pode criar fluxos automatizados que respondem usuarios, organizam tickets e executam acoes automaticamente, reduzindo trabalho manual e aumentando a eficiencia do atendimento.",
  },
  {
    question: "Como funcionam os pagamentos dentro do sistema?",
    answer:
      "O sistema permite integrar metodos de pagamento diretamente ao seu fluxo. Apos a confirmacao, acoes como liberacao de cargos ou acesso podem ser executadas automaticamente, sem intervencao manual.",
  },
  {
    question: "Posso usar em mais de um servidor?",
    answer:
      "Sim. A quantidade de servidores depende do plano escolhido. Voce pode gerenciar multiplos servidores em um unico painel, mantendo tudo centralizado e organizado.",
  },
] as const;

const EXPANDED_FAQ_ITEMS = [
  {
    question: "O sistema e confiavel para uso continuo?",
    answer:
      "A plataforma e projetada para alta disponibilidade, garantindo que sua operacao funcione de forma estavel e consistente, mesmo com crescimento do volume de usuarios e atendimentos.",
  },
  {
    question: "Posso mudar de plano depois?",
    answer:
      "Sim. Voce pode fazer upgrade ou downgrade a qualquer momento. O sistema se adapta automaticamente, permitindo que sua estrutura acompanhe o crescimento da sua operacao.",
  },
  {
    question: "O sistema impacta o desempenho do meu servidor?",
    answer:
      "Nao. A arquitetura foi pensada para operar de forma otimizada, garantindo que as automacoes, tickets e integracoes funcionem sem afetar a performance do seu servidor Discord.",
  },
  {
    question: "E possivel personalizar mensagens e embeds?",
    answer:
      "Sim. Voce pode personalizar totalmente mensagens, embeds, cores e estrutura de comunicacao, mantendo a identidade do seu servidor e criando uma experiencia consistente para os usuarios.",
  },
  {
    question: "Como funciona o suporte em caso de problemas?",
    answer:
      "O suporte varia conforme o plano, mas todos os usuarios tem acesso a assistencia para configuracao e resolucao de duvidas. Planos mais avancados contam com prioridade no atendimento.",
  },
  {
    question: "Existe limite de uso no sistema?",
    answer:
      "Sim, os limites variam de acordo com o plano escolhido, incluindo quantidade de servidores, automacoes e volume de uso. Planos mais avancados oferecem maior capacidade e recursos ilimitados.",
  },
  {
    question: "Quanto tempo leva para configurar tudo?",
    answer:
      "A configuracao inicial pode ser feita em poucos minutos. Em geral, voce ja consegue ter um sistema funcional rapidamente e evoluir aos poucos conforme sua necessidade.",
  },
] as const;

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

function FaqItem({
  question,
  answer,
  isOpen,
  onToggle,
  className = "",
  style,
  "data-flowdesk-visible": dataFlowdeskVisible,
}: {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
  "data-flowdesk-visible"?: "true" | "false";
}) {
  return (
    <div
      className={`border-b border-[rgba(255,255,255,0.03)] ${className}`.trim()}
      style={style}
      data-flowdesk-visible={dataFlowdeskVisible}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-[20px] py-[28px] text-left transition-opacity duration-200 hover:opacity-100"
        aria-expanded={isOpen}
      >
        <span
          className={`pr-[12px] text-[16px] leading-[1.2] font-normal transition-colors duration-300 md:text-[18px] ${
            isOpen
              ? "text-[rgba(218,218,218,0.96)]"
              : "text-[rgba(183,183,183,0.8)]"
          }`}
        >
          {question}
        </span>
        <ChevronIcon isOpen={isOpen} />
      </button>

      <div
        className={`grid overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <p className="max-w-[960px] pb-[28px] pr-[44px] text-[14px] leading-[1.38] font-normal text-[rgba(183,183,183,0.7)] md:text-[16px]">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}

export function LandingFaqAccordion() {
  const [openIndex, setOpenIndex] = useState(1);
  const [isExpanded, setIsExpanded] = useState(false);
  const baseDelay = 2660;

  function handleToggleExpanded() {
    setIsExpanded((currentExpanded) => {
      const nextExpanded = !currentExpanded;

      if (!nextExpanded && openIndex >= PRIMARY_FAQ_ITEMS.length) {
        setOpenIndex(1);
      }

      return nextExpanded;
    });
  }

  return (
    <div className="mx-auto mt-[56px] w-full max-w-[1124px] text-left">
      {PRIMARY_FAQ_ITEMS.map((item, index) => {
        const isOpen = openIndex === index;

        return (
          <LandingReveal key={item.question} delay={baseDelay + index * 70}>
            <FaqItem
              question={item.question}
              answer={item.answer}
              isOpen={isOpen}
              onToggle={() =>
                setOpenIndex((currentIndex) =>
                  currentIndex === index ? -1 : index,
                )
              }
            />
          </LandingReveal>
        );
      })}

      <div
        className={`grid overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isExpanded
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div
            className={`transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isExpanded
                ? "translate-y-0 opacity-100"
                : "-translate-y-[14px] opacity-0"
            }`}
          >
            {EXPANDED_FAQ_ITEMS.map((item, index) => {
              const resolvedIndex = PRIMARY_FAQ_ITEMS.length + index;
              const isOpen = openIndex === resolvedIndex;

              return (
                <LandingReveal
                  key={item.question}
                  delay={120 + index * 55}
                >
                  <FaqItem
                    question={item.question}
                    answer={item.answer}
                    isOpen={isOpen}
                    onToggle={() =>
                      setOpenIndex((currentIndex) =>
                        currentIndex === resolvedIndex ? -1 : resolvedIndex,
                      )
                    }
                  />
                </LandingReveal>
              );
            })}
          </div>
        </div>
      </div>

      <LandingReveal delay={baseDelay + PRIMARY_FAQ_ITEMS.length * 70}>
        <div className="flex justify-center pt-[28px]">
          <button
            type="button"
            onClick={handleToggleExpanded}
            className={`inline-flex h-[46px] items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[16px] leading-none font-semibold transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isExpanded
                ? "bg-[#111111] text-[#B7B7B7]"
                : "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] text-[#282828]"
            }`}
          >
            {isExpanded ? "Ver menos" : "Ver mais"}
          </button>
        </div>
      </LandingReveal>
    </div>
  );
}
