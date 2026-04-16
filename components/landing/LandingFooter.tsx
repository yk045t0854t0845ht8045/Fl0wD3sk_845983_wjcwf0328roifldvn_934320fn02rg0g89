"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { LandingReveal } from "@/components/landing/LandingReveal";

type FooterLinkItem = {
  label: string;
  href: string;
};

type FooterGroup = {
  title: string;
  links: FooterLinkItem[];
};

const DISCORD_HREF = "https://discord.gg/ddXtHhvvrx";
const DOCUMENTATION_HREF =
  process.env.NEXT_PUBLIC_DOCUMENTATION_URL || "/terms";

const FOOTER_GROUPS: FooterGroup[] = [
  {
    title: "Produto",
    links: [
      { label: "Dominios", href: "/domains" },
      { label: "Planos", href: "/#plans" },
      { label: "Solucoes", href: "/#solutions" },
      { label: "Servicos", href: "/#services" },
      { label: "Produtos", href: "/#products" },
      { label: "Comecar agora", href: "/config?fresh=1" },
    ],
  },
  {
    title: "Automacao",
    links: [
      { label: "Tickets", href: "#" },
      { label: "Fluxos", href: "#" },
      { label: "Respostas automaticas", href: "#" },
      { label: "Plugins", href: "#" },
      { label: "Logs", href: "#" },
    ],
  },
  {
    title: "Atendimento",
    links: [
      { label: "Dashboard", href: "#" },
      { label: "Moderação", href: "#" },
      { label: "Equipes", href: "#" },
      { label: "Filas", href: "#" },
      { label: "Organizacao", href: "#" },
    ],
  },
  {
    title: "Pagamentos",
    links: [
      { label: "Assinaturas", href: "#" },
      { label: "Cargos automaticos", href: "#" },
      { label: "PIX", href: "#" },
      { label: "Cartao", href: "#" },
      { label: "Renovacao", href: "#" },
    ],
  },
  {
    title: "Seguranca",
    links: [
      { label: "Privacidade", href: "/privacy" },
      { label: "Termos", href: "/terms" },
      { label: "Protecao da conta", href: "#" },
      { label: "Confiabilidade", href: "#" },
      { label: "Operacao estavel", href: "#" },
    ],
  },
  {
    title: "Recursos",
    links: [
      { label: "Documentacao", href: DOCUMENTATION_HREF },
      { label: "Perguntas frequentes", href: "#" },
      { label: "Integracoes", href: "#" },
      { label: "Planos empresariais", href: "#" },
      { label: "Atualizacoes", href: "#" },
    ],
  },
  {
    title: "Plataforma",
    links: [
      { label: "Login", href: "/login" },
      { label: "Configuracao", href: "/config?fresh=1" },
      { label: "Vincular Discord", href: "/discord/link" },
      { label: "Painel web", href: "#" },
      { label: "Deploy", href: "#" },
    ],
  },
  {
    title: "Empresa",
    links: [
      { label: "Sobre", href: "/#about" },
      { label: "Afiliados", href: "/affiliates" },
      { label: "Clientes", href: "#" },
      { label: "Roadmap", href: "#" },
      { label: "Status", href: "/status" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Termos", href: "/terms" },
      { label: "Privacidade", href: "/privacy" },
      { label: "Licenciamento", href: "#" },
      { label: "Reembolsos", href: "#" },
      { label: "Compliance", href: "#" },
    ],
  },
  {
    title: "Comunidade",
    links: [
      { label: "Discord", href: DISCORD_HREF },
      { label: "Contato", href: DISCORD_HREF },
      { label: "Suporte", href: DISCORD_HREF },
      { label: "Atualizacoes", href: "#" },
      { label: "Feedback", href: "#" },
    ],
  },
];

function FooterLink({ item }: { item: FooterLinkItem }) {
  const baseClassName =
    "inline-flex self-start rounded-[14px] px-[12px] py-[8px] -mx-[12px] -my-[8px] text-[15px] leading-[1.25] font-normal transition-[background-color,color,opacity] duration-200";

  if (item.href === "#") {
    return (
      <span
        aria-disabled="true"
        className={`${baseClassName} cursor-default select-none`}
        style={{ color: "rgba(183, 183, 183, 0.38)" }}
      >
        {item.label}
      </span>
    );
  }

  if (item.href.startsWith("http")) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noreferrer noopener"
        className={`${baseClassName} hover:bg-[rgba(255,255,255,0.045)] focus-visible:bg-[rgba(255,255,255,0.05)] focus-visible:outline-none`}
        style={{ color: "rgba(183, 183, 183, 0.56)" }}
      >
        {item.label}
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      className={`${baseClassName} hover:bg-[rgba(255,255,255,0.045)] focus-visible:bg-[rgba(255,255,255,0.05)] focus-visible:outline-none`}
      style={{ color: "rgba(183, 183, 183, 0.56)" }}
    >
      {item.label}
    </Link>
  );
}

export function LandingFooter({ 
  baseDelay = 3160, 
  bottomDelay = 3600 
}: { 
  baseDelay?: number; 
  bottomDelay?: number; 
}) {
  const [overallStatus, setOverallStatus] = useState<string>("operational");
  const [statusMessage, setStatusMessage] = useState<string>("Todos sistemas normais");

  useEffect(() => {
    let isMounted = true;
    async function fetchStatus() {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const data = await res.json();
        
        if (isMounted && data.ok) {
          setOverallStatus(data.overallStatus);
          if (data.overallStatus === "major_outage") {
            setStatusMessage("Falha crítica detectada");
          } else if (data.overallStatus === "partial_outage") {
            setStatusMessage("Sistemas com instabilidade");
          } else {
            // operational e degraded_performance = tudo normal no footer
            setStatusMessage("Todos sistemas normais");
          }
        }
      } catch (e) {
        // Fallback silently
      }
    }
    
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const getStatusColor = () => {
    switch (overallStatus) {
      case "major_outage": return "#EF4444";
      case "partial_outage": return "#EAB308";
      // operational e degraded_performance ficam azul — sistema respondendo normalmente
      default: return "#0062FF";
    }
  };

  const statusColor = getStatusColor();

  return (
    <footer className="relative overflow-hidden border-t border-[rgba(255,255,255,0.03)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 left-1/2 h-[2px] w-screen -translate-x-1/2 bg-[linear-gradient(90deg,rgba(14,14,14,0.2)_0%,rgba(14,14,14,1)_50%,rgba(14,14,14,0.2)_100%)]" />

      <div className="mx-auto w-full max-w-[1582px] px-[20px] pb-[22px] pt-[56px] md:px-6 lg:px-8 xl:px-10 2xl:px-[20px]">
        <div className="grid grid-cols-2 gap-x-[28px] gap-y-[34px] md:grid-cols-3 xl:grid-cols-5">
          {FOOTER_GROUPS.map((group, index) => (
            <LandingReveal key={group.title} delay={baseDelay + index * 70}>
              <div className="flex min-h-[176px] flex-col">
                <p className="text-[13px] leading-none font-semibold uppercase tracking-[0.08em] text-[rgba(218,218,218,0.92)]">
                  {group.title}
                </p>
                <div className="mt-[22px] flex flex-col gap-[16px]">
                  {group.links.map((linkItem) => (
                    <FooterLink
                      key={`${group.title}-${linkItem.label}`}
                      item={linkItem}
                    />
                  ))}
                </div>
              </div>
            </LandingReveal>
          ))}
        </div>

        <LandingReveal delay={bottomDelay}>
          <div className="mt-[30px] flex flex-col gap-[18px] border-t border-[rgba(255,255,255,0.03)] pt-[18px] md:flex-row md:items-center md:justify-between">
            <Link 
              href="/status" 
              className="group flex items-center gap-[10px] transition-opacity hover:opacity-80"
            >
              <span 
                className="h-[10px] w-[10px] rounded-[2px] transition-colors" 
                style={{ backgroundColor: statusColor }}
              />
              <p 
                className="text-[13px] leading-none font-semibold tracking-[0.02em] transition-colors"
                style={{ color: statusColor }}
              >
                {statusMessage}
              </p>
            </Link>

            <div className="flex flex-wrap items-center gap-x-[18px] gap-y-[10px]">
              <FooterLink item={{ label: "Discord", href: DISCORD_HREF }} />
              <FooterLink item={{ label: "Privacidade", href: "/privacy" }} />
              <FooterLink item={{ label: "Termos", href: "/terms" }} />
              <FooterLink item={{ label: "Documentacao", href: DOCUMENTATION_HREF }} />
            </div>
          </div>
        </LandingReveal>
      </div>
    </footer>
  );
}
