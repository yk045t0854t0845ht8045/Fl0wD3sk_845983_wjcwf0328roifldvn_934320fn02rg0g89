"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { ServerSettingsEditor } from "@/components/servers/ServerSettingsEditor";
import { ServerSettingsEditorSkeleton } from "@/components/servers/ServerSettingsEditorSkeleton";
import type { ManagedServer, ManagedServerStatus } from "@/lib/servers/managedServers";
import type { PendingTeamInvite, UserTeam } from "@/lib/teams/userTeams";

type ServersWorkspaceProps = {
  displayName: string;
  initialGuildId?: string | null;
  initialTab?: "settings" | "payments" | "methods" | "plans";
  initialServers?: ManagedServer[] | null;
  initialTeams?: UserTeam[] | null;
  initialPendingInvites?: PendingTeamInvite[] | null;
};

type ServerEditorTab = "settings" | "payments" | "methods" | "plans";
type FilterOption = "all" | ManagedServerStatus;
type ViewMode = "overview" | "list";
type CreateTeamStep = "name" | "servers" | "members";

type ServersApiResponse = {
  ok: boolean;
  message?: string;
  servers?: ManagedServer[];
};

type TeamsApiResponse = {
  ok: boolean;
  message?: string;
  teams?: UserTeam[];
  pendingInvites?: PendingTeamInvite[];
  createdTeamId?: number;
};

const FILTER_LABEL: Record<FilterOption, string> = {
  all: "Todos",
  paid: "Pago",
  expired: "Expirados",
  off: "Desligados",
};

type SidebarItem = {
  label: string;
  kind:
    | "overview"
    | "settings"
    | "payments"
    | "methods"
    | "plans"
    | "analytics"
    | "integrations"
    | "storage"
    | "support"
    | "preferences";
  tab?: ServerEditorTab | null;
  disabled?: boolean;
  chevron?: boolean;
};

const SIDEBAR_SECTIONS: SidebarItem[][] = [
  [
    { label: "Projetos", kind: "overview", tab: null },
    { label: "Configuracoes", kind: "settings", tab: "settings" },
    { label: "Pagamentos", kind: "payments", tab: "payments" },
    { label: "Metodos", kind: "methods", tab: "methods" },
    { label: "Planos", kind: "plans", tab: "plans" },
  ],
  [
    { label: "Analytics", kind: "analytics", disabled: true },
    { label: "Integracoes", kind: "integrations", disabled: true, chevron: true },
    { label: "Storage", kind: "storage", disabled: true },
  ],
  [
    { label: "Suporte", kind: "support", disabled: true },
    { label: "Settings", kind: "preferences", disabled: true, chevron: true },
  ],
];

const shellClass =
  "rounded-[28px] border border-[#0E0E0E] bg-[#0A0A0A] shadow-[0_24px_80px_rgba(0,0,0,0.38)]";

const sidebarShellClass =
  "relative overflow-hidden border border-[#0E0E0E] bg-[#050505] shadow-[0_24px_80px_rgba(0,0,0,0.42)]";

const TEAM_ICON_OPTIONS = [
  {
    key: "aurora",
    label: "Aurora",
    shell:
      "bg-[radial-gradient(circle_at_30%_20%,#91B6FF_0%,#245BFF_48%,#081A4E_100%)]",
  },
  {
    key: "ember",
    label: "Ember",
    shell:
      "bg-[radial-gradient(circle_at_30%_20%,#FFC18F_0%,#FF7A1A_48%,#4A1805_100%)]",
  },
  {
    key: "ocean",
    label: "Ocean",
    shell:
      "bg-[radial-gradient(circle_at_30%_20%,#8AF2FF_0%,#148EBC_48%,#052238_100%)]",
  },
  {
    key: "amethyst",
    label: "Amethyst",
    shell:
      "bg-[radial-gradient(circle_at_30%_20%,#D9A8FF_0%,#7D3BFF_48%,#220842_100%)]",
  },
  {
    key: "forest",
    label: "Forest",
    shell:
      "bg-[radial-gradient(circle_at_30%_20%,#A9FFB8_0%,#0E8E4E_48%,#062615_100%)]",
  },
  {
    key: "sunset",
    label: "Sunset",
    shell:
      "bg-[radial-gradient(circle_at_28%_18%,#FFD7A8_0%,#FF7A59_36%,#D83A7C_68%,#2D0718_100%)]",
  },
] as const;

function getTeamIconShell(iconKey: string) {
  return (
    TEAM_ICON_OPTIONS.find((option) => option.key === iconKey)?.shell ||
    TEAM_ICON_OPTIONS[0].shell
  );
}

function teamInitial(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "E";
}

function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isSubsequence(query: string, target: string) {
  if (!query) return true;
  let queryIndex = 0;
  for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
    if (target[targetIndex] === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex >= query.length) return true;
    }
  }
  return false;
}

function getSearchScore(guildName: string, query: string) {
  if (!query) return 1;
  const normalizedName = normalizeSearchText(guildName);
  const compactName = normalizedName.replace(/\s+/g, "");
  const compactQuery = query.replace(/\s+/g, "");
  if (normalizedName === query) return 100;
  if (normalizedName.startsWith(query)) return 90;
  if (normalizedName.includes(query)) return 80;
  if (compactQuery && isSubsequence(compactQuery, compactName)) return 50;
  return 0;
}

function formatDateLabel(rawDate: string) {
  const timestamp = Date.parse(rawDate);
  if (!Number.isFinite(timestamp)) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(timestamp);
}

function statusStyle(status: ManagedServerStatus) {
  if (status === "paid") {
    return {
      badgeText: "Pago",
      badgeClass:
        "border border-[rgba(0,98,255,0.42)] bg-[rgba(0,98,255,0.14)] text-[#8AB6FF]",
      ringColor:
        "conic-gradient(#0062FF 0deg 300deg, rgba(255,255,255,0.08) 300deg 360deg)",
    };
  }

  if (status === "expired") {
    return {
      badgeText: "Expirado",
      badgeClass:
        "border border-[rgba(242,200,35,0.4)] bg-[rgba(242,200,35,0.12)] text-[#F2C823]",
      ringColor:
        "conic-gradient(#F2C823 0deg 220deg, rgba(255,255,255,0.08) 220deg 360deg)",
    };
  }

  return {
    badgeText: "Desligado",
    badgeClass:
      "border border-[rgba(219,70,70,0.4)] bg-[rgba(219,70,70,0.12)] text-[#DB4646]",
    ringColor:
      "conic-gradient(#DB4646 0deg 140deg, rgba(255,255,255,0.08) 140deg 360deg)",
  };
}

function statusDescription(server: ManagedServer) {
  if (server.status === "paid") return `Renovacao ativa • expira em ${server.daysUntilExpire} dias`;
  if (server.status === "expired") return `Licenca expirada • restam ${server.daysUntilOff} dias`;
  return "Bot desligado • retorna imediatamente apos pagamento";
}

function serverMetaLabel(server: ManagedServer) {
  return server.accessMode === "owner"
    ? `Dono da licenca • renovado em ${formatDateLabel(server.licensePaidAt)}`
    : `Acesso de visualizacao • valido ate ${formatDateLabel(server.licenseExpiresAt)}`;
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
      <path d="M5 7H19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 12H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 17H14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
      <path d="M5 5H10V10H5V5Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M14 5H19V10H14V5Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 14H10V19H5V14Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M14 14H19V19H14V14Z" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
      <path d="M8 6.5H19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 12H19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 17.5H19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="5" cy="6.5" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="17.5" r="1" fill="currentColor" />
    </svg>
  );
}

function MenuDotsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] shrink-0" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15 9V7A2 2 0 0 0 13 5H7A2 2 0 0 0 5 7V13A2 2 0 0 0 7 15H9" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] shrink-0" fill="none" aria-hidden="true">
      <path d="M20 7L10 17L5 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
      <path d="M12 5V19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="8" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 18.5C5.3 15.95 7.45 14.5 10 14.5C12.55 14.5 14.7 15.95 15.5 18.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M15.5 16.2C16.12 15.1 17.2 14.5 18.45 14.5C19.06 14.5 19.63 14.64 20.13 14.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function TeamAvatar({
  iconKey,
  name,
  className = "",
  textClassName = "text-[#F3F3F3]",
}: {
  iconKey: string;
  name: string;
  className?: string;
  textClassName?: string;
}) {
  return (
    <div
      className={`relative inline-flex items-center justify-center overflow-hidden rounded-[12px] ${getTeamIconShell(
        iconKey,
      )} ${className}`.trim()}
      aria-hidden="true"
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.22)_0%,transparent_58%)]" />
      <span
        className={`relative z-10 text-[14px] leading-none font-semibold tracking-[-0.04em] ${textClassName}`}
      >
        {teamInitial(name)}
      </span>
    </div>
  );
}

function SidebarWorkspaceIcon() {
  return (
    <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_32%_28%,#E7A540_0%,#C77B12_58%,#6B3600_100%)] shadow-[0_0_30px_rgba(231,165,64,0.18)]">
      <div className="grid h-[18px] w-[18px] grid-cols-3 gap-[2px] opacity-95">
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} className="rounded-full bg-[rgba(12,8,0,0.42)]" />
        ))}
      </div>
    </div>
  );
}

function SidebarMiniChevron() {
  return (
    <svg viewBox="0 0 20 20" className="h-[14px] w-[14px] shrink-0" fill="none" aria-hidden="true">
      <path d="M5.5 7.5L10 12L14.5 7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SidebarSearchShortcutIcon() {
  return (
    <span className="inline-flex h-[28px] min-w-[28px] items-center justify-center rounded-[9px] border border-[#1A1A1A] bg-[#101010] px-[8px] text-[12px] font-medium text-[#A7A7A7]">
      F
    </span>
  );
}

function SidebarBellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] shrink-0" fill="none" aria-hidden="true">
      <path d="M8 17H16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10 20H14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.5 17V11.5C6.5 8.47 8.97 6 12 6C15.03 6 17.5 8.47 17.5 11.5V17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SidebarLogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] shrink-0" fill="none" aria-hidden="true">
      <path d="M9 6H7A2 2 0 0 0 5 8V16A2 2 0 0 0 7 18H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M13 8L17 12L13 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 12H17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SidebarNavIcon({
  kind,
  active = false,
}: {
  kind: SidebarItem["kind"];
  active?: boolean;
}) {
  const stroke = active ? "#E5E5E5" : "currentColor";

  if (kind === "overview") {
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <path d="M5 5H10V10H5V5Z" stroke={stroke} strokeWidth="1.7" />
        <path d="M14 5H19V10H14V5Z" stroke={stroke} strokeWidth="1.7" />
        <path d="M5 14H10V19H5V14Z" stroke={stroke} strokeWidth="1.7" />
        <path d="M14 14H19V19H14V14Z" stroke={stroke} strokeWidth="1.7" />
      </svg>
    );
  }

  if (kind === "settings") {
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <path d="M12 4L19 8V16L12 20L5 16V8L12 4Z" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M12 4V20" stroke={stroke} strokeWidth="1.4" />
      </svg>
    );
  }

  if (kind === "payments") {
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <path d="M6 7H18" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M6 12H18" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M6 17H14" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "methods") {
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <path d="M5 18V6" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M5 18L11 12L15 15L19 7" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === "plans") {
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="7" stroke={stroke} strokeWidth="1.7" />
        <path d="M9.5 12H14.5" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "analytics") {
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <path d="M6 18V10" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M12 18V6" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M18 18V13" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "integrations") {
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <path d="M8 8H16V16H8V8Z" stroke={stroke} strokeWidth="1.7" />
        <path d="M12 4V8" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M12 16V20" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M4 12H8" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M16 12H20" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "storage") {
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <ellipse cx="12" cy="7" rx="6.5" ry="2.8" stroke={stroke} strokeWidth="1.7" />
        <path d="M5.5 7V17C5.5 18.55 8.41 19.8 12 19.8C15.59 19.8 18.5 18.55 18.5 17V7" stroke={stroke} strokeWidth="1.7" />
      </svg>
    );
  }

  if (kind === "support") {
    return (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
        <path d="M7.5 15.5V9.5C7.5 7.01 9.51 5 12 5C14.49 5 16.5 7.01 16.5 9.5V15.5" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M6 15H7.5V17.5H6C5.17 17.5 4.5 16.83 4.5 16V16C4.5 15.17 5.17 14.5 6 14.5V15Z" stroke={stroke} strokeWidth="1.7" />
        <path d="M18 15H16.5V17.5H18C18.83 17.5 19.5 16.83 19.5 16V16C19.5 15.17 18.83 14.5 18 14.5V15Z" stroke={stroke} strokeWidth="1.7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" aria-hidden="true">
      <path d="M12 4.5L13.7 6.5L16.3 6.2L16.8 8.8L19 10L17.8 12.2L18.1 14.8L15.5 15.3L13.5 17L12 19.5L10.5 17L8.5 15.3L5.9 14.8L6.2 12.2L5 10L7.2 8.8L7.7 6.2L10.3 6.5L12 4.5Z" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.8" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

function StatusRing({ status }: { status: ManagedServerStatus }) {
  const style = statusStyle(status);
  return (
    <div className="flex h-[42px] w-[42px] items-center justify-center rounded-full p-[2px]" style={{ background: style.ringColor }} aria-hidden="true">
      <div className="flex h-full w-full items-center justify-center rounded-full bg-[#0A0A0A]">
        <div className={`h-[8px] w-[8px] rounded-full ${status === "paid" ? "bg-[#0062FF]" : status === "expired" ? "bg-[#F2C823]" : "bg-[#DB4646]"}`} />
      </div>
    </div>
  );
}

function FallbackServerIcon() {
  return <div className="flex h-[54px] w-[54px] items-center justify-center rounded-[16px] bg-[#131313] text-[15px] font-semibold text-[#7A7A7A]">FD</div>;
}

function ServerListRow({
  server,
  index,
  isSelected,
  isCopied,
  openCardMenuGuildId,
  onOpen,
  onPrefetch,
  onCopy,
  onToggleMenu,
  onCopyFromMenu,
  onDeactivate,
}: {
  server: ManagedServer;
  index: number;
  isSelected: boolean;
  isCopied: boolean;
  openCardMenuGuildId: string | null;
  onOpen: (guildId: string) => void;
  onPrefetch: (guildId: string) => void;
  onCopy: (guildId: string) => void;
  onToggleMenu: (guildId: string) => void;
  onCopyFromMenu: (guildId: string) => void;
  onDeactivate: () => void;
}) {
  const style = statusStyle(server.status);

  return (
    <LandingReveal delay={Math.min(index, 10) * 55}>
      <article className={`flowdesk-landing-soft-motion relative cursor-pointer border-b border-[#141414] bg-[#0A0A0A] px-[18px] py-[18px] transition-[background-color,border-color] duration-250 hover:border-[#1E1E1E] hover:bg-[#0D0D0D] ${isSelected ? "bg-[#101010]" : ""}`} onClick={() => onOpen(server.guildId)} onMouseEnter={() => onPrefetch(server.guildId)} onFocus={() => onPrefetch(server.guildId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(server.guildId); } }} role="button" tabIndex={0}>
        <div className="flex flex-col gap-[18px] xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-[16px]">
            {server.iconUrl ? <Image src={server.iconUrl} alt={server.guildName} width={56} height={56} className="h-[56px] w-[56px] rounded-[16px] object-cover" unoptimized /> : <FallbackServerIcon />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
                <h3 className="truncate text-[18px] leading-none font-medium tracking-[-0.03em] text-[#E5E5E5]">{server.guildName}</h3>
                <span className={`inline-flex items-center rounded-full px-[10px] py-[6px] text-[11px] leading-none font-medium ${style.badgeClass}`}>{style.badgeText}</span>
              </div>
              <div className="mt-[10px] flex flex-wrap items-center gap-x-[14px] gap-y-[8px] text-[13px] text-[#6F6F6F]">
                <span className="truncate">ID {server.guildId}</span>
                <button type="button" onClick={(event) => { event.stopPropagation(); onCopy(server.guildId); }} className={`inline-flex items-center gap-[7px] transition-colors ${isCopied ? "text-[#8AB6FF]" : "hover:text-[#C4C4C4]"}`} aria-label="Copiar ID do servidor">
                  <span className="relative inline-flex h-[15px] w-[15px] items-center justify-center">
                    <span className={`absolute inset-0 inline-flex items-center justify-center transition-all duration-200 ${isCopied ? "scale-75 opacity-0" : "scale-100 opacity-100"}`}><CopyIcon /></span>
                    <span className={`inline-flex items-center justify-center transition-all duration-200 ${isCopied ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}><CheckIcon /></span>
                  </span>
                  <span>{isCopied ? "Copiado" : "Copiar ID"}</span>
                </button>
              </div>
            </div>
          </div>
          <div className="grid gap-[8px] xl:min-w-[250px] xl:justify-items-start">
            <p className="text-[17px] leading-none font-medium text-[#DADADA]">{serverMetaLabel(server)}</p>
            <p className="text-[13px] leading-[1.45] text-[#777777]">{statusDescription(server)}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-[12px] xl:ml-[18px]">
            <span className="inline-flex items-center rounded-full border border-[#1B1B1B] bg-[#111111] px-[12px] py-[8px] text-[12px] leading-none text-[#D0D0D0]">owner {String(server.licenseOwnerUserId).slice(0, 10)}</span>
            <StatusRing status={server.status} />
            <div
              className={`relative ${
                openCardMenuGuildId === server.guildId ? "z-[80]" : "z-0"
              }`}
              data-server-card-menu-root="true"
            >
              <button type="button" onClick={(event) => { event.stopPropagation(); onToggleMenu(server.guildId); }} className="flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#101010] text-[#7B7B7B] transition-colors hover:border-[#222222] hover:text-[#D0D0D0]" aria-label="Abrir menu do servidor"><MenuDotsIcon /></button>
              {openCardMenuGuildId === server.guildId ? <div className="absolute right-0 top-[48px] z-[160] min-w-[186px] rounded-[16px] border border-[#171717] bg-[#0A0A0A] p-[8px] shadow-[0_22px_60px_rgba(0,0,0,0.44)]"><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(server.guildId); onToggleMenu(server.guildId); }} className="flex w-full items-center rounded-[12px] px-[12px] py-[10px] text-left text-[13px] text-[#D0D0D0] transition-colors hover:bg-[#111111]">Abrir configuracoes</button><button type="button" onClick={(event) => { event.stopPropagation(); onCopyFromMenu(server.guildId); }} className="mt-[4px] flex w-full items-center rounded-[12px] px-[12px] py-[10px] text-left text-[13px] text-[#D0D0D0] transition-colors hover:bg-[#111111]">Copiar ID</button>{server.accessMode === "owner" ? <button type="button" onClick={(event) => { event.stopPropagation(); onDeactivate(); }} className="mt-[4px] flex w-full items-center rounded-[12px] px-[12px] py-[10px] text-left text-[13px] text-[#DB8A8A] transition-colors hover:bg-[#111111]">Desativar bot</button> : null}</div> : null}
            </div>
          </div>
        </div>
      </article>
    </LandingReveal>
  );
}

function ServerGridCard({
  server,
  index,
  isSelected,
  isCopied,
  openCardMenuGuildId,
  onOpen,
  onPrefetch,
  onCopy,
  onToggleMenu,
  onCopyFromMenu,
  onDeactivate,
}: {
  server: ManagedServer;
  index: number;
  isSelected: boolean;
  isCopied: boolean;
  openCardMenuGuildId: string | null;
  onOpen: (guildId: string) => void;
  onPrefetch: (guildId: string) => void;
  onCopy: (guildId: string) => void;
  onToggleMenu: (guildId: string) => void;
  onCopyFromMenu: (guildId: string) => void;
  onDeactivate: () => void;
}) {
  const style = statusStyle(server.status);

  return (
    <LandingReveal delay={Math.min(index, 8) * 60}>
      <article
        className={`flowdesk-landing-soft-motion relative cursor-pointer rounded-[26px] border border-[#151515] bg-[#0A0A0A] p-[18px] transition-[border-color,background-color,transform] duration-250 hover:border-[#1E1E1E] hover:bg-[#0D0D0D] ${isSelected ? "border-[rgba(0,98,255,0.28)] bg-[#0E0E0E]" : ""}`}
        onClick={() => onOpen(server.guildId)}
        onMouseEnter={() => onPrefetch(server.guildId)}
        onFocus={() => onPrefetch(server.guildId)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(server.guildId);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-start justify-between gap-[14px]">
          <div className="flex min-w-0 items-start gap-[14px]">
            {server.iconUrl ? (
              <Image
                src={server.iconUrl}
                alt={server.guildName}
                width={56}
                height={56}
                className="h-[56px] w-[56px] rounded-[16px] object-cover"
                unoptimized
              />
            ) : (
              <FallbackServerIcon />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-[10px]">
                <h3 className="truncate text-[18px] leading-none font-medium tracking-[-0.04em] text-[#E7E7E7]">
                  {server.guildName}
                </h3>
              </div>
              <p className="mt-[10px] truncate text-[14px] leading-none text-[#8D8D8D]">
                {serverMetaLabel(server)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-[10px]">
            <StatusRing status={server.status} />
            <div
              className={`relative ${
                openCardMenuGuildId === server.guildId ? "z-[80]" : "z-0"
              }`}
              data-server-card-menu-root="true"
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleMenu(server.guildId);
                }}
                className="flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#101010] text-[#7B7B7B] transition-colors hover:border-[#222222] hover:text-[#D0D0D0]"
                aria-label="Abrir menu do servidor"
              >
                <MenuDotsIcon />
              </button>
              {openCardMenuGuildId === server.guildId ? (
                <div className="absolute right-0 top-[48px] z-[160] min-w-[186px] rounded-[16px] border border-[#171717] bg-[#0A0A0A] p-[8px] shadow-[0_22px_60px_rgba(0,0,0,0.44)]">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(server.guildId);
                      onToggleMenu(server.guildId);
                    }}
                    className="flex w-full items-center rounded-[12px] px-[12px] py-[10px] text-left text-[13px] text-[#D0D0D0] transition-colors hover:bg-[#111111]"
                  >
                    Abrir configuracoes
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCopyFromMenu(server.guildId);
                    }}
                    className="mt-[4px] flex w-full items-center rounded-[12px] px-[12px] py-[10px] text-left text-[13px] text-[#D0D0D0] transition-colors hover:bg-[#111111]"
                  >
                    Copiar ID
                  </button>
                  {server.accessMode === "owner" ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeactivate();
                      }}
                      className="mt-[4px] flex w-full items-center rounded-[12px] px-[12px] py-[10px] text-left text-[13px] text-[#DB8A8A] transition-colors hover:bg-[#111111]"
                    >
                      Desativar bot
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCopy(server.guildId);
          }}
          className={`mt-[18px] inline-flex max-w-full items-center gap-[8px] rounded-full border px-[12px] py-[8px] text-[13px] leading-none transition-colors ${
            isCopied
              ? "border-[rgba(0,98,255,0.3)] bg-[rgba(0,98,255,0.09)] text-[#9CC0FF]"
              : "border-[#1A1A1A] bg-[#101010] text-[#D8D8D8] hover:border-[#262626] hover:bg-[#131313]"
          }`}
        >
          <span className="relative inline-flex h-[15px] w-[15px] items-center justify-center">
            <span
              className={`absolute inset-0 inline-flex items-center justify-center transition-all duration-200 ${
                isCopied ? "scale-75 opacity-0" : "scale-100 opacity-100"
              }`}
            >
              <CopyIcon />
            </span>
            <span
              className={`inline-flex items-center justify-center transition-all duration-200 ${
                isCopied ? "scale-100 opacity-100" : "scale-75 opacity-0"
              }`}
            >
              <CheckIcon />
            </span>
          </span>
          <span className="truncate">{isCopied ? "Copiado" : `${server.guildId.slice(0, 18)}...`}</span>
        </button>

        <div className="mt-[18px] rounded-[20px] border border-[#141414] bg-[#080808] px-[16px] py-[16px]">
          <div className="flex items-center justify-between gap-[12px]">
            <p className="text-[12px] leading-none font-medium uppercase tracking-[0.18em] text-[#686868]">
              {style.badgeText}
            </p>
            <span className={`inline-flex items-center rounded-full px-[10px] py-[6px] text-[11px] leading-none font-medium ${style.badgeClass}`}>
              {server.accessMode === "owner" ? "owner" : "viewer"}
            </span>
          </div>
          <p className="mt-[14px] text-[17px] leading-[1.28] font-medium tracking-[-0.03em] text-[#E9E9E9]">
            {statusDescription(server)}
          </p>
          <p className="mt-[10px] text-[14px] leading-[1.45] text-[#8C8C8C]">
            {formatDateLabel(server.licensePaidAt)} • {server.accessMode === "owner" ? "licenca principal" : "acesso de visualizacao"}
          </p>
        </div>
      </article>
    </LandingReveal>
  );
}

export function ServersWorkspace({
  displayName,
  initialGuildId = null,
  initialTab = "settings",
  initialServers = null,
  initialTeams = null,
  initialPendingInvites = null,
}: ServersWorkspaceProps) {
  const router = useRouter();
  const [servers, setServers] = useState<ManagedServer[]>(initialServers ?? []);
  const [isLoading, setIsLoading] = useState(initialServers === null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterOption>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [copiedGuildId, setCopiedGuildId] = useState<string | null>(null);
  const [openCardMenuGuildId, setOpenCardMenuGuildId] = useState<string | null>(null);
  const [teams, setTeams] = useState<UserTeam[]>(initialTeams ?? []);
  const [pendingTeamInvites, setPendingTeamInvites] = useState<PendingTeamInvite[]>(
    initialPendingInvites ?? [],
  );
  const [isTeamsLoading, setIsTeamsLoading] = useState(initialTeams === null);
  const [teamsErrorMessage, setTeamsErrorMessage] = useState<string | null>(null);
  const [isTeamMenuOpen, setIsTeamMenuOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [isCreateTeamModalOpen, setIsCreateTeamModalOpen] = useState(false);
  const [createTeamStep, setCreateTeamStep] = useState<CreateTeamStep>("name");
  const [createTeamName, setCreateTeamName] = useState("");
  const [createTeamIconKey, setCreateTeamIconKey] = useState<string>("aurora");
  const [createTeamServerIds, setCreateTeamServerIds] = useState<string[]>([]);
  const [createTeamMemberIds, setCreateTeamMemberIds] = useState<string[]>([]);
  const [isMemberSubmodalOpen, setIsMemberSubmodalOpen] = useState(false);
  const [memberDraftIds, setMemberDraftIds] = useState<string[]>([""]);
  const [teamActionMessage, setTeamActionMessage] = useState<string | null>(null);
  const [teamActionError, setTeamActionError] = useState<string | null>(null);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [acceptingTeamId, setAcceptingTeamId] = useState<number | null>(null);
  const [selectedGuildIdForConfig, setSelectedGuildIdForConfig] = useState<string | null>(initialGuildId);
  const [selectedEditorTabForConfig, setSelectedEditorTabForConfig] = useState<ServerEditorTab>(initialTab);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const desktopTeamMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileTeamMenuRef = useRef<HTMLDivElement | null>(null);

  const applyTeamsSnapshot = useCallback(
    (payload: TeamsApiResponse, preferredTeamId: number | null = null) => {
      const nextTeams = payload.teams || [];
      const nextPendingInvites = payload.pendingInvites || [];
      setTeams(nextTeams);
      setPendingTeamInvites(nextPendingInvites);
      setSelectedTeamId((current) => {
        if (preferredTeamId && nextTeams.some((team) => team.id === preferredTeamId)) {
          return preferredTeamId;
        }
        if (current && nextTeams.some((team) => team.id === current)) {
          return current;
        }
        return null;
      });
    },
    [],
  );

  useEffect(() => {
    if (initialServers !== null) {
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);

    async function loadServers() {
      try {
        const response = await fetch("/api/auth/me/servers", { cache: "no-store", signal: controller.signal });
        const payload = (await response.json()) as ServersApiResponse;
        if (!isMounted) return;
        if (!response.ok || !payload.ok) throw new Error(payload.message || "Falha ao carregar servidores.");
        setServers(payload.servers || []);
      } catch (error) {
        if (!isMounted) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          setErrorMessage("Tempo esgotado ao carregar servidores. Tente novamente.");
          setServers([]);
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "Erro ao carregar servidores.");
        setServers([]);
      } finally {
        if (!isMounted) return;
        window.clearTimeout(timeoutId);
        setIsLoading(false);
      }
    }

    void loadServers();
    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [initialServers]);

  useEffect(() => {
    if (initialTeams !== null) {
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    async function loadTeams() {
      try {
        const response = await fetch("/api/auth/me/teams", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as TeamsApiResponse;
        if (!isMounted) return;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Falha ao carregar equipes.");
        }
        applyTeamsSnapshot(payload);
      } catch (error) {
        if (!isMounted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTeamsErrorMessage(
          error instanceof Error ? error.message : "Erro ao carregar equipes.",
        );
      } finally {
        if (!isMounted) return;
        setIsTeamsLoading(false);
      }
    }

    void loadTeams();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [applyTeamsSnapshot, initialTeams]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && statusRef.current && !statusRef.current.contains(target)) setIsStatusOpen(false);
      if (target instanceof Element && !target.closest("[data-server-card-menu-root='true']")) setOpenCardMenuGuildId(null);
      const clickedInsideDesktopMenu =
        target && desktopTeamMenuRef.current
          ? desktopTeamMenuRef.current.contains(target)
          : false;
      const clickedInsideMobileMenu =
        target && mobileTeamMenuRef.current
          ? mobileTeamMenuRef.current.contains(target)
          : false;
      if (!clickedInsideDesktopMenu && !clickedInsideMobileMenu) {
        setIsTeamMenuOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsStatusOpen(false);
        setOpenCardMenuGuildId(null);
        setIsTeamMenuOpen(false);
        setIsMemberSubmodalOpen(false);
        setIsCreateTeamModalOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!isCreateTeamModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCreateTeamModalOpen]);

  const normalizedQuery = useMemo(() => normalizeSearchText(searchText), [searchText]);
  const normalizedInviteDraftDiscordIds = useMemo(() => {
    return Array.from(
      new Set(
        memberDraftIds
          .map((value) => value.trim())
          .filter((value) => /^\d{10,25}$/.test(value)),
      ),
    ).slice(0, 30);
  }, [memberDraftIds]);
  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) || null,
    [selectedTeamId, teams],
  );
  const teamServerOptions = useMemo(
    () =>
      [...servers].sort((a, b) =>
        a.guildName.localeCompare(b.guildName, "pt-BR"),
      ),
    [servers],
  );
  const visibleServers = useMemo(() => {
    if (!selectedTeam) return servers;
    const allowedGuildIds = new Set(selectedTeam.linkedGuildIds);
    return servers.filter((server) => allowedGuildIds.has(server.guildId));
  }, [selectedTeam, servers]);

  const filteredServers = useMemo(() => {
    return visibleServers.map((server) => ({ server, score: getSearchScore(server.guildName, normalizedQuery) }))
      .filter((item) => item.score > 0)
      .filter((item) => (statusFilter === "all" ? true : item.server.status === statusFilter))
      .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.server.guildName.localeCompare(b.server.guildName, "pt-BR")))
      .map((item) => item.server);
  }, [normalizedQuery, visibleServers, statusFilter]);
  const activeTeamServerCount = visibleServers.length;

  const buildServerConfigUrl = useCallback((guildId: string, tab: ServerEditorTab) => {
    const encodedGuildId = encodeURIComponent(guildId);
    return tab === "settings" ? `/servers/${encodedGuildId}` : `/servers/${encodedGuildId}?tab=${encodeURIComponent(tab)}`;
  }, []);

  const navigateToUrl = useCallback((nextUrl: string, mode: "push" | "replace" = "push") => {
    if (typeof window === "undefined") return;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentUrl === nextUrl) return;
    if (mode === "replace") router.replace(nextUrl, { scroll: false });
    else router.push(nextUrl, { scroll: false });
  }, [router]);

  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { window.location.assign("/login"); }
  }, [isLoggingOut]);

  const handleCopyGuildId = useCallback(async (guildId: string) => {
    try {
      await navigator.clipboard.writeText(guildId);
      setCopiedGuildId(guildId);
      window.setTimeout(() => setCopiedGuildId((current) => (current === guildId ? null : current)), 1000);
    } catch {
      setCopiedGuildId(null);
    }
  }, []);

  const handleCardMenuCopyId = useCallback((guildId: string) => {
    void handleCopyGuildId(guildId);
    setOpenCardMenuGuildId(null);
  }, [handleCopyGuildId]);

  const handleCardMenuDeactivate = useCallback(() => {
    setOpenCardMenuGuildId(null);
    setErrorMessage("Opcao de desativacao sera liberada em breve.");
  }, []);

  const resetCreateTeamForm = useCallback(() => {
    setCreateTeamStep("name");
    setCreateTeamName("");
    setCreateTeamIconKey("aurora");
    setCreateTeamServerIds([]);
    setCreateTeamMemberIds([]);
    setIsMemberSubmodalOpen(false);
    setMemberDraftIds([""]);
    setTeamActionError(null);
  }, []);

  const openCreateTeamModal = useCallback(() => {
    resetCreateTeamForm();
    setTeamActionMessage(null);
    setIsTeamMenuOpen(false);
    setIsCreateTeamModalOpen(true);
  }, [resetCreateTeamForm]);

  const handleToggleCreateTeamServer = useCallback((guildId: string) => {
    setCreateTeamServerIds((current) =>
      current.includes(guildId)
        ? current.filter((value) => value !== guildId)
        : [...current, guildId],
    );
  }, []);

  const handleSelectTeam = useCallback(
    (teamId: number | null) => {
      setSelectedTeamId(teamId);
      setIsTeamMenuOpen(false);
      setTeamActionMessage(null);
      setTeamActionError(null);
    },
    [],
  );

  const handleOpenMemberSubmodal = useCallback(() => {
    setMemberDraftIds([""]);
    setTeamActionError(null);
    setIsMemberSubmodalOpen(true);
  }, []);

  const handleMemberDraftChange = useCallback((index: number, value: string) => {
    setMemberDraftIds((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? value : draft)),
    );
  }, []);

  const handleAddMemberDraftField = useCallback(() => {
    setMemberDraftIds((current) => [...current, ""]);
  }, []);

  const handleConfirmMemberDrafts = useCallback(() => {
    if (!normalizedInviteDraftDiscordIds.length) {
      setTeamActionError("Adicione pelo menos um ID valido para convidar membros.");
      return;
    }
    setCreateTeamMemberIds((current) =>
      Array.from(new Set([...current, ...normalizedInviteDraftDiscordIds])).slice(0, 50),
    );
    setIsMemberSubmodalOpen(false);
    setMemberDraftIds([""]);
    setTeamActionError(null);
  }, [normalizedInviteDraftDiscordIds]);

  const handleRemoveTeamMemberId = useCallback((discordId: string) => {
    setCreateTeamMemberIds((current) => current.filter((value) => value !== discordId));
  }, []);

  const handleCreateTeam = useCallback(async () => {
    if (isCreatingTeam) return;
    setIsCreatingTeam(true);
    setTeamActionError(null);
    setTeamActionMessage(null);

    try {
      const response = await fetch("/api/auth/me/teams", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: createTeamName,
          iconKey: createTeamIconKey,
          guildIds: createTeamServerIds,
          memberDiscordIds: createTeamMemberIds,
        }),
      });

      const payload = (await response.json()) as TeamsApiResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Nao foi possivel criar a equipe.");
      }

      const trimmedName = createTeamName.trim();
      const createdTeamId =
        payload.createdTeamId ||
        [...(payload.teams || [])]
          .reverse()
          .find((team) => team.name === trimmedName)?.id ||
        null;

      applyTeamsSnapshot(payload, createdTeamId);
      setTeamActionMessage("Equipe criada com sucesso.");
      setIsCreateTeamModalOpen(false);
      setIsTeamMenuOpen(true);
      resetCreateTeamForm();
    } catch (error) {
      setTeamActionError(
        error instanceof Error ? error.message : "Erro ao criar equipe.",
      );
    } finally {
      setIsCreatingTeam(false);
    }
  }, [
    applyTeamsSnapshot,
    createTeamName,
    createTeamIconKey,
    createTeamMemberIds,
    createTeamServerIds,
    isCreatingTeam,
    resetCreateTeamForm,
  ]);

  const handleAcceptTeamInvite = useCallback(
    async (teamId: number) => {
      if (acceptingTeamId === teamId) return;
      setAcceptingTeamId(teamId);
      setTeamActionError(null);
      setTeamActionMessage(null);

      try {
        const response = await fetch(`/api/auth/me/teams/${teamId}/accept`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        });

        const payload = (await response.json()) as TeamsApiResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(
            payload.message || "Nao foi possivel aceitar o convite.",
          );
        }

        applyTeamsSnapshot(payload, teamId);
        setTeamActionMessage("Convite aceito. Equipe adicionada ao painel.");
      } catch (error) {
        setTeamActionError(
          error instanceof Error
            ? error.message
            : "Erro ao aceitar convite da equipe.",
        );
      } finally {
        setAcceptingTeamId(null);
      }
    },
    [acceptingTeamId, applyTeamsSnapshot],
  );

  const handleOpenServerConfig = useCallback((guildId: string, tab: ServerEditorTab = "settings") => {
    setSelectedGuildIdForConfig(guildId);
    setSelectedEditorTabForConfig(tab);
    setErrorMessage(null);
    navigateToUrl(buildServerConfigUrl(guildId, tab), "push");
  }, [buildServerConfigUrl, navigateToUrl]);

  const prefetchServerConfig = useCallback((guildId: string, tab: ServerEditorTab = "settings") => {
    router.prefetch(buildServerConfigUrl(guildId, tab));
  }, [buildServerConfigUrl, router]);

  const selectedServer = useMemo(() => servers.find((server) => server.guildId === selectedGuildIdForConfig) || null, [selectedGuildIdForConfig, servers]);
  const isEditingServer = Boolean(selectedGuildIdForConfig);
  const shouldShowEditorSkeleton = Boolean(selectedGuildIdForConfig) && isLoading && !selectedServer;

  useEffect(() => {
    if (!selectedGuildIdForConfig) return;
    if (visibleServers.some((server) => server.guildId === selectedGuildIdForConfig)) {
      return;
    }
    setSelectedGuildIdForConfig(null);
    setSelectedEditorTabForConfig("settings");
    navigateToUrl("/servers", "replace");
  }, [navigateToUrl, selectedGuildIdForConfig, visibleServers]);

  useEffect(() => {
    if (isLoading || !selectedGuildIdForConfig || selectedServer) return;
    setSelectedGuildIdForConfig(null);
    setSelectedEditorTabForConfig("settings");
    navigateToUrl("/servers", "replace");
  }, [isLoading, navigateToUrl, selectedGuildIdForConfig, selectedServer]);

  const panelTitle = isEditingServer ? "Servidor selecionado" : viewMode === "overview" ? "Overview" : "Servidores em lista";
  const panelDescription = isEditingServer
    ? "Gerencie configuracoes, pagamentos, metodos e planos sem perder o contexto visual da plataforma."
    : viewMode === "overview"
      ? selectedTeam
        ? `Servidores vinculados a equipe ${selectedTeam.name}, com visao mais limpa para moderacao, licencas e operacao do painel.`
        : "Uma visao mais limpa para encontrar servidores, acompanhar licencas e abrir configuracoes rapido."
      : selectedTeam
        ? `Modo lista da equipe ${selectedTeam.name}, com todos os servidores vinculados organizados no mesmo fluxo.`
        : "Modo lista para navegar mais rapido entre todos os servidores e licencas.";
  const teamSummaryLabel = isTeamsLoading
    ? "Carregando equipes..."
    : selectedTeam
      ? `${selectedTeam.memberCount} membro(s) • ${selectedTeam.linkedGuildIds.length} servidor(es)`
      : teams.length
        ? `${teams.length} equipe(s) disponivel(is)`
        : pendingTeamInvites.length
          ? `${pendingTeamInvites.length} convite(s) pendente(s)`
          : "Nenhuma equipe criada";
  const renderSidebarContent = (teamDropdownRef: RefObject<HTMLDivElement | null>) => (
    <div className="flex h-full flex-col px-[14px] py-[14px]">
      <div ref={teamDropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setIsTeamMenuOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-[12px] rounded-[18px] border border-[#111111] bg-[#080808] px-[10px] py-[10px] text-left transition-colors hover:border-[#1A1A1A] hover:bg-[#0B0B0B]"
          aria-expanded={isTeamMenuOpen}
          aria-haspopup="dialog"
        >
          <div className="flex min-w-0 items-center gap-[10px]">
            {selectedTeam ? (
              <TeamAvatar
                iconKey={selectedTeam.iconKey}
                name={selectedTeam.name}
                className="h-[34px] w-[34px] shrink-0 rounded-full"
                textClassName="text-[13px] text-[#F0F0F0]"
              />
            ) : (
              <SidebarWorkspaceIcon />
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] leading-none font-medium tracking-[-0.03em] text-[#E5E5E5]">
                {selectedTeam ? selectedTeam.name : displayName}
              </p>
              <p className="mt-[5px] truncate text-[12px] leading-none text-[#6D6D6D]">{teamSummaryLabel}</p>
            </div>
          </div>
          <div className="flex items-center">
            <span className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-[10px] text-[#7E7E7E] transition-colors hover:bg-[#101010] hover:text-[#D8D8D8]">
              <SidebarMiniChevron />
            </span>
          </div>
        </button>
        {isTeamMenuOpen ? (
          <div
            className="absolute left-0 right-0 top-[calc(100%+10px)] z-[120] overflow-hidden rounded-[22px] border border-[#151515] bg-[#070707] p-[12px] shadow-[0_26px_80px_rgba(0,0,0,0.54)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="space-y-[8px]">
              <div>
                <p className="px-[4px] text-[11px] uppercase tracking-[0.16em] text-[#5F5F5F]">Trocar equipe</p>
                <div className="mt-[10px] space-y-[6px]">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleSelectTeam(null);
                    }}
                    className={`flex w-full items-center justify-between rounded-[14px] px-[12px] py-[11px] text-left transition-colors ${
                      !selectedTeam
                        ? "bg-[#141414] text-[#ECECEC]"
                        : "text-[#A7A7A7] hover:bg-[#111111] hover:text-[#E6E6E6]"
                    }`}
                  >
                    <span className="inline-flex items-center gap-[10px]">
                      <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] border border-[#171717] bg-[#0D0D0D] text-[#A7A7A7]">
                        <TeamIcon />
                      </span>
                      <span>
                        <span className="block text-[14px] leading-none font-medium tracking-[-0.03em]">
                          Todos os servidores
                        </span>
                        <span className="mt-[5px] block text-[11px] leading-none text-[#666666]">
                          Visual geral do painel
                        </span>
                      </span>
                    </span>
                    {!selectedTeam ? (
                      <span className="h-[7px] w-[7px] rounded-full bg-[#0062FF]" />
                    ) : null}
                  </button>
                  {teams.map((team) => {
                    const isSelected = selectedTeamId === team.id;
                    return (
                      <button
                        key={team.id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelectTeam(team.id);
                        }}
                        className={`flex w-full items-center justify-between rounded-[14px] px-[12px] py-[11px] text-left transition-colors ${
                          isSelected
                            ? "bg-[#141414] text-[#ECECEC]"
                            : "text-[#A7A7A7] hover:bg-[#111111] hover:text-[#E6E6E6]"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-[10px]">
                          <TeamAvatar
                            iconKey={team.iconKey}
                            name={team.name}
                            className="h-[30px] w-[30px] shrink-0"
                            textClassName="text-[12px] text-[#F3F3F3]"
                          />
                          <span className="min-w-0">
                          <span className="block truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                            {team.name}
                          </span>
                          <span className="mt-[5px] block truncate text-[11px] leading-none text-[#666666]">
                            {team.memberCount} membro(s) • {team.linkedGuildIds.length} servidor(es)
                          </span>
                          </span>
                        </span>
                        {isSelected ? (
                          <span className="h-[7px] w-[7px] rounded-full bg-[#0062FF]" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              {pendingTeamInvites.length ? (
                <div className="border-t border-[#121212] pt-[12px]">
                  <p className="px-[4px] text-[11px] uppercase tracking-[0.16em] text-[#5F5F5F]">
                    Convites pendentes
                  </p>
                  <div className="mt-[10px] space-y-[8px]">
                    {pendingTeamInvites.map((invite) => (
                      <div
                        key={invite.membershipId}
                        className="rounded-[14px] border border-[#141414] bg-[#0D0D0D] px-[12px] py-[11px]"
                      >
                        <p className="truncate text-[14px] leading-none font-medium tracking-[-0.03em] text-[#E9E9E9]">
                          {invite.teamName}
                        </p>
                        <p className="mt-[6px] text-[11px] leading-[1.4] text-[#6E6E6E]">
                          Convite enviado por {invite.invitedByDisplayName}
                        </p>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleAcceptTeamInvite(invite.teamId);
                          }}
                          disabled={acceptingTeamId === invite.teamId}
                          className="mt-[10px] inline-flex h-[34px] items-center justify-center rounded-[12px] bg-[#F4F4F4] px-[14px] text-[12px] font-medium text-[#111111] transition-transform duration-200 hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {acceptingTeamId === invite.teamId ? (
                            <ButtonLoader size={14} colorClassName="text-[#111111]" />
                          ) : (
                            "Aceitar convite"
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="border-t border-[#121212] pt-[12px]">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openCreateTeamModal();
                  }}
                  className="group relative inline-flex h-[46px] w-full shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[14px] leading-none font-semibold"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-[12px] bg-[#111111] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                  />
                  <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap leading-none text-[#B7B7B7]">
                    Criar equipe
                  </span>
                </button>
              </div>

              {teamsErrorMessage ? (
                <p className="text-[12px] leading-[1.45] text-[#D98484]">{teamsErrorMessage}</p>
              ) : null}
              {teamActionError ? (
                <p className="text-[12px] leading-[1.45] text-[#D98484]">{teamActionError}</p>
              ) : null}
              {teamActionMessage ? (
                <p className="text-[12px] leading-[1.45] text-[#8AB6FF]">{teamActionMessage}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-[14px] flex items-center gap-[10px] rounded-[16px] border border-[#141414] bg-[#080808] px-[14px] py-[12px]">
        <SearchIcon />
        <input
          type="text"
          placeholder="Find..."
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#5A5A5A]"
        />
        <SidebarSearchShortcutIcon />
      </div>

      <div className="mt-[14px] flex-1 overflow-y-auto pr-[2px]">
        {SIDEBAR_SECTIONS.map((section, sectionIndex) => (
          <div key={sectionIndex} className={sectionIndex === 0 ? "" : "mt-[12px] border-t border-[#121212] pt-[12px]"}>
            <div className="space-y-[4px]">
              {section.map((item) => {
                const isOverview = item.tab === null;
                const isActive = isOverview ? !isEditingServer : Boolean(item.tab && selectedEditorTabForConfig === item.tab && isEditingServer);
                const isDisabled = item.disabled || Boolean(!isOverview && item.tab && !selectedServer);

                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      if (isDisabled) return;
                      if (isOverview) {
                        setSelectedGuildIdForConfig(null);
                        setSelectedEditorTabForConfig("settings");
                        navigateToUrl("/servers", "push");
                        return;
                      }
                      if (!selectedServer || !item.tab) return;
                      setSelectedGuildIdForConfig(selectedServer.guildId);
                      setSelectedEditorTabForConfig(item.tab);
                      navigateToUrl(buildServerConfigUrl(selectedServer.guildId, item.tab), "replace");
                    }}
                    disabled={isDisabled}
                    className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-all duration-200 ${
                      isActive
                        ? "bg-[#1E1E1E] text-[#F0F0F0]"
                        : isDisabled
                          ? "text-[#585858]"
                          : "text-[#B5B5B5] hover:bg-[#111111] hover:text-[#E3E3E3]"
                    }`}
                  >
                    <span className={`inline-flex h-[22px] w-[22px] items-center justify-center ${isActive ? "text-[#F0F0F0]" : isDisabled ? "text-[#4A4A4A]" : "text-[#8A8A8A] group-hover:text-[#DADADA]"}`}>
                      <SidebarNavIcon kind={item.kind} active={isActive} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">{item.label}</span>
                    {item.chevron ? (
                      <span className={`${isDisabled ? "text-[#4C4C4C]" : "text-[#686868] group-hover:text-[#BEBEBE]"}`}>
                        <SidebarMiniChevron />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-[14px] border-t border-[#121212] pt-[14px]">
        <div className="flex items-center gap-[10px]">
          <div className="flex min-w-0 flex-1 items-center gap-[10px]">
            <div className="relative flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,#7D3BFF_0%,#3C0F6D_54%,#170822_100%)] text-[14px] font-semibold text-[#F0F0F0] shadow-[0_0_28px_rgba(125,59,255,0.14)]">
              {displayName.trim().charAt(0).toUpperCase() || "F"}
              <span className="absolute bottom-[2px] right-[2px] h-[8px] w-[8px] rounded-full bg-[#0062FF]" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] leading-none font-medium tracking-[-0.03em] text-[#E5E5E5]">{displayName}</p>
              <p className="mt-[5px] truncate text-[12px] leading-none text-[#686868]">workspace online</p>
            </div>
          </div>
          <button type="button" className="relative inline-flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[#161616] bg-[#090909] text-[#868686] transition-colors hover:bg-[#101010] hover:text-[#E1E1E1]" aria-label="Notificacoes">
            <SidebarBellIcon />
            <span className="absolute right-[9px] top-[8px] h-[7px] w-[7px] rounded-full bg-[#0062FF]" />
          </button>
          <button type="button" onClick={() => { void handleLogout(); }} disabled={isLoggingOut} className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[#161616] bg-[#090909] text-[#9A6E6E] transition-colors hover:bg-[#101010] hover:text-[#E8B4B4] disabled:cursor-not-allowed disabled:opacity-60" aria-label="Logout">
            {isLoggingOut ? <ButtonLoader size={16} colorClassName="text-[#DB8A8A]" /> : <SidebarLogoutIcon />}
          </button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]" />
      <div className="hidden xl:block">
        <aside className="fixed inset-y-0 left-0 z-20 w-[318px]">
          <div className={`${sidebarShellClass} h-full rounded-none border-y-0 border-l-0 border-r-[#151515]`}>
            <LandingReveal delay={90}>
              {renderSidebarContent(desktopTeamMenuRef)}
            </LandingReveal>
          </div>
        </aside>
      </div>
      <main className="relative px-[20px] pt-[32px] pb-[56px] md:px-6 lg:px-8 xl:min-h-screen xl:pl-[358px] xl:pr-[42px]">
        <div className="mx-auto w-full max-w-[1220px]">
          <aside className="mb-[20px] min-w-0 xl:hidden">
            <LandingReveal delay={90}>
              <div className={`${sidebarShellClass} rounded-[28px]`}>
                {renderSidebarContent(mobileTeamMenuRef)}
              </div>
            </LandingReveal>
          </aside>
          <section className="min-w-0">
            <LandingReveal delay={120}>
              <div className="flex flex-col gap-[18px]">
                <div className="flex flex-col gap-[14px] md:flex-row md:items-end md:justify-between">
                  <div><LandingGlowTag className="px-[24px]">Central de servidores</LandingGlowTag><h1 className="mt-[18px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.02] font-normal tracking-[-0.05em] text-transparent md:text-[42px]">{panelTitle}</h1><p className="mt-[14px] max-w-[760px] text-[14px] leading-[1.55] text-[#7D7D7D] md:text-[15px]">{panelDescription}</p></div>
                  {!isEditingServer ? <LandingActionButton href="/config/#/step/1" variant="light" className="h-[44px] rounded-[14px] px-[18px] text-[15px]"><span className="inline-flex items-center gap-[10px]"><PlusIcon />Add New</span></LandingActionButton> : null}
                </div>
                {!isEditingServer ? <div className={`${shellClass} relative z-[120] px-[14px] py-[14px] sm:px-[18px] sm:py-[18px]`}><div className="flex flex-col gap-[12px] xl:flex-row xl:items-center"><div className="flex min-w-0 flex-1 items-center rounded-[18px] border border-[#151515] bg-[#080808] px-[16px] py-[14px]"><SearchIcon /><input type="text" value={searchText} onChange={(event) => setSearchText(event.currentTarget.value)} placeholder="Pesquisar servidor..." className="ml-[12px] w-full bg-transparent text-[15px] text-[#D8D8D8] outline-none placeholder:text-[#4F4F4F]" /></div><div className="flex flex-wrap items-center gap-[10px] xl:justify-end"><div ref={statusRef} className="relative z-[140]"><button type="button" onClick={() => setIsStatusOpen((current) => !current)} className={`flex h-[52px] w-[52px] items-center justify-center rounded-[16px] border transition-colors ${isStatusOpen ? "border-[rgba(0,98,255,0.28)] bg-[rgba(0,98,255,0.08)] text-[#DADADA]" : "border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] hover:border-[#242424] hover:text-[#DADADA]"}`} aria-label="Filtrar por status"><FilterIcon /></button>{isStatusOpen ? <div className="absolute right-0 top-[60px] z-[180] min-w-[190px] rounded-[18px] border border-[#171717] bg-[#0A0A0A] p-[8px] shadow-[0_22px_60px_rgba(0,0,0,0.44)]">{(["all", "paid", "expired", "off"] as const).map((option) => <button key={option} type="button" onClick={() => { setStatusFilter(option); setIsStatusOpen(false); }} className={`flex w-full items-center justify-between rounded-[12px] px-[12px] py-[10px] text-left text-[13px] transition-colors ${statusFilter === option ? "bg-[#111111] text-[#E5E5E5]" : "text-[#9B9B9B] hover:bg-[#111111] hover:text-[#D5D5D5]"}`}><span>{FILTER_LABEL[option]}</span>{statusFilter === option ? <span className="h-[7px] w-[7px] rounded-full bg-[#0062FF]" /> : null}</button>)}</div> : null}</div><div className="inline-flex items-center gap-[8px] rounded-[18px] border border-[#171717] bg-[#0D0D0D] p-[6px]"><button type="button" onClick={() => setViewMode("overview")} className={`flex h-[40px] w-[40px] items-center justify-center rounded-[12px] transition-colors ${viewMode === "overview" ? "bg-[#131313] text-[#E5E5E5]" : "text-[#7C7C7C] hover:text-[#D5D5D5]"}`} aria-label="Visual overview"><GridIcon /></button><button type="button" onClick={() => setViewMode("list")} className={`flex h-[40px] w-[40px] items-center justify-center rounded-[12px] transition-colors ${viewMode === "list" ? "bg-[#131313] text-[#E5E5E5]" : "text-[#7C7C7C] hover:text-[#D5D5D5]"}`} aria-label="Visual lista"><ListIcon /></button></div></div></div></div> : null}
              </div>
            </LandingReveal>
            <div className="mt-[22px]">
              {selectedServer ? (
                <LandingReveal delay={180}>
                  <div className="space-y-[18px]">
                    <div className={`${shellClass} px-[18px] py-[18px]`}><div className="flex flex-col gap-[14px] md:flex-row md:items-center md:justify-between"><div><p className="text-[12px] uppercase tracking-[0.18em] text-[#666666]">Servidor em edicao</p><h2 className="mt-[10px] text-[28px] leading-none font-medium tracking-[-0.04em] text-[#E5E5E5]">{selectedServer.guildName}</h2></div><LandingActionButton href="/servers" variant="dark" className="h-[42px] rounded-[12px] px-[18px] text-[15px]" onClick={() => { setSelectedGuildIdForConfig(null); setSelectedEditorTabForConfig("settings"); navigateToUrl("/servers", "push"); }}>Voltar para a lista</LandingActionButton></div></div>
                    <ServerSettingsEditor guildId={selectedServer.guildId} guildName={selectedServer.guildName} status={selectedServer.status} daysUntilExpire={selectedServer.daysUntilExpire} daysUntilOff={selectedServer.daysUntilOff} accessMode={selectedServer.accessMode} allServers={servers} initialTab={selectedEditorTabForConfig} onTabChange={(tab) => { setSelectedEditorTabForConfig(tab); navigateToUrl(buildServerConfigUrl(selectedServer.guildId, tab), "replace"); }} standalone onClose={() => { setSelectedGuildIdForConfig(null); setSelectedEditorTabForConfig("settings"); navigateToUrl("/servers", "push"); }} />
                  </div>
                </LandingReveal>
              ) : shouldShowEditorSkeleton ? (
                <LandingReveal delay={180}><ServerSettingsEditorSkeleton standalone /></LandingReveal>
              ) : (
                <LandingReveal delay={180}>
                  {viewMode === "overview" ? (
                    <div>
                      <div className="mb-[18px] flex flex-col gap-[10px] sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[12px] uppercase tracking-[0.18em] text-[#666666]">Projetos</p>
                          <h2 className="mt-[10px] text-[26px] leading-none font-medium tracking-[-0.04em] text-[#E5E5E5]">Servidores em destaque</h2>
                        </div>
                          <p className="text-[13px] leading-[1.5] text-[#6F6F6F]">
                          {filteredServers.length} resultado(s) exibidos de {activeTeamServerCount} servidor(es).
                        </p>
                      </div>
                      {isLoading ? (
                        <div>
                          <div className="grid gap-[14px] xl:grid-cols-2">
                            {Array.from({ length: 4 }, (_, index) => (
                              <div key={index} className="overflow-hidden rounded-[24px] border border-[#141414] bg-[#0A0A0A] px-[18px] py-[20px]">
                                <div className="flowdesk-shimmer h-[210px] rounded-[18px] bg-[#111111]" />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : errorMessage ? (
                        <div className="py-[34px] text-center text-[13px] text-[#C2C2C2]">{errorMessage}</div>
                      ) : filteredServers.length ? (
                        <div className="grid gap-[14px] xl:grid-cols-2">
                          {filteredServers.map((server, index) => (
                            <ServerGridCard
                              key={server.guildId}
                              server={server}
                              index={index}
                              isSelected={selectedGuildIdForConfig === server.guildId}
                              isCopied={copiedGuildId === server.guildId}
                              openCardMenuGuildId={openCardMenuGuildId}
                              onOpen={handleOpenServerConfig}
                              onPrefetch={prefetchServerConfig}
                              onCopy={(guildId) => {
                                void handleCopyGuildId(guildId);
                              }}
                              onToggleMenu={(guildId) => {
                                setOpenCardMenuGuildId((current) => current === guildId ? null : guildId);
                              }}
                              onCopyFromMenu={handleCardMenuCopyId}
                              onDeactivate={handleCardMenuDeactivate}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="py-[34px] text-center text-[13px] text-[#C2C2C2]">{selectedTeam ? "Nenhum servidor vinculado ou encontrado para essa equipe." : "Nenhum servidor encontrado para esse filtro."}</div>
                      )}
                    </div>
                  ) : (
                    <div className={`${shellClass} overflow-visible`}>
                      <div className="border-b border-[#141414] px-[18px] py-[18px]"><div className="flex flex-col gap-[10px] sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[12px] uppercase tracking-[0.18em] text-[#666666]">Projetos</p><h2 className="mt-[10px] text-[26px] leading-none font-medium tracking-[-0.04em] text-[#E5E5E5]">{selectedTeam ? `Servidores da equipe ${selectedTeam.name}` : "Todos os servidores"}</h2></div><p className="text-[13px] leading-[1.5] text-[#6F6F6F]">{filteredServers.length} resultado(s) exibidos de {activeTeamServerCount} servidor(es).</p></div></div>
                      {isLoading ? <div className="px-[18px] py-[24px]"><div className="space-y-[12px]">{Array.from({ length: 5 }, (_, index) => <div key={index} className="overflow-hidden rounded-[24px] border border-[#141414] bg-[#0A0A0A] px-[18px] py-[20px]"><div className="flowdesk-shimmer h-[82px] rounded-[18px] bg-[#111111]" /></div>)}</div></div> : errorMessage ? <div className="px-[18px] py-[34px] text-center text-[13px] text-[#C2C2C2]">{errorMessage}</div> : filteredServers.length ? <div>{filteredServers.map((server, index) => <ServerListRow key={server.guildId} server={server} index={index} isSelected={selectedGuildIdForConfig === server.guildId} isCopied={copiedGuildId === server.guildId} openCardMenuGuildId={openCardMenuGuildId} onOpen={handleOpenServerConfig} onPrefetch={prefetchServerConfig} onCopy={(guildId) => { void handleCopyGuildId(guildId); }} onToggleMenu={(guildId) => { setOpenCardMenuGuildId((current) => current === guildId ? null : guildId); }} onCopyFromMenu={handleCardMenuCopyId} onDeactivate={handleCardMenuDeactivate} />)}</div> : <div className="px-[18px] py-[34px] text-center text-[13px] text-[#C2C2C2]">{selectedTeam ? "Nenhum servidor vinculado ou encontrado para essa equipe." : "Nenhum servidor encontrado para esse filtro."}</div>}
                    </div>
                  )}
                </LandingReveal>
              )}
            </div>
          </section>
        </div>
      </main>
      {isCreateTeamModalOpen ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center px-[18px] py-[28px]">
          <button
            type="button"
            aria-label="Fechar modal de equipe"
            className="absolute inset-0 bg-[rgba(0,0,0,0.78)]"
            onClick={() => {
              setIsCreateTeamModalOpen(false);
              setIsMemberSubmodalOpen(false);
              setTeamActionError(null);
            }}
          />
          <div className="relative z-10 w-full max-w-[760px]">
            <div className="relative overflow-hidden rounded-[32px] bg-transparent px-[22px] py-[22px] shadow-[0_34px_110px_rgba(0,0,0,0.52)] sm:px-[28px] sm:py-[28px]">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[32px] border border-[#0E0E0E]"
              />
              <span
                aria-hidden="true"
                className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[32px]"
              />
              <span
                aria-hidden="true"
                className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[32px]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-[1px] rounded-[31px] bg-[linear-gradient(180deg,rgba(8,8,8,0.985)_0%,rgba(4,4,4,0.985)_100%)]"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-[1px] top-[1px] h-[180px] rounded-t-[31px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.02)_32%,transparent_76%)]"
              />
              <div className="relative z-10">
                <div className="flex flex-col gap-[14px] sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <LandingGlowTag className="px-[18px]">Criar equipe</LandingGlowTag>
                    <h2 className="mt-[18px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[36px]">
                      Monte uma equipe
                      <br />
                      para seus servidores
                    </h2>
                    <p className="mt-[14px] max-w-[560px] text-[14px] leading-[1.55] text-[#747474]">
                      Crie uma estrutura profissional, escolha os servidores da equipe e envie convites pendentes para o staff aceitar depois dentro do painel.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreateTeamModalOpen(false);
                      setIsMemberSubmodalOpen(false);
                      setTeamActionError(null);
                    }}
                    className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4]"
                    aria-label="Fechar modal"
                  >
                    <span className="text-[18px] leading-none">×</span>
                  </button>
                </div>

                <div className="mt-[22px]">
                  <div className="grid grid-cols-3 gap-[8px] rounded-[18px] border border-[#141414] bg-[#090909] p-[6px]">
                    {([
                      ["name", "Nome da equipe"],
                      ["servers", "Servidores"],
                      ["members", "Convidar membros"],
                    ] as const).map(([step, label]) => {
                      const isActive = createTeamStep === step;
                      return (
                        <button
                          key={step}
                          type="button"
                          onClick={() => {
                            if (step === "servers" && createTeamName.trim().length < 3) return;
                            if (step === "members" && !createTeamServerIds.length) return;
                            setCreateTeamStep(step);
                            setTeamActionError(null);
                          }}
                          className={`rounded-[12px] px-[10px] py-[10px] text-[12px] leading-[1.2] font-medium transition-colors ${
                            isActive
                              ? "bg-[#131313] text-[#ECECEC]"
                              : "text-[#6F6F6F] hover:text-[#CFCFCF]"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {createTeamStep === "name" ? (
                    <div className="mt-[18px] space-y-[14px]">
                      <label className="block">
                        <span className="mb-[8px] block text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                          Nome da equipe
                        </span>
                        <input
                          type="text"
                          value={createTeamName}
                          onChange={(event) => setCreateTeamName(event.currentTarget.value)}
                          placeholder="Ex: Moderacao principal"
                          maxLength={64}
                          className="h-[50px] w-full rounded-[16px] border border-[#151515] bg-[#0A0A0A] px-[16px] text-[15px] text-[#E0E0E0] outline-none transition-colors placeholder:text-[#575757] focus:border-[rgba(0,98,255,0.34)]"
                        />
                      </label>

                      <div>
                        <span className="mb-[8px] block text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                          Icones genericos
                        </span>
                        <div className="grid grid-cols-3 gap-[10px]">
                          {TEAM_ICON_OPTIONS.map((option) => {
                            const isActive = createTeamIconKey === option.key;
                            return (
                              <button
                                key={option.key}
                                type="button"
                                onClick={() => setCreateTeamIconKey(option.key)}
                                className={`rounded-[16px] border px-[10px] py-[12px] transition-colors ${
                                  isActive
                                    ? "border-[rgba(0,98,255,0.3)] bg-[rgba(0,98,255,0.08)]"
                                    : "border-[#141414] bg-[#0A0A0A] hover:border-[#1E1E1E] hover:bg-[#0D0D0D]"
                                }`}
                              >
                                <div className="flex flex-col items-center gap-[8px]">
                                  <TeamAvatar
                                    iconKey={option.key}
                                    name={createTeamName || option.label}
                                    className="h-[44px] w-[44px] rounded-[14px]"
                                    textClassName="text-[16px] text-[#F3F3F3]"
                                  />
                                  <span className="text-[12px] leading-none text-[#C7C7C7]">
                                    {option.label}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {createTeamStep === "servers" ? (
                    <div className="mt-[18px]">
                      <div className="mb-[10px] flex items-center justify-between gap-[12px]">
                        <span className="text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                          Servidores vinculados
                        </span>
                        <span className="text-[12px] text-[#6F6F6F]">
                          {createTeamServerIds.length} selecionado(s)
                        </span>
                      </div>
                      <div className="max-h-[360px] space-y-[8px] overflow-y-auto pr-[4px]">
                        {teamServerOptions.length ? teamServerOptions.map((server) => {
                          const isChecked = createTeamServerIds.includes(server.guildId);
                          return (
                            <label
                              key={server.guildId}
                              className={`flex cursor-pointer items-center gap-[12px] rounded-[16px] border px-[14px] py-[12px] transition-colors ${
                                isChecked
                                  ? "border-[rgba(0,98,255,0.32)] bg-[rgba(0,98,255,0.08)]"
                                  : "border-[#141414] bg-[#0A0A0A] hover:border-[#1F1F1F] hover:bg-[#0D0D0D]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleCreateTeamServer(server.guildId)}
                                className="hidden"
                              />
                              <span
                                className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border ${
                                  isChecked
                                    ? "border-[#0062FF] bg-[#0062FF]"
                                    : "border-[#303030] bg-[#111111]"
                                }`}
                              >
                                {isChecked ? (
                                  <span className="h-[6px] w-[6px] rounded-full bg-white" />
                                ) : null}
                              </span>
                              {server.iconUrl ? (
                                <Image
                                  src={server.iconUrl}
                                  alt={server.guildName}
                                  width={36}
                                  height={36}
                                  className="h-[36px] w-[36px] rounded-[12px] object-cover"
                                  unoptimized
                                />
                              ) : (
                                <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[12px] bg-[#131313] text-[11px] font-semibold text-[#8A8A8A]">
                                  FD
                                </div>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[14px] leading-none font-medium text-[#E8E8E8]">
                                  {server.guildName}
                                </span>
                                <span className="mt-[5px] block truncate text-[12px] leading-none text-[#6B6B6B]">
                                  {server.guildId}
                                </span>
                              </span>
                            </label>
                          );
                        }) : (
                          <div className="rounded-[16px] border border-[#141414] bg-[#0A0A0A] px-[14px] py-[14px] text-[13px] leading-[1.5] text-[#6E6E6E]">
                            Nenhum servidor disponivel no painel para vincular a uma equipe agora.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {createTeamStep === "members" ? (
                    <div className="mt-[18px] space-y-[14px]">
                      <div className="rounded-[18px] border border-[#141414] bg-[#0A0A0A] p-[14px]">
                        <div className="flex flex-col gap-[10px] sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                              Convidar membros
                            </p>
                            <p className="mt-[8px] text-[13px] leading-[1.55] text-[#727272]">
                              Adicione IDs do Discord. Eles ficam pendentes ate o staff entrar no painel e aceitar o convite.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleOpenMemberSubmodal}
                            className="group relative inline-flex h-[42px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-5 text-[13px] leading-none font-semibold"
                          >
                            <span
                              aria-hidden="true"
                              className="absolute inset-0 rounded-[12px] bg-[#111111] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                            />
                            <span className="relative z-10 inline-flex items-center gap-[8px] whitespace-nowrap leading-none text-[#B7B7B7]">
                              <PlusIcon />
                              Adicionar membro
                            </span>
                          </button>
                        </div>
                      </div>

                      <div className="rounded-[18px] border border-[#141414] bg-[#0A0A0A] p-[14px]">
                        <div className="flex items-center justify-between gap-[10px]">
                          <p className="text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                            Membros pendentes
                          </p>
                          <span className="text-[12px] text-[#6A6A6A]">
                            {createTeamMemberIds.length} ID(s)
                          </span>
                        </div>
                        {createTeamMemberIds.length ? (
                          <div className="mt-[12px] flex flex-wrap gap-[8px]">
                            {createTeamMemberIds.map((discordId) => (
                              <button
                                key={discordId}
                                type="button"
                                onClick={() => handleRemoveTeamMemberId(discordId)}
                                className="inline-flex items-center gap-[8px] rounded-full border border-[#171717] bg-[#121212] px-[10px] py-[7px] text-[12px] leading-none text-[#C4C4C4] transition-colors hover:border-[#242424] hover:text-[#F0F0F0]"
                              >
                                <span>{discordId}</span>
                                <span className="text-[13px] leading-none text-[#777777]">×</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-[12px] text-[12px] text-[#5E5E5E]">
                            Nenhum membro adicionado ainda.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {teamActionError ? (
                    <p className="mt-[14px] text-[13px] leading-[1.5] text-[#D98484]">
                      {teamActionError}
                    </p>
                  ) : null}
                </div>

                <div className="mt-[20px] flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      if (createTeamStep === "name") {
                        setIsCreateTeamModalOpen(false);
                        setIsMemberSubmodalOpen(false);
                        setTeamActionError(null);
                        return;
                      }
                      if (createTeamStep === "servers") {
                        setCreateTeamStep("name");
                        setTeamActionError(null);
                        return;
                      }
                      setCreateTeamStep("servers");
                      setTeamActionError(null);
                    }}
                    className="inline-flex h-[46px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] px-[18px] text-[14px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1]"
                  >
                    {createTeamStep === "name" ? "Cancelar" : "Voltar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (createTeamStep === "name") {
                        if (createTeamName.trim().length < 3) {
                          setTeamActionError("Escolha um nome de equipe com pelo menos 3 caracteres.");
                          return;
                        }
                        setTeamActionError(null);
                        setCreateTeamStep("servers");
                        return;
                      }
                      if (createTeamStep === "servers") {
                        if (!createTeamServerIds.length) {
                          setTeamActionError("Selecione pelo menos um servidor para vincular a equipe.");
                          return;
                        }
                        setTeamActionError(null);
                        setCreateTeamStep("members");
                        return;
                      }
                      void handleCreateTeam();
                    }}
                    disabled={
                      isCreatingTeam ||
                      (createTeamStep === "name" && createTeamName.trim().length < 3) ||
                      (createTeamStep === "servers" && !createTeamServerIds.length)
                    }
                    className="group relative inline-flex h-[46px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[14px] leading-none font-semibold disabled:cursor-not-allowed disabled:opacity-75"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[12px] bg-[#111111] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                    />
                    <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap leading-none text-[#B7B7B7]">
                      {isCreatingTeam ? (
                        <ButtonLoader size={16} colorClassName="text-[#B7B7B7]" />
                      ) : createTeamStep === "members" ? (
                        "Criar equipe"
                      ) : (
                        "Proximo"
                      )}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {isMemberSubmodalOpen ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-[16px]">
              <button
                type="button"
                aria-label="Fechar submodal de membros"
                className="absolute inset-0 bg-[rgba(0,0,0,0.62)]"
                onClick={() => {
                  setIsMemberSubmodalOpen(false);
                  setTeamActionError(null);
                }}
              />
              <div className="relative z-10 w-full max-w-[520px] overflow-hidden rounded-[26px] border border-[#151515] bg-[#070707] p-[18px] shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
                <div className="flex items-start justify-between gap-[14px]">
                  <div>
                    <p className="text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                      Adicionar membros
                    </p>
                    <p className="mt-[10px] text-[14px] leading-[1.55] text-[#797979]">
                      Digite um ou mais IDs do Discord. Use um campo por pessoa.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMemberSubmodalOpen(false);
                      setTeamActionError(null);
                    }}
                    className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[12px] border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4]"
                    aria-label="Fechar submodal"
                  >
                    <span className="text-[18px] leading-none">×</span>
                  </button>
                </div>

                <div className="mt-[18px] space-y-[10px]">
                  {memberDraftIds.map((draft, index) => (
                    <input
                      key={index}
                      type="text"
                      value={draft}
                      onChange={(event) => handleMemberDraftChange(index, event.currentTarget.value)}
                      placeholder={
                        'ID do membro ' + (index + 1)
                      }
                      className="h-[48px] w-full rounded-[14px] border border-[#151515] bg-[#0A0A0A] px-[16px] text-[14px] text-[#E0E0E0] outline-none transition-colors placeholder:text-[#575757] focus:border-[rgba(0,98,255,0.34)]"
                    />
                  ))}
                </div>

                <div className="mt-[14px] flex flex-wrap gap-[8px]">
                  <button
                    type="button"
                    onClick={handleAddMemberDraftField}
                    className="inline-flex h-[40px] items-center justify-center rounded-[12px] border border-[#171717] bg-[#0D0D0D] px-[14px] text-[13px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1]"
                  >
                    Adicionar mais
                  </button>
                  {normalizedInviteDraftDiscordIds.length ? (
                    <div className="flex flex-wrap items-center gap-[8px]">
                      {normalizedInviteDraftDiscordIds.map((discordId) => (
                        <span
                          key={discordId}
                          className="inline-flex rounded-full border border-[#171717] bg-[#121212] px-[10px] py-[7px] text-[12px] leading-none text-[#BFBFBF]"
                        >
                          {discordId}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="mt-[18px] flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMemberSubmodalOpen(false);
                      setTeamActionError(null);
                    }}
                    className="inline-flex h-[44px] items-center justify-center rounded-[12px] border border-[#171717] bg-[#0D0D0D] px-[16px] text-[13px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmMemberDrafts}
                    className="group relative inline-flex h-[44px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-5 text-[13px] leading-none font-semibold"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[12px] bg-[#111111] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                    />
                    <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap leading-none text-[#B7B7B7]">
                      Confirmar IDs
                    </span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
