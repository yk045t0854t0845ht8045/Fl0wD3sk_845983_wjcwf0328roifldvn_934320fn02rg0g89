"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { LandingReveal } from "@/components/landing/LandingReveal";

type NavigationItem = {
  label: string;
  href: string;
  hasChevron?: boolean;
};

type LandingHeaderAuthenticatedUser = {
  username: string;
  avatarUrl: string | null;
  href?: string;
};

type LandingHeaderProps = {
  authenticatedUser?: LandingHeaderAuthenticatedUser | null;
};

type DesktopMenuIconName =
  | "ticket"
  | "layers"
  | "spark"
  | "shield"
  | "plugin"
  | "chart"
  | "wallet"
  | "grid"
  | "team"
  | "rocket"
  | "globe"
  | "lock";

type DesktopMenuEntry = {
  title: string;
  description: string;
  href: string;
  icon: DesktopMenuIconName;
};

type DesktopMenuGroup = {
  title: string;
  items: DesktopMenuEntry[];
};

type DesktopMenuPanelData = {
  groups: DesktopMenuGroup[];
  sideTitle: string;
  sideLinks: Array<{
    label: string;
    href: string;
  }>;
};

const LEFT_NAV_ITEMS: NavigationItem[] = [
  { label: "Servicos", href: "/#services", hasChevron: true },
  { label: "Produtos", href: "/#products", hasChevron: true },
  { label: "Solucoes", href: "/#solutions", hasChevron: true },
  { label: "Afiliados", href: "/affiliates" },
  { label: "Planos", href: "/#plans" },
];

const TABLET_NAV_BREAKPOINT = 1250;
const MOBILE_MENU_ITEMS: NavigationItem[] = [
  { label: "Servicos", href: "/#services" },
  { label: "Produtos", href: "/#products" },
  { label: "Solucoes", href: "/#solutions" },
  { label: "Afiliados", href: "/affiliates" },
  { label: "Planos", href: "/#plans" },
];
const DESKTOP_MENU_LABELS = LEFT_NAV_ITEMS.filter((item) => item.hasChevron).map(
  (item) => item.label,
);

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`h-[16px] w-[16px] shrink-0 text-current transition-transform duration-200 ${className}`.trim()}
      fill="none"
    >
      <path
        d="M3.5 5.75L8 10.25L12.5 5.75"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DesktopMenuIcon({ icon }: { icon: DesktopMenuIconName }) {
  const baseClassName =
    "h-[19px] w-[19px] shrink-0 text-[rgba(218,218,218,0.72)]";

  switch (icon) {
    case "ticket":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path d="M6 8H18V16H6V8Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 8V16M15 8V16" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "layers":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path d="M12 5L19 9L12 13L5 9L12 5Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 13L12 17L19 13" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 17L12 21L19 17" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "spark":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path
            d="M12 3L14.3 9.7L21 12L14.3 14.3L12 21L9.7 14.3L3 12L9.7 9.7L12 3Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "shield":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path d="M12 4L18 6.5V12C18 15.7 15.5 19.1 12 20.5C8.5 19.1 6 15.7 6 12V6.5L12 4Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "plugin":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path d="M8 7V5C8 3.9 8.9 3 10 3C11.1 3 12 3.9 12 5V7" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7V5C12 3.9 12.9 3 14 3C15.1 3 16 3.9 16 5V7" stroke="currentColor" strokeWidth="1.8" />
          <path d="M7 7H17V12C17 15.3 14.3 18 11 18H7V7Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M17 10H20" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "chart":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path d="M5 19V10" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 19V5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M19 19V13" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "wallet":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path d="M5 8H19V18H5V8Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 8V7C5 5.9 5.9 5 7 5H16" stroke="currentColor" strokeWidth="1.8" />
          <path d="M15 13H19" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "grid":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path d="M5 5H10V10H5V5Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M14 5H19V10H14V5Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 14H10V19H5V14Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M14 14H19V19H14V14Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "team":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path d="M9 11C10.7 11 12 9.7 12 8C12 6.3 10.7 5 9 5C7.3 5 6 6.3 6 8C6 9.7 7.3 11 9 11Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M15.5 10C16.9 10 18 8.9 18 7.5C18 6.1 16.9 5 15.5 5C14.1 5 13 6.1 13 7.5C13 8.9 14.1 10 15.5 10Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4.5 18C4.5 15.8 6.3 14 8.5 14H9.5C11.7 14 13.5 15.8 13.5 18" stroke="currentColor" strokeWidth="1.8" />
          <path d="M13.5 17C13.8 15.5 15.1 14.5 16.7 14.5C18.5 14.5 20 16 20 17.8" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "rocket":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path d="M14 5C17.5 5 19 8.2 19 10.5C16.8 10.5 13.5 12 13.5 15.5C11.2 15.5 8 14 8 10.5C8 8.2 10.5 5 14 5Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 15L6 18" stroke="currentColor" strokeWidth="1.8" />
          <path d="M15 15L18 18" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "globe":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4 12H20" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 4C14.5 6.3 15.9 9.1 15.9 12C15.9 14.9 14.5 17.7 12 20" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 4C9.5 6.3 8.1 9.1 8.1 12C8.1 14.9 9.5 17.7 12 20" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "lock":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={baseClassName} fill="none">
          <path d="M8 10V8C8 5.8 9.8 4 12 4C14.2 4 16 5.8 16 8V10" stroke="currentColor" strokeWidth="1.8" />
          <path d="M6 10H18V19H6V10Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
  }
}

function DesktopMenuCard({
  item,
  onNavigate,
}: {
  item: DesktopMenuEntry;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className="group flex items-start gap-[14px] rounded-[18px] px-[14px] py-[12px] transition-[background-color,transform] duration-200 ease-out hover:bg-[rgba(255,255,255,0.035)]"
    >
      <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] bg-[rgba(255,255,255,0.02)] ring-1 ring-[rgba(255,255,255,0.04)] transition-colors duration-200 group-hover:bg-[rgba(255,255,255,0.045)]">
        <DesktopMenuIcon icon={item.icon} />
      </div>
      <div className="min-w-0 text-left">
        <p className="text-[18px] leading-[1.05] font-medium text-[rgba(218,218,218,0.9)]">
          {item.title}
        </p>
        <p className="mt-[6px] text-[15px] leading-[1.25] font-normal text-[rgba(183,183,183,0.64)]">
          {item.description}
        </p>
      </div>
    </Link>
  );
}

function DesktopMenuSideLink({
  label,
  href,
  onNavigate,
}: {
  label: string;
  href: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="inline-flex self-start rounded-[14px] px-[12px] py-[10px] -mx-[12px] text-[18px] leading-none font-normal text-[rgba(183,183,183,0.7)] transition-[background-color,color] duration-200 hover:bg-[rgba(255,255,255,0.04)] hover:text-[rgba(218,218,218,0.92)]"
    >
      {label}
    </Link>
  );
}

function MaybeMenuReveal({
  enabled,
  delay,
  children,
}: {
  enabled: boolean;
  delay: number;
  children: ReactElement<{
    className?: string;
    style?: CSSProperties;
    "data-flowdesk-visible"?: "true" | "false";
  }>;
}) {
  if (!enabled) {
    return children;
  }

  return <LandingReveal delay={delay}>{children}</LandingReveal>;
}

function DesktopMenuPanelContent({
  menuLabel,
  menuData,
  onNavigate,
  enableReveal = false,
}: {
  menuLabel: string;
  menuData: DesktopMenuPanelData;
  onNavigate?: () => void;
  enableReveal?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1.7fr)_278px]">
      <div className="grid grid-cols-2 gap-x-[24px] gap-y-[28px] p-[28px]">
        {menuData.groups.map((group, groupIndex) => (
          <div key={`${menuLabel}-${group.title}`}>
            <MaybeMenuReveal
              enabled={enableReveal}
              delay={40 + groupIndex * 65}
            >
              <p className="text-[13px] leading-none font-semibold uppercase tracking-[0.08em] text-[rgba(218,218,218,0.46)]">
                {group.title}
              </p>
            </MaybeMenuReveal>
            <div className="mt-[18px] flex flex-col gap-[10px]">
              {group.items.map((menuItem, itemIndex) => (
                <MaybeMenuReveal
                  key={`${menuLabel}-${menuItem.title}`}
                  enabled={enableReveal}
                  delay={90 + groupIndex * 65 + itemIndex * 45}
                >
                  <div>
                    <DesktopMenuCard
                      item={menuItem}
                      onNavigate={onNavigate}
                    />
                  </div>
                </MaybeMenuReveal>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-l border-[rgba(255,255,255,0.04)] p-[28px]">
        <MaybeMenuReveal enabled={enableReveal} delay={120}>
          <p className="text-[13px] leading-none font-semibold uppercase tracking-[0.08em] text-[rgba(218,218,218,0.46)]">
            {menuData.sideTitle}
          </p>
        </MaybeMenuReveal>
        <div className="mt-[18px] flex flex-col gap-[8px]">
          {menuData.sideLinks.map((linkItem, linkIndex) => (
            <MaybeMenuReveal
              key={`${menuLabel}-${linkItem.label}`}
              enabled={enableReveal}
              delay={170 + linkIndex * 45}
            >
              <div>
                <DesktopMenuSideLink
                  label={linkItem.label}
                  href={linkItem.href}
                  onNavigate={onNavigate}
                />
              </div>
            </MaybeMenuReveal>
          ))}
        </div>
      </div>
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[24px] w-[24px] shrink-0"
      fill="none"
    >
      <path
        d="M4 7H20M4 12H20M4 17H20"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[24px] w-[24px] shrink-0"
      fill="none"
    >
      <path
        d="M6 6L18 18M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 28 28"
      className="h-[28px] w-[28px] shrink-0 text-[#B7B7B7]"
      fill="none"
    >
      <path
        d="M14 2L16.6 11.4L26 14L16.6 16.6L14 26L11.4 16.6L2 14L11.4 11.4L14 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function NavLink({
  item,
  className = "",
  onClick,
  style,
  isActive = false,
  "data-flowdesk-visible": dataFlowdeskVisible,
}: {
  item: NavigationItem;
  className?: string;
  onClick?: () => void;
  style?: CSSProperties;
  isActive?: boolean;
  "data-flowdesk-visible"?: "true" | "false";
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      style={style}
      data-flowdesk-visible={dataFlowdeskVisible}
      className={`inline-flex items-center rounded-[16px] px-[16px] py-[10px] whitespace-nowrap text-[20px] leading-none font-normal transition-[background-color,color] duration-200 ${
        isActive
          ? "bg-[#0F0F0F] text-[rgba(218,218,218,0.92)]"
          : "text-[#B7B7B7] hover:bg-[#0F0F0F] hover:text-[rgba(218,218,218,0.92)]"
      } ${className}`.trim()}
    >
      <span className="inline-flex items-center gap-[14px]">
        <span>{item.label}</span>
        {item.hasChevron ? (
          <ChevronIcon className={isActive ? "rotate-180" : ""} />
        ) : null}
      </span>
    </Link>
  );
}

function truncateHeaderUsername(username: string) {
  const normalized = username.trim();
  if (!normalized) return "Conta";
  const glyphs = Array.from(normalized);
  if (glyphs.length <= 7) return normalized;
  return `${glyphs.slice(0, 7).join("")}...`;
}

function HeaderAccountButton({
  user,
  variant,
  className = "",
}: {
  user: LandingHeaderAuthenticatedUser;
  variant: "dark" | "light";
  className?: string;
}) {
  const trimmedUsername = user.username.trim();
  const fallbackInitial = trimmedUsername
    ? Array.from(trimmedUsername)[0]?.toUpperCase() || "F"
    : "F";

  return (
    <LandingActionButton
      href={user.href || "/servers"}
      variant={variant}
      className={className}
    >
      <span className="inline-flex items-center gap-[10px]">
        {user.avatarUrl ? (
          <Image
            src={user.avatarUrl}
            alt={trimmedUsername || "Conta"}
            width={26}
            height={26}
            className="h-[26px] w-[26px] rounded-full object-cover"
            unoptimized
          />
        ) : (
          <span
            className={`inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-[12px] font-semibold ${
              variant === "light"
                ? "bg-[rgba(17,17,17,0.1)] text-[#111111]"
                : "bg-[#1A1A1A] text-[#EAEAEA]"
            }`}
          >
            {fallbackInitial}
          </span>
        )}
        <span>{truncateHeaderUsername(trimmedUsername)}</span>
      </span>
    </LandingActionButton>
  );
}

export function LandingHeader({ authenticatedUser = null }: LandingHeaderProps = {}) {
  const documentationHref =
    process.env.NEXT_PUBLIC_DOCUMENTATION_URL || "/terms";
  const headerShellRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desktopMenuCloseTimeoutRef = useRef<number | null>(null);
  const desktopMenuOpenFrameRef = useRef<number | null>(null);
  const desktopMenuSwapKeyRef = useRef(0);
  const openFrameRef = useRef<number | null>(null);
  const lastScrollYRef = useRef(0);
  const floatingHeaderUnlockedRef = useRef(false);
  const floatingHeaderStateRef = useRef(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuMounted, setIsMenuMounted] = useState(false);
  const [activeDesktopMenu, setActiveDesktopMenu] = useState<string | null>(null);
  const [isDesktopMenuVisible, setIsDesktopMenuVisible] = useState(false);
  const [shouldRevealDesktopMenuContent, setShouldRevealDesktopMenuContent] =
    useState(true);
  const [desktopMenuTransition, setDesktopMenuTransition] = useState<{
    previousLabel: string;
    currentLabel: string;
    direction: 1 | -1;
    key: number;
  } | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [isFloatingHeader, setIsFloatingHeader] = useState(false);
  const [isFloatingHeaderVisible, setIsFloatingHeaderVisible] = useState(true);
  const resolvedViewportWidth = viewportWidth ?? 1920;
  const isTabletMode = resolvedViewportWidth < TABLET_NAV_BREAKPOINT;
  const shouldForceHeaderVisible = isMenuMounted || isMenuOpen;
  const desktopMenus: Record<string, DesktopMenuPanelData> = useMemo(() => ({
    Servicos: {
      groups: [
        {
          title: "ATENDIMENTO",
          items: [
            {
              title: "Bot Discord",
              description: "Automacao, tickets e operacao completa para o seu servidor.",
              href: "/#services",
              icon: "ticket",
            },
            {
              title: "Registro de Dominio",
              description: "Pesquise, valide e registre dominios para a sua marca.",
              href: "/domains",
              icon: "team",
            },
          ],
        },
        {
          title: "AUTOMACAO",
          items: [
            {
              title: "Fluxos automatizados",
              description: "Reduza trabalho manual com respostas e acoes.",
              href: "/#services",
              icon: "spark",
            },
            {
              title: "Logs e auditoria",
              description: "Acompanhe cada evento com mais confianca.",
              href: "/#services",
              icon: "chart",
            },
          ],
        },
        {
          title: "OPERACAO",
          items: [
            {
              title: "Plugins e extensoes",
              description: "Expanda sua base sem perder consistencia.",
              href: "/#services",
              icon: "plugin",
            },
            {
              title: "Camadas de seguranca",
              description: "Proteja a rotina da equipe e do servidor.",
              href: "/privacy",
              icon: "shield",
            },
          ],
        },
      ],
      sideTitle: "COMECE RAPIDO",
      sideLinks: [
        { label: "Ver servicos", href: "/#services" },
        { label: "Conhecer produtos", href: "/#products" },
        { label: "Escolher um plano", href: "/#plans" },
        { label: "Falar com o time", href: "https://discord.gg/ddXtHhvvrx" },
      ],
    },
    Produtos: {
      groups: [
        {
          title: "PLATAFORMA",
          items: [
            {
              title: "Painel web",
              description: "Controle tudo em uma base unica e organizada.",
              href: "/#products",
              icon: "grid",
            },
            {
              title: "Dashboard central",
              description: "Visualize tickets, filas e performance em tempo real.",
              href: "/#products",
              icon: "chart",
            },
          ],
        },
        {
          title: "MONETIZACAO",
          items: [
            {
              title: "Pagamentos integrados",
              description: "Conecte cobrancas ao fluxo do servidor.",
              href: "/#products",
              icon: "wallet",
            },
            {
              title: "Cargos automaticos",
              description: "Libere acessos sem operacao manual.",
              href: "/#products",
              icon: "plugin",
            },
          ],
        },
        {
          title: "GESTAO",
          items: [
            {
              title: "Licenciamento",
              description: "Escalone planos conforme a sua estrutura.",
              href: "/#plans",
              icon: "layers",
            },
            {
              title: "Operacao unificada",
              description: "Junte suporte, vendas e automacao no mesmo lugar.",
              href: "/#products",
              icon: "rocket",
            },
          ],
        },
      ],
      sideTitle: "PRODUTO",
      sideLinks: [
        { label: "Painel principal", href: "/config?fresh=1" },
        { label: "Planos empresariais", href: "/#plans" },
        { label: "Documentacao", href: documentationHref },
        { label: "Privacidade", href: "/privacy" },
      ],
    },
    Solucoes: {
      groups: [
        {
          title: "COMUNIDADES",
          items: [
            {
              title: "Atendimento premium",
              description: "Melhore a experiencia da sua comunidade.",
              href: "/#solutions",
              icon: "team",
            },
            {
              title: "Staff centralizada",
              description: "Coordene moderadores com mais velocidade.",
              href: "/#solutions",
              icon: "globe",
            },
          ],
        },
        {
          title: "ESCALA",
          items: [
            {
              title: "Multi servidores",
              description: "Gerencie operacoes em mais de uma base.",
              href: "/#solutions",
              icon: "layers",
            },
            {
              title: "Fluxos confiaveis",
              description: "Mantenha a consistencia com crescimento continuo.",
              href: "/#solutions",
              icon: "shield",
            },
          ],
        },
        {
          title: "RESULTADO",
          items: [
            {
              title: "Performance mais rapida",
              description: "Entregue respostas e liberacoes com mais fluidez.",
              href: "/#solutions",
              icon: "rocket",
            },
            {
              title: "Operacao previsivel",
              description: "Organize cada etapa com menos atrito.",
              href: "/#solutions",
              icon: "spark",
            },
          ],
        },
      ],
      sideTitle: "SOLUCOES",
      sideLinks: [
        { label: "Ver solucoes", href: "/#solutions" },
        { label: "Ir para planos", href: "/#plans" },
        { label: "Entrar no painel", href: "/login" },
        { label: "Documentacao", href: documentationHref },
      ],
    },
    Sobre: {
      groups: [
        {
          title: "FLOWDESK",
          items: [
            {
              title: "Nossa proposta",
              description: "Automacao, atendimento e pagamentos em uma base so.",
              href: "/#about",
              icon: "spark",
            },
            {
              title: "Infraestrutura segura",
              description: "Confiabilidade pensada para operacao continua.",
              href: "/privacy",
              icon: "lock",
            },
          ],
        },
        {
          title: "INSTITUCIONAL",
          items: [
            {
              title: "Privacidade",
              description: "Entenda como protegemos dados e acessos.",
              href: "/privacy",
              icon: "shield",
            },
            {
              title: "Termos",
              description: "Veja as diretrizes de uso da plataforma.",
              href: "/terms",
              icon: "layers",
            },
          ],
        },
      ],
      sideTitle: "INFORMACOES",
      sideLinks: [
        { label: "Sobre a Flowdesk", href: "/#about" },
        { label: "Documentacao", href: documentationHref },
        { label: "Privacidade", href: "/privacy" },
        { label: "Termos", href: "/terms" },
      ],
    },
  }), [documentationHref]);

  const closeMenu = useCallback(() => {
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }

    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }

    setIsMenuOpen(false);
    closeTimeoutRef.current = setTimeout(() => {
      setIsMenuMounted(false);
      closeTimeoutRef.current = null;
    }, 320);
  }, []);

  const openMenu = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    setIsMenuMounted(true);

    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
    }

    openFrameRef.current = window.requestAnimationFrame(() => {
      setIsMenuOpen(true);
      openFrameRef.current = null;
    });
  }, []);

  const toggleMenu = useCallback(() => {
    if (isMenuMounted && isMenuOpen) {
      closeMenu();
      return;
    }

    openMenu();
  }, [closeMenu, isMenuMounted, isMenuOpen, openMenu]);

  const cancelDesktopMenuClose = useCallback(() => {
    if (desktopMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(desktopMenuCloseTimeoutRef.current);
      desktopMenuCloseTimeoutRef.current = null;
    }
  }, []);

  const closeDesktopMenu = useCallback(
    (delay = 0) => {
      cancelDesktopMenuClose();

      const runClose = () => {
        setIsDesktopMenuVisible(false);
        setShouldRevealDesktopMenuContent(false);
        desktopMenuCloseTimeoutRef.current = window.setTimeout(() => {
          setActiveDesktopMenu(null);
          setDesktopMenuTransition(null);
          desktopMenuCloseTimeoutRef.current = null;
        }, 220);
      };

      if (delay > 0) {
        desktopMenuCloseTimeoutRef.current = window.setTimeout(() => {
          runClose();
        }, delay);
        return;
      }

      runClose();
    },
    [cancelDesktopMenuClose],
  );

  const openDesktopMenu = useCallback(
    (label: string) => {
      if (isTabletMode || !desktopMenus[label]) {
        return;
      }

      cancelDesktopMenuClose();

      if (desktopMenuOpenFrameRef.current !== null) {
        window.cancelAnimationFrame(desktopMenuOpenFrameRef.current);
      }

      if (activeDesktopMenu && activeDesktopMenu !== label) {
        const currentIndex = DESKTOP_MENU_LABELS.indexOf(activeDesktopMenu);
        const nextIndex = DESKTOP_MENU_LABELS.indexOf(label);
        let nextDirection: 1 | -1 = 1;

        if (currentIndex !== -1 && nextIndex !== -1) {
          nextDirection = nextIndex > currentIndex ? 1 : -1;
        }

        desktopMenuSwapKeyRef.current += 1;
        setShouldRevealDesktopMenuContent(false);
        setDesktopMenuTransition({
          previousLabel: activeDesktopMenu,
          currentLabel: label,
          direction: nextDirection,
          key: desktopMenuSwapKeyRef.current,
        });
      } else {
        if (!activeDesktopMenu) {
          setShouldRevealDesktopMenuContent(true);
        }

        setDesktopMenuTransition(null);
      }

      setActiveDesktopMenu(label);
      desktopMenuOpenFrameRef.current = window.requestAnimationFrame(() => {
        setIsDesktopMenuVisible(true);
        desktopMenuOpenFrameRef.current = null;
      });
    },
    [activeDesktopMenu, cancelDesktopMenuClose, desktopMenus, isTabletMode],
  );

  useEffect(() => {
    function syncViewportWidth() {
      const nextViewportWidth = window.innerWidth;
      setViewportWidth(nextViewportWidth);

      if (nextViewportWidth >= TABLET_NAV_BREAKPOINT) {
        closeMenu();
      } else {
        closeDesktopMenu();
      }
    }

    syncViewportWidth();
    window.addEventListener("resize", syncViewportWidth);

    return () => {
      window.removeEventListener("resize", syncViewportWidth);
    };
  }, [closeDesktopMenu, closeMenu]);

  useEffect(() => {
    if (isTabletMode && activeDesktopMenu) {
      closeDesktopMenu();
    }
  }, [activeDesktopMenu, closeDesktopMenu, isTabletMode]);

  useEffect(() => {
    floatingHeaderStateRef.current = isFloatingHeader;
  }, [isFloatingHeader]);

  useEffect(() => {
    if (!isMenuMounted) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isMenuMounted]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current) {
        return;
      }

      if (!menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
        closeDesktopMenu();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeDesktopMenu, closeMenu]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }

      if (openFrameRef.current !== null) {
        window.cancelAnimationFrame(openFrameRef.current);
      }

      if (desktopMenuCloseTimeoutRef.current !== null) {
        window.clearTimeout(desktopMenuCloseTimeoutRef.current);
      }

      if (desktopMenuOpenFrameRef.current !== null) {
        window.cancelAnimationFrame(desktopMenuOpenFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function syncHeaderHeight() {
      const nextHeight = headerShellRef.current?.offsetHeight ?? 0;

      if (nextHeight > 0) {
        setHeaderHeight(nextHeight);
      }
    }

    syncHeaderHeight();

    const observedNode = headerShellRef.current;

    if (!observedNode) {
      return;
    }

    const observer = new ResizeObserver(syncHeaderHeight);
    observer.observe(observedNode);
    window.addEventListener("resize", syncHeaderHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncHeaderHeight);
    };
  }, [isTabletMode]);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;

    function handleScroll() {
      const currentScrollY = window.scrollY;
      const previousScrollY = lastScrollYRef.current;
      const delta = currentScrollY - previousScrollY;
      const activationOffset = Math.max(headerHeight, 96);
      const wasFloatingHeader = floatingHeaderStateRef.current;

      if (currentScrollY <= 4) {
        setIsFloatingHeader(false);
        setIsFloatingHeaderVisible(true);
        floatingHeaderUnlockedRef.current = false;
        floatingHeaderStateRef.current = false;
        lastScrollYRef.current = currentScrollY;
        return;
      }

      if (currentScrollY <= activationOffset) {
        setIsFloatingHeader(false);
        setIsFloatingHeaderVisible(true);
        floatingHeaderUnlockedRef.current = false;
        floatingHeaderStateRef.current = false;
        lastScrollYRef.current = currentScrollY;
        return;
      }

      if (Math.abs(delta) < 4) {
        return;
      }

      if (delta < 0) {
        floatingHeaderUnlockedRef.current = true;
        setIsFloatingHeader(true);
        floatingHeaderStateRef.current = true;
        setIsFloatingHeaderVisible(true);
        lastScrollYRef.current = currentScrollY;
        return;
      }

      if (!floatingHeaderUnlockedRef.current && !wasFloatingHeader) {
        lastScrollYRef.current = currentScrollY;
        return;
      }

      setIsFloatingHeader(true);
      floatingHeaderStateRef.current = true;
      setIsFloatingHeaderVisible(false);

      lastScrollYRef.current = currentScrollY;
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [headerHeight]);

  const responsiveTransitionClassName =
    "flowdesk-landing-soft-motion overflow-hidden";
  const shouldShowFloatingHeader =
    !isFloatingHeader || shouldForceHeaderVisible || isFloatingHeaderVisible;
  const activeDesktopMenuData = activeDesktopMenu
    ? desktopMenus[activeDesktopMenu] ?? null
    : null;
  const desktopMenuTransitionData = desktopMenuTransition
    ? {
        previousMenuData:
          desktopMenus[desktopMenuTransition.previousLabel] ?? null,
        currentMenuData:
          desktopMenus[desktopMenuTransition.currentLabel] ?? null,
      }
    : null;

  return (
    <header
      className="relative z-[70] w-full"
      style={isFloatingHeader ? { height: `${headerHeight}px` } : undefined}
    >
      <div
        ref={headerShellRef}
        className={`w-full transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isFloatingHeader
            ? `fixed inset-x-0 top-0 ${
                shouldShowFloatingHeader ? "translate-y-0" : "-translate-y-[115%]"
              }`
            : "relative translate-y-0"
        }`}
      >
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute top-0 right-[max(2px,_calc(50%_-_799px))] bottom-[28px] left-[max(2px,_calc(50%_-_799px))] bg-[rgba(4,4,4,0.08)] ${
            isFloatingHeader ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          aria-hidden="true"
          style={{
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
          }}
          className={`pointer-events-none absolute top-0 right-[max(2px,_calc(50%_-_799px))] bottom-[28px] left-[max(2px,_calc(50%_-_799px))] ${
            isFloatingHeader ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          style={{
            transitionDelay:
              isFloatingHeader && shouldShowFloatingHeader ? "40ms" : "0ms",
          }}
          className={`relative transition-[opacity,filter] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isFloatingHeader
              ? shouldShowFloatingHeader
                ? "opacity-100 blur-0"
                : "opacity-0 blur-[6px]"
              : "opacity-100 blur-0"
          }`}
        >
          <div className="relative mx-auto flex w-full max-w-[1582px] flex-col px-[20px] pt-[20px] pb-10 md:px-6 lg:px-8 xl:px-10 2xl:px-[20px]">
        <div className="relative flex min-h-[88px] items-center justify-between gap-6">
          <div className="flex min-w-0 items-center">
            <LandingReveal delay={90}>
              <Link
                href="/"
                className="flowdesk-landing-soft-motion relative block h-[30px] w-[150px] shrink-0 sm:h-[36px] sm:w-[180px] xl:h-[42px] xl:w-[210px]"
                aria-label="Ir para a pagina inicial do Flowdesk"
              >
                <Image
                  src="/cdn/logos/logo.png"
                  alt="Flowdesk"
                  fill
                  sizes="(max-width: 640px) 150px, (max-width: 1280px) 180px, 210px"
                  className="object-contain"
                  priority
                />
              </Link>
            </LandingReveal>

            <div
              onPointerEnter={cancelDesktopMenuClose}
              onPointerMove={cancelDesktopMenuClose}
              onPointerLeave={() => closeDesktopMenu(180)}
              className={`flex min-w-0 items-center flowdesk-landing-soft-motion ${
                isTabletMode
                  ? "pointer-events-none ml-0 max-w-0 -translate-y-1 overflow-hidden opacity-0"
                  : "relative ml-10 max-w-[1200px] translate-y-0 overflow-visible px-[6px] pb-[18px] -mb-[18px] opacity-100"
              }`}
            >
              <nav className="flex min-w-0 items-center">
                {LEFT_NAV_ITEMS.map((item, index) => {
                  const itemWrapperClassName = `${responsiveTransitionClassName} overflow-visible ${
                    index === 0 ? "" : "ml-5"
                  }`;

                  return (
                    <div
                      key={item.label}
                      className={itemWrapperClassName}
                      onPointerEnter={() => {
                        if (item.hasChevron) {
                          openDesktopMenu(item.label);
                          return;
                        }

                        closeDesktopMenu(90);
                      }}
                    >
                      <LandingReveal delay={150 + index * 55}>
                        <NavLink
                          item={item}
                          onClick={
                            item.hasChevron
                              ? () => closeDesktopMenu()
                              : undefined
                          }
                          isActive={activeDesktopMenu === item.label}
                        />
                      </LandingReveal>
                    </div>
                  );
                })}
              </nav>

              {activeDesktopMenu && activeDesktopMenuData ? (
                <div
                  className={`absolute left-0 top-[calc(100%+2px)] z-[100] origin-top transform-gpu w-[min(1040px,calc(100vw-320px))] transition-[opacity,transform,filter] duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    isDesktopMenuVisible
                      ? "translate-y-0 scale-y-100 opacity-100 blur-0"
                      : "pointer-events-none -translate-y-[16px] scale-y-[0.965] opacity-0 blur-[10px]"
                  }`}
                >
                  <div className="relative isolate overflow-hidden rounded-[28px] bg-transparent shadow-[0_34px_120px_rgba(0,0,0,0.58)]">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-[28px] border border-[#0E0E0E]"
                    />
                    <span
                      aria-hidden="true"
                      className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[28px]"
                    />
                    <span
                      aria-hidden="true"
                      className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[28px]"
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-[1px] rounded-[27px] bg-[#070707]"
                    />
                    {desktopMenuTransition &&
                    desktopMenuTransitionData?.previousMenuData &&
                    desktopMenuTransitionData.currentMenuData ? (
                      <div className="relative z-20 min-h-[408px] overflow-hidden">
                        <div
                          key={`desktop-menu-swap-${desktopMenuTransition.key}`}
                          onAnimationEnd={() => {
                            setDesktopMenuTransition((currentTransition) =>
                              currentTransition?.key === desktopMenuTransition.key
                                ? null
                                : currentTransition,
                            );
                          }}
                          className={`flex w-[200%] will-change-transform ${
                            desktopMenuTransition.direction === 1
                              ? "flowdesk-header-menu-track-next"
                              : "flowdesk-header-menu-track-prev"
                          }`}
                        >
                          {desktopMenuTransition.direction === 1 ? (
                            <>
                              <div className="w-1/2 shrink-0">
                                <DesktopMenuPanelContent
                                  menuLabel={desktopMenuTransition.previousLabel}
                                  menuData={desktopMenuTransitionData.previousMenuData}
                                  onNavigate={() => closeDesktopMenu()}
                                  enableReveal={false}
                                />
                              </div>
                              <div className="w-1/2 shrink-0">
                                <DesktopMenuPanelContent
                                  menuLabel={desktopMenuTransition.currentLabel}
                                  menuData={desktopMenuTransitionData.currentMenuData}
                                  onNavigate={() => closeDesktopMenu()}
                                  enableReveal={true}
                                />
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="w-1/2 shrink-0">
                                <DesktopMenuPanelContent
                                  menuLabel={desktopMenuTransition.currentLabel}
                                  menuData={desktopMenuTransitionData.currentMenuData}
                                  onNavigate={() => closeDesktopMenu()}
                                  enableReveal={true}
                                />
                              </div>
                              <div className="w-1/2 shrink-0">
                                <DesktopMenuPanelContent
                                  menuLabel={desktopMenuTransition.previousLabel}
                                  menuData={desktopMenuTransitionData.previousMenuData}
                                  onNavigate={() => closeDesktopMenu()}
                                  enableReveal={false}
                                />
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="relative z-20 min-h-[408px]">
                        <DesktopMenuPanelContent
                          menuLabel={activeDesktopMenu}
                          menuData={activeDesktopMenuData}
                          onNavigate={() => closeDesktopMenu()}
                          enableReveal={shouldRevealDesktopMenuContent}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end">
            <LandingReveal delay={410}>
              <div
                className={`flex shrink-0 items-center ${responsiveTransitionClassName} ${
                  isTabletMode
                    ? "pointer-events-none max-w-0 translate-y-1 opacity-0"
                    : "max-w-[720px] translate-y-0 opacity-100"
                }`}
              >
                <LandingReveal delay={500}>
                  <div className="flowdesk-landing-soft-motion flex h-[46px] shrink-0 items-center">
                    <Link
                      href={documentationHref}
                      onPointerEnter={() => closeDesktopMenu(90)}
                      className="inline-flex h-[46px] items-center rounded-[16px] px-[16px] py-[10px] whitespace-nowrap text-[20px] leading-none font-normal text-[#B7B7B7] transition-[background-color,color] duration-200 hover:bg-[#0F0F0F] hover:text-[rgba(218,218,218,0.92)]"
                    >
                      Docs
                    </Link>
                  </div>
                </LandingReveal>

                <div className="ml-[30px] flex items-center gap-6">
                  {authenticatedUser ? (
                      <LandingReveal delay={570}>
                      <LandingActionButton
                        href="/servers"
                        variant="light"
                        className="h-[40px] px-4 text-[14px] sm:h-[46px] sm:px-6 sm:text-[16px]"
                      >
                        Dashboard
                      </LandingActionButton>
                    </LandingReveal>
                  ) : (
                    <>
                      <LandingReveal delay={570}>
                        <LandingActionButton href="/login" variant="dark">
                          Login
                        </LandingActionButton>
                      </LandingReveal>
                      <LandingReveal delay={640}>
                        <LandingActionButton href="/login" variant="light">
                          Sign Up
                        </LandingActionButton>
                      </LandingReveal>
                    </>
                  )}
                </div>
              </div>
            </LandingReveal>

            <LandingReveal delay={410}>
              <div
                className={`ml-4 flex shrink-0 items-center gap-4 ${responsiveTransitionClassName} ${
                  isTabletMode
                    ? "max-w-[220px] translate-y-0 opacity-100"
                    : "pointer-events-none ml-0 max-w-0 translate-y-1 opacity-0"
                }`}
              >
                <LandingReveal delay={500}>
                  {authenticatedUser ? (
                    <LandingActionButton
                      href="/servers"
                      variant="light"
                      className="h-[40px] px-4 text-[14px] sm:h-[46px] sm:px-6 sm:text-[16px]"
                    >
                      Dashboard
                    </LandingActionButton>
                  ) : (
                    <LandingActionButton
                      href="/login"
                      variant="light"
                      className="h-[40px] px-4 text-[14px] sm:h-[46px] sm:px-6 sm:text-[16px]"
                    >
                      Sign Up
                    </LandingActionButton>
                  )}
                </LandingReveal>

                <LandingReveal delay={570}>
                  <button
                    type="button"
                    onClick={toggleMenu}
                    aria-label={isMenuOpen ? "Fechar menu" : "Abrir menu"}
                    aria-expanded={isMenuOpen}
                    className="inline-flex h-[40px] w-[40px] items-center justify-center text-[#D1D1D1] transition-opacity duration-150 hover:opacity-85 active:opacity-70 sm:h-[46px] sm:w-[46px]"
                  >
                    {isMenuOpen ? <CloseIcon /> : <HamburgerIcon />}
                  </button>
                </LandingReveal>
              </div>
            </LandingReveal>
          </div>
        </div>

      </div>
      </div>
      </div>

      {isMenuMounted ? (
        <div
          className={`fixed inset-0 z-50 flex items-end justify-center bg-[rgba(4,4,4,0.64)] px-4 pb-4 pt-20 backdrop-blur-[18px] transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:px-6 sm:pb-6 ${
            isMenuOpen ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            ref={menuRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu mobile"
            className={`w-full max-w-[560px] rounded-[32px] border border-[#111111] bg-[#040404] p-4 shadow-[0_34px_120px_rgba(0,0,0,0.62)] transition-[opacity,transform,filter] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:p-5 ${
              isMenuOpen
                ? "translate-y-0 opacity-100 blur-0"
                : "translate-y-10 opacity-0 blur-[4px]"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <LandingReveal delay={90}>
                <div className="flex h-[56px] w-[56px] items-center justify-center rounded-[18px] bg-[#111111]">
                  <SparkleIcon />
                </div>
              </LandingReveal>

              <LandingReveal delay={130}>
                <button
                  type="button"
                  onClick={closeMenu}
                  aria-label="Fechar menu"
                  className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[#111111] text-[#B7B7B7] transition-colors duration-200 hover:bg-[#161616] hover:text-white"
                >
                  <CloseIcon />
                </button>
              </LandingReveal>
            </div>

            <LandingReveal delay={170}>
              <div className="mt-5">
                <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.05] font-semibold tracking-[-0.04em] text-transparent">
                  Explore o Flowdesk
                </h2>
                <p className="mt-3 max-w-[420px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[18px] leading-[1.35] font-normal text-transparent">
                  Acesse rapidamente as areas principais da plataforma com o
                  mesmo visual premium da landing.
                </p>
              </div>
            </LandingReveal>

            <div className="mt-6 flex flex-col gap-3">
              {MOBILE_MENU_ITEMS.map((item, index) => (
                <LandingReveal
                  key={item.label}
                  delay={230 + index * 70}
                >
                  <LandingActionButton
                    href={item.href}
                    onClick={closeMenu}
                    variant="dark"
                    className="h-[52px] w-full rounded-[12px] px-6 text-[18px]"
                  >
                    {item.label}
                  </LandingActionButton>
                </LandingReveal>
              ))}

              <LandingReveal delay={440}>
                {authenticatedUser ? (
                  <LandingActionButton
                    href="/servers"
                    onClick={closeMenu}
                    variant="light"
                    className="h-[52px] w-full rounded-[12px] px-6 text-[18px]"
                  >
                    Acessar Dashboard
                  </LandingActionButton>
                ) : (
                  <LandingActionButton
                    href="/login"
                    onClick={closeMenu}
                    variant="light"
                    className="h-[52px] w-full rounded-[12px] px-6 text-[18px]"
                  >
                    Login
                  </LandingActionButton>
                )}
              </LandingReveal>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
