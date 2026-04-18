"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type RefObject } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRightLeft,
  BadgePercent,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cog,
  FolderKanban,
  Globe,
  Grid2x2,
  HardDrive,
  List as ListLucide,
  LogOut,
  Palette,
  Plus,
  PlugZap,
  Search as SearchLucide,
  UserRound,
  Users,
  WalletCards,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { useNotificationEffect } from "@/components/notifications/NotificationsProvider";
import { getDashboardViewById, resolveDashboardViewFromPathname, type DashboardViewId } from "@/lib/dashboard/navigation";
import { buildDiscordAuthStartHref, buildLoginHref } from "@/lib/auth/paths";
import type { ManagedServer } from "@/lib/servers/managedServers";
import { buildBrowserRoutingTargetFromInternalPath } from "@/lib/routing/subdomains";
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

type DashboardWorkspaceProps = {
  currentAccount: {
    authUserId: number;
    discordUserId: string | null;
    displayName: string;
    username: string;
    avatarUrl: string | null;
  };
  initialServers?: ManagedServer[] | null;
  initialTeams?: UserTeam[] | null;
  initialPendingInvites?: PendingTeamInvite[] | null;
  workspaceAlertMessage?: string | null;
  children?: React.ReactNode;
};

type SavedPanelAccount = {
  authUserId: number;
  discordUserId: string | null;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  lastSeenAt: number;
};

type DashboardSidebarItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  viewIds?: DashboardViewId[];
};

type CreateTeamStep = "name" | "servers" | "members";

type TeamsApiResponse = {
  ok: boolean;
  message?: string;
  teams?: UserTeam[];
  pendingInvites?: PendingTeamInvite[];
  createdTeamId?: number;
};

const sidebarShellClass =
  "relative overflow-hidden border border-[#0E0E0E] bg-[#050505] shadow-[0_24px_80px_rgba(0,0,0,0.42)]";
const shellClass =
  "rounded-[28px] border border-[#0E0E0E] bg-[#0A0A0A] shadow-[0_24px_80px_rgba(0,0,0,0.38)]";
const SAVED_PANEL_ACCOUNTS_KEY = "flowdesk_saved_panel_accounts_v1";

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

const PRIMARY_ITEMS: DashboardSidebarItem[] = [
  {
    id: "home",
    label: "Inicio",
    href: "/dashboard",
    icon: Grid2x2,
    viewIds: ["home"],
  },
  {
    id: "servers",
    label: "Servidores Discord",
    href: "/servers",
    icon: FolderKanban,
  },
];

const SECONDARY_ITEMS: DashboardSidebarItem[] = [
  {
    id: "hosting",
    label: "Hospedagem",
    href: "/dashboard/hosting",
    icon: HardDrive,
    viewIds: ["hosting"],
  },
  {
    id: "flowai_api",
    label: "FlowAI API",
    href: "/dashboard/flowai-api",
    icon: PlugZap,
    viewIds: ["flowai_api"],
  },
];

const DOMAIN_ITEMS: DashboardSidebarItem[] = [
  {
    id: "domains_overview",
    label: "Meus Dominios",
    href: "/dashboard/domains",
    icon: Globe,
    viewIds: ["domains_overview"],
  },
  {
    id: "domains_acquire",
    label: "Adquirir dominio",
    href: "/dashboard/domains/acquire",
    icon: Plus,
    viewIds: ["domains_acquire"],
  },
  {
    id: "domains_transfers",
    label: "Transferencias",
    href: "/dashboard/domains/transfers",
    icon: ArrowRightLeft,
    viewIds: ["domains_transfers"],
  },
];

const BILLING_ITEMS: DashboardSidebarItem[] = [
  {
    id: "billing_subscriptions",
    label: "Assinaturas",
    href: "/dashboard/billing/subscriptions",
    icon: BadgePercent,
    viewIds: ["billing_subscriptions"],
  },
  {
    id: "billing_payment_history",
    label: "Historico de Pagamentos",
    href: "/dashboard/billing/payment-history",
    icon: ListLucide,
    viewIds: ["billing_payment_history"],
  },
  {
    id: "billing_payment_methods",
    label: "Metodos de pagamento",
    href: "/dashboard/billing/payment-methods",
    icon: Workflow,
    viewIds: ["billing_payment_methods"],
  },
];

function accountInitial(name: string, username: string) {
  const source = name.trim() || username.trim();
  return source ? source.charAt(0).toUpperCase() : "F";
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeComparablePath(value: string) {
  if (!value) return "/";
  if (value === "/") return value;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

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

function normalizeSavedPanelAccounts(input: unknown) {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<SavedPanelAccount>;
      if (
        typeof record.authUserId !== "number" ||
        typeof record.displayName !== "string" ||
        typeof record.username !== "string" ||
        typeof record.lastSeenAt !== "number"
      ) {
        return null;
      }

      return {
        authUserId: record.authUserId,
        discordUserId:
          typeof record.discordUserId === "string" ? record.discordUserId : null,
        displayName: record.displayName,
        username: record.username,
        avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl : null,
        lastSeenAt: record.lastSeenAt,
      } satisfies SavedPanelAccount;
    })
    .filter((value): value is SavedPanelAccount => value !== null)
    .slice(0, 3);
}

function resolveSavedAccountKey(account: {
  authUserId: number;
  discordUserId: string | null;
}) {
  return account.discordUserId || `auth:${account.authUserId}`;
}

function mergeSavedPanelAccounts(
  currentAccount: SavedPanelAccount,
  previousAccounts: SavedPanelAccount[],
) {
  const currentAccountKey = resolveSavedAccountKey(currentAccount);
  return [
    currentAccount,
    ...previousAccounts.filter(
      (account) => resolveSavedAccountKey(account) !== currentAccountKey,
    ),
  ]
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

function SearchIcon() {
  return <SearchLucide className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]" strokeWidth={1.85} aria-hidden="true" />;
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

function SidebarLogoutIcon() {
  return <LogOut className="h-[17px] w-[17px] shrink-0" strokeWidth={1.9} aria-hidden="true" />;
}

function DashboardNavButton({
  item,
  active,
  onNavigate,
  onPrefetch,
}: {
  item: DashboardSidebarItem;
  active: boolean;
  onNavigate: (item: DashboardSidebarItem) => void;
  onPrefetch?: (item: DashboardSidebarItem) => void;
}) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onMouseEnter={() => onPrefetch?.(item)}
      onFocus={() => onPrefetch?.(item)}
      onClick={() => onNavigate(item)}
      className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-all duration-200 ${
        active
          ? "bg-[#1E1E1E] text-[#F0F0F0]"
          : "text-[#B5B5B5] hover:bg-[#111111] hover:text-[#E3E3E3]"
      }`}
    >
      <span
        className={`inline-flex h-[22px] w-[22px] items-center justify-center ${
          active ? "text-[#F0F0F0]" : "text-[#8A8A8A] group-hover:text-[#DADADA]"
        }`}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2 : 1.85} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">
        {item.label}
      </span>
    </button>
  );
}

export function DashboardWorkspace({
  currentAccount,
  initialServers = null,
  initialTeams = null,
  initialPendingInvites = null,
  workspaceAlertMessage = null,
  children,
}: DashboardWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startSidebarNavigationTransition] = useTransition();
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
  const [sidebarSearchText, setSidebarSearchText] = useState("");
  const [pendingViewId, setPendingViewId] = useState<DashboardViewId | null>(null);
  const [servers, setServers] = useState<ManagedServer[]>(initialServersSnapshot ?? []);
  const [isDomainsOpen, setIsDomainsOpen] = useState(false);
  const [isBillingOpen, setIsBillingOpen] = useState(false);
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
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [teamActionMessage, setTeamActionMessage] = useState<string | null>(null);
  const [teamActionError, setTeamActionError] = useState<string | null>(null);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [acceptingTeamId, setAcceptingTeamId] = useState<number | null>(null);
  const desktopTeamMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileTeamMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileProfileMenuRef = useRef<HTMLDivElement | null>(null);
  const currentView = useMemo(
    () => resolveDashboardViewFromPathname(pathname) ?? getDashboardViewById("home"),
    [pathname],
  );
  const highlightedViewId = pendingViewId ?? currentView.id;
  const hasWorkspaceAlert = Boolean(workspaceAlertMessage);

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

  const isDomainsActive = currentView.id.startsWith("domains_");
  const isBillingActive = currentView.id.startsWith("billing_");
  const normalizedSidebarSearch = normalizeSearchText(sidebarSearchText);
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
  const filteredPrimaryItems = PRIMARY_ITEMS.filter((item) =>
    !normalizedSidebarSearch || normalizeSearchText(item.label).includes(normalizedSidebarSearch),
  );
  const filteredSecondaryItems = SECONDARY_ITEMS.filter((item) =>
    !normalizedSidebarSearch || normalizeSearchText(item.label).includes(normalizedSidebarSearch),
  );
  const filteredDomainItems = DOMAIN_ITEMS.filter((item) =>
    !normalizedSidebarSearch ||
    normalizeSearchText(`Dominios ${item.label}`).includes(normalizedSidebarSearch),
  );
  const showSecondarySection = filteredSecondaryItems.length > 0;
  const filteredBillingItems = BILLING_ITEMS.filter((item) =>
    !normalizedSidebarSearch ||
    normalizeSearchText(`Cobrancas ${item.label}`).includes(normalizedSidebarSearch),
  );
  const showDomainsSection = filteredDomainItems.length > 0;
  const showBillingSection = filteredBillingItems.length > 0;
  const isSearchingSidebar = normalizedSidebarSearch.length > 0;
  const shouldShowEmptySearchState =
    isSearchingSidebar &&
    filteredPrimaryItems.length === 0 &&
    filteredSecondaryItems.length === 0 &&
    filteredDomainItems.length === 0 &&
    filteredBillingItems.length === 0;
  const isCreateTeamNextDisabled =
    isCreatingTeam ||
    (createTeamStep === "name" && createTeamName.trim().length < 3) ||
    (createTeamStep === "servers" && !createTeamServerIds.length);
  const teamSummaryLabel = isTeamsLoading
    ? "Carregando equipes..."
    : selectedTeam
      ? `${selectedTeam.memberCount} membro(s)   ${selectedTeam.linkedGuildIds.length} servidor(es)`
      : teams.length
        ? `${teams.length} equipe(s) disponivel(is)`
        : pendingTeamInvites.length
          ? `${pendingTeamInvites.length} convite(s) pendente(s)`
          : "Nenhuma equipe criada";

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
  }, [initialServers, workspaceCacheKey]);

  useEffect(() => {
    if (initialTeams !== null) {
      storeCachedTeamsSnapshot(
        workspaceCacheKey,
        initialTeams,
        initialPendingInvites ?? [],
      );
      setIsTeamsLoading(false);
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
    if (isDomainsActive) {
      setIsDomainsOpen(true);
    }
    if (isBillingActive) {
      setIsBillingOpen(true);
    }
  }, [isBillingActive, isDomainsActive]);

  useEffect(() => {
    setPendingViewId(null);
  }, [pathname]);

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
    if (initialServers !== null) {
      return;
    }

    let isMounted = true;

    async function loadServers() {
      try {
        const response = await fetch("/api/auth/me/servers", { cache: "no-store" });
        const payload = (await response.json()) as { ok?: boolean; servers?: ManagedServer[] };
        if (!isMounted || !response.ok || !payload.ok) {
          return;
        }

        const nextServers = payload.servers || [];
        storeCachedManagedServers(workspaceCacheKey, nextServers);
        setServers(nextServers);
      } catch {
        // noop
      }
    }

    void loadServers();

    return () => {
      isMounted = false;
    };
  }, [initialServers, workspaceCacheKey]);

  useEffect(() => {
    if (initialTeams !== null) {
      return;
    }

    let isMounted = true;

    async function loadTeams() {
      try {
        const response = await fetch("/api/auth/me/teams", {
          cache: "no-store",
        });
        const payload = (await response.json()) as TeamsApiResponse;
        if (!isMounted || !response.ok || !payload.ok) {
          setIsTeamsLoading(false);
          return;
        }

        applyTeamsSnapshot(payload);
        setTeamsErrorMessage(null);
        setIsTeamsLoading(false);
      } catch {
        if (!isMounted) return;
        setIsTeamsLoading(false);
      }
    }

    void loadTeams();

    return () => {
      isMounted = false;
    };
  }, [applyTeamsSnapshot, initialTeams]);

  const prefetchRoute = useCallback(
    (href: string) => {
      const target = buildBrowserRoutingTargetFromInternalPath(href);
      if (!target.sameOrigin) return;
      void router.prefetch(target.path);
    },
    [router],
  );

  useEffect(() => {
    [...PRIMARY_ITEMS, ...SECONDARY_ITEMS, ...DOMAIN_ITEMS, ...BILLING_ITEMS].forEach((item) => {
      prefetchRoute(item.href);
    });
    prefetchRoute("/servers");
    prefetchRoute("/servers/plans");
    prefetchRoute("/account");
  }, [prefetchRoute]);

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
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;

      const clickedInsideDesktopTeam =
        target && desktopTeamMenuRef.current
          ? desktopTeamMenuRef.current.contains(target)
          : false;
      const clickedInsideMobileTeam =
        target && mobileTeamMenuRef.current
          ? mobileTeamMenuRef.current.contains(target)
          : false;
      if (!clickedInsideDesktopTeam && !clickedInsideMobileTeam) {
        setIsTeamMenuOpen(false);
      }

      const desktopInside = desktopProfileMenuRef.current?.contains(target);
      const mobileInside = mobileProfileMenuRef.current?.contains(target);
      if (!desktopInside && !mobileInside) {
        setIsProfileMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
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

  const navigateToHref = useCallback(
    (href: string, nextViewId?: DashboardViewId | null) => {
      setIsTeamMenuOpen(false);
      setIsProfileMenuOpen(false);
      const target = buildBrowserRoutingTargetFromInternalPath(href);
      const comparableCurrentPath = normalizeComparablePath(pathname);
      const comparableNextPath = normalizeComparablePath(target.path);
      if (comparableCurrentPath === comparableNextPath) return;

      if (nextViewId) {
        setPendingViewId(nextViewId);
      }

      if (!target.sameOrigin) {
        window.location.assign(target.href);
        return;
      }

      prefetchRoute(href);
      startSidebarNavigationTransition(() => {
        router.push(target.path, { scroll: false });
      });
    },
    [pathname, prefetchRoute, router, startSidebarNavigationTransition],
  );

  const handleNavigateItem = useCallback(
    (item: DashboardSidebarItem) => {
      if (item.href === "/servers" && !currentAccount.discordUserId) {
        window.location.assign(buildLoginHref("/servers", "link"));
        return;
      }

      navigateToHref(item.href, item.viewIds?.[0] ?? null);
    },
    [currentAccount.discordUserId, navigateToHref],
  );

  const handlePrefetchItem = useCallback(
    (item: DashboardSidebarItem) => {
      prefetchRoute(item.href);
    },
    [prefetchRoute],
  );

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
    createTeamIconKey,
    createTeamMemberIds,
    createTeamName,
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
      // Mesmo com erro de rede, redireciona para login.
    } finally {
      try {
        window.localStorage.removeItem("flowdesk_pending_account_switch_v1");
      } catch {
        // noop
      }
      window.location.replace(buildLoginHref());
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
      if (
        resolveSavedAccountKey(account) === resolveSavedAccountKey(currentAccount)
      ) {
        setIsProfileMenuOpen(false);
        return;
      }

      if (!account.discordUserId) {
        setIsProfileMenuOpen(false);
        window.location.replace(buildLoginHref());
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
    [currentAccount, openDiscordLoginFlow],
  );

  const handleOpenAccountSettings = useCallback(() => {
    navigateToHref("/account");
  }, [navigateToHref]);

  const handleOpenMyAccount = useCallback(() => {
    setIsProfileMenuOpen(false);
    window.location.assign(
      buildBrowserRoutingTargetFromInternalPath("/discord/link", {
        fallbackArea: "public",
      }).href,
    );
  }, []);

  const handleOpenHelp = useCallback(() => {
    setIsProfileMenuOpen(false);
    window.open("https://discord.gg/ddXtHhvvrx", "_blank", "noopener,noreferrer");
  }, []);

  const renderProfileCard = (profileDropdownRef: RefObject<HTMLDivElement | null>) => (
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
                  <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
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
  );

  const renderSidebarContent = (
    teamRef: RefObject<HTMLDivElement | null>,
    profileRef: RefObject<HTMLDivElement | null>,
  ) => (
    <div className="flex h-full flex-col px-[14px] py-[14px]">
      <div ref={teamRef} className="relative">
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
                {selectedTeam ? selectedTeam.name : currentAccount.displayName}
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
          type="text"
          value={typeof sidebarSearchText === "string" ? sidebarSearchText : ""}
          onChange={(event) => setSidebarSearchText(String(event.currentTarget.value ?? ""))}
          placeholder="Buscar..."
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#5A5A5A]"
        />
        <SidebarSearchShortcutIcon />
      </div>

      <div className="mt-[14px] min-h-0 flex-1 overflow-y-auto pr-[2px] thin-scrollbar">
        <div className="space-y-[4px]">
          {filteredPrimaryItems.map((item) => (
            <DashboardNavButton
              key={item.id}
              item={item}
              active={Boolean(item.viewIds?.includes(highlightedViewId))}
              onNavigate={handleNavigateItem}
              onPrefetch={handlePrefetchItem}
            />
          ))}
        </div>

        {showDomainsSection ? (
          <div className="mt-[12px]">
            <button
              type="button"
              onClick={() => setIsDomainsOpen((current) => !current)}
              className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-all duration-200 ${
                isDomainsActive
                  ? "bg-[#1E1E1E] text-[#F0F0F0]"
                  : isDomainsOpen
                    ? "bg-[#121212] text-[#D6D6D6]"
                    : "text-[#B5B5B5] hover:bg-[#111111] hover:text-[#E3E3E3]"
              }`}
            >
              <span
                className={`inline-flex h-[22px] w-[22px] items-center justify-center ${
                  isDomainsActive
                    ? "text-[#F0F0F0]"
                    : isDomainsOpen
                      ? "text-[#C7C7C7]"
                      : "text-[#8A8A8A] group-hover:text-[#DADADA]"
                }`}
              >
                <Globe className="h-[18px] w-[18px] shrink-0" strokeWidth={isDomainsActive ? 2 : 1.85} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">
                Dominios
              </span>
              <span
                className={`transition-transform duration-200 ${
                  isSearchingSidebar || isDomainsOpen
                    ? "rotate-180 text-[#C9C9C9]"
                    : "rotate-0 text-[#6F6F6F] group-hover:text-[#BEBEBE]"
                }`}
              >
                <SidebarDropdownChevronIcon />
              </span>
            </button>

            {isSearchingSidebar || isDomainsOpen ? (
              <div className="mt-[6px] space-y-[4px] pl-[12px]">
                {filteredDomainItems.map((item) => (
                  <DashboardNavButton
                    key={item.id}
                    item={item}
                    active={Boolean(item.viewIds?.includes(highlightedViewId))}
                    onNavigate={handleNavigateItem}
                    onPrefetch={handlePrefetchItem}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {showSecondarySection ? (
          <div className="mt-[12px] space-y-[4px]">
            {filteredSecondaryItems.map((item) => (
              <DashboardNavButton
                key={item.id}
                item={item}
                active={Boolean(item.viewIds?.includes(highlightedViewId))}
                onNavigate={handleNavigateItem}
                onPrefetch={handlePrefetchItem}
              />
            ))}
          </div>
        ) : null}

        {showBillingSection ? (
          <div className="mt-[12px]">
            <button
              type="button"
              onClick={() => setIsBillingOpen((current) => !current)}
              className={`group flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-all duration-200 ${
                isBillingActive
                  ? "bg-[#1E1E1E] text-[#F0F0F0]"
                  : isBillingOpen
                    ? "bg-[#121212] text-[#D6D6D6]"
                    : "text-[#B5B5B5] hover:bg-[#111111] hover:text-[#E3E3E3]"
              }`}
            >
              <span
                className={`inline-flex h-[22px] w-[22px] items-center justify-center ${
                  isBillingActive
                    ? "text-[#F0F0F0]"
                    : isBillingOpen
                      ? "text-[#C7C7C7]"
                      : "text-[#8A8A8A] group-hover:text-[#DADADA]"
                }`}
              >
                <WalletCards className="h-[18px] w-[18px] shrink-0" strokeWidth={isBillingActive ? 2 : 1.85} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] leading-none font-medium tracking-[-0.03em]">
                Cobrancas
              </span>
              <span
                className={`transition-transform duration-200 ${
                  isSearchingSidebar || isBillingOpen
                    ? "rotate-180 text-[#C9C9C9]"
                    : "rotate-0 text-[#6F6F6F] group-hover:text-[#BEBEBE]"
                }`}
              >
                <SidebarDropdownChevronIcon />
              </span>
            </button>

            {isSearchingSidebar || isBillingOpen ? (
              <div className="mt-[6px] space-y-[4px] pl-[12px]">
                {filteredBillingItems.map((item) => (
                  <DashboardNavButton
                    key={item.id}
                    item={item}
                    active={Boolean(item.viewIds?.includes(highlightedViewId))}
                    onNavigate={handleNavigateItem}
                    onPrefetch={handlePrefetchItem}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {shouldShowEmptySearchState ? (
          <div className="mt-[14px] rounded-[16px] border border-[#141414] bg-[#080808] px-[14px] py-[14px]">
            <p className="text-[13px] leading-[1.55] text-[#6F6F6F]">
              Nenhum item encontrado para essa pesquisa.
            </p>
          </div>
        ) : null}
      </div>

      {renderProfileCard(profileRef)}
    </div>
  );

  const showPlaceholder = !currentView.isEmptyHome;

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]"
      />

      {workspaceAlertMessage ? (
        <button
          type="button"
          onMouseEnter={() => prefetchRoute("/servers/plans")}
          onFocus={() => prefetchRoute("/servers/plans")}
          onClick={() => {
            navigateToHref("/servers/plans");
          }}
          className="fixed inset-x-0 top-0 z-[1400] h-[42px] overflow-hidden bg-[linear-gradient(90deg,#731015_0%,#971D22_10%,#BC2D32_24%,#D94141_40%,#E45555_50%,#D94141_60%,#BC2D32_76%,#971D22_90%,#731015_100%)] text-white transition-opacity hover:opacity-95 md:h-[46px]"
          aria-label={`${workspaceAlertMessage} Abrir pagina de planos.`}
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-[linear-gradient(90deg,transparent_0%,rgba(255,214,214,0.24)_14%,rgba(255,214,214,0.12)_50%,rgba(255,214,214,0.24)_86%,transparent_100%)]" />
          <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,240,240,0.18)_0%,rgba(255,240,240,0.06)_34%,transparent_62%)] opacity-[0.14]" />
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
              {renderSidebarContent(desktopTeamMenuRef, desktopProfileMenuRef)}
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
                {renderSidebarContent(mobileTeamMenuRef, mobileProfileMenuRef)}
              </div>
            </LandingReveal>
          </aside>

          <section className="min-w-0">
            <LandingReveal delay={120}>
              <div className="relative z-[700] flex flex-col gap-[18px]">
                <div className="flex flex-col gap-[14px] md:flex-row md:items-end md:justify-between">
                  <div>
                    <LandingGlowTag className="px-[24px]">
                      Dashboard
                    </LandingGlowTag>
                    <h1 className="mt-[18px] bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[34px] leading-[1.02] font-normal tracking-[-0.05em] text-transparent md:text-[42px]">
                      {currentView.title}
                    </h1>
                    <p className="mt-[14px] max-w-[760px] text-[14px] leading-[1.55] text-[#7D7D7D] md:text-[15px]">
                      {currentView.description}
                    </p>
                  </div>
                </div>
              </div>
            </LandingReveal>

            {showPlaceholder ? (
              <LandingReveal delay={180}>
                <div className={`mt-[22px] ${shellClass} px-[22px] py-[24px]`}>
                  <div className="rounded-[22px] border border-[#141414] bg-[#090909] px-[22px] py-[26px]">
                    <p className="text-[12px] uppercase tracking-[0.18em] text-[#666666]">
                      Em breve
                    </p>
                    <h2 className="mt-[12px] text-[24px] leading-none font-medium tracking-[-0.04em] text-[#E5E5E5]">
                      Esta area do dashboard esta sendo preparada
                    </h2>
                    <p className="mt-[12px] max-w-[720px] text-[14px] leading-[1.6] text-[#7D7D7D]">
                      O shell da navegacao ja esta pronto. Agora podemos evoluir esta secao sem misturar o fluxo de servidores com o painel principal.
                    </p>
                  </div>
                </div>
              </LandingReveal>
            ) : null}

            {children}
          </section>
        </div>
      </main>

      {isCreateTeamModalOpen ? (
        <div className="fixed inset-y-0 left-0 right-0 z-[5000] isolate overflow-y-auto overscroll-contain lg:left-[318px]">
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
          <div className="relative z-[10] min-h-full px-[20px] py-[32px] md:px-6 lg:px-8 lg:pl-[40px] lg:pr-[42px]">
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
                                <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
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
                      disabled={isCreateTeamNextDisabled}
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
                  <div className="mt-[18px] flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setIsMemberSubmodalOpen(false);
                        setTeamActionError(null);
                      }}
                      className="inline-flex h-[42px] items-center justify-center rounded-[12px] border border-[#171717] bg-[#0D0D0D] px-[16px] text-[13px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmMemberDrafts}
                      className="inline-flex h-[42px] items-center justify-center rounded-[12px] bg-[#F3F3F3] px-[16px] text-[13px] font-medium text-[#111111] transition-transform duration-200 hover:translate-y-[-1px]"
                    >
                      Confirmar IDs
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
