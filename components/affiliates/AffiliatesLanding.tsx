"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronDown,
  DollarSign,
  Globe,
  Link2,
  QrCode,
  Sparkles,
  TrendingUp,
  Trophy,
  Webhook,
  Bell,
  Users,
} from "lucide-react";

import { AFFILIATE_LEVELS } from "@/lib/affiliates/affiliateLevels";
import type { AffiliateLevel } from "@/lib/affiliates/affiliateTypes";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { LandingSmoothScroll } from "@/components/landing/LandingSmoothScroll";

// Data

const MOCK_RANKING = [
  {
    rank: 1,
    name: "Joao S.",
    level: "diamond" as AffiliateLevel,
    sales: 87,
    commission: "R$ 12.480",
    avatarLetter: "J",
  },
  {
    rank: 2,
    name: "Marina A.",
    level: "diamond" as AffiliateLevel,
    sales: 64,
    commission: "R$ 9.216",
    avatarLetter: "M",
  },
  {
    rank: 3,
    name: "Pedro R.",
    level: "gold" as AffiliateLevel,
    sales: 41,
    commission: "R$ 5.904",
    avatarLetter: "P",
  },
];

const BENEFITS = [
  {
    icon: Link2,
    title: "Link exclusivo por plano",
    description: "Links unicos para cada plano e periodo, rastreando toda conversao sua.",
  },
  {
    icon: QrCode,
    title: "QR Code personalizado",
    description: "Gere QR Codes para divulgar offline com sua marca.",
  },
  {
    icon: Webhook,
    title: "Webhook em tempo real",
    description: "Receba notificacoes de vendas pendentes, aprovadas e canceladas.",
  },
  {
    icon: Bell,
    title: "Alertas por SMS e Email",
    description: "Nunca perca uma venda. Alertas instantaneos a cada conversao.",
  },
  {
    icon: Globe,
    title: "Templates de sites prontos",
    description: "Divulgue com seu proprio site em subdominio personalizado.",
  },
  {
    icon: Sparkles,
    title: "Analises com IA",
    description: "Insights inteligentes para otimizar sua taxa de conversao.",
  },
  {
    icon: Trophy,
    title: "Ranking com bonus",
    description: "Top 3 do mes ganham % extra de comissao e beneficios exclusivos.",
  },
  {
    icon: Users,
    title: "Grupo de afiliados",
    description: "Comunidade exclusiva no WhatsApp com treinamentos e suporte.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Cadastre-se",
    description: "Crie sua conta de afiliado gratuitamente e receba seu link exclusivo.",
    icon: Users,
  },
  {
    step: "02",
    title: "Divulgue",
    description: "Compartilhe seu link em redes sociais, sites, WhatsApp ou email.",
    icon: Globe,
  },
  {
    step: "03",
    title: "Receba",
    description: "Ganhe comissao a cada venda aprovada. Saque quando quiser via Pix.",
    icon: DollarSign,
  },
];

const PRIMARY_AFFILIATE_FAQ_ITEMS = [
  {
    question: "Como funciona o pagamento de comissoes?",
    answer:
      "Depois que a venda e aprovada, a comissao entra no seu saldo disponivel. A partir disso, voce pode solicitar saque conforme as regras do programa.",
  },
  {
    question: "Qual e o prazo para receber apos solicitar o saque?",
    answer:
      "Os saques sao processados em ate 2 dias uteis. Assim voce consegue acompanhar tudo pelo dashboard sem depender de atendimento manual.",
  },
  {
    question: "Como subo de nivel dentro do programa?",
    answer:
      "Seu nivel sobe automaticamente conforme a quantidade de vendas aprovadas no mes. Quanto maior seu volume, maior o percentual de comissao e os beneficios liberados.",
  },
  {
    question: "Posso divulgar mais de um link de afiliado?",
    answer:
      "Sim. Voce pode trabalhar com links diferentes por plano e por periodo, o que ajuda a testar campanhas, canais e tipos de publico com mais controle.",
  },
  {
    question: "O que e o ranking de afiliados?",
    answer:
      "O ranking mensal destaca quem mais vendeu no periodo. Os melhores colocados podem receber bonus extras e maior visibilidade dentro do programa.",
  },
] as const;

const EXPANDED_AFFILIATE_FAQ_ITEMS = [
  {
    question: "Quando uma venda conta como aprovada?",
    answer:
      "A venda passa a contar quando conclui a validacao do pagamento e atende as regras internas do programa. Enquanto isso, ela pode aparecer como pendente no painel.",
  },
  {
    question: "Consigo acompanhar cliques e conversoes em tempo real?",
    answer:
      "Sim. O dashboard mostra o desempenho dos seus links, ajudando voce a ver quais campanhas geram mais cliques, vendas aprovadas e comissoes.",
  },
  {
    question: "Posso anunciar em redes sociais, grupos e comunidades?",
    answer:
      "Sim, desde que a divulgacao respeite as regras da plataforma e nao utilize spam, promessas enganosas ou abordagens proibidas. O ideal e trabalhar canais com audiencia qualificada.",
  },
  {
    question: "Existe algum custo para participar do programa de afiliados?",
    answer:
      "Nao. A entrada no programa e gratuita. Voce recebe acesso ao painel, aos links e aos materiais de divulgacao sem taxa de adesao.",
  },
  {
    question: "Se o cliente cancelar, eu perco a comissao?",
    answer:
      "Em casos de cancelamento, reembolso ou fraude, a venda pode deixar de ser valida para comissao. Isso garante um controle mais justo para todo o programa.",
  },
  {
    question: "Posso usar trafego pago para divulgar?",
    answer:
      "Pode, desde que a campanha siga as diretrizes da marca e nao use termos proibidos, paginas enganosas ou promessas irreais. O ideal e alinhar bem a comunicacao da oferta.",
  },
  {
    question: "Recebo material para ajudar na divulgacao?",
    answer:
      "Sim. O programa pode disponibilizar links, referencias, direcionamentos e recursos para facilitar sua divulgacao e melhorar sua conversao ao longo do tempo.",
  },
] as const;

function LevelCard({ level }: { level: AffiliateLevel }) {
  const config = AFFILIATE_LEVELS[level];
  const isTop = level === "diamond";

  return (
    <div
      className={`relative overflow-hidden rounded-[24px] border p-[24px] transition-transform duration-300 hover:scale-[1.02] ${isTop ? "lg:scale-[1.04]" : ""}`}
      style={{
        borderColor: config.borderColor,
        background: `linear-gradient(135deg, #080808 0%, ${config.bgColor} 100%)`,
      }}
    >
      <p
        className="text-[13px] font-bold uppercase tracking-[0.05em]"
        style={{ color: config.color }}
      >
        Nivel
      </p>
      <p
        className="mt-[12px] text-[20px] font-semibold tracking-[-0.03em]"
        style={{ color: config.color }}
      >
        {config.label}
      </p>
      <p className="mt-[6px] text-[13px] leading-[1.55] text-[#6E6E6E]">
        {config.minSalesPerMonth === 0
          ? "Nivel inicial para todos"
          : `A partir de ${config.minSalesPerMonth} vendas/mes`}
      </p>
      <div
        className="mt-[20px] flex items-end gap-[4px]"
      >
        <span
          className="text-[42px] font-semibold leading-none tracking-[-0.04em]"
          style={{ color: config.color }}
        >
          {config.commissionPct}%
        </span>
        <span className="mb-[6px] text-[14px] text-[#666666]">comissao</span>
      </div>
      {config.rankBonusPct > 0 && (
        <p
          className="mt-[8px] text-[12px]"
          style={{ color: config.color }}
        >
          + ate {config.rankBonusPct}% bonus Top 3
        </p>
      )}
      <div className="mt-[20px] space-y-[8px]">
        {[
          "Painel de afiliado completo",
          "Links rastreaveis por plano",
          "QR Code personalizado",
          ...(level !== "bronze" ? ["Webhook personalizado"] : []),
          ...(level === "gold" || level === "diamond" ? ["Analises com IA"] : []),
          ...(level === "diamond" ? ["Bonus Top 3 de ranking"] : []),
        ].map((feat) => (
          <div key={feat} className="flex items-center gap-[8px]">
            <Check className="h-[14px] w-[14px] shrink-0" style={{ color: config.color }} strokeWidth={2.5} />
            <span className="text-[13px] text-[#A0A0A0]">{feat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankPodium({ entry }: { entry: typeof MOCK_RANKING[0] }) {
  const config = AFFILIATE_LEVELS[entry.level];
  const rankColors = ["#FFFFFF", "#E5E5E5", "#AFAFAF"] as const;
  const rankColor = rankColors[entry.rank - 1];

  return (
    <div
      className="relative overflow-hidden rounded-[20px] border p-[20px] text-center"
      style={{
        borderColor: `${rankColor}40`,
        background: `linear-gradient(135deg, #080808 0%, ${rankColor}0A 100%)`,
      }}
    >
      <div
        className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full text-[22px] font-bold"
        style={{ background: `${rankColor}18`, border: `1.5px solid ${rankColor}50` }}
      >
        {entry.avatarLetter}
      </div>
      <p className="mt-[10px] text-[16px] font-medium text-[#E8E8E8]">{entry.name}</p>
      <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: config.color }}>
        {config.label}
      </p>
      <div className="mt-[14px] space-y-[4px]">
        <div className="flex items-center justify-center gap-[6px] text-[13px] text-[#888]">
          <TrendingUp className="h-[13px] w-[13px]" />
          {entry.sales} vendas este mes
        </div>
        <p className="text-[18px] font-semibold" style={{ color: rankColor }}>
          {entry.commission}
        </p>
      </div>
    </div>
  );
}

function AffiliateFaqChevron({ isOpen }: { isOpen: boolean }) {
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

function AffiliateFaqItem({
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
        <AffiliateFaqChevron isOpen={isOpen} />
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

function AffiliateFaqAccordion() {
  const [openIndex, setOpenIndex] = useState(1);
  const [isExpanded, setIsExpanded] = useState(false);
  const baseDelay = 320;

  function handleToggleExpanded() {
    setIsExpanded((currentExpanded) => {
      const nextExpanded = !currentExpanded;

      if (!nextExpanded && openIndex >= PRIMARY_AFFILIATE_FAQ_ITEMS.length) {
        setOpenIndex(1);
      }

      return nextExpanded;
    });
  }

  return (
    <div className="mx-auto mt-[56px] w-full max-w-[1124px] text-left">
      {PRIMARY_AFFILIATE_FAQ_ITEMS.map((item, index) => {
        const isOpen = openIndex === index;

        return (
          <LandingReveal key={item.question} delay={baseDelay + index * 70}>
            <AffiliateFaqItem
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
            {EXPANDED_AFFILIATE_FAQ_ITEMS.map((item, index) => {
              const resolvedIndex = PRIMARY_AFFILIATE_FAQ_ITEMS.length + index;
              const isOpen = openIndex === resolvedIndex;

              return (
                <LandingReveal key={item.question} delay={120 + index * 55}>
                  <AffiliateFaqItem
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

      <LandingReveal
        delay={baseDelay + PRIMARY_AFFILIATE_FAQ_ITEMS.length * 70}
      >
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

export function AffiliatesLanding({ isAuthenticated }: { isAuthenticated: boolean }) {
  const router = useRouter();
  const statsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handleCTA() {
    if (isAuthenticated) {
      router.push("/affiliates/dashboard");
    } else {
      router.push("/login?redirect=/affiliates/dashboard&reason=affiliate");
    }
  }

  return (
    <div className="relative overflow-x-clip text-white">
      <LandingSmoothScroll />

      {/* Background Blocks Pattern */}
      <section className="w-full">
        <div className="mx-auto mt-[35px] w-full max-w-[1582px] px-[20px] md:px-6 lg:px-8 xl:px-10 2xl:px-[20px]">
          <div className="relative isolate min-h-[620px] overflow-hidden pb-8">
            <LandingReveal delay={140}>
              <div className="pointer-events-none absolute inset-x-0 top-[21%] -translate-y-1/2">
                <div className="flowdesk-landing-soft-motion relative left-1/2 aspect-[1542/492] w-[160%] max-w-none -translate-x-1/2 scale-[1.05] transform-gpu min-[861px]:w-[98%] min-[861px]:scale-100">
                  <Image
                    src="/cdn/hero-blocks-1.svg"
                    alt=""
                    fill
                    sizes="(max-width: 860px) 170vw, (max-width: 1640px) 126vw, 1772px"
                    className="pointer-events-none select-none object-contain opacity-90"
                    draggable={false}
                    priority
                  />
                </div>
              </div>
            </LandingReveal>

            <div className="relative z-10">
              <div className="mx-auto flex max-w-[980px] flex-col items-center pt-[73px] text-center">
                <LandingReveal delay={60}>
                  <div className="flex w-full justify-center">
                    <LandingGlowTag className="px-[28px]">
                      Programa de Afiliados Flowdesk
                    </LandingGlowTag>
                  </div>
                </LandingReveal>

                <LandingReveal delay={120}>
                  <h1 className="mt-[28px] max-w-[820px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[42px] leading-[1.0] font-normal tracking-[-0.05em] text-transparent md:text-[56px] lg:text-[68px]">
                    Indique e ganhe <span className="text-white">ate 35%</span> de comissao
                  </h1>
                </LandingReveal>

                <LandingReveal delay={180}>
                  <p className="mt-[22px] max-w-[580px] text-[16px] leading-[1.65] text-[#787878] md:text-[18px]">
                    Indique o Flowdesk, receba comissao em cada venda aprovada e acompanhe tudo em tempo real no seu dashboard exclusivo de afiliado.
                  </p>
                </LandingReveal>

                <LandingReveal delay={240}>
                  <div className="mt-[36px] flex flex-col items-center gap-[14px] sm:flex-row">
                    <LandingActionButton
                      onClick={handleCTA}
                      variant="light"
                      className="h-[40px] px-4 text-[14px] sm:h-[46px] sm:px-6 sm:text-[16px]"
                    >
                      <span className="inline-flex items-center gap-[8px]">
                        {isAuthenticated ? "Acessar meu dashboard" : "Quero ser afiliado"}
                        <ArrowRight className="h-[16px] w-[16px]" strokeWidth={2.2} />
                      </span>
                    </LandingActionButton>
                    <a
                      href="#como-funciona"
                      className="flex items-center gap-[6px] text-[14px] text-[#666666] transition-colors hover:text-[#A0A0A0]"
                    >
                      Como funciona
                      <ChevronDown className="h-[14px] w-[14px]" strokeWidth={1.8} />
                    </a>
                  </div>
                </LandingReveal>

                <LandingReveal delay={300}>
                  <div
                    ref={statsRef}
                    className="mt-[56px] grid w-full max-w-[1124px] grid-cols-2 gap-[1px] overflow-hidden rounded-[20px] border border-[#111111] bg-[#0C0C0C] sm:grid-cols-4"
                  >
                    {[
                      { label: "Afiliados ativos", value: "1.200+" },
                      { label: "Comissoes pagas", value: "R$ 480k+" },
                      { label: "Taxa de conversao", value: "8,4%" },
                      { label: "Saques processados", value: "3.700+" },
                    ].map((stat) => (
                      <div key={stat.label} className="flex flex-col items-center px-[24px] py-[20px]">
                        <span className="text-[22px] font-semibold tracking-[-0.04em] text-[#E5E5E5] md:text-[26px]">
                          {stat.value}
                        </span>
                        <span className="mt-[4px] text-[12px] text-[#5A5A5A]">{stat.label}</span>
                      </div>
                    ))}
                  </div>
                </LandingReveal>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="relative z-10 mx-auto max-w-[1124px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <LandingReveal>
          <div className="flex flex-col items-center text-center">
            <LandingGlowTag className="px-[24px]">Como funciona</LandingGlowTag>
            <h2 className="mt-[20px] text-[32px] font-normal leading-[1.1] tracking-[-0.045em] text-[#D0D0D0] md:text-[40px]">
              Simples do inicio ao saque
            </h2>
          </div>
        </LandingReveal>
        <div className="mt-[48px] grid gap-[20px] sm:grid-cols-3">
          {HOW_IT_WORKS.map((step, i) => {
            const Icon = step.icon;
            return (
              <LandingReveal key={step.step} delay={i * 80}>
                <div className="relative overflow-hidden rounded-[24px] border border-[#111111] bg-[#080808] p-[28px]">
                  <span className="absolute top-[20px] right-[20px] text-[42px] font-bold tracking-[-0.05em] text-[#111111]">
                    {step.step}
                  </span>
                  <div className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#D8D8D8]">
                    <Icon className="h-[20px] w-[20px]" strokeWidth={1.8} />
                  </div>
                  <h3 className="mt-[16px] text-[18px] font-medium text-[#E0E0E0]">{step.title}</h3>
                  <p className="mt-[8px] text-[14px] leading-[1.65] text-[#707070]">{step.description}</p>
                </div>
              </LandingReveal>
            );
          })}
        </div>
      </section>

      {/* Niveis e comissoes */}
      <section className="relative z-10 mx-auto max-w-[1320px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <LandingReveal>
          <div className="flex flex-col items-center text-center">
            <LandingGlowTag className="px-[24px]">Niveis de afiliado</LandingGlowTag>
            <h2 className="mt-[20px] text-[32px] font-normal leading-[1.1] tracking-[-0.045em] text-[#D0D0D0] md:text-[40px]">
              Quanto mais voce vende, mais voce ganha
            </h2>
            <p className="mt-[14px] max-w-[560px] text-[15px] leading-[1.65] text-[#6A6A6A]">
              Seus niveis sobem automaticamente conforme suas vendas mensais aumentam. Suba de Bronze a Diamante e maximize seus ganhos.
            </p>
          </div>
        </LandingReveal>
        <div className="mt-[48px] grid gap-[16px] sm:grid-cols-2 lg:grid-cols-4">
          {(["bronze", "silver", "gold", "diamond"] as AffiliateLevel[]).map((level, i) => (
            <LandingReveal key={level} delay={i * 70}>
              <LevelCard level={level} />
            </LandingReveal>
          ))}
        </div>
      </section>

      {/* Ranking ao vivo */}
      <section className="relative z-10 mx-auto max-w-[1124px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <LandingReveal>
          <div className="flex flex-col items-center text-center">
            <LandingGlowTag className="px-[24px]">Ranking do mes</LandingGlowTag>
            <h2 className="mt-[20px] text-[32px] font-normal leading-[1.1] tracking-[-0.045em] text-[#D0D0D0] md:text-[40px]">
              Top 3 afiliados com bonus especiais
            </h2>
            <p className="mt-[14px] max-w-[560px] text-[15px] leading-[1.65] text-[#6A6A6A]">
              Todo mes rankeamos afiliados por volume de vendas. O Top 3 recebe % de bonus extra na comissao do mes seguinte.
            </p>
          </div>
        </LandingReveal>
        <div className="mt-[48px] grid gap-[16px] sm:grid-cols-3">
          {MOCK_RANKING.map((entry, i) => (
            <LandingReveal key={entry.rank} delay={i * 80}>
              <RankPodium entry={entry} />
            </LandingReveal>
          ))}
        </div>
      </section>

      {/* Beneficios */}
      <section className="relative z-10 mx-auto max-w-[1320px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <LandingReveal>
          <div className="flex flex-col items-center text-center">
            <LandingGlowTag className="px-[24px]">Ferramentas incluidas</LandingGlowTag>
            <h2 className="mt-[20px] text-[32px] font-normal leading-[1.1] tracking-[-0.045em] text-[#D0D0D0] md:text-[40px]">
              Tudo que voce precisa para vender mais
            </h2>
          </div>
        </LandingReveal>
        <div className="mt-[48px] grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((benefit, i) => {
            const Icon = benefit.icon;
            return (
              <LandingReveal key={benefit.title} delay={Math.min(i * 45, 280)}>
                <div className="group rounded-[20px] border border-[#0E0E0E] bg-[#080808] p-[20px] transition-all duration-300 hover:-translate-y-1 hover:border-[#1A1A1A] hover:bg-[#0A0A0A]">
                  <div className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border border-[#151515] bg-[#0C0C0C] text-[#ADADAD] transition-colors group-hover:text-white">
                    <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} />
                  </div>
                  <h3 className="mt-[14px] text-[14px] font-semibold text-[#D8D8D8] transition-colors group-hover:text-white">{benefit.title}</h3>
                  <p className="mt-[6px] text-[13px] leading-[1.6] text-[#646464] transition-colors group-hover:text-[#888]">{benefit.description}</p>
                </div>
              </LandingReveal>
            );
          })}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative z-10 mx-auto max-w-[1320px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <div className="flex flex-col items-center text-center">
          <LandingReveal>
            <div className="flex w-full justify-center">
              <LandingGlowTag>Saiba mais sobre o programa de afiliados</LandingGlowTag>
            </div>
          </LandingReveal>

          <LandingReveal delay={80}>
            <h2 className="mt-[20px] max-w-[1280px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.08] font-normal tracking-[-0.04em] text-transparent sm:text-[40px] md:text-[52px] lg:text-[50px]">
              Duvidas frequentes para afiliados
            </h2>
          </LandingReveal>

          <LandingReveal delay={160}>
            <p className="mt-[20px] max-w-[1280px] text-[14px] leading-[1.42] font-normal text-[#B7B7B7] md:text-[17px]">
              <span className="block">
                Entenda como funcionam links, niveis, comissoes, aprovacoes e saques dentro do programa de afiliados.
              </span>
              <span className="mt-[4px] block">
                Se precisar, voce ainda pode falar com a equipe para melhorar sua divulgacao e acompanhar seus resultados.
              </span>
            </p>
          </LandingReveal>

          <LandingReveal delay={240}>
            <LandingActionButton
              onClick={handleCTA}
              variant="light"
              className="mt-[28px] h-[46px] rounded-[12px] px-6 text-[16px]"
            >
              {isAuthenticated ? "Acessar meu dashboard" : "Quero ser afiliado"}
            </LandingActionButton>
          </LandingReveal>

          <LandingReveal delay={320}>
            <AffiliateFaqAccordion />
          </LandingReveal>
        </div>
      </section>

      {/* CTA final */}
      <section className="relative z-10 mx-auto max-w-[1124px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <LandingReveal>
          <div className="relative overflow-hidden rounded-[32px] border border-[#1A1A1A] bg-[#070707] px-[40px] py-[80px] text-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.035)_0%,transparent_70%)]"
            />

            <div className="relative z-10 mx-auto mb-10 h-[42px] w-[180px]">
              <Image 
                src="/cdn/logos/logo.png" 
                alt="Flowdesk" 
                fill 
                sizes="180px"
                className="object-contain"
                priority
              />
            </div>

            <h2 className="relative z-10 mt-[20px] text-[32px] font-normal leading-[1.1] tracking-[-0.045em] text-[#D0D0D0] md:text-[40px]">
              Comece a ganhar hoje mesmo
            </h2>
            <p className="relative z-10 mt-[16px] max-w-[480px] mx-auto text-[15px] leading-[1.65] text-[#6A6A6A]">
              Cadastre-se gratuitamente e comece a divulgar seu link em minutos. Sem burocracia e com a infraestrutura oficial Flowdesk.
            </p>
            <LandingActionButton
              onClick={handleCTA}
              variant="light"
              className="relative z-10 mt-[40px] h-[40px] px-4 text-[14px] sm:h-[46px] sm:px-6 sm:text-[16px]"
            >
              <span className="inline-flex items-center gap-[8px]">
                {isAuthenticated ? "Acessar meu dashboard" : "Quero ser um afiliado"}
                <ArrowRight className="h-[16px] w-[16px]" strokeWidth={2.2} />
              </span>
            </LandingActionButton>
            <p className="relative z-10 mt-[20px] text-[12px] text-[#484848]">
              Adesao Gratuita - Sem Fidelidade - Saques via Pix
            </p>
          </div>
        </LandingReveal>
      </section>
    </div>
  );
}
