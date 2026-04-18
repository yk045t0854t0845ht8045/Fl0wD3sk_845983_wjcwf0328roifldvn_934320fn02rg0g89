"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { RefObject } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRightLeft,
  BadgePercent,
  BarChart3,
  Check as CheckLucide,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Cog,
  Copy as CopyLucide,
  Ellipsis,
  FolderKanban,
  Grid2x2,
  HardDrive,
  LifeBuoy,
  List as ListLucide,
  LogOut,
  Palette,
  Plus as PlusLucide,
  PlugZap,
  Search as SearchLucide,
  Settings2,
  Shield,
  SlidersHorizontal,
  Ticket,
  UserRound,
  Users,
  WalletCards,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { useNotificationEffect } from "@/components/notifications/NotificationsProvider";
import { ServerSettingsEditor } from "@/components/servers/ServerSettingsEditor";
import { ServerSettingsEditorSkeleton } from "@/components/servers/ServerSettingsEditorSkeleton";
import { PermissionDeniedState } from "@/components/servers/PermissionDeniedState";
import { resolveAddServerTargetHref } from "@/lib/plans/addServerFlow";
import { buildDiscordAuthStartHref } from "@/lib/auth/paths";
import type { ManagedServer, ManagedServerStatus } from "@/lib/servers/managedServers";
import {
  buildServerMetaLabel,
  buildServerStatusDescription,
} from "@/lib/servers/licensePresentation";
import { resolveServersWorkspaceAlertMessage } from "@/lib/servers/workspaceAlerts";
import { prefetchServerDashboardSettings } from "@/lib/servers/serverDashboardSettingsClient";
import {
  readCachedManagedServers,
  readManagedServersMemoryCache,
  readCachedTeamsSnapshot,
  readTeamsSnapshotMemoryCache,
  storeCachedManagedServers,
  storeCachedTeamsSnapshot,
} from "@/lib/servers/serversWorkspaceClientCache";
import type { PendingTeamInvite, UserTeam } from "@/lib/teams/userTeams";
import { useBodyScrollLock } from "@/lib/ui/useBodyScrollLock";

type ServersWorkspaceProps = {
  displayName: string;
  currentAccount: {
    authUserId: number;
    discordUserId: string;
    displayName: string;
    username: string;
    avatarUrl: string | null;
  };
  initialGuildId?: string | null;
  initialTab?: "settings" | "payments" | "methods" | "plans";
  initialSettingsSection?: ServerSettingsSection;
  initialServers?: ManagedServer[] | null;
  initialTeams?: UserTeam[] | null;
  initialPendingInvites?: PendingTeamInvite[] | null;
};

type ServerEditorTab = "settings" | "payments" | "methods" | "plans";
type ServerSettingsSection =
  | "overview"
  | "message"
  | "entry_exit_overview"
  | "entry_exit_message"
  | "security_antilink"
  | "security_autorole"
  | "security_logs"
  | "ticket_ai";
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

type SavedPanelAccount = {
  authUserId: number;
  discordUserId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  lastSeenAt: number;
};

const FILTER_LABEL: Record<FilterOption, string> = {
  all: "Todos",
  paid: "Em dia",
  pending_payment: "Pendente",
  expired: "Expirada",
  off: "Desligados",
};

type SidebarItem = {
  label: string;
  kind: "overview" | "settings" | "ticket" | "entry_exit" | "security" | "dashboard";
  tab?: ServerEditorTab | null;
  settingsSection?: ServerSettingsSection | null;
  disabled?: boolean;
  chevron?: boolean;
  searchAliases?: string[];
  requiredPermission?: string;
};

const PROJECTS_SIDEBAR_ITEMS: SidebarItem[] = [
  {
    label: "Dashboard",
    kind: "dashboard",
    tab: null,
    searchAliases: ["dashboard", "painel"],
  },
  {
    label: "Projetos",
    kind: "overview",
    tab: null,
    searchAliases: ["overview", "servidores", "dashboard", "inicio"],
  },
];

const TICKET_SIDEBAR_ITEMS: SidebarItem[] = [
  {
    label: "configurando ticket",
    kind: "ticket",
    tab: "settings",
    settingsSection: "overview",
    requiredPermission: "server_manage_tickets_overview",
    searchAliases: [
      "ticket",
      "tickets",
      "config",
      "setup",
      "canais",
      "cargos",
      "staff",
      "visao geral",
      "painel",
    ],
  },
  {
    label: "Mensagem do ticket",
    kind: "ticket",
    tab: "settings",
    settingsSection: "message",
    requiredPermission: "server_manage_tickets_message",
    searchAliases: [
      "mensagem",
      "embed",
      "painel principal",
      "titulo",
      "descricao",
      "botao",
      "ticket",
    ],
  },
  {
    label: "Configurando FlowAI",
    kind: "ticket",
    tab: "settings",
    settingsSection: "ticket_ai",
    requiredPermission: "server_manage_tickets_overview",
    searchAliases: [
      "ia",
      "ai",
      "flowai",
      "inteligencia",
      "robo",
      "sugestao",
      "regras",
      "empresa",
    ],
  },
];

const ENTRY_EXIT_SIDEBAR_ITEMS: SidebarItem[] = [
  {
    label: "Canais e Logs",
    kind: "entry_exit",
    tab: "settings",
    settingsSection: "entry_exit_overview",
    requiredPermission: "server_manage_welcome_overview",
    searchAliases: [
      "entrada",
      "saida",
      "logs",
      "canal",
      "mensagem",
      "boas vindas",
      "entrada e saida",
    ],
  },
  {
    label: "Configurando Mensagem",
    kind: "entry_exit",
    tab: "settings",
    settingsSection: "entry_exit_message",
    requiredPermission: "server_manage_welcome_message",
    searchAliases: [
      "mensagem",
      "embed",
      "entrada",
      "saida",
      "configurar",
      "boas vindas",
    ],
  },
];

const SECURITY_SIDEBAR_ITEMS: SidebarItem[] = [
  {
    label: "AntiLink",
    kind: "security",
    tab: "settings",
    settingsSection: "security_antilink",
    requiredPermission: "server_manage_antilink",
    searchAliases: [
      "seguranca",
      "anti link",
      "antilink",
      "moderacao",
      "ban",
      "expulsar",
      "silenciar",
      "links",
      "discord.gg",
    ],
  },
  {
    label: "AutoRole",
    kind: "security",
    tab: "settings",
    settingsSection: "security_autorole",
    requiredPermission: "server_manage_autorole",
    searchAliases: [
      "seguranca",
      "autorole",
      "auto role",
      "cargo automatico",
      "cargos automaticos",
      "roles",
      "cargos",
    ],
  },
  {
    label: "Logs",
    kind: "security",
    tab: "settings",
    settingsSection: "security_logs",
    requiredPermission: "server_view_security_logs",
    searchAliases: [
      "seguranca",
      "logs",
      "nickname",
      "avatar",
      "voz",
      "mensagem deletada",
      "mensagem editada",
      "ban",
      "desban",
      "kick",
      "silenciar",
      "timeout",
      "move call",
    ],
  },
];
const shellClass =
  "rounded-[28px] border border-[#0E0E0E] bg-[#0A0A0A] shadow-[0_24px_80px_rgba(0,0,0,0.38)]";

const sidebarShellClass =
  "relative overflow-hidden border border-[#0E0E0E] bg-[#050505] shadow-[0_24px_80px_rgba(0,0,0,0.42)]";

const SAVED_PANEL_ACCOUNTS_KEY = "flowdesk_saved_panel_accounts_v1";
const editorPanelRevealClass =
  "origin-top transform-gpu transition-[opacity,transform,filter] duration-[620ms] ease-[cubic-bezier(0.22,1,0.36,1)] data-[flowdesk-visible=false]:translate-y-[18px] data-[flowdesk-visible=false]:scale-[0.985] data-[flowdesk-visible=false]:opacity-0 data-[flowdesk-visible=true]:translate-y-0 data-[flowdesk-visible=true]:scale-100 data-[flowdesk-visible=true]:opacity-100";
const workspacePaneRevealClass =
  "transform-gpu transition-[opacity,transform,filter] duration-[620ms] ease-[cubic-bezier(0.22,1,0.36,1)] data-[flowdesk-visible=false]:translate-y-[14px] data-[flowdesk-visible=false]:scale-[0.992] data-[flowdesk-visible=false]:opacity-0 data-[flowdesk-visible=true]:translate-y-0 data-[flowdesk-visible=true]:scale-100 data-[flowdesk-visible=true]:opacity-100";

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

function parseWorkspaceRoute(pathname: string | null): {
  guildId: string | null;
  tab: ServerEditorTab;
  settingsSection: ServerSettingsSection;
} {
  const fallback = {
    guildId: null,
    tab: "settings" as const,
    settingsSection: "overview" as const,
  };

  if (!pathname) return fallback;

  const bareMatch = pathname.match(/^\/servers\/(\d{10,25})\/?$/);
  if (bareMatch) {
    return {
      guildId: bareMatch[1],
      tab: "settings",
      settingsSection: "overview",
    };
  }

  const ticketSectionMatch = pathname.match(
    /^\/servers\/(\d{10,25})\/tickets?\/(overview|message|flowai)\/?$/,
  );
  if (ticketSectionMatch) {
    return {
      guildId: ticketSectionMatch[1],
      tab: "settings",
      settingsSection:
        ticketSectionMatch[2] === "flowai"
          ? "ticket_ai"
          : (ticketSectionMatch[2] as ServerSettingsSection),
    };
  }

  const entryExitSectionMatch = pathname.match(
    /^\/servers\/(\d{10,25})\/entry-exit\/(overview|message)\/?$/,
  );
  if (entryExitSectionMatch) {
    return {
      guildId: entryExitSectionMatch[1],
      tab: "settings",
      settingsSection:
        entryExitSectionMatch[2] === "overview"
          ? "entry_exit_overview"
          : "entry_exit_message",
    };
  }

  const securitySectionMatch = pathname.match(
    /^\/servers\/(\d{10,25})\/security\/(antilink|autorole|logs)\/?$/,
  );
  if (securitySectionMatch) {
    return {
      guildId: securitySectionMatch[1],
      tab: "settings",
      settingsSection:
        securitySectionMatch[2] === "logs"
          ? "security_logs"
          : securitySectionMatch[2] === "autorole"
            ? "security_autorole"
            : "security_antilink",
    };
  }

  return fallback;
}

function normalizeComparablePath(value: string) {
  if (!value) return "/";
  if (value === "/") return value;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isServersWorkspacePath(pathname: string) {
  return pathname === "/servers" || pathname.startsWith("/servers/");
}

function statusStyle(status: ManagedServerStatus) {
  if (status === "paid") {
    return {
      badgeText: "Em dia",
      badgeClass:
        "border border-[rgba(0,98,255,0.42)] bg-[rgba(0,98,255,0.14)] text-[#8AB6FF]",
      ringColor:
        "conic-gradient(#0062FF 0deg 300deg, rgba(255,255,255,0.08) 300deg 360deg)",
    };
  }

  if (status === "expired") {
    return {
      badgeText: "Expirada",
      badgeClass:
        "border border-[rgba(242,200,35,0.4)] bg-[rgba(242,200,35,0.12)] text-[#F2C823]",
      ringColor:
        "conic-gradient(#F2C823 0deg 220deg, rgba(255,255,255,0.08) 220deg 360deg)",
    };
  }

  if (status === "pending_payment") {
    return {
      badgeText: "Pendente",
      badgeClass:
        "border border-[rgba(242,200,35,0.4)] bg-[rgba(242,200,35,0.12)] text-[#F2C823]",
      ringColor:
        "conic-gradient(#F2C823 0deg 180deg, rgba(255,255,255,0.08) 180deg 360deg)",
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
  return buildServerStatusDescription(server, "workspace");
}

function serverMetaLabel(server: ManagedServer) {
  return buildServerMetaLabel(server);
}

function serverAccessBadgeLabel(server: ManagedServer) {
  if (server.accessMode === "owner") return "titular";
  return server.canManage ? "equipe" : "visualizar";
}

function serverAccountChipLabel(server: ManagedServer) {
  if (server.accessMode === "owner") return "conta titular";
  return server.canManage ? "conta da equipe" : "conta vinculada";
}

function WorkspaceAlertPixelAccent({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";
  const edgeClass = isLeft ? "left-0" : "right-0";
  const columnOpacities = isLeft
    ? [1, 0.96, 0.9, 0.8, 0.66, 0.5, 0.34, 0.2, 0.1, 0.04]
    : [0.04, 0.1, 0.2, 0.34, 0.5, 0.66, 0.8, 0.9, 0.96, 1];
  const rowOpacities = [1, 0.95, 0.88, 0.76, 0.62, 0.46, 0.28];
  const maskImage = isLeft
    ? "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.98) 34%, rgba(0,0,0,0.78) 58%, rgba(0,0,0,0.34) 82%, transparent 100%)"
    : "linear-gradient(270deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.98) 34%, rgba(0,0,0,0.78) 58%, rgba(0,0,0,0.34) 82%, transparent 100%)";

  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute ${edgeClass} inset-y-0 hidden items-stretch lg:flex`}
    >
      <span
        className="grid h-full w-[72px] grid-cols-10 grid-rows-7 gap-[2px] px-[2px] py-[2px] md:w-[84px]"
        style={{ maskImage, WebkitMaskImage: maskImage }}
      >
        {rowOpacities.flatMap((rowOpacity, rowIndex) =>
          columnOpacities.map((columnOpacity, columnIndex) => (
            <span
              key={`${side}-${rowIndex}-${columnIndex}`}
              className="rounded-[1px] bg-[linear-gradient(135deg,#FF9A9A_0%,#FF6F6F_42%,#E04747_100%)]"
              style={{ opacity: rowOpacity * columnOpacity }}
            />
          )),
        )}
      </span>
    </span>
  );
}

function SearchIcon() {
  return <SearchLucide className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]" strokeWidth={1.85} aria-hidden="true" />;
}

function FilterIcon() {
  return <SlidersHorizontal className="h-[18px] w-[18px] shrink-0" strokeWidth={1.85} aria-hidden="true" />;
}

function GridIcon() {
  return <Grid2x2 className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} aria-hidden="true" />;
}

function ListIcon() {
  return <ListLucide className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} aria-hidden="true" />;
}

function MenuDotsIcon() {
  return <Ellipsis className="h-[18px] w-[18px] shrink-0" strokeWidth={1.85} aria-hidden="true" />;
}

function CopyIcon() {
  return <CopyLucide className="h-[15px] w-[15px] shrink-0" strokeWidth={1.8} aria-hidden="true" />;
}

function CheckIcon() {
  return <CheckLucide className="h-[15px] w-[15px] shrink-0" strokeWidth={2.2} aria-hidden="true" />;
}

function PlusIcon() {
  return <PlusLucide className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} aria-hidden="true" />;
}

function TeamIcon() {
  return <Users className="h-[18px] w-[18px] shrink-0" strokeWidth={1.85} aria-hidden="true" />;
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

function accountInitial(name: string, username: string) {
  const source = name.trim() || username.trim();
  return source ? source.charAt(0).toUpperCase() : "F";
}

function normalizeSavedPanelAccounts(input: unknown) {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<SavedPanelAccount>;
      if (
        typeof record.authUserId !== "number" ||
        typeof record.discordUserId !== "string" ||
        typeof record.displayName !== "string" ||
        typeof record.username !== "string" ||
        typeof record.lastSeenAt !== "number"
      ) {
        return null;
      }

      return {
        authUserId: record.authUserId,
        discordUserId: record.discordUserId,
        displayName: record.displayName,
        username: record.username,
        avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl : null,
        lastSeenAt: record.lastSeenAt,
      } satisfies SavedPanelAccount;
    })
    .filter((value): value is SavedPanelAccount => value !== null)
    .slice(0, 3);
}

function mergeSavedPanelAccounts(
  currentAccount: SavedPanelAccount,
  previousAccounts: SavedPanelAccount[],
) {
  return [currentAccount, ...previousAccounts.filter((account) => account.discordUserId !== currentAccount.discordUserId)]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, 3);
}

function AccountAvatar({
  avatarUrl,
  displayName,
  username,
  className = "",
}: {
  avatarUrl: string | null;
  displayName: string;
  username: string;
  className?: string;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={displayName}
        width={44}
        height={44}
        className={`rounded-full object-cover ${className}`.trim()}
        unoptimized
      />
    );
  }

  return (
    <div
      className={`relative flex items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,#7D3BFF_0%,#3C0F6D_54%,#170822_100%)] font-semibold text-[#F0F0F0] shadow-[0_0_28px_rgba(125,59,255,0.14)] ${className}`.trim()}
    >
      {accountInitial(displayName, username)}
      <span className="absolute bottom-[2px] right-[2px] h-[8px] w-[8px] rounded-full bg-[#0062FF]" />
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

function SidebarDropdownChevronIcon() {
  return <ChevronDown className="h-[14px] w-[14px] shrink-0" strokeWidth={1.9} aria-hidden="true" />;
}

function SidebarChevronRightIcon() {
  return <ChevronRight className="h-[14px] w-[14px] shrink-0" strokeWidth={1.9} aria-hidden="true" />;
}

function SidebarSearchShortcutIcon() {
  return (
    <span className="inline-flex h-[28px] min-w-[28px] items-center justify-center rounded-[9px] border border-[#1A1A1A] bg-[#101010] px-[8px] text-[12px] font-medium text-[#A7A7A7]">
      F
    </span>
  );
}

function SidebarLogoutIcon() {
  return <LogOut className="h-[17px] w-[17px] shrink-0" strokeWidth={1.9} aria-hidden="true" />;
}

function SidebarNavIcon({
  kind,
  active = false,
}: {
  kind: SidebarItem["kind"];
  active?: boolean;
}) {
  const Icon: LucideIcon = {
    overview: FolderKanban,
    settings: Settings2,
    ticket: Ticket,
    entry_exit: ArrowRightLeft,
    security: Shield,
    dashboard: ChevronLeft,
    payments: WalletCards,
    methods: Workflow,
    plans: BadgePercent,
    analytics: BarChart3,
    integrations: PlugZap,
    storage: HardDrive,
    support: LifeBuoy,
    preferences: Cog,
  }[kind];

  return <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2 : 1.85} aria-hidden="true" />;
}

function StatusRing({ status }: { status: ManagedServerStatus }) {
  const style = statusStyle(status);
  const dotColorClass =
    status === "paid"
      ? "bg-[#0062FF]"
      : status === "expired" || status === "pending_payment"
        ? "bg-[#F2C823]"
        : "bg-[#DB4646]";
  return (
    <div className="flex h-[42px] w-[42px] items-center justify-center rounded-full p-[2px]" style={{ background: style.ringColor }} aria-hidden="true">
      <div className="flex h-full w-full items-center justify-center rounded-full bg-[#0A0A0A]">
        <div className={`h-[8px] w-[8px] rounded-full ${dotColorClass}`} />
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
            <span className="inline-flex items-center rounded-full border border-[#1B1B1B] bg-[#111111] px-[12px] py-[8px] text-[12px] leading-none text-[#D0D0D0]">
              {serverAccountChipLabel(server)}
            </span>
            <StatusRing status={server.status} />
            <div
              className={`relative ${
                openCardMenuGuildId === server.guildId ? "z-[80]" : "z-0"
              }`}
              data-server-card-menu-root="true"
            >
              <button type="button" onClick={(event) => { event.stopPropagation(); onToggleMenu(server.guildId); }} className="flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#101010] text-[#7B7B7B] transition-colors hover:border-[#222222] hover:text-[#D0D0D0]" aria-label="Abrir menu do servidor"><MenuDotsIcon /></button>
              {openCardMenuGuildId === server.guildId ? <div className="absolute right-0 top-[48px] z-[160] min-w-[186px] rounded-[16px] border border-[#171717] bg-[#0A0A0A] p-[8px] shadow-[0_22px_60px_rgba(0,0,0,0.44)]"><button type="button" onClick={(event) => { event.stopPropagation(); onOpen(server.guildId); onToggleMenu(server.guildId); }} className="flex w-full items-center rounded-[12px] px-[12px] py-[10px] text-left text-[13px] text-[#D0D0D0] transition-colors hover:bg-[#111111]">Abrir configuracoes</button><button type="button" onClick={(event) => { event.stopPropagation(); onCopyFromMenu(server.guildId); }} className="mt-[4px] flex w-full items-center rounded-[12px] px-[12px] py-[10px] text-left text-[13px] text-[#D0D0D0] transition-colors hover:bg-[#111111]">Copiar ID</button></div> : null}
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
              {serverAccessBadgeLabel(server)}
            </span>
          </div>
          <p className="mt-[14px] text-[17px] leading-[1.28] font-medium tracking-[-0.03em] text-[#E9E9E9]">
            {statusDescription(server)}
          </p>
          <p className="mt-[10px] text-[14px] leading-[1.45] text-[#8C8C8C]">
            {serverMetaLabel(server)}
          </p>
        </div>
      </article>
    </LandingReveal>
  );
}

export function ServersWorkspace({
  displayName,
  currentAccount,
  initialGuildId = null,
  initialTab = "settings",
  initialSettingsSection = "overview",
  initialServers = null,
  initialTeams = null,
  initialPendingInvites = null,
}: ServersWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const workspaceCacheKey = `${currentAccount.authUserId}:${currentAccount.discordUserId}`;
  const initialServersSnapshot =
    initialServers ?? readManagedServersMemoryCache(workspaceCacheKey);
  const initialTeamsSnapshot =
    initialTeams
      ? {
          teams: initialTeams,
          pendingInvites: initialPendingInvites ?? [],
        }
      : readTeamsSnapshotMemoryCache(workspaceCacheKey);
  const [servers, setServers] = useState<ManagedServer[]>(initialServersSnapshot ?? []);
  const [isLoading, setIsLoading] = useState(initialServersSnapshot === null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isResolvingAddServer, setIsResolvingAddServer] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [sidebarSearchText, setSidebarSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterOption>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [copiedGuildId, setCopiedGuildId] = useState<string | null>(null);
  const [openCardMenuGuildId, setOpenCardMenuGuildId] = useState<string | null>(null);
  const [teams, setTeams] = useState<UserTeam[]>(initialTeamsSnapshot?.teams ?? []);
  const [pendingTeamInvites, setPendingTeamInvites] = useState<PendingTeamInvite[]>(
    initialTeamsSnapshot?.pendingInvites ?? [],
  );
  const [isTeamsLoading, setIsTeamsLoading] = useState(initialTeamsSnapshot === null);
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
  const [savedAccounts, setSavedAccounts] = useState<SavedPanelAccount[]>([]);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [teamActionMessage, setTeamActionMessage] = useState<string | null>(null);
  const [teamActionError, setTeamActionError] = useState<string | null>(null);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [acceptingTeamId, setAcceptingTeamId] = useState<number | null>(null);
  const [selectedGuildIdForConfig, setSelectedGuildIdForConfig] = useState<string | null>(initialGuildId);
  const [selectedEditorTabForConfig, setSelectedEditorTabForConfig] = useState<ServerEditorTab>(initialTab);
  const [selectedSettingsSectionForConfig, setSelectedSettingsSectionForConfig] =
    useState<ServerSettingsSection>(initialSettingsSection);
  const [hasUnsavedSettingsChanges, setHasUnsavedSettingsChanges] = useState(false);
  const [navigationBlockSignal, setNavigationBlockSignal] = useState(0);
  const [isTicketSidebarOpen, setIsTicketSidebarOpen] = useState(false);
  const [isEntryExitSidebarOpen, setIsEntryExitSidebarOpen] = useState(false);
  const [isSecuritySidebarOpen, setIsSecuritySidebarOpen] = useState(false);
  const [currentDashboardPermissions, setCurrentDashboardPermissions] = useState<string[] | "full">([]);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const desktopTeamMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileTeamMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopSidebarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSidebarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const lastServersRecoveryAtRef = useRef(0);
  const selectedServerRecoveryRef = useRef<{
    guildId: string | null;
    attempts: number;
  }>({ guildId: null, attempts: 0 });
  const [serversReloadToken, setServersReloadToken] = useState(0);
  const [teamsReloadToken, setTeamsReloadToken] = useState(0);
  const previousRouteGuildIdRef = useRef<string | null>(null);
  const [, startOpenServerTransition] = useTransition();

  const isEditingServer = Boolean(selectedGuildIdForConfig);

  const routeState = useMemo(() => parseWorkspaceRoute(pathname), [pathname]);
  const routeGuildId = routeState.guildId;

  const requestServersReload = useCallback((options?: { silent?: boolean }) => {
    setErrorMessage(null);
    if (!(options?.silent && servers.length > 0)) {
      setIsLoading(true);
    }
    setServersReloadToken((current) => current + 1);
  }, [servers.length]);

  const requestTeamsReload = useCallback((options?: { silent?: boolean }) => {
    setTeamsErrorMessage(null);
    if (!(options?.silent && (teams.length > 0 || pendingTeamInvites.length > 0))) {
      setIsTeamsLoading(true);
    }
    setTeamsReloadToken((current) => current + 1);
  }, [pendingTeamInvites.length, teams.length]);

  const applyTeamsSnapshot = useCallback(
    (payload: TeamsApiResponse, preferredTeamId: number | null = null) => {
      const nextTeams = payload.teams || [];
      const nextPendingInvites = payload.pendingInvites || [];
      storeCachedTeamsSnapshot(
        workspaceCacheKey,
        nextTeams,
        nextPendingInvites,
      );
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
    [workspaceCacheKey],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_PANEL_ACCOUNTS_KEY);
      const currentSnapshot: SavedPanelAccount = {
        ...currentAccount,
        lastSeenAt: Date.now(),
      };
      const nextAccounts = mergeSavedPanelAccounts(
        currentSnapshot,
        normalizeSavedPanelAccounts(raw ? JSON.parse(raw) : []),
      );
      setSavedAccounts(nextAccounts);
      window.localStorage.setItem(SAVED_PANEL_ACCOUNTS_KEY, JSON.stringify(nextAccounts));
    } catch {
      setSavedAccounts([
        {
          ...currentAccount,
          lastSeenAt: Date.now(),
        },
      ]);
    }
  }, [currentAccount]);

  useEffect(() => {
    if (initialServers !== null) {
      storeCachedManagedServers(workspaceCacheKey, initialServers);
      return;
    }

    const cachedServers = readCachedManagedServers(workspaceCacheKey);
    if (!cachedServers) {
      return;
    }

    setServers(cachedServers);
    setErrorMessage(null);
    setIsLoading(false);
  }, [initialServers, workspaceCacheKey]);

  useEffect(() => {
    if (initialTeams !== null) {
      storeCachedTeamsSnapshot(
        workspaceCacheKey,
        initialTeams,
        initialPendingInvites ?? [],
      );
      return;
    }

    const cachedTeamsSnapshot = readCachedTeamsSnapshot(workspaceCacheKey);
    if (!cachedTeamsSnapshot) {
      return;
    }

    setTeams(cachedTeamsSnapshot.teams);
    setPendingTeamInvites(cachedTeamsSnapshot.pendingInvites);
    setTeamsErrorMessage(null);
    setIsTeamsLoading(false);
  }, [initialPendingInvites, initialTeams, workspaceCacheKey]);

  useEffect(() => {
    if (initialServers !== null) {
      return;
    }

    let isMounted = true;
    let activeController: AbortController | null = null;
    let activeTimeoutId: number | null = null;
    let retryTimeoutId: number | null = null;
    let requestAttempt = 0;
    let isRequestInFlight = false;
    let hasTriggeredRefresh = false;

    function clearActiveTimeout() {
      if (activeTimeoutId !== null) {
        window.clearTimeout(activeTimeoutId);
        activeTimeoutId = null;
      }
    }

    function clearRetryTimeout() {
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }
    }

    function scheduleRetry(reason: "abort" | "network" | "online") {
      if (!isMounted) return;

      requestAttempt += 1;
      setErrorMessage(null);
      setIsLoading(true);

      if (requestAttempt >= 3 && !hasTriggeredRefresh) {
        hasTriggeredRefresh = true;
        router.refresh();
      }

      const retryDelayMs =
        reason === "online"
          ? 120
          : reason === "abort"
            ? Math.min(1200 * requestAttempt, 5000)
            : Math.min(900 * requestAttempt, 5000);

      clearRetryTimeout();
      retryTimeoutId = window.setTimeout(() => {
        if (!isMounted) return;
        void loadServers();
      }, retryDelayMs);
    }

    async function loadServers() {
      if (isRequestInFlight || !isMounted) {
        return;
      }

      isRequestInFlight = true;
      clearRetryTimeout();
      const controller = new AbortController();
      activeController = controller;
      clearActiveTimeout();
      activeTimeoutId = window.setTimeout(() => controller.abort("timeout"), 12000);

      try {
        const response = await fetch("/api/auth/me/servers", { cache: "no-store", signal: controller.signal });
        const payload = (await response.json()) as ServersApiResponse;
        if (!isMounted) return;
        if (!response.ok || !payload.ok) {
          const message = payload.message || "Falha ao carregar servidores.";
          if (response.status === 401 || response.status === 403) {
            throw Object.assign(new Error(message), { cause: "non_retryable" });
          }
          throw new Error(message);
        }
        requestAttempt = 0;
        hasTriggeredRefresh = false;
        const nextServers = payload.servers || [];
        storeCachedManagedServers(workspaceCacheKey, nextServers);
        setServers(nextServers);
        setErrorMessage(null);
        setIsLoading(false);
      } catch (error) {
        if (!isMounted) return;
        const isAbortError =
          (error instanceof DOMException && error.name === "AbortError") ||
          (error instanceof Error && (error.name === "AbortError" || error.message === "unmount")) ||
          (error && typeof error === "object" && "name" in error && error.name === "AbortError");
        const isNonRetryable =
          error instanceof Error &&
          "cause" in error &&
          error.cause === "non_retryable";

        if (isNonRetryable) {
          setErrorMessage(error instanceof Error ? error.message : "Erro ao carregar servidores.");
          setServers([]);
          setIsLoading(false);
          return;
        }

        scheduleRetry(isAbortError ? "abort" : "network");
      } finally {
        isRequestInFlight = false;
        clearActiveTimeout();
        if (activeController === controller) {
          activeController = null;
        }
      }
    }

    function handleOnline() {
      if (!isMounted) return;
      if (isRequestInFlight) return;
      scheduleRetry("online");
    }

    window.addEventListener("online", handleOnline);
    void loadServers();
    return () => {
      isMounted = false;
      window.removeEventListener("online", handleOnline);
      clearRetryTimeout();
      clearActiveTimeout();
      activeController?.abort("unmount");
    };
  }, [initialServers, router, serversReloadToken, workspaceCacheKey]);

  useEffect(() => {
    setSelectedGuildIdForConfig((current) => {
      if (current === routeGuildId) {
        return current;
      }
      return routeGuildId;
    });
    setSelectedEditorTabForConfig(routeState.tab);
    setSelectedSettingsSectionForConfig(routeState.settingsSection);
  }, [routeGuildId, routeState.settingsSection, routeState.tab]);

  useEffect(() => {
    const previousRouteGuildId = previousRouteGuildIdRef.current;

    if (previousRouteGuildId && !routeGuildId && servers.length > 0) {
      requestServersReload({ silent: true });
      requestTeamsReload({ silent: true });
    }

    previousRouteGuildIdRef.current = routeGuildId;
  }, [
    requestServersReload,
    requestTeamsReload,
    routeGuildId,
    servers.length,
  ]);

  useEffect(() => {
    if (initialTeams !== null) {
      return;
    }

    let isMounted = true;
    let activeController: AbortController | null = null;
    let activeTimeoutId: number | null = null;
    let retryTimeoutId: number | null = null;
    let requestAttempt = 0;
    let isRequestInFlight = false;
    let hasTriggeredRefresh = false;

    function clearActiveTimeout() {
      if (activeTimeoutId !== null) {
        window.clearTimeout(activeTimeoutId);
        activeTimeoutId = null;
      }
    }

    function clearRetryTimeout() {
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
        retryTimeoutId = null;
      }
    }

    function scheduleRetry(reason: "abort" | "network" | "online") {
      if (!isMounted) return;

      requestAttempt += 1;
      setTeamsErrorMessage(null);
      setIsTeamsLoading(true);

      if (requestAttempt >= 3 && !hasTriggeredRefresh) {
        hasTriggeredRefresh = true;
        router.refresh();
      }

      const retryDelayMs =
        reason === "online"
          ? 180
          : reason === "abort"
            ? Math.min(1200 * requestAttempt, 4500)
            : Math.min(900 * requestAttempt, 4500);

      clearRetryTimeout();
      retryTimeoutId = window.setTimeout(() => {
        if (!isMounted) return;
        void loadTeams();
      }, retryDelayMs);
    }

    async function loadTeams() {
      if (isRequestInFlight || !isMounted) {
        return;
      }

      isRequestInFlight = true;
      clearRetryTimeout();
      const controller = new AbortController();
      activeController = controller;
      clearActiveTimeout();
      activeTimeoutId = window.setTimeout(() => controller.abort("timeout"), 12000);

      try {
        const response = await fetch("/api/auth/me/teams", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as TeamsApiResponse;
        if (!isMounted) return;
        if (!response.ok || !payload.ok) {
          const message = payload.message || "Falha ao carregar equipes.";
          if (response.status === 401 || response.status === 403) {
            throw Object.assign(new Error(message), { cause: "non_retryable" });
          }
          throw new Error(message);
        }
        requestAttempt = 0;
        hasTriggeredRefresh = false;
        applyTeamsSnapshot(payload);
        setTeamsErrorMessage(null);
        setIsTeamsLoading(false);
      } catch (error) {
        if (!isMounted) return;
        const isAbortError =
          (error instanceof DOMException && error.name === "AbortError") ||
          (error instanceof Error && (error.name === "AbortError" || error.message === "unmount")) ||
          (error && typeof error === "object" && "name" in error && error.name === "AbortError");
        const isNonRetryable =
          error instanceof Error &&
          "cause" in error &&
          error.cause === "non_retryable";

        if (isNonRetryable) {
          setTeamsErrorMessage(
            error instanceof Error ? error.message : "Erro ao carregar equipes.",
          );
          setIsTeamsLoading(false);
          return;
        }

        scheduleRetry(isAbortError ? "abort" : "network");
      } finally {
        isRequestInFlight = false;
        clearActiveTimeout();
        if (activeController === controller) {
          activeController = null;
        }
      }
    }

    function handleOnline() {
      if (!isMounted) return;
      if (isRequestInFlight) return;
      scheduleRetry("online");
    }

    window.addEventListener("online", handleOnline);
    void loadTeams();

    return () => {
      isMounted = false;
      window.removeEventListener("online", handleOnline);
      clearRetryTimeout();
      clearActiveTimeout();
      activeController?.abort("unmount");
    };
  }, [applyTeamsSnapshot, initialTeams, router, teamsReloadToken]);

  useEffect(() => {
    if (initialServers !== null || initialTeams !== null) {
      return;
    }

    function shouldRecoverDashboardState() {
      if (!pathname?.startsWith("/servers")) return false;
      if (isLoading || isTeamsLoading) return false;
      if (errorMessage || teamsErrorMessage) return false;
      if (servers.length > 0 || teams.length > 0) return false;
      return true;
    }

    function recoverDashboardState(force = false) {
      if (!shouldRecoverDashboardState()) return;

      const now = Date.now();
      if (!force && now - lastServersRecoveryAtRef.current < 5000) {
        return;
      }

      lastServersRecoveryAtRef.current = now;
      requestServersReload();
      requestTeamsReload();
    }

    function handlePageShow() {
      recoverDashboardState(true);
    }

    function handleWindowFocus() {
      recoverDashboardState();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        recoverDashboardState();
      }
    }

    recoverDashboardState();
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    errorMessage,
    initialServers,
    initialTeams,
    isLoading,
    isTeamsLoading,
    pathname,
    requestServersReload,
    requestTeamsReload,
    servers.length,
    teams.length,
    teamsErrorMessage,
  ]);

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
      const clickedInsideDesktopProfile =
        target && desktopProfileMenuRef.current
          ? desktopProfileMenuRef.current.contains(target)
          : false;
      const clickedInsideMobileProfile =
        target && mobileProfileMenuRef.current
          ? mobileProfileMenuRef.current.contains(target)
          : false;
      if (!clickedInsideDesktopProfile && !clickedInsideMobileProfile) {
        setIsProfileMenuOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsStatusOpen(false);
        setOpenCardMenuGuildId(null);
        setIsTeamMenuOpen(false);
        setIsProfileMenuOpen(false);
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

  const focusSidebarSearchInput = useCallback(() => {
    const inputCandidates = [
      desktopSidebarSearchInputRef.current,
      mobileSidebarSearchInputRef.current,
    ].filter((input): input is HTMLInputElement => Boolean(input));

    const visibleInput = inputCandidates.find((input) => {
      const style = window.getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });

    const targetInput = visibleInput ?? inputCandidates[0] ?? null;
    if (!targetInput) return;

    targetInput.focus();
    targetInput.select();
  }, []);

  useEffect(() => {
    function handleSidebarSearchShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== "f") {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName;
        const isEditable =
          target.isContentEditable ||
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          tagName === "SELECT" ||
          Boolean(target.closest("[contenteditable='true']"));

        if (isEditable) {
          return;
        }
      }

      event.preventDefault();
      focusSidebarSearchInput();
    }

    document.addEventListener("keydown", handleSidebarSearchShortcut);
    return () => {
      document.removeEventListener("keydown", handleSidebarSearchShortcut);
    };
  }, [focusSidebarSearchInput]);

  const normalizedQuery = useMemo(() => normalizeSearchText(searchText), [searchText]);
  const normalizedSidebarQuery = useMemo(
    () => normalizeSearchText(sidebarSearchText),
    [sidebarSearchText],
  );
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
  useBodyScrollLock(isCreateTeamModalOpen);
  const linkedGuildIdsInTeams = useMemo(
    () => new Set(teams.flatMap((team) => team.linkedGuildIds)),
    [teams],
  );
  const teamServerOptions = useMemo(
    () =>
      [...servers].sort((a, b) =>
        a.guildName.localeCompare(b.guildName, "pt-BR"),
      ),
    [servers],
  );
  const availableTeamServerOptions = useMemo(
    () => teamServerOptions.filter((server) => !linkedGuildIdsInTeams.has(server.guildId)),
    [linkedGuildIdsInTeams, teamServerOptions],
  );
  const visibleServers = useMemo(() => {
    if (!selectedTeam) return servers;
    const allowedGuildIds = new Set(selectedTeam.linkedGuildIds);
    return servers.filter((server) => allowedGuildIds.has(server.guildId));
  }, [selectedTeam, servers]);

  const filteredServers = useMemo(() => {
    const baseServers =
      statusFilter === "all"
        ? visibleServers
        : visibleServers.filter((server) => server.status === statusFilter);

    if (!normalizedQuery) {
      return baseServers;
    }

    return baseServers
      .map((server) => ({
        server,
        score: getSearchScore(server.guildName, normalizedQuery),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) =>
        a.score !== b.score
          ? b.score - a.score
          : a.server.guildName.localeCompare(b.server.guildName, "pt-BR"),
      )
      .map((item) => item.server);
  }, [normalizedQuery, visibleServers, statusFilter]);
  const filteredProjectsSidebarItems = useMemo(() => {
    if (!normalizedSidebarQuery) return PROJECTS_SIDEBAR_ITEMS;

    return PROJECTS_SIDEBAR_ITEMS
      .map((item) => {
        const haystack = [item.label, ...(item.searchAliases || [])].join(" ");
        return { item, score: getSearchScore(haystack, normalizedSidebarQuery) };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) =>
        a.score !== b.score
          ? b.score - a.score
          : a.item.label.localeCompare(b.item.label, "pt-BR"),
      )
      .map((entry) => entry.item);
  }, [normalizedSidebarQuery]);

  const filteredTicketSidebarItems = useMemo(() => {
    if (!isEditingServer) return [];

    const items = TICKET_SIDEBAR_ITEMS;

    if (!normalizedSidebarQuery) return items;

    return items
      .map((item) => {
        const haystack = [item.label, ...(item.searchAliases || [])].join(" ");
        return { item, score: getSearchScore(haystack, normalizedSidebarQuery) };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) =>
        a.score !== b.score
          ? b.score - a.score
          : a.item.label.localeCompare(b.item.label, "pt-BR"),
      )
      .map((entry) => entry.item);
  }, [isEditingServer, normalizedSidebarQuery]);

  const filteredEntryExitSidebarItems = useMemo(() => {
    if (!isEditingServer) return [];

    const items = ENTRY_EXIT_SIDEBAR_ITEMS;

    if (!normalizedSidebarQuery) return items;

    return items
      .map((item) => {
        const haystack = [item.label, ...(item.searchAliases || [])].join(" ");
        return { item, score: getSearchScore(haystack, normalizedSidebarQuery) };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) =>
        a.score !== b.score
          ? b.score - a.score
          : a.item.label.localeCompare(b.item.label, "pt-BR"),
      )
      .map((entry) => entry.item);
  }, [isEditingServer, normalizedSidebarQuery]);
  const filteredSecuritySidebarItems = useMemo(() => {
    if (!isEditingServer) return [];

    const items = SECURITY_SIDEBAR_ITEMS;

    if (!normalizedSidebarQuery) return items;

    return items
      .map((item) => {
        const haystack = [item.label, ...(item.searchAliases || [])].join(" ");
        return { item, score: getSearchScore(haystack, normalizedSidebarQuery) };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) =>
        a.score !== b.score
          ? b.score - a.score
          : a.item.label.localeCompare(b.item.label, "pt-BR"),
      )
      .map((entry) => entry.item);
  }, [isEditingServer, normalizedSidebarQuery]);
  const activeTeamServerCount = visibleServers.length;
  const isCreateTeamNextDisabled =
    isCreatingTeam ||
    (createTeamStep === "name" && createTeamName.trim().length < 3) ||
    (createTeamStep === "servers" && !createTeamServerIds.length);
  const isTicketGroupActive =
    isEditingServer &&
    selectedEditorTabForConfig === "settings" &&
    (selectedSettingsSectionForConfig === "overview" ||
      selectedSettingsSectionForConfig === "message");
  const isEntryExitGroupActive =
    isEditingServer &&
    selectedEditorTabForConfig === "settings" &&
    (selectedSettingsSectionForConfig === "entry_exit_overview" ||
      selectedSettingsSectionForConfig === "entry_exit_message");
  const isSecurityGroupActive =
    isEditingServer &&
    selectedEditorTabForConfig === "settings" &&
    (selectedSettingsSectionForConfig === "security_antilink" ||
      selectedSettingsSectionForConfig === "security_autorole" ||
      selectedSettingsSectionForConfig === "security_logs");
  useEffect(() => {
    if (normalizedSidebarQuery) {
      setIsTicketSidebarOpen(true);
      setIsEntryExitSidebarOpen(true);
      setIsSecuritySidebarOpen(true);
      return;
    }

    if (isTicketGroupActive) {
      setIsTicketSidebarOpen(true);
    }
    if (isEntryExitGroupActive) {
      setIsEntryExitSidebarOpen(true);
    }
    if (isSecurityGroupActive) {
      setIsSecuritySidebarOpen(true);
    }
  }, [isEntryExitGroupActive, isSecurityGroupActive, isTicketGroupActive, normalizedSidebarQuery]);

  useEffect(() => {
    if (!selectedGuildIdForConfig) {
      setHasUnsavedSettingsChanges(false);
    }
  }, [selectedGuildIdForConfig]);

  useEffect(() => {
    if (
      Boolean(selectedGuildIdForConfig) ||
      isLoading ||
      errorMessage ||
      !filteredServers.length
    ) {
      return;
    }

    const guildIdsToWarm = filteredServers
      .slice(0, 6)
      .map((server) => server.guildId);

    const timeoutId = window.setTimeout(() => {
      guildIdsToWarm.forEach((guildId) => {
        void prefetchServerDashboardSettings(guildId);
      });
    }, 80);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [errorMessage, filteredServers, isLoading, selectedGuildIdForConfig]);

  useEffect(() => {
    router.prefetch("/dashboard");
    router.prefetch("/account");
  }, [router]);

  const buildServerConfigUrl = useCallback((
    guildId: string,
    tab: ServerEditorTab,
    settingsSection: ServerSettingsSection = "overview",
    options?: { explicitSection?: boolean },
  ) => {
    if (tab !== "settings") {
      const encodedGuildId = encodeURIComponent(guildId);
      return `/servers/${encodedGuildId}/`;
    }

    const encodedGuildId = encodeURIComponent(guildId);
    if (settingsSection === "message") {
      return `/servers/${encodedGuildId}/tickets/message/`;
    }
    if (settingsSection === "ticket_ai") {
      return `/servers/${encodedGuildId}/tickets/flowai/`;
    }
    if (settingsSection === "entry_exit_message") {
      return `/servers/${encodedGuildId}/entry-exit/message/`;
    }
    if (settingsSection === "entry_exit_overview") {
      return `/servers/${encodedGuildId}/entry-exit/overview/`;
    }
    if (settingsSection === "security_antilink") {
      return `/servers/${encodedGuildId}/security/antilink/`;
    }
    if (settingsSection === "security_autorole") {
      return `/servers/${encodedGuildId}/security/autorole/`;
    }
    if (settingsSection === "security_logs") {
      return `/servers/${encodedGuildId}/security/logs/`;
    }
    if (options?.explicitSection) {
      return `/servers/${encodedGuildId}/tickets/overview/`;
    }
    return `/servers/${encodedGuildId}/`;
  }, []);

  const navigateToUrl = useCallback((nextUrl: string, mode: "push" | "replace" = "push") => {
    if (typeof window === "undefined") return;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const comparableCurrentUrl = normalizeComparablePath(currentUrl);
    const comparableNextUrl = normalizeComparablePath(nextUrl);
    if (comparableCurrentUrl === comparableNextUrl) return;
    const currentPathname = window.location.pathname;
    const nextPathname = nextUrl.split("?")[0]?.split("#")[0] || "";
    const isInternalServersPath =
      isServersWorkspacePath(currentPathname) &&
      isServersWorkspacePath(nextPathname);

    // Atualiza a URL imediatamente enquanto mantemos a arvore viva no mesmo workspace.
    if (isInternalServersPath) {
      if (mode === "replace") {
        window.history.replaceState(window.history.state, "", nextUrl);
        return;
      }

      window.history.pushState(window.history.state, "", nextUrl);
      return;
    }

    void router.prefetch(nextPathname || nextUrl);
    if (mode === "replace") router.replace(nextUrl, { scroll: false });
    else router.push(nextUrl, { scroll: false });
  }, [router]);

  const applySelectedServerRouteState = useCallback((
    guildId: string | null,
    tab: ServerEditorTab,
    settingsSection: ServerSettingsSection,
  ) => {
    setSelectedGuildIdForConfig(guildId);
    setSelectedEditorTabForConfig(tab);
    setSelectedSettingsSectionForConfig(settingsSection);
  }, []);

  const openProjectsOverview = useCallback((mode: "push" | "replace" = "push") => {
    navigateToUrl("/servers/", mode);
    startOpenServerTransition(() => {
      applySelectedServerRouteState(null, "settings", "overview");
      setErrorMessage(null);
    });
  }, [applySelectedServerRouteState, navigateToUrl, startOpenServerTransition]);

  const prefetchWorkspaceSections = useCallback((guildId: string) => {
    void prefetchServerDashboardSettings(guildId);
    [
      buildServerConfigUrl(guildId, "settings", "overview"),
      buildServerConfigUrl(guildId, "settings", "message"),
      buildServerConfigUrl(guildId, "settings", "ticket_ai"),
      buildServerConfigUrl(guildId, "settings", "entry_exit_overview"),
      buildServerConfigUrl(guildId, "settings", "entry_exit_message"),
      buildServerConfigUrl(guildId, "settings", "security_antilink"),
      buildServerConfigUrl(guildId, "settings", "security_autorole"),
      buildServerConfigUrl(guildId, "settings", "security_logs"),
    ].forEach((url) => {
      router.prefetch(url);
    });
  }, [buildServerConfigUrl, router]);

  const handleSidebarSettingsSectionNavigation = useCallback(
    (input: {
      guildId: string;
      tab: ServerEditorTab;
      settingsSection: ServerSettingsSection;
    }) => {
      const isChangingSettingsSection =
        selectedEditorTabForConfig === "settings" &&
        input.tab === "settings" &&
        selectedSettingsSectionForConfig !== input.settingsSection;

      if (
        isEditingServer &&
        hasUnsavedSettingsChanges &&
        isChangingSettingsSection
      ) {
        setNavigationBlockSignal((current) => current + 1);
        return;
      }

      prefetchWorkspaceSections(input.guildId);
      navigateToUrl(
        buildServerConfigUrl(
          input.guildId,
          input.tab,
          input.settingsSection,
          { explicitSection: true },
        ),
        "replace",
      );
      startOpenServerTransition(() => {
        applySelectedServerRouteState(input.guildId, input.tab, input.settingsSection);
        setErrorMessage(null);
      });
    },
    [
      applySelectedServerRouteState,
      buildServerConfigUrl,
      hasUnsavedSettingsChanges,
      isEditingServer,
      navigateToUrl,
      prefetchWorkspaceSections,
      selectedEditorTabForConfig,
      selectedSettingsSectionForConfig,
      startOpenServerTransition,
    ],
  );

  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
      });
    } catch {
      // Mesmo com erro de rede, redireciona para login
    } finally {
      // Limpa qualquer estado persistido no localStorage antes de redirecionar
      try {
        window.localStorage.removeItem("flowdesk_pending_account_switch_v1");
      } catch {
        // noop
      }
      window.location.replace("/login");
    }
  }, [isLoggingOut]);

  const openDiscordLoginFlow = useCallback(() => {
    if (typeof window === "undefined") return;
    const nextPath = `${window.location.pathname}${window.location.search}`;
    window.location.assign(buildDiscordAuthStartHref(nextPath));
  }, []);

  const handleAddAnotherAccount = useCallback(() => {
    setIsProfileMenuOpen(false);
    openDiscordLoginFlow();
  }, [openDiscordLoginFlow]);

  const handleSwitchSavedAccount = useCallback(
    (account: SavedPanelAccount) => {
      if (account.discordUserId === currentAccount.discordUserId) {
        setIsProfileMenuOpen(false);
        return;
      }

      try {
        window.localStorage.setItem(
          "flowdesk_pending_account_switch_v1",
          JSON.stringify({
            discordUserId: account.discordUserId,
            requestedAt: Date.now(),
          }),
        );
      } catch {
        // noop
      }

      setIsProfileMenuOpen(false);
      openDiscordLoginFlow();
    },
    [currentAccount.discordUserId, openDiscordLoginFlow],
  );

  const handleOpenAccountSettings = useCallback(() => {
    setIsProfileMenuOpen(false);
    router.push("/account");
  }, [router]);

  const handleOpenMyAccount = useCallback(() => {
    setIsProfileMenuOpen(false);
    window.location.assign("/discord/link");
  }, []);

  const handleOpenHelp = useCallback(() => {
    setIsProfileMenuOpen(false);
    window.open("https://discord.gg/ddXtHhvvrx", "_blank", "noopener,noreferrer");
  }, []);

  const handleStartAddServer = useCallback(async () => {
    if (isResolvingAddServer) return;
    setErrorMessage(null);
    setIsResolvingAddServer(true);

    try {
      const targetHref = await resolveAddServerTargetHref();
      window.location.assign(targetHref);
    } finally {
      setIsResolvingAddServer(false);
    }
  }, [isResolvingAddServer]);

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
    const normalizedValue = typeof value === "string" ? value : "";
    setMemberDraftIds((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? normalizedValue : (typeof draft === "string" ? draft : ""),
      ),
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
    const nextSettingsSection: ServerSettingsSection = "overview";
    const isSameSelection =
      selectedGuildIdForConfig === guildId &&
      selectedEditorTabForConfig === tab &&
      selectedSettingsSectionForConfig === nextSettingsSection;
    if (isSameSelection) {
      return;
    }

    prefetchWorkspaceSections(guildId);
    navigateToUrl(buildServerConfigUrl(guildId, tab), "push");
    startOpenServerTransition(() => {
      applySelectedServerRouteState(guildId, tab, nextSettingsSection);
      setErrorMessage(null);
    });
  }, [
    applySelectedServerRouteState,
    buildServerConfigUrl,
    navigateToUrl,
    prefetchWorkspaceSections,
    selectedEditorTabForConfig,
    selectedGuildIdForConfig,
    selectedSettingsSectionForConfig,
    startOpenServerTransition,
  ]);

  const prefetchServerConfig = useCallback((guildId: string, tab: ServerEditorTab = "settings") => {
    prefetchWorkspaceSections(guildId);
    router.prefetch(buildServerConfigUrl(guildId, tab));
  }, [buildServerConfigUrl, prefetchWorkspaceSections, router]);

  useEffect(() => {
    if (!selectedGuildIdForConfig) return;

    const timeoutId = window.setTimeout(() => {
      prefetchWorkspaceSections(selectedGuildIdForConfig);
    }, 100);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [prefetchWorkspaceSections, selectedGuildIdForConfig]);

  const selectedServer = useMemo(
    () => servers.find((server) => server.guildId === selectedGuildIdForConfig) || null,
    [selectedGuildIdForConfig, servers],
  );
  const workspaceAlertMessage = useMemo(
    () =>
      resolveServersWorkspaceAlertMessage({
        isEditingServer,
        selectedServer,
        servers,
      }),
    [isEditingServer, selectedServer, servers],
  );
  const hasWorkspaceAlert = Boolean(workspaceAlertMessage);
  const isEditorViewerOnly = useMemo(() => {
    if (!selectedServer) return false;
    return !(selectedServer.canManage && selectedServer.accessMode === "owner");
  }, [selectedServer]);

  const hasCurrentSectionPermission = useMemo(() => {
    if (selectedServer?.accessMode === "owner") return true;
    if (currentDashboardPermissions === "full") return true;
    const perms = new Set(currentDashboardPermissions);
    const section = selectedSettingsSectionForConfig;

    if (section === "overview" || section === "message") {
      return perms.has("server_manage_tickets_overview");
    }
    if (section === "entry_exit_overview" || section === "entry_exit_message") {
      return perms.has("server_manage_welcome_overview");
    }
    if (section === "security_antilink") return perms.has("server_manage_security_antilink");
    if (section === "security_autorole") return perms.has("server_manage_security_autorole");
    if (section === "security_logs") return perms.has("server_manage_security_logs");
    
    return false;
  }, [currentDashboardPermissions, selectedServer?.accessMode, selectedSettingsSectionForConfig]);

  const shouldHideEditorHeaderDueToPermissions = 
    isEditingServer && 
    !isLoading && 
    !isEditorViewerOnly && 
    !hasCurrentSectionPermission &&
    (errorMessage === "Acesso negado." || (Array.isArray(currentDashboardPermissions) && currentDashboardPermissions.length === 0));
  
  const shouldShowEditorSkeleton =
    Boolean(selectedGuildIdForConfig) && (isLoading || (!selectedServer && !errorMessage));
  const shouldShowEditorUnavailableState =
    Boolean(selectedGuildIdForConfig) &&
    !selectedServer &&
    !isLoading &&
    Boolean(errorMessage || servers.length > 0);
  const shouldShowEditorHeaderSkeleton =
    Boolean(selectedGuildIdForConfig) && !selectedServer;

  useNotificationEffect(teamsErrorMessage, {
    tone: "error",
    title: "Equipes",
  });
  useNotificationEffect(teamActionError, {
    tone: "error",
    title: "Equipes",
  });
  useNotificationEffect(teamActionMessage, {
    tone: "success",
    title: "Equipes",
  });

  useEffect(() => {
    if (!selectedGuildIdForConfig) {
      selectedServerRecoveryRef.current = { guildId: null, attempts: 0 };
      return;
    }

    if (selectedServer) {
      selectedServerRecoveryRef.current = {
        guildId: selectedGuildIdForConfig,
        attempts: 0,
      };
      return;
    }

    if (isLoading) {
      return;
    }

    if (selectedServerRecoveryRef.current.guildId !== selectedGuildIdForConfig) {
      selectedServerRecoveryRef.current = {
        guildId: selectedGuildIdForConfig,
        attempts: 0,
      };
    }

    if (selectedServerRecoveryRef.current.attempts >= 2) {
      return;
    }

    selectedServerRecoveryRef.current = {
      guildId: selectedGuildIdForConfig,
      attempts: selectedServerRecoveryRef.current.attempts + 1,
    };
    requestServersReload();
  }, [isLoading, requestServersReload, selectedGuildIdForConfig, selectedServer]);

  const panelTitle = isEditingServer
    ? `Servidor ${selectedServer?.guildName || ""}`.trim()
    : viewMode === "overview"
      ? "Overview"
      : "Servidores em lista";
  const panelDescription = isEditingServer
    ? "Gerencie tickets, canais e cargos do servidor em um fluxo unico, mais limpo e mais atual."
    : viewMode === "overview"
      ? selectedTeam
        ? `Servidores vinculados a equipe ${selectedTeam.name}, com visao mais limpa para moderacao, cobranca da conta e operacao do painel.`
        : "Uma visao mais limpa para encontrar servidores, acompanhar a cobranca da conta e abrir configuracoes rapido."
      : selectedTeam
        ? `Modo lista da equipe ${selectedTeam.name}, com todos os servidores vinculados organizados no mesmo fluxo.`
        : "Modo lista para navegar mais rapido entre todos os servidores e estados da conta.";
  const teamSummaryLabel = isTeamsLoading
    ? "Carregando equipes..."
    : selectedTeam
      ? `${selectedTeam.memberCount} membro(s)   ${selectedTeam.linkedGuildIds.length} servidor(es)`
      : teams.length
        ? `${teams.length} equipe(s) disponivel(is)`
        : pendingTeamInvites.length
          ? `${pendingTeamInvites.length} convite(s) pendente(s)`
          : "Nenhuma equipe criada";
  const renderSidebarContent = (
    teamDropdownRef: RefObject<HTMLDivElement | null>,
    profileDropdownRef: RefObject<HTMLDivElement | null>,
    sidebarSearchInputRef: RefObject<HTMLInputElement | null>,
  ) => (
    <div className="flex h-full flex-col px-[14px] py-[14px]">
      <div ref={teamDropdownRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setIsProfileMenuOpen(false);
            setIsTeamMenuOpen((current) => !current);
          }}
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
              <SidebarDropdownChevronIcon />
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
                            {team.memberCount} membro(s)   {team.linkedGuildIds.length} servidor(es)
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
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-[14px] flex items-center gap-[10px] rounded-[16px] border border-[#141414] bg-[#080808] px-[14px] py-[12px]">
        <SearchIcon />
        <input
          ref={sidebarSearchInputRef}
          type="text"
          value={typeof sidebarSearchText === "string" ? sidebarSearchText : ""}
          onChange={(event) => setSidebarSearchText(String(event.currentTarget.value ?? ""))}
          placeholder="Buscar..."
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#5A5A5A]"
        />
        <SidebarSearchShortcutIcon />
      </div>

      <div className="mt-[14px] flex-1 overflow-y-auto pr-[2px]">
        {filteredProjectsSidebarItems.length ||
        filteredTicketSidebarItems.length ||
        filteredEntryExitSidebarItems.length ||
        filteredSecuritySidebarItems.length ? (
          <>
            {filteredProjectsSidebarItems.length ? (
              <div className="space-y-[4px]">
                {filteredProjectsSidebarItems.map((item) => {
                  const isActive = item.kind === "overview" && !isEditingServer;

                  return (
                      <button
                        key={item.label}
                        type="button"
                        onMouseEnter={() => {
                          if (item.kind === "dashboard") {
                            router.prefetch("/dashboard");
                          }
                        }}
                        onFocus={() => {
                          if (item.kind === "dashboard") {
                            router.prefetch("/dashboard");
                          }
                        }}
                        onClick={() => {
                          if (item.kind === "dashboard") {
                            router.push("/dashboard");
                          } else {
                            openProjectsOverview("push");
                          }
                        }}
                        className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-all duration-200 ${
                          isActive
                          ? "bg-[#1E1E1E] text-[#F0F0F0]"
                          : "text-[#B5B5B5] hover:bg-[#111111] hover:text-[#E3E3E3]"
                      }`}
                    >
                      <span className={`inline-flex h-[22px] w-[22px] items-center justify-center ${isActive ? "text-[#F0F0F0]" : "text-[#8A8A8A] group-hover:text-[#DADADA]"}`}>
                        <SidebarNavIcon kind={item.kind} active={isActive} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {isEditingServer ? (
              <div className="my-[12px] h-px rounded-full bg-[#202020]" />
            ) : null}

            {filteredTicketSidebarItems.length ? (
              <div className="mt-[12px]">
                <button
                  type="button"
                  onClick={() => setIsTicketSidebarOpen((current) => !current)}
                  className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-all duration-200 ${
                    isTicketGroupActive
                      ? "bg-[#1E1E1E] text-[#F0F0F0]"
                      : isTicketSidebarOpen
                        ? "bg-[#121212] text-[#D6D6D6]"
                        : "text-[#B5B5B5] hover:bg-[#111111] hover:text-[#E3E3E3]"
                  }`}
                >
                  <span className={`inline-flex h-[22px] w-[22px] items-center justify-center ${isTicketGroupActive ? "text-[#F0F0F0]" : isTicketSidebarOpen ? "text-[#C7C7C7]" : "text-[#8A8A8A] group-hover:text-[#DADADA]"}`}>
                    <SidebarNavIcon kind="ticket" active={isTicketGroupActive} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">
                    Ticket
                  </span>
                  <span
                    className={`transition-transform duration-200 ${
                      isTicketSidebarOpen || normalizedSidebarQuery
                        ? "rotate-180 text-[#C9C9C9]"
                        : "rotate-0 text-[#6F6F6F] group-hover:text-[#BEBEBE]"
                    }`}
                  >
                    <SidebarDropdownChevronIcon />
                  </span>
                </button>

                {isTicketSidebarOpen || normalizedSidebarQuery ? (
                  <div className="mt-[6px] space-y-[4px] pl-[12px]">
                    {filteredTicketSidebarItems.map((item) => {
                      const isDisabled = item.disabled || !selectedServer || !item.tab;
                      const isActive =
                        Boolean(
                          item.tab &&
                            selectedEditorTabForConfig === item.tab &&
                            selectedSettingsSectionForConfig === item.settingsSection &&
                            isEditingServer,
                        );

                        return (
                          <button
                            key={item.label}
                            type="button"
                            onMouseEnter={() => {
                              if (!isDisabled || selectedServer) {
                                const guildId = selectedServer?.guildId;
                                if (guildId && item.tab) {
                                  prefetchWorkspaceSections(guildId);
                                }
                              }
                            }}
                            onFocus={() => {
                              if (!isDisabled || selectedServer) {
                                const guildId = selectedServer?.guildId;
                                if (guildId && item.tab) {
                                  prefetchWorkspaceSections(guildId);
                                }
                              }
                            }}
                            onClick={() => {
                              if (isDisabled || !selectedServer || !item.tab) return;
                              handleSidebarSettingsSectionNavigation({
                              guildId: selectedServer.guildId,
                              tab: item.tab,
                              settingsSection: item.settingsSection || "overview",
                            });
                          }}
                          disabled={isDisabled}
                          className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[10px] text-left transition-all duration-200 ${
                            isActive
                              ? "bg-[#1A1A1A] text-[#F0F0F0]"
                              : isDisabled
                                ? "text-[#585858]"
                                : "text-[#AFAFAF] hover:bg-[#101010] hover:text-[#E3E3E3]"
                          }`}
                        >
                          <span className={`inline-flex h-[20px] w-[20px] items-center justify-center ${isActive ? "text-[#F0F0F0]" : isDisabled ? "text-[#4A4A4A]" : "text-[#7F7F7F] group-hover:text-[#DADADA]"}`}>
                            <SidebarNavIcon kind={item.kind} active={isActive} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {filteredEntryExitSidebarItems.length ? (
              <div className="mt-[12px]">
                <button
                  type="button"
                  onClick={() => setIsEntryExitSidebarOpen((current) => !current)}
                  className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-all duration-200 ${
                    isEntryExitGroupActive
                      ? "bg-[#1E1E1E] text-[#F0F0F0]"
                      : isEntryExitSidebarOpen
                        ? "bg-[#121212] text-[#D6D6D6]"
                        : "text-[#B5B5B5] hover:bg-[#111111] hover:text-[#E3E3E3]"
                  }`}
                >
                  <span className={`inline-flex h-[22px] w-[22px] items-center justify-center ${isEntryExitGroupActive ? "text-[#F0F0F0]" : isEntryExitSidebarOpen ? "text-[#C7C7C7]" : "text-[#8A8A8A] group-hover:text-[#DADADA]"}`}>
                    <SidebarNavIcon kind="entry_exit" active={isEntryExitGroupActive} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">
                    Mensagem Entrada/Saida
                  </span>
                  <span
                    className={`transition-transform duration-200 ${
                      isEntryExitSidebarOpen || normalizedSidebarQuery
                        ? "rotate-180 text-[#C9C9C9]"
                        : "rotate-0 text-[#6F6F6F] group-hover:text-[#BEBEBE]"
                    }`}
                  >
                    <SidebarDropdownChevronIcon />
                  </span>
                </button>

                {isEntryExitSidebarOpen || normalizedSidebarQuery ? (
                  <div className="mt-[6px] space-y-[4px] pl-[12px]">
                    {filteredEntryExitSidebarItems.map((item) => {
                      const isDisabled = item.disabled || !selectedServer || !item.tab;
                      const isActive =
                        Boolean(
                          item.tab &&
                            selectedEditorTabForConfig === item.tab &&
                            selectedSettingsSectionForConfig === item.settingsSection &&
                            isEditingServer,
                        );

                        return (
                          <button
                            key={item.label}
                            type="button"
                            onMouseEnter={() => {
                              if (!isDisabled || selectedServer) {
                                const guildId = selectedServer?.guildId;
                                if (guildId && item.tab) {
                                  prefetchWorkspaceSections(guildId);
                                }
                              }
                            }}
                            onFocus={() => {
                              if (!isDisabled || selectedServer) {
                                const guildId = selectedServer?.guildId;
                                if (guildId && item.tab) {
                                  prefetchWorkspaceSections(guildId);
                                }
                              }
                            }}
                            onClick={() => {
                              if (isDisabled || !selectedServer || !item.tab) return;
                              handleSidebarSettingsSectionNavigation({
                              guildId: selectedServer.guildId,
                              tab: item.tab,
                              settingsSection: item.settingsSection || "overview",
                            });
                          }}
                          disabled={isDisabled}
                          className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[10px] text-left transition-all duration-200 ${
                            isActive
                              ? "bg-[#1A1A1A] text-[#F0F0F0]"
                              : isDisabled
                                ? "text-[#585858]"
                                : "text-[#AFAFAF] hover:bg-[#101010] hover:text-[#E3E3E3]"
                          }`}
                        >
                          <span className={`inline-flex h-[20px] w-[20px] items-center justify-center ${isActive ? "text-[#F0F0F0]" : isDisabled ? "text-[#4A4A4A]" : "text-[#7F7F7F] group-hover:text-[#DADADA]"}`}>
                            <SidebarNavIcon kind={item.kind} active={isActive} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {filteredSecuritySidebarItems.length ? (
              <div className="mt-[12px]">
                <button
                  type="button"
                  onClick={() => setIsSecuritySidebarOpen((current) => !current)}
                  className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-all duration-200 ${
                    isSecurityGroupActive
                      ? "bg-[#1E1E1E] text-[#F0F0F0]"
                      : isSecuritySidebarOpen
                        ? "bg-[#121212] text-[#D6D6D6]"
                        : "text-[#B5B5B5] hover:bg-[#111111] hover:text-[#E3E3E3]"
                  }`}
                >
                  <span className={`inline-flex h-[22px] w-[22px] items-center justify-center ${isSecurityGroupActive ? "text-[#F0F0F0]" : isSecuritySidebarOpen ? "text-[#C7C7C7]" : "text-[#8A8A8A] group-hover:text-[#DADADA]"}`}>
                    <SidebarNavIcon kind="security" active={isSecurityGroupActive} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">
                    Seguranca
                  </span>
                  <span
                    className={`transition-transform duration-200 ${
                      isSecuritySidebarOpen || normalizedSidebarQuery
                        ? "rotate-180 text-[#C9C9C9]"
                        : "rotate-0 text-[#6F6F6F] group-hover:text-[#BEBEBE]"
                    }`}
                  >
                    <SidebarDropdownChevronIcon />
                  </span>
                </button>

                {isSecuritySidebarOpen || normalizedSidebarQuery ? (
                  <div className="mt-[6px] space-y-[4px] pl-[12px]">
                    {filteredSecuritySidebarItems.map((item) => {
                      const isDisabled = item.disabled || !selectedServer || !item.tab;
                      const isActive =
                        Boolean(
                          item.tab &&
                            selectedEditorTabForConfig === item.tab &&
                            selectedSettingsSectionForConfig === item.settingsSection &&
                            isEditingServer,
                        );

                        return (
                          <button
                            key={item.label}
                            type="button"
                            onMouseEnter={() => {
                              if (!isDisabled || selectedServer) {
                                const guildId = selectedServer?.guildId;
                                if (guildId && item.tab) {
                                  prefetchWorkspaceSections(guildId);
                                }
                              }
                            }}
                            onFocus={() => {
                              if (!isDisabled || selectedServer) {
                                const guildId = selectedServer?.guildId;
                                if (guildId && item.tab) {
                                  prefetchWorkspaceSections(guildId);
                                }
                              }
                            }}
                            onClick={() => {
                              if (isDisabled || !selectedServer || !item.tab) return;
                              handleSidebarSettingsSectionNavigation({
                              guildId: selectedServer.guildId,
                              tab: item.tab,
                              settingsSection: item.settingsSection || "overview",
                            });
                          }}
                          disabled={isDisabled}
                          className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[10px] text-left transition-all duration-200 ${
                            isActive
                              ? "bg-[#1A1A1A] text-[#F0F0F0]"
                              : isDisabled
                                ? "text-[#585858]"
                                : "text-[#AFAFAF] hover:bg-[#101010] hover:text-[#E3E3E3]"
                          }`}
                        >
                          <span className={`inline-flex h-[20px] w-[20px] items-center justify-center ${isActive ? "text-[#F0F0F0]" : isDisabled ? "text-[#4A4A4A]" : "text-[#7F7F7F] group-hover:text-[#DADADA]"}`}>
                            <SidebarNavIcon kind={item.kind} active={isActive} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-[18px] border border-[#131313] bg-[#080808] px-[14px] py-[16px]">
            <p className="text-[13px] leading-[1.55] text-[#767676]">
              Nenhuma area encontrada para essa busca.
            </p>
          </div>
        )}
      </div>

      <div ref={profileDropdownRef} className="mt-[14px]">
        <div className="relative">
          {isProfileMenuOpen ? (
            <div className="absolute inset-x-0 bottom-[calc(100%+10px)] z-[140] overflow-hidden rounded-[22px] border border-[#151515] bg-[#070707] p-[12px] shadow-[0_26px_80px_rgba(0,0,0,0.54)]">
              <div className="space-y-[8px]">
                <button
                  type="button"
                  onClick={handleAddAnotherAccount}
                  className="flex w-full items-center gap-[12px] rounded-[16px] border border-[#171717] bg-[#0D0D0D] px-[12px] py-[12px] text-left text-[#D8D8D8] transition-colors hover:border-[#222222] hover:bg-[#111111]"
                >
                  <span className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-[11px] border border-[#1A1A1A] bg-[#101010] text-[#CFCFCF]">
                    <PlusIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                      Adicionar outra conta
                    </span>
                    <span className="mt-[6px] block truncate text-[11px] leading-none text-[#686868]">
                      Ate 3 contas salvas neste navegador
                    </span>
                  </span>
                </button>

                <div className="border-t border-[#121212] pt-[12px]">
                  <p className="px-[4px] text-[11px] uppercase tracking-[0.16em] text-[#5F5F5F]">
                    Contas salvas
                  </p>
                  <div className="mt-[10px] space-y-[6px]">
                    {savedAccounts.map((account) => {
                      const isCurrent = account.discordUserId === currentAccount.discordUserId;
                      return (
                        <button
                          key={account.discordUserId}
                          type="button"
                          onClick={() => handleSwitchSavedAccount(account)}
                          className={`flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-colors ${
                            isCurrent
                              ? "bg-[#141414] text-[#ECECEC]"
                              : "text-[#A7A7A7] hover:bg-[#111111] hover:text-[#E6E6E6]"
                          }`}
                        >
                          <AccountAvatar
                            avatarUrl={account.avatarUrl}
                            displayName={account.displayName}
                            username={account.username}
                            className="h-[36px] w-[36px] shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] leading-none font-medium tracking-[-0.03em]">
                              {account.displayName}
                            </span>
                            <span className="mt-[6px] block truncate text-[11px] leading-none text-[#666666]">
                              @{account.username}
                            </span>
                          </span>
                          {isCurrent ? (
                            <span className="inline-flex rounded-full border border-[rgba(0,98,255,0.28)] bg-[rgba(0,98,255,0.1)] px-[8px] py-[5px] text-[10px] leading-none font-medium text-[#8AB6FF]">
                              ativa
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-[#121212] pt-[12px]">
                  <div className="space-y-[4px]">
                    <button
                      type="button"
                      onClick={handleOpenMyAccount}
                      className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#B7B7B7] transition-colors hover:bg-[#111111] hover:text-[#ECECEC]"
                    >
                      <UserRound className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
                      <span className="text-[14px] leading-none font-medium">Minha conta</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenAccountSettings}
                      className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#B7B7B7] transition-colors hover:bg-[#111111] hover:text-[#ECECEC]"
                    >
                      <Cog className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
                      <span className="text-[14px] leading-none font-medium">Configuracoes</span>
                    </button>
                    <button
                      type="button"
                      disabled
                      className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#656565]"
                    >
                      <Palette className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
                      <span className="text-[14px] leading-none font-medium">Personalizacao</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenHelp}
                      className="flex w-full items-center justify-between gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#B7B7B7] transition-colors hover:bg-[#111111] hover:text-[#ECECEC]"
                    >
                      <span className="inline-flex items-center gap-[12px]">
                        <CircleHelp className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
                        <span className="text-[14px] leading-none font-medium">Ajuda</span>
                      </span>
                      <SidebarChevronRightIcon />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleLogout();
                      }}
                      disabled={isLoggingOut}
                      className="flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left text-[#DB9E9E] transition-colors hover:bg-[#111111] hover:text-[#F1C0C0] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isLoggingOut ? (
                        <ButtonLoader size={16} colorClassName="text-[#DB8A8A]" />
                      ) : (
                        <SidebarLogoutIcon />
                      )}
                      <span className="text-[14px] leading-none font-medium">Sair</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setIsTeamMenuOpen(false);
              setIsProfileMenuOpen((current) => !current);
            }}
            className="flex w-full items-center justify-between gap-[12px] rounded-[18px] border border-[#111111] bg-[#080808] px-[10px] py-[10px] text-left transition-colors hover:border-[#1A1A1A] hover:bg-[#0B0B0B]"
            aria-expanded={isProfileMenuOpen}
            aria-haspopup="menu"
          >
            <div className="flex min-w-0 items-center gap-[10px]">
              <AccountAvatar
                avatarUrl={currentAccount.avatarUrl}
                displayName={currentAccount.displayName}
                username={currentAccount.username}
                className="h-[38px] w-[38px] shrink-0"
              />
              <div className="min-w-0">
                <p className="truncate text-[15px] leading-none font-medium tracking-[-0.03em] text-[#E5E5E5]">
                  {currentAccount.displayName}
                </p>
                <p className="mt-[5px] truncate text-[12px] leading-none text-[#686868]">
                  @{currentAccount.username}
                </p>
              </div>
            </div>
            <span className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[10px] text-[#7E7E7E] transition-colors hover:bg-[#101010] hover:text-[#D8D8D8]">
              <SidebarDropdownChevronIcon />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]" />
      {workspaceAlertMessage ? (
        <button
          type="button"
          onClick={() => {
            router.push("/servers/plans");
          }}
          className="fixed inset-x-0 top-0 z-[1400] h-[42px] overflow-hidden bg-[linear-gradient(90deg,#731015_0%,#971D22_10%,#BC2D32_24%,#D94141_40%,#E45555_50%,#D94141_60%,#BC2D32_76%,#971D22_90%,#731015_100%)] text-white transition-opacity hover:opacity-95 md:h-[46px]"
          aria-label={`${workspaceAlertMessage} Abrir pagina de planos.`}
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-[linear-gradient(90deg,transparent_0%,rgba(255,214,214,0.24)_14%,rgba(255,214,214,0.12)_50%,rgba(255,214,214,0.24)_86%,transparent_100%)]" />
          <span className="pointer-events-none absolute inset-0 opacity-[0.14] bg-[radial-gradient(circle_at_50%_50%,rgba(255,240,240,0.18)_0%,rgba(255,240,240,0.06)_34%,transparent_62%)]" />
          <span className="pointer-events-none absolute inset-y-0 left-0 w-[220px] bg-[linear-gradient(90deg,rgba(44,0,0,0.28)_0%,rgba(44,0,0,0.16)_32%,rgba(44,0,0,0.05)_64%,transparent_100%)]" />
          <span className="pointer-events-none absolute inset-y-0 right-0 w-[220px] bg-[linear-gradient(270deg,rgba(44,0,0,0.28)_0%,rgba(44,0,0,0.16)_32%,rgba(44,0,0,0.05)_64%,transparent_100%)]" />
          <WorkspaceAlertPixelAccent side="left" />
          <WorkspaceAlertPixelAccent side="right" />
          <div className="relative mx-auto flex h-full w-full max-w-[1280px] items-center justify-center px-[16px] md:px-[22px]">
            <span className="inline-flex min-w-0 max-w-full items-center justify-center gap-[8px] text-center md:gap-[12px]">
              <span className="text-[12px] font-medium tracking-[-0.02em] text-white md:text-[13px]">
                {workspaceAlertMessage}
              </span>
              <span className="hidden items-center gap-[6px] rounded-full border border-[rgba(255,255,255,0.18)] bg-[rgba(22,0,0,0.16)] px-[11px] py-[5px] text-[11px] leading-none font-semibold text-[rgba(255,255,255,0.94)] md:inline-flex">
                Ver planos
                <ArrowUpRight className="h-[14px] w-[14px] shrink-0" strokeWidth={2.4} aria-hidden="true" />
              </span>
              <ArrowUpRight className="h-[15px] w-[15px] shrink-0 md:hidden" strokeWidth={2.5} aria-hidden="true" />
            </span>
          </div>
        </button>
      ) : null}
      <div className="hidden lg:block">
        <aside
          className={`fixed left-0 z-20 w-[318px] ${
            hasWorkspaceAlert ? "top-[42px] bottom-0 md:top-[46px]" : "inset-y-0"
          }`}
        >
          <div className={`${sidebarShellClass} h-full rounded-none border-y-0 border-l-0 border-r-[#151515]`}>
            <LandingReveal delay={90}>
              {renderSidebarContent(desktopTeamMenuRef, desktopProfileMenuRef, desktopSidebarSearchInputRef)}
            </LandingReveal>
          </div>
        </aside>
      </div>
      <main
        className={`relative px-[20px] pb-[56px] md:px-6 lg:min-h-screen lg:pl-[358px] lg:pr-[42px] ${
          hasWorkspaceAlert ? "pt-[56px] md:pt-[60px]" : "pt-[32px]"
        }`}
      >
        <div className="mx-auto w-full max-w-[1220px]">
          <aside className="mb-[20px] min-w-0 lg:hidden">
            <LandingReveal delay={90}>
              <div className={`${sidebarShellClass} rounded-[28px]`}>
                {renderSidebarContent(mobileTeamMenuRef, mobileProfileMenuRef, mobileSidebarSearchInputRef)}
              </div>
            </LandingReveal>
          </aside>
          <section className="min-w-0">
            <LandingReveal delay={120}>
              <div className="relative z-[700] flex flex-col gap-[18px]">
                <div className="flex flex-col gap-[14px] md:flex-row md:items-end md:justify-between">
                  <div>
                    {shouldShowEditorHeaderSkeleton ? (
                      <div className="space-y-[14px]" aria-hidden="true">
                        <div className="flowdesk-shimmer h-[42px] w-[210px] rounded-full bg-[#111111]" />
                        <div className="flowdesk-shimmer h-[42px] w-[min(460px,78vw)] max-w-full rounded-[18px] bg-[#131313]" />
                        <div className="flowdesk-shimmer h-[14px] w-[min(620px,82vw)] max-w-full rounded-[12px] bg-[#111111]" />
                      </div>
                    ) : shouldHideEditorHeaderDueToPermissions ? null : (
                      <>
                        <LandingGlowTag className="px-[24px]">
                          {isEditingServer ? "Configurando servidor" : "Central de servidores"}
                        </LandingGlowTag>
                        <h1 className="mt-[18px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.02] font-normal tracking-[-0.05em] text-transparent md:text-[42px]">
                          {panelTitle}
                        </h1>
                        <p className="mt-[14px] max-w-[760px] text-[14px] leading-[1.55] text-[#7D7D7D] md:text-[15px]">
                          {panelDescription}
                        </p>
                      </>
                    )}
                  </div>
                  {!isEditingServer ? (
                    <LandingActionButton
                      variant="light"
                      className="h-[44px] rounded-[14px] px-[18px] text-[15px]"
                      disabled={isResolvingAddServer}
                      onClick={() => {
                        void handleStartAddServer();
                      }}
                    >
                      <span className="inline-flex items-center gap-[10px]">
                        {isResolvingAddServer ? (
                          <ButtonLoader size={16} colorClassName="text-[#2B2B2B]" />
                        ) : (
                          <PlusIcon />
                        )}
                        Adicionar novo
                      </span>
                    </LandingActionButton>
                  ) : null}
                </div>
                {!isEditingServer ? (
                  <div
                    className={`${shellClass} relative z-[900] overflow-visible px-[14px] py-[14px] sm:px-[18px] sm:py-[18px]`}
                  >
                    <div className="flex flex-col gap-[12px] xl:flex-row xl:items-center">
                      <div className="flex min-w-0 flex-1 items-center rounded-[18px] border border-[#151515] bg-[#080808] px-[16px] py-[14px]">
                        <SearchIcon />
                        <input
                          type="text"
                          value={typeof searchText === "string" ? searchText : ""}
                          onChange={(event) => setSearchText(String(event.currentTarget.value ?? ""))}
                          placeholder="Pesquisar servidor..."
                          autoComplete="off"
                          className="ml-[12px] w-full bg-transparent text-[15px] text-[#D8D8D8] outline-none placeholder:text-[#4F4F4F]"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-[10px] xl:justify-end">
                        <div ref={statusRef} className="relative z-[1200]">
                          <button
                            type="button"
                            onClick={() => setIsStatusOpen((current) => !current)}
                            className={`flex h-[52px] w-[52px] items-center justify-center rounded-[16px] border transition-colors ${
                              isStatusOpen
                                ? "border-[rgba(0,98,255,0.28)] bg-[rgba(0,98,255,0.08)] text-[#DADADA]"
                                : "border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] hover:border-[#242424] hover:text-[#DADADA]"
                            }`}
                            aria-label="Filtrar por status"
                          >
                            <FilterIcon />
                          </button>

                          {isStatusOpen ? (
                            <div
                              className="absolute right-0 top-[60px] z-[2000] min-w-[190px] rounded-[18px] border border-[#171717] bg-[#0A0A0A] p-[8px] shadow-[0_22px_60px_rgba(0,0,0,0.44)]"
                              onMouseDown={(event) => event.stopPropagation()}
                            >
                              {(["all", "paid", "pending_payment", "expired", "off"] as const).map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => {
                                    setStatusFilter(option);
                                    setIsStatusOpen(false);
                                  }}
                                  className={`flex w-full items-center justify-between rounded-[12px] px-[12px] py-[10px] text-left text-[13px] transition-colors ${
                                    statusFilter === option
                                      ? "bg-[#111111] text-[#E5E5E5]"
                                      : "text-[#9B9B9B] hover:bg-[#111111] hover:text-[#D5D5D5]"
                                  }`}
                                >
                                  <span>{FILTER_LABEL[option]}</span>
                                  {statusFilter === option ? (
                                    <span className="h-[7px] w-[7px] rounded-full bg-[#0062FF]" />
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="inline-flex items-center gap-[8px] rounded-[18px] border border-[#171717] bg-[#0D0D0D] p-[6px]">
                          <button
                            type="button"
                            onClick={() => setViewMode("overview")}
                            className={`flex h-[40px] w-[40px] items-center justify-center rounded-[12px] transition-colors ${
                              viewMode === "overview"
                                ? "bg-[#131313] text-[#E5E5E5]"
                                : "text-[#7C7C7C] hover:text-[#D5D5D5]"
                            }`}
                            aria-label="Visual overview"
                          >
                            <GridIcon />
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewMode("list")}
                            className={`flex h-[40px] w-[40px] items-center justify-center rounded-[12px] transition-colors ${
                              viewMode === "list"
                                ? "bg-[#131313] text-[#E5E5E5]"
                                : "text-[#7C7C7C] hover:text-[#D5D5D5]"
                            }`}
                            aria-label="Visual lista"
                          >
                            <ListIcon />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </LandingReveal>
            <div className="relative z-[10] mt-[22px]">
              {selectedServer ? (
                <LandingReveal delay={180}>
                  <div className={editorPanelRevealClass}>
                    <ServerSettingsEditor
                      {...selectedServer}
                      allServers={servers}
                      initialTab={selectedEditorTabForConfig}
                      settingsSection={selectedSettingsSectionForConfig}
                      onTabChange={(tab) => {
                        handleSidebarSettingsSectionNavigation({
                          guildId: selectedServer.guildId,
                          tab,
                          settingsSection: "overview",
                        });
                      }}
                      onUnsavedChangesChange={setHasUnsavedSettingsChanges}
                      onPermissionsChange={setCurrentDashboardPermissions}
                      navigationBlockSignal={navigationBlockSignal}
                      onClose={() => {
                        openProjectsOverview("push");
                      }}
                    />
                  </div>
                </LandingReveal>
              ) : shouldShowEditorSkeleton ? (
                <LandingReveal delay={180}>
                  <div className={editorPanelRevealClass}>
                    <ServerSettingsEditorSkeleton standalone />
                  </div>
                </LandingReveal>
              ) : shouldShowEditorUnavailableState ? (
                <LandingReveal delay={180}>
                  <div className={`${editorPanelRevealClass} ${shellClass} px-[22px] py-[24px]`}>
                    <div className="rounded-[22px] border border-[#141414] bg-[#090909] px-[20px] py-[20px]">
                      {errorMessage === "Acesso negado." ? (
                        <div className="py-[60px]">
                          <PermissionDeniedState 
                            onAction={() => {
                              openProjectsOverview("replace");
                            }}
                          />
                        </div>
                      ) : (
                        <>
                          <p className="text-[12px] uppercase tracking-[0.18em] text-[#666666]">
                            Servidor
                          </p>
                          <h2 className="mt-[12px] text-[24px] leading-none font-medium tracking-[-0.04em] text-[#E5E5E5]">
                            Nao foi possivel abrir este servidor agora
                          </h2>
                          <p className="mt-[12px] max-w-[720px] text-[14px] leading-[1.6] text-[#7D7D7D]">
                            {errorMessage || "Estamos tentando recuperar os dados deste servidor. Voce pode tentar novamente sem sair da configuracao."}
                          </p>
                          <div className="mt-[18px] flex flex-wrap items-center gap-[12px]">
                            <button
                              type="button"
                              onClick={() => {
                                requestServersReload();
                              }}
                              className="inline-flex h-[46px] items-center justify-center rounded-[12px] bg-[#F3F3F3] px-6 text-[15px] font-medium text-[#101010] transition-colors hover:bg-white"
                            >
                              Tentar novamente
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                openProjectsOverview("replace");
                              }}
                              className="inline-flex h-[46px] items-center justify-center rounded-[12px] border border-[#181818] bg-[#101010] px-6 text-[15px] font-medium text-[#B7B7B7] transition-colors hover:border-[#222222] hover:bg-[#141414] hover:text-[#E5E5E5]"
                            >
                              Voltar aos projetos
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </LandingReveal>
              ) : (
                <LandingReveal delay={180}>
                  {viewMode === "overview" ? (
                    <div className={workspacePaneRevealClass}>
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
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="py-[34px] text-center text-[13px] text-[#C2C2C2]">{selectedTeam ? "Nenhum servidor vinculado ou encontrado para essa equipe." : "Nenhum servidor encontrado para esse filtro."}</div>
                      )}
                    </div>
                  ) : (
                    <div className={`${shellClass} ${workspacePaneRevealClass} overflow-visible`}>
                      <div className="border-b border-[#141414] px-[18px] py-[18px]"><div className="flex flex-col gap-[10px] sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[12px] uppercase tracking-[0.18em] text-[#666666]">Projetos</p><h2 className="mt-[10px] text-[26px] leading-none font-medium tracking-[-0.04em] text-[#E5E5E5]">{selectedTeam ? `Servidores da equipe ${selectedTeam.name}` : "Todos os servidores"}</h2></div><p className="text-[13px] leading-[1.5] text-[#6F6F6F]">{filteredServers.length} resultado(s) exibidos de {activeTeamServerCount} servidor(es).</p></div></div>
                      {isLoading ? <div className="px-[18px] py-[24px]"><div className="space-y-[12px]">{Array.from({ length: 5 }, (_, index) => <div key={index} className="overflow-hidden rounded-[24px] border border-[#141414] bg-[#0A0A0A] px-[18px] py-[20px]"><div className="flowdesk-shimmer h-[82px] rounded-[18px] bg-[#111111]" /></div>)}</div></div> : errorMessage ? <div className="px-[18px] py-[34px] text-center text-[13px] text-[#C2C2C2]">{errorMessage}</div> : filteredServers.length ? <div>{filteredServers.map((server, index) => <ServerListRow key={server.guildId} server={server} index={index} isSelected={selectedGuildIdForConfig === server.guildId} isCopied={copiedGuildId === server.guildId} openCardMenuGuildId={openCardMenuGuildId} onOpen={handleOpenServerConfig} onPrefetch={prefetchServerConfig} onCopy={(guildId) => { void handleCopyGuildId(guildId); }} onToggleMenu={(guildId) => { setOpenCardMenuGuildId((current) => current === guildId ? null : guildId); }} onCopyFromMenu={handleCardMenuCopyId} />)}</div> : <div className="px-[18px] py-[34px] text-center text-[13px] text-[#C2C2C2]">{selectedTeam ? "Nenhum servidor vinculado ou encontrado para essa equipe." : "Nenhum servidor encontrado para esse filtro."}</div>}
                    </div>
                  )}
                </LandingReveal>
              )}
            </div>
          </section>
        </div>
      </main>
      {isCreateTeamModalOpen ? (
        <div className="fixed inset-y-0 left-0 right-0 z-[5000] isolate overflow-y-auto overscroll-contain xl:left-[318px]">
          <button
            type="button"
            aria-label="Fechar modal de equipe"
            className="absolute inset-0 bg-[rgba(0,0,0,0.84)] backdrop-blur-[7px]"
            onClick={() => {
              setIsCreateTeamModalOpen(false);
              setIsMemberSubmodalOpen(false);
              setTeamActionError(null);
            }}
          />
          <div className="relative z-[10] min-h-full px-[20px] py-[32px] md:px-6 lg:px-8 xl:pl-[40px] xl:pr-[42px]">
            <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[1220px] items-center justify-center">
              <div
              role="dialog"
              aria-modal="true"
              aria-label="Criar equipe"
              className="relative w-full max-w-[760px] overflow-hidden rounded-[32px] bg-transparent px-[22px] py-[22px] shadow-[0_34px_110px_rgba(0,0,0,0.52)] sm:px-[28px] sm:py-[28px]"
              >
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
                    <span className="text-[18px] leading-none">x</span>
                  </button>
                </div>

                <div className="mt-[22px]">
                  {createTeamStep === "name" ? (
                    <div className="mt-[18px] space-y-[14px]">
                      <label className="block">
                        <span className="mb-[8px] block text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                          Nome da equipe
                        </span>
                        <input
                          type="text"
                          value={typeof createTeamName === "string" ? createTeamName : ""}
                          onChange={(event) => setCreateTeamName(String(event.currentTarget.value ?? ""))}
                          placeholder="Ex: Moderacao principal"
                          autoComplete="off"
                          maxLength={64}
                          className="h-[50px] w-full rounded-[16px] border border-[#151515] bg-[#0A0A0A] px-[16px] text-[15px] text-[#E0E0E0] outline-none transition-colors placeholder:text-[#575757] focus:border-[rgba(0,98,255,0.34)]"
                        />
                      </label>

                      <div>
                        <span className="mb-[8px] block text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                          Cor da equipe
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
                      {!availableTeamServerOptions.length && teamServerOptions.length ? (
                        <p className="mb-[10px] text-[12px] leading-[1.5] text-[#676767]">
                          Todos os servidores disponiveis no painel ja estao vinculados a outra equipe.
                        </p>
                      ) : null}
                      <div className="max-h-[360px] space-y-[8px] overflow-y-auto pr-[4px]">
                        {availableTeamServerOptions.length ? availableTeamServerOptions.map((server) => {
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
                                <span className="text-[13px] leading-none text-[#777777]">x</span>
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
                      isCreateTeamNextDisabled
                    }
                    className="group relative inline-flex h-[46px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[14px] leading-none font-semibold disabled:cursor-not-allowed disabled:opacity-75"
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 rounded-[12px] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985] ${
                        isCreateTeamNextDisabled ? "bg-[#111111]" : "bg-[#F3F3F3]"
                      }`}
                    />
                    <span
                      className={`relative z-10 inline-flex items-center justify-center whitespace-nowrap leading-none ${
                        isCreateTeamNextDisabled ? "text-[#B7B7B7]" : "text-[#111111]"
                      }`}
                    >
                      {isCreatingTeam ? (
                        <span className="relative inline-flex items-center justify-center">
                          <span className="invisible">
                            {createTeamStep === "members" ? "Criar equipe" : "Proximo"}
                          </span>
                          <span className="absolute inset-0 flex items-center justify-center">
                            <ButtonLoader size={16} colorClassName={isCreateTeamNextDisabled ? "text-[#B7B7B7]" : "text-[#111111]"} />
                          </span>
                        </span>
                      ) : (
                        createTeamStep === "members" ? "Criar equipe" : "Proximo"
                      )}
                    </span>
                  </button>
                </div>
              </div>
              </div>
            </div>
          </div>

          {isMemberSubmodalOpen ? (
            <div className="absolute inset-0 z-[30] overflow-y-auto overscroll-contain p-[16px]">
              <button
                type="button"
                aria-label="Fechar submodal de membros"
                className="absolute inset-0 bg-[rgba(0,0,0,0.72)] backdrop-blur-[4px]"
                onClick={() => {
                  setIsMemberSubmodalOpen(false);
                  setTeamActionError(null);
                }}
              />
              <div className="relative z-[40] mx-auto flex min-h-full items-center justify-center">
                <div className="w-full max-w-[520px] overflow-hidden rounded-[26px] border border-[#151515] bg-[#070707] p-[18px] shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
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
                    <span className="text-[18px] leading-none">x</span>
                  </button>
                </div>

                <div className="mt-[18px] space-y-[10px]">
                  {memberDraftIds.map((draft, index) => (
                    <input
                      key={index}
                      type="text"
                      value={typeof draft === "string" ? draft : ""}
                      onChange={(event) => handleMemberDraftChange(index, String(event.currentTarget.value ?? ""))}
                      placeholder={
                        'ID do membro ' + (index + 1)
                      }
                      autoComplete="off"
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
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
