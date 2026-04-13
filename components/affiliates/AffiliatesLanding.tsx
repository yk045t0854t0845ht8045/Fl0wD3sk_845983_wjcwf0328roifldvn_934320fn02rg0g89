"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  DollarSign,
  ExternalLink,
  Globe,
  Link2,
  Medal,
  MousePointerClick,
  QrCode,
  Sparkles,
  TrendingUp,
  Trophy,
  Webhook,
  Zap,
  Bell,
  MessageSquare,
  BarChart3,
  Users,
  Star,
} from "lucide-react";

import { AFFILIATE_LEVELS } from "@/lib/affiliates/affiliateLevels";
import type { AffiliateLevel } from "@/lib/affiliates/affiliateTypes";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { LandingSmoothScroll } from "@/components/landing/LandingSmoothScroll";
import { motion, AnimatePresence } from "framer-motion";

// ─── Data ────────────────────────────────────────────────────────────────────

const MOCK_RANKING = [
  {
    rank: 1,
    name: "João S.",
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
    description: "Links únicos para cada plano e período, rastreando toda conversão sua.",
  },
  {
    icon: QrCode,
    title: "QR Code personalizado",
    description: "Gere QR Codes para divulgar offline com sua marca.",
  },
  {
    icon: Webhook,
    title: "Webhook em tempo real",
    description: "Receba notificações de vendas pendentes, aprovadas e canceladas.",
  },
  {
    icon: Bell,
    title: "Alertas por SMS e Email",
    description: "Nunca perca uma venda. Alertas instantâneos a cada conversão.",
  },
  {
    icon: Globe,
    title: "Templates de sites prontos",
    description: "Divulgue com seu próprio site em subdomínio personalizado.",
  },
  {
    icon: Sparkles,
    title: "Análises com IA",
    description: "Insights inteligentes para otimizar sua taxa de conversão.",
  },
  {
    icon: Trophy,
    title: "Ranking com bônus",
    description: "Top 3 do mês ganham % extra de comissão e benefícios exclusivos.",
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
    description: "Ganhe comissão a cada venda aprovada. Saque quando quiser via Pix.",
    icon: DollarSign,
  },
];

const FAQS = [
  {
    q: "Como funciona o pagamento de comissões?",
    a: "Após a aprovação de cada venda, sua comissão é creditada no saldo disponível. Você pode solicitar saque a qualquer momento via Pix.",
  },
  {
    q: "Qual é o prazo para receber após solicitar saque?",
    a: "Processamos saques em até 2 dias úteis após a solicitação.",
  },
  {
    q: "Como subo de nível?",
    a: "Seu nível sobe automaticamente conforme você acumula vendas aprovadas no mês. Bronze (0+), Prata (5+), Ouro (20+) e Diamante (50+ vendas/mês).",
  },
  {
    q: "Posso ter mais de um link?",
    a: "Sim! Você tem links específicos por plano (Basic, Pro, Enterprise) e por período (mensal/anual), totalizando 6 links rastreáveis.",
  },
  {
    q: "O que é o ranking de afiliados?",
    a: "Todo mês rankeamos os afiliados por volume de vendas. O Top 3 recebe bônus extra na comissão e benefícios exclusivos.",
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

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
        Nível
      </p>
      <p
        className="mt-[12px] text-[20px] font-semibold tracking-[-0.03em]"
        style={{ color: config.color }}
      >
        {config.label}
      </p>
      <p className="mt-[6px] text-[13px] leading-[1.55] text-[#6E6E6E]">
        {config.minSalesPerMonth === 0
          ? "Nível inicial para todos"
          : `A partir de ${config.minSalesPerMonth} vendas/mês`}
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
        <span className="mb-[6px] text-[14px] text-[#666666]">comissão</span>
      </div>
      {config.rankBonusPct > 0 && (
        <p
          className="mt-[8px] text-[12px]"
          style={{ color: config.color }}
        >
          + até {config.rankBonusPct}% bônus Top 3
        </p>
      )}
      <div className="mt-[20px] space-y-[8px]">
        {[
          "Painel de afiliado completo",
          "Links rastreáveis por plano",
          "QR Code personalizado",
          ...(level !== "bronze" ? ["Webhook personalizado"] : []),
          ...(level === "gold" || level === "diamond" ? ["Análises com IA"] : []),
          ...(level === "diamond" ? ["Bônus Top 3 de ranking"] : []),
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
  const rankIcons = [Star, Star, Star];
  const RankIcon = rankIcons[entry.rank - 1];

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
          {entry.sales} vendas este mês
        </div>
        <p className="text-[18px] font-semibold" style={{ color: rankColor }}>
          {entry.commission}
        </p>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[#111111]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-[16px] py-[22px] text-left transition-colors hover:text-white"
      >
        <span className="text-[16px] font-medium text-[#D8D8D8] md:text-[17px]">{q}</span>
        <ChevronDown
          className={`h-[18px] w-[18px] shrink-0 text-[#444] transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <p className="pb-[22px] text-[15px] leading-[1.7] text-[#787878] md:text-[16px]">
              {a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AffiliatesLanding({ isAuthenticated }: { isAuthenticated: boolean }) {
  const router = useRouter();
  const [statsAnimated, setStatsAnimated] = useState(false);
  const statsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStatsAnimated(true);
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
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <LandingSmoothScroll />
      {/* Background surface */}
      <div className="absolute inset-0 bg-[#040404]" />

      {/* ───── Hero ───────────────────────────────────────────────── */}
      <section className="relative mx-auto flex max-w-[1220px] flex-col items-center px-[20px] pt-[120px] pb-[80px] text-center md:px-6 lg:px-8">
        <LandingReveal delay={60}>
          <LandingGlowTag className="px-[28px]">
            Programa de Afiliados Flowdesk
          </LandingGlowTag>
        </LandingReveal>

        <LandingReveal delay={120}>
          <h1 className="mt-[28px] max-w-[820px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[42px] leading-[1.0] font-normal tracking-[-0.05em] text-transparent md:text-[56px] lg:text-[68px]">
            Indique e ganhe{" "}
            <span className="text-white">
              até 35%
            </span>{" "}
            de comissão
          </h1>
        </LandingReveal>

        <LandingReveal delay={180}>
          <p className="mt-[22px] max-w-[580px] text-[16px] leading-[1.65] text-[#787878] md:text-[18px]">
            Indique o Flowdesk, receba comissão em cada venda aprovada e acompanhe tudo em tempo real no seu dashboard exclusivo de afiliado.
          </p>
        </LandingReveal>

        <LandingReveal delay={240}>
          <div className="mt-[36px] flex flex-col items-center gap-[14px] sm:flex-row">
            <button
              type="button"
              onClick={handleCTA}
              className="group relative inline-flex h-[52px] items-center justify-center overflow-visible whitespace-nowrap rounded-[16px] px-8 text-[15px] font-semibold"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-[16px] bg-[#F3F3F3] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
              />
              <span className="relative z-10 flex items-center gap-[8px] text-[#111111]">
                {isAuthenticated ? "Acessar meu dashboard" : "Quero ser afiliado"}
                <ArrowRight className="h-[16px] w-[16px]" strokeWidth={2.2} />
              </span>
            </button>
            <a
              href="#como-funciona"
              className="flex items-center gap-[6px] text-[14px] text-[#666666] transition-colors hover:text-[#A0A0A0]"
            >
              Como funciona
              <ChevronDown className="h-[14px] w-[14px]" strokeWidth={1.8} />
            </a>
          </div>
        </LandingReveal>

        {/* Stats bar */}
        <LandingReveal delay={300}>
          <div
            ref={statsRef}
            className="mt-[56px] grid grid-cols-2 gap-[1px] overflow-hidden rounded-[20px] border border-[#111111] bg-[#0C0C0C] sm:grid-cols-4"
          >
            {[
              { label: "Afiliados ativos", value: "1.200+" },
              { label: "Comissões pagas", value: "R$ 480k+" },
              { label: "Taxa de conversão", value: "8,4%" },
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
      </section>

      {/* ───── Como funciona ─────────────────────────────────────── */}
      <section id="como-funciona" className="relative z-10 mx-auto max-w-[1220px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <LandingReveal>
          <div className="text-left">
            <LandingGlowTag className="px-[24px]">Como funciona</LandingGlowTag>
            <h2 className="mt-[20px] text-[32px] font-normal leading-[1.1] tracking-[-0.045em] text-[#D0D0D0] md:text-[40px]">
              Simples do início ao saque
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

      {/* ───── Níveis e Comissões ─────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-[1220px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <LandingReveal>
          <div className="text-left">
            <LandingGlowTag className="px-[24px]">Níveis de afiliado</LandingGlowTag>
            <h2 className="mt-[20px] text-[32px] font-normal leading-[1.1] tracking-[-0.045em] text-[#D0D0D0] md:text-[40px]">
              Quanto mais você vende, mais você ganha
            </h2>
            <p className="mt-[14px] max-w-[560px] text-[15px] leading-[1.65] text-[#6A6A6A]">
              Seus níveis sobem automaticamente conforme suas vendas mensais aumentam. Suba de Bronze a Diamante e maximize seus ganhos.
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

      {/* ───── Ranking ao vivo ────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-[1220px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <LandingReveal>
          <div className="text-left">
            <LandingGlowTag className="px-[24px]">Ranking do mês</LandingGlowTag>
            <h2 className="mt-[20px] text-[32px] font-normal leading-[1.1] tracking-[-0.045em] text-[#D0D0D0] md:text-[40px]">
              Top 3 afiliados com bônus especiais
            </h2>
            <p className="mt-[14px] max-w-[560px] text-[15px] leading-[1.65] text-[#6A6A6A]">
              Todo mês rankeamos afiliados por vendasocorrido. O Top 3 recebe % de bônus extra na comissão do mês seguinte.
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

      {/* ───── Benefícios ─────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-[1220px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <LandingReveal>
          <div className="text-left">
            <LandingGlowTag className="px-[24px]">Ferramentas incluídas</LandingGlowTag>
            <h2 className="mt-[20px] text-[32px] font-normal leading-[1.1] tracking-[-0.045em] text-[#D0D0D0] md:text-[40px]">
              Tudo que você precisa para vender mais
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

      {/* ───── FAQ ────────────────────────────────────────────────── */}
      <section id="faq" className="relative z-10 mx-auto max-w-[1220px] px-[20px] py-[80px] md:px-6 lg:px-8">
        <LandingReveal>
          <div className="text-left">
            <LandingGlowTag className="px-[24px]">Perguntas frequentes</LandingGlowTag>
            <h2 className="mt-[20px] text-[32px] font-normal leading-[1.1] tracking-[-0.045em] text-[#D0D0D0] md:text-[40px]">
              Ficou com dúvidas?
            </h2>
          </div>
        </LandingReveal>
        <div className="mt-[40px] flex flex-col w-full">
          {FAQS.map((faq) => (
            <FaqItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
      </section>
      {/* ───── CTA Final ──────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-[1220px] px-[20px] py-[80px] md:px-6 lg:px-8">
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
            <button
              type="button"
              onClick={handleCTA}
              className="group relative z-10 mt-[40px] inline-flex h-[52px] items-center justify-center overflow-visible whitespace-nowrap rounded-[16px] px-10 text-[15px] font-semibold"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-[16px] bg-[#F3F3F3] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
              />
              <span className="relative z-10 flex items-center gap-[8px] text-[#111111]">
                {isAuthenticated ? "Acessar meu dashboard" : "Quero ser um afiliado"}
                <ArrowRight className="h-[16px] w-[16px]" strokeWidth={2.2} />
              </span>
            </button>
            <p className="relative z-10 mt-[20px] text-[12px] text-[#484848]">
              Adesão Gratuita • Sem Fidelidade • Saques via Pix
            </p>
          </div>
        </LandingReveal>
      </section>
    </div>
  );
}
