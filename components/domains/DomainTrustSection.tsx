"use client";

import { ShieldCheck, Zap, Globe, Lock, Headset, CreditCard } from "lucide-react";
import { LandingReveal } from "@/components/landing/LandingReveal";

const TRUST_FEATURES = [
  {
    icon: ShieldCheck,
    title: "Privacidade WHOIS Grátis",
    description: "Esconda seus dados pessoais de bancos de dados públicos para evitar spam e tentativas de phishing.",
    color: "text-[#4ADE80]"
  },
  {
    icon: Lock,
    title: "Segurança Avançada",
    description: "Proteção contra transferências não autorizadas e bloqueio de domínio para sua maior tranquilidade.",
    color: "text-[#0062FF]"
  },
  {
    icon: Globe,
    title: "Gestão DNS Profissional",
    description: "Controle total da sua zona DNS com propagação global ultra-rápida e interface intuitiva.",
    color: "text-[#7d66ff]"
  },
  {
    icon: Headset,
    title: "Suporte Especializado 24/7",
    description: "Time técnico pronto para ajudar você com qualquer configuração ou dúvida técnica.",
    color: "text-[#FACC15]"
  }
];

export function DomainTrustSection() {
  return (
    <div className="mt-32 w-full space-y-20">
      {/* Features Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {TRUST_FEATURES.map((feature, i) => (
          <LandingReveal key={i} delay={100 + i * 100}>
            <div className="group relative rounded-[28px] border border-[#141414] bg-[#0A0A0A] p-8 transition-all hover:border-[#222] hover:bg-[#0D0D0D]">
              <div className={`mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#111] transition-transform group-hover:scale-110 ${feature.color}`}>
                <feature.icon className="h-6 w-6" />
              </div>
              <h3 className="mb-3 text-[18px] font-bold text-white">{feature.title}</h3>
              <p className="text-[14px] leading-relaxed text-[#666]">{feature.description}</p>
            </div>
          </LandingReveal>
        ))}
      </div>

      {/* Security & Payment Banner */}
      <LandingReveal delay={600}>
        <div className="rounded-[32px] border border-[#141414] bg-[linear-gradient(180deg,#0A0A0A_0%,#050505_100%)] p-10">
          <div className="flex flex-col items-center justify-between gap-12 lg:flex-row">
            <div className="space-y-2 text-center lg:text-left">
              <h4 className="text-[15px] font-bold uppercase tracking-widest text-[#444]">Registro Seguro e Certificado</h4>
              <div className="flex flex-wrap justify-center gap-8 lg:justify-start">
                 <div className="flex items-center gap-2 text-[14px] font-bold text-[#888]">
                    <ShieldCheck className="h-5 w-5 text-[#4ADE80]" />
                    ICANN REGISTRAR COMPLIANT
                 </div>
                 <div className="flex items-center gap-2 text-[14px] font-bold text-[#888]">
                    <Lock className="h-5 w-5 text-[#0062FF]" />
                    SSL SECURE CHECKOUT
                 </div>
              </div>
            </div>

            <div className="h-px w-full bg-[#141414] lg:h-12 lg:w-px" />

            <div className="space-y-4 text-center lg:text-right">
              <p className="text-[13px] font-medium text-[#444]">Aceitamos os principais métodos de pagamento</p>
              <div className="flex flex-wrap justify-center gap-6 opacity-40 grayscale transition-all hover:opacity-80 hover:grayscale-0 lg:justify-end">
                 {/* Styled placeholder for payment logos */}
                 <div className="flex items-center gap-2 font-black text-white italic tracking-tighter text-[20px]">PIX</div>
                 <div className="flex items-center gap-2 font-black text-white italic tracking-tighter text-[20px]">VISA</div>
                 <div className="flex items-center gap-2 font-black text-white italic tracking-tighter text-[20px]">MASTERCARD</div>
                 <div className="flex items-center gap-2 font-black text-white italic tracking-tighter text-[20px]">STRIPE</div>
              </div>
            </div>
          </div>
        </div>
      </LandingReveal>
    </div>
  );
}
