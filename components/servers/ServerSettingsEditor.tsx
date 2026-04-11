"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRightLeft,
  CircleHelp,
  ImageUp,
  LogIn,
  LogOut,
  MicOff,
  PencilLine,
  Settings2,
  ShieldCheck,
  ShieldX,
  Signature,
  TimerOff,
  Trash2,
  UserRoundX,
} from "lucide-react";
import { ClientErrorBoundary } from "@/components/common/ClientErrorBoundary";
import { BotMissingModal } from "@/components/config/BotMissingModal";
import { ConfigStepMultiSelect } from "@/components/config/ConfigStepMultiSelect";
import { ConfigStepSelect } from "@/components/config/ConfigStepSelect";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { ServerSettingsEditorSkeleton } from "@/components/servers/ServerSettingsEditorSkeleton";
import { TicketMessageBuilder } from "@/components/servers/TicketMessageBuilder";
import { serversScale } from "@/components/servers/serversScale";
import {
  getServerDashboardSettings,
  readCachedServerDashboardSettings,
} from "@/lib/servers/serverDashboardSettingsClient";
import type { ServerDashboardSettingsPayload } from "@/lib/servers/serverDashboardSettingsClient";
import {
  countTicketPanelFunctionButtons,
  createDefaultTicketPanelLayout,
  normalizeTicketPanelLayout,
  ticketPanelLayoutHasAtMostOneFunctionButton,
  ticketPanelLayoutHasRequiredParts,
  type TicketPanelLayout,
} from "@/lib/servers/ticketPanelBuilder";
import {
  createDefaultWelcomeEntryLayout,
  createDefaultWelcomeExitLayout,
  normalizeWelcomeLayout,
  welcomeLayoutHasContent,
  type WelcomeThumbnailMode,
} from "@/lib/servers/welcomeMessageBuilder";
import {
  isValidBrazilDocument,
  normalizeBrazilDocumentDigits,
  resolveBrazilDocumentType,
} from "@/lib/payments/brazilDocument";
import {
  areCardPaymentsEnabled,
  CARD_PAYMENTS_COMING_SOON_BADGE,
  CARD_PAYMENTS_DISABLED_MESSAGE,
  CARD_RECURRING_DISABLED_MESSAGE,
} from "@/lib/payments/cardAvailability";
import { useBodyScrollLock } from "@/lib/ui/useBodyScrollLock";

type ManagedServerStatus = "paid" | "expired" | "off" | "pending_payment";
type EditorTab = "settings" | "payments" | "methods" | "plans";
type ServerSettingsSection =
  | "overview"
  | "message"
  | "entry_exit_overview"
  | "entry_exit_message"
  | "security_antilink"
  | "security_autorole"
  | "security_logs";
type PaymentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";
type CardBrand = "visa" | "mastercard" | "amex" | "elo" | null;
type AddMethodFieldKey =
  | "cardNumber"
  | "holderName"
  | "expiry"
  | "cvv"
  | "document"
  | "nickname";

type SelectOption = {
  id: string;
  name: string;
};

type ServerSettingsDraft = {
  enabled: boolean;
  menuChannelId: string | null;
  ticketsCategoryId: string | null;
  logsCreatedChannelId: string | null;
  logsClosedChannelId: string | null;
  panelLayout: TicketPanelLayout;
  adminRoleId: string | null;
  claimRoleIds: string[];
  closeRoleIds: string[];
  notifyRoleIds: string[];
};

type WelcomeSettingsDraft = {
  enabled: boolean;
  entryPublicChannelId: string | null;
  entryLogChannelId: string | null;
  exitPublicChannelId: string | null;
  exitLogChannelId: string | null;
  entryLayout: TicketPanelLayout;
  exitLayout: TicketPanelLayout;
  entryThumbnailMode: WelcomeThumbnailMode;
  exitThumbnailMode: WelcomeThumbnailMode;
};

type AntiLinkEnforcementAction = "delete_only" | "timeout" | "kick" | "ban";

type AntiLinkSettingsDraft = {
  enabled: boolean;
  logChannelId: string | null;
  enforcementAction: AntiLinkEnforcementAction;
  timeoutMinutes: number;
  ignoredRoleIds: string[];
  blockExternalLinks: boolean;
  blockDiscordInvites: boolean;
  blockObfuscatedLinks: boolean;
};

type AutoRoleAssignmentDelayMinutes = 0 | 10 | 20 | 30;

type AutoRoleSettingsDraft = {
  enabled: boolean;
  roleIds: string[];
  assignmentDelayMinutes: AutoRoleAssignmentDelayMinutes;
};

type AutoRoleSyncStatus =
  | "idle"
  | "pending"
  | "processing"
  | "completed"
  | "failed";

type SecurityLogEventKey =
  | "nicknameChange"
  | "avatarChange"
  | "voiceJoin"
  | "voiceLeave"
  | "messageDelete"
  | "messageEdit"
  | "memberBan"
  | "memberUnban"
  | "memberKick"
  | "memberTimeout"
  | "voiceMove"
  | "voiceMute";

type SecurityLogEventDraft = {
  enabled: boolean;
  channelId: string | null;
};

type SecurityLogEventsDraft = Record<SecurityLogEventKey, SecurityLogEventDraft>;

type SecurityLogsSettingsDraft = {
  enabled: boolean;
  useDefaultChannel: boolean;
  defaultChannelId: string | null;
  events: SecurityLogEventsDraft;
};

type PaymentOrder = {
  id: number;
  orderNumber: number;
  guildId: string;
  method: "pix" | "card";
  status: PaymentStatus;
  amount: number;
  currency: string;
  providerStatusDetail: string | null;
  card: {
    brand: string | null;
    firstSix: string | null;
    lastFour: string | null;
    expMonth: number | null;
    expYear: number | null;
  } | null;
  createdAt: string;
  technicalLabels: string[];
};

type SavedMethod = {
  id: string;
  brand: string | null;
  firstSix: string;
  lastFour: string;
  expMonth: number | null;
  expYear: number | null;
  lastUsedAt: string;
  timesUsed: number;
  nickname?: string | null;
  verificationStatus?: "verified" | "pending" | "failed" | "cancelled";
  verificationStatusDetail?: string | null;
  verificationAmount?: number | null;
  verifiedAt?: string | null;
  lastContextGuildId?: string | null;
};

type MercadoPagoCardTokenPayload = {
  id?: string;
  payment_method_id?: string;
  issuer_id?: string | number | null;
  message?: string;
  cause?: Array<{ description?: string }>;
};

type UnknownErrorObject = Record<string, unknown>;

type MercadoPagoInstance = {
  createCardToken: (input: {
    cardNumber: string;
    cardholderName: string;
    identificationType: "CPF" | "CNPJ";
    identificationNumber: string;
    securityCode: string;
    cardExpirationMonth: string;
    cardExpirationYear: string;
    device?: {
      id: string;
    };
  }) => Promise<MercadoPagoCardTokenPayload>;
};

declare global {
  interface Window {
    MercadoPago?: new (
      publicKey: string,
      options?: { locale?: string },
    ) => MercadoPagoInstance;
    MP_DEVICE_SESSION_ID?: string;
    flowdeskDeviceSessionId?: string;
  }
}

type PlanSettings = {
  planCode: "pro";
  monthlyAmount: number;
  currency: string;
  recurringEnabled: boolean;
  recurringMethodId: string | null;
  recurringMethod: SavedMethod | null;
  availableMethods?: SavedMethod[];
  availableMethodsCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type PlanApiResponse = {
  ok: boolean;
  message?: string;
  plan?: PlanSettings;
};

type ServerSettingsEditorProps = {
  guildId: string;
  guildName: string;
  status: ManagedServerStatus;
  daysUntilExpire?: number;
  daysUntilOff?: number;
  accessMode?: "owner" | "viewer";
  canManage?: boolean;
  allServers: Array<{
    guildId: string;
    guildName: string;
    iconUrl: string | null;
  }>;
  initialTab?: EditorTab;
  settingsSection?: ServerSettingsSection;
  onTabChange?: (tab: EditorTab) => void;
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
  navigationBlockSignal?: number;
  onClose: () => void;
  standalone?: boolean;
};

const TAB_INDEX: Record<EditorTab, number> = {
  settings: 0,
  payments: 1,
  methods: 2,
  plans: 3,
};

const WELCOME_VARIABLES = [
  { token: "{user}", description: "Menciona o usuario." },
  { token: "{user.id}", description: "ID do usuario no Discord." },
  { token: "{user.tag}", description: "Usuario#0000." },
  { token: "{user.avatar}", description: "URL da foto do usuario." },
  { token: "{inviter}", description: "Quem convidou o usuario." },
  { token: "{server}", description: "Nome do servidor." },
  { token: "{server.id}", description: "ID do servidor." },
  { token: "{memberCount}", description: "Total de membros." },
];

const ANTILINK_ACTION_OPTIONS: Array<{
  id: AntiLinkEnforcementAction;
  name: string;
}> = [
  { id: "delete_only", name: "Apenas apagar mensagem" },
  { id: "timeout", name: "Silenciar por alguns minutos" },
  { id: "kick", name: "Expulsar usuario" },
  { id: "ban", name: "Banir usuario" },
];

const AUTOROLE_DELAY_OPTIONS: Array<{
  id: string;
  name: string;
}> = [
  { id: "0", name: "Adicionar ao entrar" },
  { id: "10", name: "Adicionar depois de 10 min" },
  { id: "20", name: "Adicionar depois de 20 min" },
  { id: "30", name: "Adicionar depois de 30 min" },
];

const ANTILINK_DEFAULT_DETECTION = {
  blockExternalLinks: true,
  blockDiscordInvites: true,
  blockObfuscatedLinks: true,
} as const;

const SECURITY_LOG_EVENT_OPTIONS: Array<{
  key: SecurityLogEventKey;
  title: string;
  description: string;
  tooltip: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}> = [
  {
    key: "nicknameChange",
    title: "Alteracao de nickname",
    description: "Mostra nickname antigo e novo quando um membro altera.",
    tooltip:
      "Registra o nome antigo e o novo nickname do membro quando a alteracao acontece no servidor.",
    icon: Signature,
  },
  {
    key: "avatarChange",
    title: "Alteracao de avatar",
    description: "Gera comparativo visual (metade antiga / metade nova).",
    tooltip:
      "Envia embed com imagem comparativa feita em canvas para facilitar auditoria de troca de avatar.",
    icon: ImageUp,
  },
  {
    key: "voiceJoin",
    title: "Entrou em canal de voz",
    description: "Dispara quando alguem conecta em call.",
    tooltip: "Registra usuario, canal e horario da entrada em voz.",
    icon: LogIn,
  },
  {
    key: "voiceLeave",
    title: "Saiu de canal de voz",
    description: "Dispara quando alguem sai de uma call.",
    tooltip: "Registra usuario, canal anterior e horario da saida.",
    icon: LogOut,
  },
  {
    key: "messageDelete",
    title: "Mensagem deletada",
    description: "Registra mensagem removida em canais de texto.",
    tooltip:
      "Mostra autor, canal e conteudo capturado da mensagem que foi deletada.",
    icon: Trash2,
  },
  {
    key: "messageEdit",
    title: "Mensagem editada",
    description: "Mostra texto antigo e novo da mensagem.",
    tooltip:
      "Compara conteudo anterior e novo quando uma mensagem e editada.",
    icon: PencilLine,
  },
  {
    key: "memberBan",
    title: "Membro banido",
    description: "Registra banimentos aplicados no servidor.",
    tooltip:
      "Inclui alvo e, quando possivel, quem executou o banimento via audit log.",
    icon: ShieldX,
  },
  {
    key: "memberUnban",
    title: "Membro desbanido",
    description: "Registra remoção de bans.",
    tooltip:
      "Inclui alvo e, quando possivel, quem executou o desbanimento via audit log.",
    icon: ShieldCheck,
  },
  {
    key: "memberKick",
    title: "Membro expulso",
    description: "Registra expulsao (kick) de membros.",
    tooltip:
      "Usa evento de saida + audit log para identificar kick e moderador quando disponivel.",
    icon: UserRoundX,
  },
  {
    key: "memberTimeout",
    title: "Membro silenciado",
    description: "Registra aplicacao de timeout/silenciamento.",
    tooltip:
      "Dispara quando timeout e aplicado, com duracao e executor quando disponivel.",
    icon: TimerOff,
  },
  {
    key: "voiceMove",
    title: "Membro movido de call",
    description: "Registra troca de call por moderacao.",
    tooltip:
      "Tenta identificar quem moveu o membro usando audit log de movimentacao.",
    icon: ArrowRightLeft,
  },
  {
    key: "voiceMute",
    title: "Mute e desmute em call",
    description: "Registra quando alguem e mutado ou desmutado na call.",
    tooltip:
      "Detecta server mute e server unmute em voz, com executor e motivo quando o Discord disponibiliza no audit log.",
    icon: MicOff,
  },
];

function normalizeSearch(value: string) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeBrandValue(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function normalizeDraftIds(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function normalizeServerSettingsDraft(
  draft: ServerSettingsDraft,
): ServerSettingsDraft {
  return {
    enabled: draft.enabled,
    menuChannelId: draft.menuChannelId,
    ticketsCategoryId: draft.ticketsCategoryId,
    logsCreatedChannelId: draft.logsCreatedChannelId,
    logsClosedChannelId: draft.logsClosedChannelId,
    panelLayout: normalizeTicketPanelLayout(draft.panelLayout),
    adminRoleId: draft.adminRoleId,
    claimRoleIds: normalizeDraftIds(draft.claimRoleIds),
    closeRoleIds: normalizeDraftIds(draft.closeRoleIds),
    notifyRoleIds: normalizeDraftIds(draft.notifyRoleIds),
  };
}

function areServerSettingsDraftsEqual(
  left: ServerSettingsDraft | null,
  right: ServerSettingsDraft | null,
) {
  if (!left || !right) return left === right;

  return JSON.stringify(normalizeServerSettingsDraft(left)) === JSON.stringify(normalizeServerSettingsDraft(right));
}

function normalizeWelcomeSettingsDraft(
  draft: WelcomeSettingsDraft,
): WelcomeSettingsDraft {
  return {
    enabled: draft.enabled,
    entryPublicChannelId: draft.entryPublicChannelId,
    entryLogChannelId: draft.entryLogChannelId,
    exitPublicChannelId: draft.exitPublicChannelId,
    exitLogChannelId: draft.exitLogChannelId,
    entryLayout: normalizeTicketPanelLayout(draft.entryLayout),
    exitLayout: normalizeTicketPanelLayout(draft.exitLayout),
    entryThumbnailMode: draft.entryThumbnailMode,
    exitThumbnailMode: draft.exitThumbnailMode,
  };
}

function areWelcomeSettingsDraftsEqual(
  left: WelcomeSettingsDraft | null,
  right: WelcomeSettingsDraft | null,
) {
  if (!left || !right) return left === right;

  return JSON.stringify(normalizeWelcomeSettingsDraft(left)) === JSON.stringify(normalizeWelcomeSettingsDraft(right));
}

function normalizeAntiLinkEnforcementAction(
  value: unknown,
): AntiLinkEnforcementAction {
  if (value === "timeout" || value === "kick" || value === "ban") {
    return value;
  }
  return "delete_only";
}

function normalizeAntiLinkTimeoutMinutes(value: unknown) {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(10080, Math.max(1, parsed));
}

function normalizeAntiLinkSettingsDraft(
  draft: AntiLinkSettingsDraft,
): AntiLinkSettingsDraft {
  return {
    enabled: draft.enabled,
    logChannelId: draft.logChannelId,
    enforcementAction: normalizeAntiLinkEnforcementAction(
      draft.enforcementAction,
    ),
    timeoutMinutes: normalizeAntiLinkTimeoutMinutes(draft.timeoutMinutes),
    ignoredRoleIds: normalizeDraftIds(draft.ignoredRoleIds),
    blockExternalLinks: Boolean(draft.blockExternalLinks),
    blockDiscordInvites: Boolean(draft.blockDiscordInvites),
    blockObfuscatedLinks: Boolean(draft.blockObfuscatedLinks),
  };
}

function areAntiLinkSettingsDraftsEqual(
  left: AntiLinkSettingsDraft | null,
  right: AntiLinkSettingsDraft | null,
) {
  if (!left || !right) return left === right;

  return JSON.stringify(normalizeAntiLinkSettingsDraft(left)) === JSON.stringify(normalizeAntiLinkSettingsDraft(right));
}

function normalizeAutoRoleAssignmentDelayMinutes(
  value: unknown,
): AutoRoleAssignmentDelayMinutes {
  return value === 10 || value === 20 || value === 30 ? value : 0;
}

function normalizeAutoRoleSettingsDraft(
  draft: AutoRoleSettingsDraft,
): AutoRoleSettingsDraft {
  return {
    enabled: draft.enabled === true,
    roleIds: normalizeDraftIds(draft.roleIds),
    assignmentDelayMinutes: normalizeAutoRoleAssignmentDelayMinutes(
      draft.assignmentDelayMinutes,
    ),
  };
}

function areAutoRoleSettingsDraftsEqual(
  left: AutoRoleSettingsDraft | null,
  right: AutoRoleSettingsDraft | null,
) {
  if (!left || !right) return left === right;

  return JSON.stringify(normalizeAutoRoleSettingsDraft(left)) === JSON.stringify(normalizeAutoRoleSettingsDraft(right));
}

function createDefaultSecurityLogEventsDraft(): SecurityLogEventsDraft {
  return {
    nicknameChange: { enabled: false, channelId: null },
    avatarChange: { enabled: false, channelId: null },
    voiceJoin: { enabled: false, channelId: null },
    voiceLeave: { enabled: false, channelId: null },
    messageDelete: { enabled: false, channelId: null },
    messageEdit: { enabled: false, channelId: null },
    memberBan: { enabled: false, channelId: null },
    memberUnban: { enabled: false, channelId: null },
    memberKick: { enabled: false, channelId: null },
    memberTimeout: { enabled: false, channelId: null },
    voiceMove: { enabled: false, channelId: null },
    voiceMute: { enabled: false, channelId: null },
  };
}

function createDefaultSecurityLogsSettingsDraft(): SecurityLogsSettingsDraft {
  return {
    enabled: false,
    useDefaultChannel: false,
    defaultChannelId: null,
    events: createDefaultSecurityLogEventsDraft(),
  };
}

function normalizeSecurityLogsSettingsDraft(
  draft: SecurityLogsSettingsDraft,
): SecurityLogsSettingsDraft {
  const defaults = createDefaultSecurityLogsSettingsDraft();

  for (const option of SECURITY_LOG_EVENT_OPTIONS) {
    const current = draft.events?.[option.key];
    defaults.events[option.key] = {
      enabled: current?.enabled === true,
      channelId: current?.channelId || null,
    };
  }

  defaults.enabled = draft.enabled === true;
  defaults.useDefaultChannel = draft.useDefaultChannel === true;
  defaults.defaultChannelId = draft.defaultChannelId || null;
  return defaults;
}

function areSecurityLogsSettingsDraftsEqual(
  left: SecurityLogsSettingsDraft | null,
  right: SecurityLogsSettingsDraft | null,
) {
  if (!left || !right) return left === right;

  return JSON.stringify(normalizeSecurityLogsSettingsDraft(left)) === JSON.stringify(normalizeSecurityLogsSettingsDraft(right));
}

type DashboardInlineSwitchProps = {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  ariaLabel: string;
};

function DashboardInlineSwitch({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: DashboardInlineSwitchProps) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={ariaLabel}
      className={`group relative inline-flex h-[30px] w-[54px] shrink-0 items-center rounded-full border p-[3px] transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? "border-[rgba(255,255,255,0.14)] bg-[linear-gradient(180deg,#F3F3F3_0%,#D8D8D8_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_12px_26px_rgba(0,0,0,0.16)]"
          : "border-[#1F1F1F] bg-[linear-gradient(180deg,#141414_0%,#0D0D0D_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] hover:border-[#292929]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-[3px] rounded-full transition-opacity duration-200 ${
          checked
            ? "bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.05)_58%,transparent_100%)]"
            : "bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,transparent_72%)]"
        }`}
      />
      <span
        aria-hidden="true"
        className={`relative z-10 h-[24px] w-[24px] rounded-full border transition-all duration-200 ease-out ${
          checked
            ? "translate-x-[24px] border-[#0B0B0B] bg-[linear-gradient(180deg,#111111_0%,#050505_100%)] shadow-[0_8px_18px_rgba(0,0,0,0.34)]"
            : "translate-x-0 border-[#252525] bg-[linear-gradient(180deg,#7D7D7D_0%,#5A5A5A_100%)] shadow-[0_8px_18px_rgba(0,0,0,0.26)]"
        }`}
      />
    </button>
  );
}

function orderStatusBadge(status: PaymentStatus) {
  if (status === "approved") return { label: "Pago", cls: "border-[#6AE25A] bg-[rgba(106,226,90,0.2)] text-[#6AE25A]" };
  if (status === "pending") return { label: "Pendente", cls: "border-[#D8D8D8] bg-[rgba(216,216,216,0.12)] text-[#D8D8D8]" };
  if (status === "expired") return { label: "Expirado", cls: "border-[#F2C823] bg-[rgba(242,200,35,0.2)] text-[#F2C823]" };
  if (status === "cancelled") return { label: "Cancelado", cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]" };
  if (status === "rejected") return { label: "Rejeitado", cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]" };
  return { label: "Falhou", cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]" };
}

function technicalHistoryBadge(label: string) {
  if (label === "Aprovado por reconciliacao de retorno") {
    return {
      label,
      cls: "border-[#5CA9FF] bg-[rgba(92,169,255,0.12)] text-[#8CC2FF]",
    };
  }

  if (label === "Aprovado por webhook") {
    return {
      label,
      cls: "border-[#7FE3C2] bg-[rgba(127,227,194,0.12)] text-[#9FF1D4]",
    };
  }

  if (label === "Estorno automatico de seguranca") {
    return {
      label,
      cls: "border-[#F2C823] bg-[rgba(242,200,35,0.12)] text-[#F2C823]",
    };
  }

  return {
    label,
    cls: "border-[#3A3A3A] bg-[rgba(255,255,255,0.04)] text-[#B8B8B8]",
  };
}

function methodVerificationBadge(status: SavedMethod["verificationStatus"]) {
  if (status === "pending") {
    return {
      label: "Validacao pendente",
      cls: "border-[#D8D8D8] bg-[rgba(216,216,216,0.12)] text-[#D8D8D8]",
    };
  }

  if (status === "failed" || status === "cancelled") {
    return {
      label: "Nao liberado",
      cls: "border-[#DB4646] bg-[rgba(219,70,70,0.2)] text-[#DB4646]",
    };
  }

  return {
    label: "Verificado",
    cls: "border-[#6AE25A] bg-[rgba(106,226,90,0.2)] text-[#6AE25A]",
  };
}

function cardBrandLabel(brand: string | null | undefined) {
  const normalized = normalizeBrandValue(brand);
  if (normalized === "visa") return "Visa";
  if (normalized === "mastercard") return "Mastercard";
  if (normalized === "amex") return "American Express";
  if (normalized === "elo") return "Elo";
  return typeof brand === "string" && brand.trim()
    ? brand.trim().toUpperCase()
    : "Cartao";
}

function cardBrandIcon(brand: string | null | undefined) {
  const normalized = normalizeBrandValue(brand);
  if (normalized === "visa") return "/cdn/icons/card_visa.svg";
  if (normalized === "mastercard") return "/cdn/icons/card_mastercard.svg";
  if (normalized === "amex") return "/cdn/icons/card_amex.svg";
  if (normalized === "elo") return "/cdn/icons/card_elo.svg";
  return "/cdn/icons/card_.png";
}

function PaymentMethodIcon({
  src,
  alt,
  size,
}: {
  src: string;
  alt: string;
  size: number;
}) {
  const fallbackSrc = "/cdn/icons/card_.png";
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    setCurrentSrc(src);
  }, [src]);

  return (
    <Image
      src={currentSrc}
      alt={alt}
      width={size}
      height={size}
      className="object-contain"
      loading="lazy"
      unoptimized
      onError={(event) => {
        const target = event.currentTarget as HTMLImageElement;
        if (target.src.endsWith(fallbackSrc)) return;
        setCurrentSrc(fallbackSrc);
      }}
    />
  );
}

function resolveRetryAfterSeconds(
  response: Response | null | undefined,
  payload?: { retryAfterSeconds?: number | null } | null,
) {
  const payloadValue =
    typeof payload?.retryAfterSeconds === "number" &&
    Number.isFinite(payload.retryAfterSeconds) &&
    payload.retryAfterSeconds > 0
      ? Math.ceil(payload.retryAfterSeconds)
      : null;

  if (payloadValue) return payloadValue;

  const headerValue = response?.headers.get("Retry-After");
  if (!headerValue) return null;

  const parsed = Number(headerValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.ceil(parsed);
}

function resolveResponseRequestId(response: Response | null | undefined) {
  const headerValue = response?.headers.get("X-Request-Id");
  if (typeof headerValue !== "string") return null;
  const normalized = headerValue.trim();
  return normalized || null;
}

function withSupportRequestId(
  message: string,
  requestId: string | null | undefined,
) {
  const normalizedMessage = message.trim();
  if (!requestId) return normalizedMessage;
  return `${normalizedMessage} Protocolo: ${requestId}.`;
}

function formatCooldownMessage(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `Aguarde ${seconds}s para tentar novamente.`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (!remainingSeconds) return `Aguarde ${minutes}min para tentar novamente.`;
  return `Aguarde ${minutes}min ${remainingSeconds}s para tentar novamente.`;
}

function resolveCardPublicKey() {
  const candidates = [
    process.env.NEXT_PUBLIC_MERCADO_PAGO_CARD_PUBLIC_KEY || null,
    process.env.NEXT_PUBLIC_MERCADO_PAGO_CARD_PRODUCTION_PUBLIC_KEY || null,
    process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY || null,
    process.env.NEXT_PUBLIC_MERCADO_PAGO_CARD_TEST_PUBLIC_KEY || null,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  const key =
    candidates.find((value) => !value.startsWith("TEST-")) ||
    candidates[0] ||
    null;
  if (!key) return null;
  if (!key.startsWith("APP_USR-") && !key.startsWith("TEST-")) {
    return null;
  }
  return key;
}

function resolveCardPaymentMethodIdFromBrand(brand: CardBrand) {
  switch (brand) {
    case "visa":
      return "visa";
    case "mastercard":
      return "master";
    case "amex":
      return "amex";
    case "elo":
      return "elo";
    default:
      return null;
  }
}

function parseMercadoPagoCardTokenError(payload: MercadoPagoCardTokenPayload) {
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  if (Array.isArray(payload.cause) && payload.cause.length > 0) {
    const description = payload.cause[0]?.description;
    if (typeof description === "string" && description.trim()) {
      return description.trim();
    }
  }

  return null;
}

function parseUnknownErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const message = error.message?.trim();
    return message || null;
  }

  if (typeof error === "string") {
    const message = error.trim();
    return message || null;
  }

  if (!error || typeof error !== "object") {
    return null;
  }

  const data = error as UnknownErrorObject;
  const directMessage = data.message;
  if (typeof directMessage === "string" && directMessage.trim()) {
    return directMessage.trim();
  }

  const errorMessage = data.errorMessage;
  if (typeof errorMessage === "string" && errorMessage.trim()) {
    return errorMessage.trim();
  }

  const cause = data.cause;
  if (Array.isArray(cause) && cause.length > 0) {
    const firstCause = cause[0];
    if (firstCause && typeof firstCause === "object") {
      const description = (firstCause as UnknownErrorObject).description;
      if (typeof description === "string" && description.trim()) {
        return description.trim();
      }
    }
  }

  return null;
}

async function loadMercadoPagoSdk() {
  if (typeof window === "undefined") {
    throw new Error("SDK de cartao indisponivel no servidor.");
  }

  if (window.MercadoPago) {
    return;
  }

  if (!mercadoPagoSdkPromise) {
    mercadoPagoSdkPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        "script[data-mp-sdk='v2']",
      );

      if (existingScript) {
        if (
          window.MercadoPago ||
          existingScript.dataset.loaded === "true"
        ) {
          resolve();
          return;
        }

        existingScript.addEventListener(
          "load",
          () => {
            existingScript.dataset.loaded = "true";
            resolve();
          },
          {
            once: true,
          },
        );
        existingScript.addEventListener(
          "error",
          () => reject(new Error("Falha ao carregar SDK do Mercado Pago.")),
          { once: true },
        );
        return;
      }

      const script = document.createElement("script");
      script.src = MERCADO_PAGO_SDK_URL;
      script.async = true;
      script.defer = true;
      script.dataset.mpSdk = "v2";
      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = () =>
        reject(new Error("Falha ao carregar SDK do Mercado Pago."));

      document.head.appendChild(script);
    });
  }

  try {
    await mercadoPagoSdkPromise;
  } catch (error) {
    mercadoPagoSdkPromise = null;
    document
      .querySelector<HTMLScriptElement>("script[data-mp-sdk='v2']")
      ?.remove();
    throw error;
  }

  if (!window.MercadoPago) {
    throw new Error("SDK do Mercado Pago nao carregou corretamente.");
  }
}

async function loadMercadoPagoSecuritySdk(retryAttempt = 0) {
  if (typeof window === "undefined") return;

  if (resolveMercadoPagoDeviceSessionId()) {
    return;
  }

  if (!mercadoPagoSecuritySdkPromise) {
    mercadoPagoSecuritySdkPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        "script[data-mp-sdk='security-v2']",
      );

      if (existingScript) {
        if (
          resolveMercadoPagoDeviceSessionId() ||
          existingScript.dataset.loaded === "true"
        ) {
          resolve();
          return;
        }

        existingScript.addEventListener(
          "load",
          () => {
            existingScript.dataset.loaded = "true";
            resolve();
          },
          {
            once: true,
          },
        );
        existingScript.addEventListener(
          "error",
          () =>
            reject(
              new Error(
                "Falha ao carregar modulo de seguranca do Mercado Pago.",
              ),
            ),
          { once: true },
        );
        return;
      }

      const script = document.createElement("script");
      const separator = MERCADO_PAGO_SECURITY_SDK_URL.includes("?")
        ? "&"
        : "?";
      script.src = `${MERCADO_PAGO_SECURITY_SDK_URL}${separator}flowdesk_device_retry=${Date.now()}_${retryAttempt}`;
      script.async = true;
      script.defer = true;
      script.dataset.mpSdk = "security-v2";
      script.setAttribute("view", "checkout");
      script.setAttribute("output", "flowdeskDeviceSessionId");
      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = () =>
        reject(
          new Error("Falha ao carregar modulo de seguranca do Mercado Pago."),
        );

      document.head.appendChild(script);
    });
  }

  try {
    await mercadoPagoSecuritySdkPromise;
    await waitForMercadoPagoDeviceSessionId(12000);
  } catch (error) {
    mercadoPagoSecuritySdkPromise = null;

    if (resolveMercadoPagoDeviceSessionId()) {
      return;
    }

    document
      .querySelector<HTMLScriptElement>("script[data-mp-sdk='security-v2']")
      ?.remove();

    window.MP_DEVICE_SESSION_ID = undefined;
    window.flowdeskDeviceSessionId = undefined;

    if (retryAttempt >= 1) {
      throw error;
    }

    await loadMercadoPagoSecuritySdk(retryAttempt + 1);
  }
}

function resolveMercadoPagoDeviceSessionId() {
  if (typeof window === "undefined") return null;

  try {
    const storedSessionId = window.sessionStorage.getItem(
      MERCADO_PAGO_DEVICE_SESSION_STORAGE_KEY,
    );
    if (
      storedSessionId &&
      /^[a-zA-Z0-9:_-]{8,200}$/.test(storedSessionId.trim())
    ) {
      return storedSessionId.trim();
    }
  } catch {
    // ignorar falha de storage local
  }

  const candidates = [
    window.MP_DEVICE_SESSION_ID,
    window.flowdeskDeviceSessionId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim();
    if (!normalized) continue;
    if (!/^[a-zA-Z0-9:_-]{8,200}$/.test(normalized)) continue;

    try {
      window.sessionStorage.setItem(
        MERCADO_PAGO_DEVICE_SESSION_STORAGE_KEY,
        normalized,
      );
    } catch {
      // ignorar falha de storage local
    }

    return normalized;
  }

  return null;
}

async function waitForMercadoPagoDeviceSessionId(timeoutMs = 12000) {
  if (typeof window === "undefined") return null;

  const startedAt = Date.now();

  return new Promise<string>((resolve, reject) => {
    const tick = () => {
      const sessionId = resolveMercadoPagoDeviceSessionId();
      if (sessionId) {
        resolve(sessionId);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            "Nao foi possivel validar a identificacao segura do dispositivo.",
          ),
        );
        return;
      }

      window.setTimeout(tick, 120);
    };

    tick();
  });
}

function formatDocumentInput(value: string) {
  const digits = normalizeBrazilDocumentDigits(value);

  if (digits.length <= 11) {
    const p1 = digits.slice(0, 3);
    const p2 = digits.slice(3, 6);
    const p3 = digits.slice(6, 9);
    const p4 = digits.slice(9, 11);

    if (digits.length <= 3) return p1;
    if (digits.length <= 6) return `${p1}.${p2}`;
    if (digits.length <= 9) return `${p1}.${p2}.${p3}`;
    return `${p1}.${p2}.${p3}-${p4}`;
  }

  const c1 = digits.slice(0, 2);
  const c2 = digits.slice(2, 5);
  const c3 = digits.slice(5, 8);
  const c4 = digits.slice(8, 12);
  const c5 = digits.slice(12, 14);

  if (digits.length <= 2) return c1;
  if (digits.length <= 5) return `${c1}.${c2}`;
  if (digits.length <= 8) return `${c1}.${c2}.${c3}`;
  if (digits.length <= 12) return `${c1}.${c2}.${c3}/${c4}`;
  return `${c1}.${c2}.${c3}/${c4}-${c5}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "--";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(amount);
}

const ELO_PREFIXES = [
  "401178",
  "401179",
  "438935",
  "457631",
  "457632",
  "431274",
  "451416",
  "457393",
  "504175",
  "506699",
  "506770",
  "506771",
  "506772",
  "506773",
  "506774",
  "506775",
  "506776",
  "506777",
  "506778",
  "509000",
  "509999",
  "627780",
  "636297",
  "636368",
  "650031",
  "650033",
  "650035",
  "650051",
  "650405",
  "650439",
  "650485",
  "650538",
  "650541",
  "650598",
  "650700",
  "650718",
  "650720",
  "650727",
  "650901",
  "650920",
  "651652",
  "651679",
  "655000",
  "655019",
];

const MERCADO_PAGO_SDK_URL = "https://sdk.mercadopago.com/js/v2";
const MERCADO_PAGO_SECURITY_SDK_URL = "https://www.mercadopago.com/v2/security.js";
const MERCADO_PAGO_DEVICE_SESSION_STORAGE_KEY =
  "flowdesk_mp_device_session_v1";
let mercadoPagoSdkPromise: Promise<void> | null = null;
let mercadoPagoSecuritySdkPromise: Promise<void> | null = null;

function normalizeCardDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 19);
}

function detectCardBrand(cardDigits: string) {
  const digits = normalizeCardDigits(cardDigits);
  if (!digits) return null;
  if (ELO_PREFIXES.some((prefix) => digits.startsWith(prefix))) return "elo";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(50|5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^4/.test(digits)) return "visa";
  return null;
}

function cardNumberLengthsForBrand(brand: string | null) {
  switch (brand) {
    case "amex":
      return [15];
    case "mastercard":
    case "elo":
      return [16];
    case "visa":
      return [13, 16, 19];
    default:
      return [13, 14, 15, 16, 17, 18, 19];
  }
}

function isLuhnValid(cardDigits: string) {
  let sum = 0;
  let shouldDouble = false;

  for (let index = cardDigits.length - 1; index >= 0; index -= 1) {
    let digit = Number(cardDigits[index]);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function normalizeCardExpiryDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

function formatCardNumberInput(value: string) {
  const digits = normalizeCardDigits(value);
  const brand = detectCardBrand(digits);

  if (brand === "amex") {
    const g1 = digits.slice(0, 4);
    const g2 = digits.slice(4, 10);
    const g3 = digits.slice(10, 15);
    return [g1, g2, g3].filter(Boolean).join(" ");
  }

  const groups = digits.match(/.{1,4}/g) || [];
  return groups.join(" ");
}

function formatCardExpiryInput(value: string) {
  const digits = normalizeCardExpiryDigits(value);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
}

function normalizeCardCvvInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

function isValidCardExpiry(expiry: string) {
  const digits = normalizeCardExpiryDigits(expiry);
  if (digits.length !== 4) return false;

  const month = Number(digits.slice(0, 2));
  const year = Number(digits.slice(2, 4)) + 2000;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear) return false;
  if (year === currentYear && month < currentMonth) return false;
  return true;
}

function createAddMethodTouchedFields(): Record<AddMethodFieldKey, boolean> {
  return {
    cardNumber: false,
    holderName: false,
    expiry: false,
    cvv: false,
    document: false,
    nickname: false,
  } satisfies Record<AddMethodFieldKey, boolean>;
}

function resolveAddMethodValidationErrors(input: {
  cardDigits: string;
  cardBrand: CardBrand;
  holderName: string;
  expiry: string;
  expiryDigits: string;
  cvvDigits: string;
  documentDigits: string;
  nickname: string;
}) {
  const errors: Record<AddMethodFieldKey, string | null> = {
    cardNumber: null,
    holderName: null,
    expiry: null,
    cvv: null,
    document: null,
    nickname: null,
  };

  if (!input.cardDigits) {
    errors.cardNumber = "Digite o numero do cartao.";
  } else if (!input.cardBrand) {
    errors.cardNumber =
      input.cardDigits.length >= 6
        ? "Nao foi possivel identificar a bandeira deste cartao."
        : "Digite o numero completo do cartao.";
  } else {
    const validLengths = cardNumberLengthsForBrand(input.cardBrand);
    const minLength = Math.min(...validLengths);
    const hasValidLength = validLengths.includes(input.cardDigits.length);

    if (input.cardDigits.length < minLength) {
      errors.cardNumber = "Digite o numero completo do cartao.";
    } else if (!hasValidLength || !isLuhnValid(input.cardDigits)) {
      errors.cardNumber = "Numero de cartao invalido.";
    }
  }

  const normalizedHolderName = input.holderName.trim().replace(/\s+/g, " ");
  if (!normalizedHolderName) {
    errors.holderName = "Digite o nome do titular.";
  } else if (normalizedHolderName.length < 2) {
    errors.holderName =
      "Digite o nome do titular como aparece no cartao.";
  }

  if (!input.expiryDigits) {
    errors.expiry = "Digite a data de validade.";
  } else if (input.expiryDigits.length < 4) {
    errors.expiry = "Use o formato MM/AA.";
  } else {
    const month = Number(input.expiryDigits.slice(0, 2));
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      errors.expiry = "Informe um mes valido entre 01 e 12.";
    } else if (!isValidCardExpiry(input.expiry)) {
      errors.expiry = "Cartao expirado ou com validade invalida.";
    }
  }

  const expectedCvvLength = input.cardBrand === "amex" ? 4 : 3;
  if (!input.cvvDigits) {
    errors.cvv = "Digite o CVV do cartao.";
  } else if (input.cvvDigits.length !== expectedCvvLength) {
    errors.cvv =
      expectedCvvLength === 4
        ? "Digite os 4 digitos do CVV."
        : "Digite os 3 digitos do CVV.";
  }

  if (!input.documentDigits) {
    errors.document = "Digite o CPF ou CNPJ do titular.";
  } else {
    const documentType = resolveBrazilDocumentType(input.documentDigits);

    if (!documentType) {
      errors.document =
        input.documentDigits.length < 11 ||
        (input.documentDigits.length > 11 && input.documentDigits.length < 14)
          ? "Digite um CPF ou CNPJ completo."
          : "CPF/CNPJ invalido.";
    } else if (!isValidBrazilDocument(input.documentDigits)) {
      errors.document =
        documentType === "CPF" ? "CPF invalido." : "CNPJ invalido.";
    }
  }

  if (input.nickname.trim().length > 42) {
    errors.nickname = "O apelido pode ter no maximo 42 caracteres.";
  }

  return errors;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toSafeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function toSafeNullableText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toSafeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function toSafeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toSafeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toSafePaymentStatus(value: unknown): PaymentStatus {
  if (value === "approved") return "approved";
  if (value === "pending") return "pending";
  if (value === "rejected") return "rejected";
  if (value === "cancelled") return "cancelled";
  if (value === "expired") return "expired";
  return "failed";
}

function toSafeVerificationStatus(value: unknown): SavedMethod["verificationStatus"] {
  if (value === "verified") return "verified";
  if (value === "pending") return "pending";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  return "verified";
}

function sanitizePaymentOrder(input: unknown): PaymentOrder | null {
  const order = asRecord(input);
  if (!order) return null;

  const id = toSafeInteger(order.id);
  const orderNumber = toSafeInteger(order.orderNumber);
  const guildId = toSafeText(order.guildId);
  const method = order.method === "card" ? "card" : order.method === "pix" ? "pix" : null;
  const status = toSafePaymentStatus(order.status);
  const currency = toSafeText(order.currency, "BRL");
  const providerStatusDetail = toSafeNullableText(order.providerStatusDetail);
  const createdAt = toSafeText(order.createdAt);
  const technicalLabels = Array.isArray(order.technicalLabels)
    ? order.technicalLabels.filter(
        (label): label is string =>
          typeof label === "string" && label.trim().length > 0,
      )
    : [];

  if (id === null || orderNumber === null || !guildId || !method || !createdAt) {
    return null;
  }

  const cardRaw = asRecord(order.card);
  const card = cardRaw
    ? {
        brand: toSafeNullableText(cardRaw.brand),
        firstSix: toSafeNullableText(cardRaw.firstSix),
        lastFour: toSafeNullableText(cardRaw.lastFour),
        expMonth: toSafeInteger(cardRaw.expMonth),
        expYear: toSafeInteger(cardRaw.expYear),
      }
    : null;

  return {
    id,
    orderNumber,
    guildId,
    method,
    status,
    amount: toSafeNumber(order.amount),
    currency,
    providerStatusDetail,
    card,
    createdAt,
    technicalLabels,
  };
}

function sanitizeSavedMethod(input: unknown): SavedMethod | null {
  const method = asRecord(input);
  if (!method) return null;

  const id = toSafeText(method.id);
  const firstSix = toSafeText(method.firstSix);
  const lastFour = toSafeText(method.lastFour);
  const lastUsedAt = toSafeText(method.lastUsedAt);
  const timesUsed = toSafeInteger(method.timesUsed);

  if (!id || !/^[a-z0-9:_-]{1,120}$/i.test(id)) return null;
  if (!/^\d{6}$/.test(firstSix) || !/^\d{4}$/.test(lastFour)) return null;
  if (!lastUsedAt) return null;

  return {
    id,
    brand: toSafeNullableText(method.brand),
    firstSix,
    lastFour,
    expMonth: toSafeInteger(method.expMonth),
    expYear: toSafeInteger(method.expYear),
    lastUsedAt,
    timesUsed: timesUsed === null ? 0 : Math.max(0, timesUsed),
    nickname: toSafeNullableText(method.nickname),
    verificationStatus: toSafeVerificationStatus(method.verificationStatus),
    verificationStatusDetail: toSafeNullableText(method.verificationStatusDetail),
    verificationAmount: toSafeNullableNumber(method.verificationAmount),
    verifiedAt: toSafeNullableText(method.verifiedAt),
    lastContextGuildId: toSafeNullableText(method.lastContextGuildId),
  };
}

export function ServerSettingsEditor({
  guildId,
  guildName,
  status,
  daysUntilExpire = 0,
  daysUntilOff = 0,
  accessMode = "owner",
  canManage,
  allServers,
  initialTab = "settings",
  settingsSection = "overview",
  onTabChange: _onTabChange,
  onUnsavedChangesChange,
  navigationBlockSignal = 0,
  onClose,
  standalone = false,
}: ServerSettingsEditorProps) {
  const cardPaymentsEnabled = areCardPaymentsEnabled();
  const showServerFinancialPanels = false;
  const [activeTab, setActiveTab] = useState<EditorTab>("settings");
  void _onTabChange;
  void onClose;

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingEmbed, setIsSendingEmbed] = useState(false);
  const isSendingEmbedRef = useRef(false);
  const hasLoadedDashboardSnapshotRef = useRef(false);
  const [hasLoadedDashboardSnapshot, setHasLoadedDashboardSnapshot] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showSaveSuccessBar, setShowSaveSuccessBar] = useState(false);
  const [showNavigationBlockedSaveState, setShowNavigationBlockedSaveState] =
    useState(false);
  const [isPortalMounted, setIsPortalMounted] = useState(false);
  const [isSaveBarRendered, setIsSaveBarRendered] = useState(false);
  const [isSaveBarExiting, setIsSaveBarExiting] = useState(false);
  const navigationBlockedFeedbackTimeoutRef = useRef<number | null>(null);

  const [textChannelOptions, setTextChannelOptions] = useState<SelectOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<SelectOption[]>([]);
  const [roleOptions, setRoleOptions] = useState<SelectOption[]>([]);

  const [menuChannelId, setMenuChannelId] = useState<string | null>(null);
  const [ticketsCategoryId, setTicketsCategoryId] = useState<string | null>(null);
  const [logsCreatedChannelId, setLogsCreatedChannelId] = useState<string | null>(null);
  const [logsClosedChannelId, setLogsClosedChannelId] = useState<string | null>(null);
  const [panelLayout, setPanelLayout] = useState<TicketPanelLayout>(
    createDefaultTicketPanelLayout(),
  );
  const [ticketEnabled, setTicketEnabled] = useState(false);
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [entryPublicChannelId, setEntryPublicChannelId] = useState<string | null>(null);
  const [entryLogChannelId, setEntryLogChannelId] = useState<string | null>(null);
  const [exitPublicChannelId, setExitPublicChannelId] = useState<string | null>(null);
  const [exitLogChannelId, setExitLogChannelId] = useState<string | null>(null);
  const [entryLayout, setEntryLayout] = useState<TicketPanelLayout>(
    createDefaultWelcomeEntryLayout(),
  );
  const [exitLayout, setExitLayout] = useState<TicketPanelLayout>(
    createDefaultWelcomeExitLayout(),
  );
  const [entryThumbnailMode, setEntryThumbnailMode] =
    useState<WelcomeThumbnailMode>("custom");
  const [exitThumbnailMode, setExitThumbnailMode] =
    useState<WelcomeThumbnailMode>("custom");
  const [antiLinkEnabled, setAntiLinkEnabled] = useState(false);
  const [antiLinkLogChannelId, setAntiLinkLogChannelId] = useState<string | null>(
    null,
  );
  const [antiLinkEnforcementAction, setAntiLinkEnforcementAction] =
    useState<AntiLinkEnforcementAction>("delete_only");
  const [antiLinkTimeoutMinutes, setAntiLinkTimeoutMinutes] = useState(10);
  const [antiLinkIgnoredRoleIds, setAntiLinkIgnoredRoleIds] = useState<string[]>(
    [],
  );
  const [, setAntiLinkBlockExternalLinks] = useState(true);
  const [, setAntiLinkBlockDiscordInvites] = useState(true);
  const [, setAntiLinkBlockObfuscatedLinks] = useState(true);
  const [autoRoleEnabled, setAutoRoleEnabled] = useState(false);
  const [autoRoleRoleIds, setAutoRoleRoleIds] = useState<string[]>([]);
  const [autoRoleAssignmentDelayMinutes, setAutoRoleAssignmentDelayMinutes] =
    useState<AutoRoleAssignmentDelayMinutes>(0);
  const [autoRoleSyncExistingMembers, setAutoRoleSyncExistingMembers] =
    useState(false);
  const [autoRoleSyncStatus, setAutoRoleSyncStatus] =
    useState<AutoRoleSyncStatus>("idle");
  const [autoRoleSyncRequestedAt, setAutoRoleSyncRequestedAt] = useState<
    string | null
  >(null);
  const [autoRoleSyncStartedAt, setAutoRoleSyncStartedAt] = useState<
    string | null
  >(null);
  const [autoRoleSyncCompletedAt, setAutoRoleSyncCompletedAt] = useState<
    string | null
  >(null);
  const [autoRoleSyncError, setAutoRoleSyncError] = useState<string | null>(
    null,
  );
  const [securityLogsDraft, setSecurityLogsDraft] =
    useState<SecurityLogsSettingsDraft>(createDefaultSecurityLogsSettingsDraft);
  const [savedSecurityLogsDraft, setSavedSecurityLogsDraft] =
    useState<SecurityLogsSettingsDraft | null>(null);
  const [activeSecurityLogModalEvent, setActiveSecurityLogModalEvent] =
    useState<SecurityLogEventKey | null>(null);
  const [openSecurityLogTooltipKey, setOpenSecurityLogTooltipKey] =
    useState<SecurityLogEventKey | null>(null);

  const [adminRoleId, setAdminRoleId] = useState<string | null>(null);
  const [claimRoleIds, setClaimRoleIds] = useState<string[]>([]);
  const [closeRoleIds, setCloseRoleIds] = useState<string[]>([]);
  const [notifyRoleIds, setNotifyRoleIds] = useState<string[]>([]);
  const [savedSettingsDraft, setSavedSettingsDraft] =
    useState<ServerSettingsDraft | null>(null);
  const [savedWelcomeSettingsDraft, setSavedWelcomeSettingsDraft] =
    useState<WelcomeSettingsDraft | null>(null);
  const [savedAntiLinkSettingsDraft, setSavedAntiLinkSettingsDraft] =
    useState<AntiLinkSettingsDraft | null>(null);
  const [savedAutoRoleSettingsDraft, setSavedAutoRoleSettingsDraft] =
    useState<AutoRoleSettingsDraft | null>(null);
  const [isStaffCardCollapsed, setIsStaffCardCollapsed] = useState(true);
  const [welcomeMessageTab, setWelcomeMessageTab] = useState<"entry" | "exit">(
    "entry",
  );
  const [isWelcomeActivationModalOpen, setIsWelcomeActivationModalOpen] =
    useState(false);
  const [, setHasDismissedWelcomeModal] = useState(false);
  const [isActivatingWelcome, setIsActivatingWelcome] = useState(false);
  const [isAntiLinkActivationModalOpen, setIsAntiLinkActivationModalOpen] =
    useState(false);
  const [hasDismissedAntiLinkModal, setHasDismissedAntiLinkModal] =
    useState(false);
  const [isActivatingAntiLink, setIsActivatingAntiLink] = useState(false);

  const [isPaymentsLoading, setIsPaymentsLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [methods, setMethods] = useState<SavedMethod[]>([]);
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [paymentGuildFilter, setPaymentGuildFilter] = useState<string>(guildId);
  const [methodSearch, setMethodSearch] = useState("");
  const [methodStatusFilter, setMethodStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [methodGuildFilter, setMethodGuildFilter] = useState<string>(guildId);
  const [openMethodMenuId, setOpenMethodMenuId] = useState<string | null>(null);
  const [deletingMethodId, setDeletingMethodId] = useState<string | null>(null);
  const [savingMethodNicknameId, setSavingMethodNicknameId] = useState<string | null>(null);
  const [methodNicknameDrafts, setMethodNicknameDrafts] = useState<Record<string, string>>({});
  const [methodActionMessage, setMethodActionMessage] = useState<string | null>(null);
  const [isAddMethodModalOpen, setIsAddMethodModalOpen] = useState(false);
  const [isAddingMethod, setIsAddingMethod] = useState(false);
  const [isAddMethodSdkLoading, setIsAddMethodSdkLoading] = useState(false);
  const [isAddMethodSdkReady, setIsAddMethodSdkReady] = useState(false);
  const [addMethodFlowState, setAddMethodFlowState] = useState<
    "idle" | "preparing" | "validating" | "approved" | "rejected"
  >("idle");
  const [addMethodStatusMessage, setAddMethodStatusMessage] = useState<string | null>(null);
  const [addMethodError, setAddMethodError] = useState<string | null>(null);
  const [addMethodClientCooldownUntil, setAddMethodClientCooldownUntil] =
    useState<number | null>(null);
  const [addMethodClientCooldownRemainingSeconds, setAddMethodClientCooldownRemainingSeconds] =
    useState<number | null>(null);
  const [addMethodForm, setAddMethodForm] = useState({
    cardNumber: "",
    holderName: "",
    expiry: "",
    cvv: "",
    document: "",
    nickname: "",
  });
  const [addMethodTouchedFields, setAddMethodTouchedFields] = useState(
    createAddMethodTouchedFields,
  );

  const [isPlanLoading, setIsPlanLoading] = useState(true);
  const [isPlanSaving, setIsPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const [planSettings, setPlanSettings] = useState<PlanSettings | null>(null);
  const [isRecurringMethodModalOpen, setIsRecurringMethodModalOpen] =
    useState(false);
  const [recurringMethodDraftId, setRecurringMethodDraftId] = useState<
    string | null
  >(null);
  const [shouldEnableRecurringAfterMethodAdd, setShouldEnableRecurringAfterMethodAdd] =
    useState(false);

  const markDashboardSnapshotLoaded = useCallback(() => {
    if (hasLoadedDashboardSnapshotRef.current) {
      return;
    }
    hasLoadedDashboardSnapshotRef.current = true;
    setHasLoadedDashboardSnapshot(true);
  }, []);

  useBodyScrollLock(
    isRecurringMethodModalOpen ||
      isAddMethodModalOpen ||
      isWelcomeActivationModalOpen ||
      isAntiLinkActivationModalOpen ||
      Boolean(activeSecurityLogModalEvent),
  );

  const locked = status === "expired" || status === "off";
  const renewalWindowOpen = status === "paid" && daysUntilExpire <= 3;
  const canRenewPlan = status !== "paid" || renewalWindowOpen;
  const isViewerOnly = !(canManage ?? accessMode === "owner");
  const settingsReadOnly = locked || isViewerOnly;
  const viewerOnlyMessage =
    "Neste acesso o painel esta disponivel somente para visualizacao.";
  const financialViewerMessage =
    "As funcoes financeiras desta area ficam disponiveis apenas para a conta responsavel pelo plano vinculado.";

  const applyDashboardSettingsPayload = useCallback(
    (payload: ServerDashboardSettingsPayload) => {
      const text = payload.channels.text.map((channel) => ({
        id: channel.id,
        name: `# ${channel.name}`,
      }));
      const categories = payload.channels.categories.map((channel) => ({
        id: channel.id,
        name: channel.name,
      }));
      const roleList = payload.roles as SelectOption[];

      setTextChannelOptions(text);
      setCategoryOptions(categories);
      setRoleOptions(roleList);

      const textSet = new Set(text.map((item) => item.id));
      const categorySet = new Set(categories.map((item) => item.id));
      const roleSet = new Set(roleList.map((item) => item.id));

      const nextMenuChannelId =
        payload.ticketSettings?.menuChannelId &&
        textSet.has(payload.ticketSettings.menuChannelId)
          ? payload.ticketSettings.menuChannelId
          : null;
      const nextTicketsCategoryId =
        payload.ticketSettings?.ticketsCategoryId &&
        categorySet.has(payload.ticketSettings.ticketsCategoryId)
          ? payload.ticketSettings.ticketsCategoryId
          : null;
      const nextLogsCreatedChannelId =
        payload.ticketSettings?.logsCreatedChannelId &&
        textSet.has(payload.ticketSettings.logsCreatedChannelId)
          ? payload.ticketSettings.logsCreatedChannelId
          : null;
      const nextLogsClosedChannelId =
        payload.ticketSettings?.logsClosedChannelId &&
        textSet.has(payload.ticketSettings.logsClosedChannelId)
          ? payload.ticketSettings.logsClosedChannelId
          : null;
      const nextTicketEnabled = Boolean(payload.ticketSettings?.enabled);
      const nextPanelLayout = normalizeTicketPanelLayout(
        payload.ticketSettings?.panelLayout,
        payload.ticketSettings || undefined,
      );

      const defaultEntryLayout = createDefaultWelcomeEntryLayout();
      const defaultExitLayout = createDefaultWelcomeExitLayout();
      const hasWelcomeSettings = Boolean(payload.welcomeSettings);
      const defaultTextChannelId = text[0]?.id ?? null;
      const nextWelcomeEnabled = Boolean(payload.welcomeSettings?.enabled);
      const nextEntryPublicChannelId = hasWelcomeSettings
        ? payload.welcomeSettings?.entryPublicChannelId &&
          textSet.has(payload.welcomeSettings.entryPublicChannelId)
          ? payload.welcomeSettings.entryPublicChannelId
          : null
        : defaultTextChannelId;
      const nextEntryLogChannelId = hasWelcomeSettings
        ? payload.welcomeSettings?.entryLogChannelId &&
          textSet.has(payload.welcomeSettings.entryLogChannelId)
          ? payload.welcomeSettings.entryLogChannelId
          : null
        : defaultTextChannelId;
      const nextExitPublicChannelId = hasWelcomeSettings
        ? payload.welcomeSettings?.exitPublicChannelId &&
          textSet.has(payload.welcomeSettings.exitPublicChannelId)
          ? payload.welcomeSettings.exitPublicChannelId
          : null
        : defaultTextChannelId;
      const nextExitLogChannelId = hasWelcomeSettings
        ? payload.welcomeSettings?.exitLogChannelId &&
          textSet.has(payload.welcomeSettings.exitLogChannelId)
          ? payload.welcomeSettings.exitLogChannelId
          : null
        : defaultTextChannelId;
      const nextEntryLayout = hasWelcomeSettings
        ? normalizeWelcomeLayout(
            payload.welcomeSettings?.entryLayout,
            defaultEntryLayout,
          )
        : defaultEntryLayout;
      const nextExitLayout = hasWelcomeSettings
        ? normalizeWelcomeLayout(
            payload.welcomeSettings?.exitLayout,
            defaultExitLayout,
          )
        : defaultExitLayout;
      const nextEntryThumbnailMode =
        payload.welcomeSettings?.entryThumbnailMode === "avatar"
          ? "avatar"
          : "custom";
      const nextExitThumbnailMode =
        payload.welcomeSettings?.exitThumbnailMode === "avatar"
          ? "avatar"
          : "custom";

      const nextAdminRoleId =
        payload.staffSettings?.adminRoleId &&
        roleSet.has(payload.staffSettings.adminRoleId)
          ? payload.staffSettings.adminRoleId
          : null;
      const nextClaimRoleIds = Array.isArray(payload.staffSettings?.claimRoleIds)
          ? payload.staffSettings.claimRoleIds.filter((id) => roleSet.has(id))
          : [];
      const nextCloseRoleIds = Array.isArray(payload.staffSettings?.closeRoleIds)
          ? payload.staffSettings.closeRoleIds.filter((id) => roleSet.has(id))
          : [];
      const nextNotifyRoleIds = Array.isArray(payload.staffSettings?.notifyRoleIds)
          ? payload.staffSettings.notifyRoleIds.filter((id) => roleSet.has(id))
          : [];
      const nextAntiLinkEnabled = Boolean(payload.antiLinkSettings?.enabled);
      const nextAntiLinkLogChannelId =
        payload.antiLinkSettings?.logChannelId &&
        textSet.has(payload.antiLinkSettings.logChannelId)
          ? payload.antiLinkSettings.logChannelId
          : null;
      const nextAntiLinkEnforcementAction = normalizeAntiLinkEnforcementAction(
        payload.antiLinkSettings?.enforcementAction,
      );
      const nextAntiLinkTimeoutMinutes = normalizeAntiLinkTimeoutMinutes(
        payload.antiLinkSettings?.timeoutMinutes,
      );
      const nextAntiLinkIgnoredRoleIds = Array.isArray(
        payload.antiLinkSettings?.ignoredRoleIds,
      )
        ? payload.antiLinkSettings.ignoredRoleIds.filter((id) => roleSet.has(id))
        : [];
      const nextAntiLinkBlockExternalLinks =
        ANTILINK_DEFAULT_DETECTION.blockExternalLinks;
      const nextAntiLinkBlockDiscordInvites =
        ANTILINK_DEFAULT_DETECTION.blockDiscordInvites;
      const nextAntiLinkBlockObfuscatedLinks =
        ANTILINK_DEFAULT_DETECTION.blockObfuscatedLinks;
      const nextAutoRoleEnabled = Boolean(payload.autoRoleSettings?.enabled);
      const nextAutoRoleRoleIds = Array.isArray(payload.autoRoleSettings?.roleIds)
        ? payload.autoRoleSettings.roleIds.filter((id) => roleSet.has(id))
        : [];
      const nextAutoRoleAssignmentDelayMinutes =
        normalizeAutoRoleAssignmentDelayMinutes(
          payload.autoRoleSettings?.assignmentDelayMinutes,
        );
      const nextAutoRoleSyncStatus: AutoRoleSyncStatus =
        payload.autoRoleSettings?.syncStatus === "pending" ||
        payload.autoRoleSettings?.syncStatus === "processing" ||
        payload.autoRoleSettings?.syncStatus === "completed" ||
        payload.autoRoleSettings?.syncStatus === "failed"
          ? payload.autoRoleSettings.syncStatus
          : "idle";
      const nextAutoRoleSyncRequestedAt =
        payload.autoRoleSettings?.syncRequestedAt || null;
      const nextAutoRoleSyncStartedAt =
        payload.autoRoleSettings?.syncStartedAt || null;
      const nextAutoRoleSyncCompletedAt =
        payload.autoRoleSettings?.syncCompletedAt || null;
      const nextAutoRoleSyncError = payload.autoRoleSettings?.syncError || null;
      const nextSecurityLogsDraft = normalizeSecurityLogsSettingsDraft(
        payload.securityLogsSettings
          ? {
              enabled: payload.securityLogsSettings.enabled === true,
              useDefaultChannel:
                payload.securityLogsSettings.useDefaultChannel === true,
              defaultChannelId:
                payload.securityLogsSettings.defaultChannelId &&
                textSet.has(payload.securityLogsSettings.defaultChannelId)
                  ? payload.securityLogsSettings.defaultChannelId
                  : null,
              events: {
              nicknameChange: {
                enabled: payload.securityLogsSettings.events.nicknameChange.enabled,
                channelId:
                  payload.securityLogsSettings.events.nicknameChange.channelId &&
                  textSet.has(payload.securityLogsSettings.events.nicknameChange.channelId)
                    ? payload.securityLogsSettings.events.nicknameChange.channelId
                    : null,
              },
              avatarChange: {
                enabled: payload.securityLogsSettings.events.avatarChange.enabled,
                channelId:
                  payload.securityLogsSettings.events.avatarChange.channelId &&
                  textSet.has(payload.securityLogsSettings.events.avatarChange.channelId)
                    ? payload.securityLogsSettings.events.avatarChange.channelId
                    : null,
              },
              voiceJoin: {
                enabled: payload.securityLogsSettings.events.voiceJoin.enabled,
                channelId:
                  payload.securityLogsSettings.events.voiceJoin.channelId &&
                  textSet.has(payload.securityLogsSettings.events.voiceJoin.channelId)
                    ? payload.securityLogsSettings.events.voiceJoin.channelId
                    : null,
              },
              voiceLeave: {
                enabled: payload.securityLogsSettings.events.voiceLeave.enabled,
                channelId:
                  payload.securityLogsSettings.events.voiceLeave.channelId &&
                  textSet.has(payload.securityLogsSettings.events.voiceLeave.channelId)
                    ? payload.securityLogsSettings.events.voiceLeave.channelId
                    : null,
              },
              messageDelete: {
                enabled: payload.securityLogsSettings.events.messageDelete.enabled,
                channelId:
                  payload.securityLogsSettings.events.messageDelete.channelId &&
                  textSet.has(payload.securityLogsSettings.events.messageDelete.channelId)
                    ? payload.securityLogsSettings.events.messageDelete.channelId
                    : null,
              },
              messageEdit: {
                enabled: payload.securityLogsSettings.events.messageEdit.enabled,
                channelId:
                  payload.securityLogsSettings.events.messageEdit.channelId &&
                  textSet.has(payload.securityLogsSettings.events.messageEdit.channelId)
                    ? payload.securityLogsSettings.events.messageEdit.channelId
                    : null,
              },
              memberBan: {
                enabled: payload.securityLogsSettings.events.memberBan.enabled,
                channelId:
                  payload.securityLogsSettings.events.memberBan.channelId &&
                  textSet.has(payload.securityLogsSettings.events.memberBan.channelId)
                    ? payload.securityLogsSettings.events.memberBan.channelId
                    : null,
              },
              memberUnban: {
                enabled: payload.securityLogsSettings.events.memberUnban.enabled,
                channelId:
                  payload.securityLogsSettings.events.memberUnban.channelId &&
                  textSet.has(payload.securityLogsSettings.events.memberUnban.channelId)
                    ? payload.securityLogsSettings.events.memberUnban.channelId
                    : null,
              },
              memberKick: {
                enabled: payload.securityLogsSettings.events.memberKick.enabled,
                channelId:
                  payload.securityLogsSettings.events.memberKick.channelId &&
                  textSet.has(payload.securityLogsSettings.events.memberKick.channelId)
                    ? payload.securityLogsSettings.events.memberKick.channelId
                    : null,
              },
              memberTimeout: {
                enabled: payload.securityLogsSettings.events.memberTimeout.enabled,
                channelId:
                  payload.securityLogsSettings.events.memberTimeout.channelId &&
                  textSet.has(payload.securityLogsSettings.events.memberTimeout.channelId)
                    ? payload.securityLogsSettings.events.memberTimeout.channelId
                    : null,
              },
              voiceMove: {
                enabled: payload.securityLogsSettings.events.voiceMove.enabled,
                channelId:
                  payload.securityLogsSettings.events.voiceMove.channelId &&
                  textSet.has(payload.securityLogsSettings.events.voiceMove.channelId)
                    ? payload.securityLogsSettings.events.voiceMove.channelId
                    : null,
              },
              voiceMute: {
                enabled: payload.securityLogsSettings.events.voiceMute.enabled,
                channelId:
                  payload.securityLogsSettings.events.voiceMute.channelId &&
                  textSet.has(payload.securityLogsSettings.events.voiceMute.channelId)
                    ? payload.securityLogsSettings.events.voiceMute.channelId
                    : null,
              },
              },
            }
          : createDefaultSecurityLogsSettingsDraft(),
      );

      setMenuChannelId(nextMenuChannelId);
      setTicketsCategoryId(nextTicketsCategoryId);
      setLogsCreatedChannelId(nextLogsCreatedChannelId);
      setLogsClosedChannelId(nextLogsClosedChannelId);
      setPanelLayout(nextPanelLayout);
      setTicketEnabled(nextTicketEnabled);
      setWelcomeEnabled(nextWelcomeEnabled);
      setEntryPublicChannelId(nextEntryPublicChannelId);
      setEntryLogChannelId(nextEntryLogChannelId);
      setExitPublicChannelId(nextExitPublicChannelId);
      setExitLogChannelId(nextExitLogChannelId);
      setEntryLayout(nextEntryLayout);
      setExitLayout(nextExitLayout);
      setEntryThumbnailMode(nextEntryThumbnailMode);
      setExitThumbnailMode(nextExitThumbnailMode);
      setAntiLinkEnabled(nextAntiLinkEnabled);
      setAntiLinkLogChannelId(nextAntiLinkLogChannelId);
      setAntiLinkEnforcementAction(nextAntiLinkEnforcementAction);
      setAntiLinkTimeoutMinutes(nextAntiLinkTimeoutMinutes);
      setAntiLinkIgnoredRoleIds(nextAntiLinkIgnoredRoleIds);
      setAntiLinkBlockExternalLinks(nextAntiLinkBlockExternalLinks);
      setAntiLinkBlockDiscordInvites(nextAntiLinkBlockDiscordInvites);
      setAntiLinkBlockObfuscatedLinks(nextAntiLinkBlockObfuscatedLinks);
      setAutoRoleEnabled(nextAutoRoleEnabled);
      setAutoRoleRoleIds(nextAutoRoleRoleIds);
      setAutoRoleAssignmentDelayMinutes(nextAutoRoleAssignmentDelayMinutes);
      setAutoRoleSyncExistingMembers(false);
      setAutoRoleSyncStatus(nextAutoRoleSyncStatus);
      setAutoRoleSyncRequestedAt(nextAutoRoleSyncRequestedAt);
      setAutoRoleSyncStartedAt(nextAutoRoleSyncStartedAt);
      setAutoRoleSyncCompletedAt(nextAutoRoleSyncCompletedAt);
      setAutoRoleSyncError(nextAutoRoleSyncError);
      setSecurityLogsDraft(nextSecurityLogsDraft);
      setAdminRoleId(nextAdminRoleId);
      setClaimRoleIds(nextClaimRoleIds);
      setCloseRoleIds(nextCloseRoleIds);
      setNotifyRoleIds(nextNotifyRoleIds);
      setSavedSettingsDraft(
        normalizeServerSettingsDraft({
          enabled: nextTicketEnabled,
          menuChannelId: nextMenuChannelId,
          ticketsCategoryId: nextTicketsCategoryId,
          logsCreatedChannelId: nextLogsCreatedChannelId,
          logsClosedChannelId: nextLogsClosedChannelId,
          panelLayout: nextPanelLayout,
          adminRoleId: nextAdminRoleId,
          claimRoleIds: nextClaimRoleIds,
          closeRoleIds: nextCloseRoleIds,
          notifyRoleIds: nextNotifyRoleIds,
        }),
      );
      setSavedWelcomeSettingsDraft(
        normalizeWelcomeSettingsDraft({
          enabled: nextWelcomeEnabled,
          entryPublicChannelId: nextEntryPublicChannelId,
          entryLogChannelId: nextEntryLogChannelId,
          exitPublicChannelId: nextExitPublicChannelId,
          exitLogChannelId: nextExitLogChannelId,
          entryLayout: nextEntryLayout,
          exitLayout: nextExitLayout,
          entryThumbnailMode: nextEntryThumbnailMode,
          exitThumbnailMode: nextExitThumbnailMode,
        }),
      );
      setSavedAntiLinkSettingsDraft(
        normalizeAntiLinkSettingsDraft({
          enabled: nextAntiLinkEnabled,
          logChannelId: nextAntiLinkLogChannelId,
          enforcementAction: nextAntiLinkEnforcementAction,
          timeoutMinutes: nextAntiLinkTimeoutMinutes,
          ignoredRoleIds: nextAntiLinkIgnoredRoleIds,
          blockExternalLinks: nextAntiLinkBlockExternalLinks,
          blockDiscordInvites: nextAntiLinkBlockDiscordInvites,
          blockObfuscatedLinks: nextAntiLinkBlockObfuscatedLinks,
        }),
      );
      setSavedAutoRoleSettingsDraft(
        normalizeAutoRoleSettingsDraft({
          enabled: nextAutoRoleEnabled,
          roleIds: nextAutoRoleRoleIds,
          assignmentDelayMinutes: nextAutoRoleAssignmentDelayMinutes,
        }),
      );
      setSavedSecurityLogsDraft(nextSecurityLogsDraft);
    },
    [],
  );

  useEffect(() => {
    const hasCachedDashboardSnapshot = Boolean(
      readCachedServerDashboardSettings(guildId),
    );
    const shouldHardResetEditor =
      !hasCachedDashboardSnapshot && !hasLoadedDashboardSnapshotRef.current;

    setActiveTab(initialTab);
    setErrorMessage(null);
    setSuccessMessage(null);
    setShowSaveSuccessBar(false);
    setWelcomeMessageTab("entry");
    setIsWelcomeActivationModalOpen(false);
    setHasDismissedWelcomeModal(false);
    setIsActivatingWelcome(false);
    setIsAntiLinkActivationModalOpen(false);
    setHasDismissedAntiLinkModal(false);
    setIsActivatingAntiLink(false);
    setActiveSecurityLogModalEvent(null);
    setOpenSecurityLogTooltipKey(null);
    setPaymentGuildFilter(guildId);
    setPaymentSearch("");
    setPaymentStatusFilter("all");
    setMethodGuildFilter(guildId);
    setMethodSearch("");
    setMethodStatusFilter("all");
    setOpenMethodMenuId(null);
    setDeletingMethodId(null);
    setSavingMethodNicknameId(null);
    setMethodActionMessage(null);
    setIsAddMethodModalOpen(false);
    setIsAddingMethod(false);
    setIsAddMethodSdkLoading(false);
    setIsAddMethodSdkReady(false);
    setAddMethodFlowState("idle");
    setAddMethodStatusMessage(null);
    setAddMethodError(null);
    setAddMethodForm({
      cardNumber: "",
      holderName: "",
      expiry: "",
      cvv: "",
      document: "",
      nickname: "",
    });
    setAddMethodTouchedFields(createAddMethodTouchedFields());
    setPlanError(null);
    setPlanSuccess(null);
    setIsRecurringMethodModalOpen(false);
    setRecurringMethodDraftId(null);
    setShouldEnableRecurringAfterMethodAdd(false);
    setAutoRoleSyncExistingMembers(false);

    if (!shouldHardResetEditor) {
      return;
    }

    setSavedSettingsDraft(null);
    setSavedWelcomeSettingsDraft(null);
    setSavedAntiLinkSettingsDraft(null);
    setSavedAutoRoleSettingsDraft(null);
    setSavedSecurityLogsDraft(null);
    setPanelLayout(createDefaultTicketPanelLayout());
    setTicketEnabled(false);
    setWelcomeEnabled(false);
    setEntryPublicChannelId(null);
    setEntryLogChannelId(null);
    setExitPublicChannelId(null);
    setExitLogChannelId(null);
    setEntryLayout(createDefaultWelcomeEntryLayout());
    setExitLayout(createDefaultWelcomeExitLayout());
    setEntryThumbnailMode("custom");
    setExitThumbnailMode("custom");
    setAntiLinkEnabled(false);
    setAntiLinkLogChannelId(null);
    setAntiLinkEnforcementAction("delete_only");
    setAntiLinkTimeoutMinutes(10);
    setAntiLinkIgnoredRoleIds([]);
    setAntiLinkBlockExternalLinks(true);
    setAntiLinkBlockDiscordInvites(true);
    setAntiLinkBlockObfuscatedLinks(true);
    setAutoRoleEnabled(false);
    setAutoRoleRoleIds([]);
    setAutoRoleAssignmentDelayMinutes(0);
    setAutoRoleSyncStatus("idle");
    setAutoRoleSyncRequestedAt(null);
    setAutoRoleSyncStartedAt(null);
    setAutoRoleSyncCompletedAt(null);
    setAutoRoleSyncError(null);
    setSecurityLogsDraft(createDefaultSecurityLogsSettingsDraft());
  }, [guildId, initialTab]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!(target instanceof Element)) {
        setOpenMethodMenuId(null);
        return;
      }
      if (!target.closest("[data-method-menu-root='true']")) {
        setOpenMethodMenuId(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMethodMenuId(null);
        setIsRecurringMethodModalOpen(false);
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
    let cancelled = false;

    async function prepareAddMethodSdk() {
      if (!isAddMethodModalOpen) return;

      setIsAddMethodSdkLoading(true);
      setIsAddMethodSdkReady(false);
      setAddMethodFlowState("preparing");
      setAddMethodStatusMessage("Preparando o cofre seguro do cartao...");
      setAddMethodError(null);

      try {
        try {
          await loadMercadoPagoSecuritySdk();
        } catch {
          // A identificacao do dispositivo sera tentada novamente ao enviar.
        }
        await loadMercadoPagoSdk();
        if (!cancelled) {
          setIsAddMethodSdkReady(true);
          setAddMethodFlowState("idle");
          setAddMethodStatusMessage(null);
        }
      } catch (error) {
        if (!cancelled) {
          setIsAddMethodSdkReady(false);
          setAddMethodFlowState("rejected");
          setAddMethodError(
            parseUnknownErrorMessage(error) ||
              "Nao foi possivel preparar o cofre seguro do cartao.",
          );
          setAddMethodStatusMessage(
            "Falha ao preparar o cofre seguro do cartao.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsAddMethodSdkLoading(false);
        }
      }
    }

    void prepareAddMethodSdk();

    return () => {
      cancelled = true;
    };
  }, [isAddMethodModalOpen]);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function loadSettings() {
      const cachedPayload = readCachedServerDashboardSettings(guildId);

      if (cachedPayload) {
        applyDashboardSettingsPayload(cachedPayload);
        markDashboardSnapshotLoaded();
        setErrorMessage(null);
        setIsLoading(false);
      } else {
        setIsLoading(true);
        setErrorMessage(null);
      }

      try {
        const payload = await getServerDashboardSettings(guildId, {
          signal: controller.signal,
          preferCache: !cachedPayload,
        });

        if (!mounted) return;
        applyDashboardSettingsPayload(payload);
        markDashboardSnapshotLoaded();
        setErrorMessage(null);
      } catch (error) {
        if (!mounted) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (!cachedPayload) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Erro ao carregar configuracoes.",
          );
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [applyDashboardSettingsPayload, guildId, markDashboardSnapshotLoaded]);

  useEffect(() => {
    setMethodNicknameDrafts((current) => {
      const next: Record<string, string> = {};
      for (const method of methods) {
        next[method.id] = current[method.id] ?? method.nickname ?? "";
      }
      return next;
    });
  }, [methods]);

  useEffect(() => {
    let mounted = true;
    async function loadPayments() {
      if (!showServerFinancialPanels) {
        if (!mounted) return;
        setOrders([]);
        setMethods([]);
        setPaymentsError(null);
        setIsPaymentsLoading(false);
        return;
      }

      if (isViewerOnly) {
        if (!mounted) return;
        setOrders([]);
        setMethods([]);
        setPaymentsError(null);
        setIsPaymentsLoading(false);
        return;
      }

      setIsPaymentsLoading(true);
      setPaymentsError(null);
      try {
        const response = await fetch("/api/auth/me/payments/history", { cache: "no-store" });
        const payload = await response.json();
        if (!mounted) return;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Falha ao carregar pagamentos.");
        }
        const safeOrders = Array.isArray(payload.orders)
          ? payload.orders
              .map((order: unknown) => sanitizePaymentOrder(order))
              .filter((order: PaymentOrder | null): order is PaymentOrder => Boolean(order))
          : [];
        const safeMethods = Array.isArray(payload.methods)
          ? payload.methods
              .map((method: unknown) => sanitizeSavedMethod(method))
              .filter((method: SavedMethod | null): method is SavedMethod => Boolean(method))
          : [];

        setOrders(safeOrders);
        setMethods(safeMethods);
      } catch (error) {
        if (!mounted) return;
        setPaymentsError(error instanceof Error ? error.message : "Erro ao carregar pagamentos.");
      } finally {
        if (mounted) setIsPaymentsLoading(false);
      }
    }
    void loadPayments();
    return () => {
      mounted = false;
    };
  }, [isViewerOnly, showServerFinancialPanels]);

  useEffect(() => {
    let mounted = true;

    async function loadPlan() {
      if (!showServerFinancialPanels) {
        if (!mounted) return;
        setPlanSettings(null);
        setPlanError(null);
        setIsPlanLoading(false);
        return;
      }

      if (isViewerOnly) {
        if (!mounted) return;
        setPlanSettings({
          planCode: "pro",
          monthlyAmount: 9.99,
          currency: "BRL",
          recurringEnabled: false,
          recurringMethodId: null,
          recurringMethod: null,
          availableMethods: [],
          availableMethodsCount: 0,
          createdAt: null,
          updatedAt: null,
        });
        setPlanError(null);
        setIsPlanLoading(false);
        return;
      }

      setIsPlanLoading(true);
      setPlanError(null);
      try {
        const response = await fetch(
          `/api/auth/me/servers/plans?guildId=${guildId}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as PlanApiResponse;

        if (!mounted) return;

        if (!response.ok || !payload.ok || !payload.plan) {
          throw new Error(payload.message || "Falha ao carregar plano do servidor.");
        }

        setPlanSettings(payload.plan);
      } catch (error) {
        if (!mounted) return;
        setPlanSettings(null);
        setPlanError(
          error instanceof Error ? error.message : "Erro ao carregar plano.",
        );
      } finally {
        if (mounted) setIsPlanLoading(false);
      }
    }

    void loadPlan();

    return () => {
      mounted = false;
    };
  }, [guildId, isViewerOnly, showServerFinancialPanels]);

  const serverMap = useMemo(() => {
    const map = new Map<string, { guildName: string; iconUrl: string | null }>();
    for (const server of allServers) {
      map.set(server.guildId, { guildName: server.guildName, iconUrl: server.iconUrl });
    }
    if (!map.has(guildId)) {
      map.set(guildId, { guildName, iconUrl: null });
    }
    return map;
  }, [allServers, guildId, guildName]);

  const serverOptions = useMemo(() => {
    const options = Array.from(serverMap.entries()).map(([id, info]) => ({ id, name: info.guildName }));
    options.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return [{ id: "all", name: "Todos servidores" }, ...options];
  }, [serverMap]);

  const filteredOrders = useMemo(() => {
    const search = normalizeSearch(paymentSearch);
    return orders.filter((order) => {
      if (paymentStatusFilter !== "all" && order.status !== paymentStatusFilter) return false;
      if (paymentGuildFilter !== "all" && order.guildId !== paymentGuildFilter) return false;
      if (!search) return true;
      const guildLabel = serverMap.get(order.guildId)?.guildName || order.guildId;
      const technicalText = order.technicalLabels.join(" ");
      const text = normalizeSearch(`${order.orderNumber} ${order.guildId} ${guildLabel} ${order.method} ${order.status} ${technicalText}`);
      return text.includes(search);
    });
  }, [orders, paymentGuildFilter, paymentSearch, paymentStatusFilter, serverMap]);

  const cardOrdersByMethod = useMemo(() => {
    const map = new Map<string, PaymentOrder[]>();
    for (const order of orders) {
      if (order.method !== "card" || !order.card?.firstSix || !order.card?.lastFour) continue;
      const methodKey = [
        (order.card.brand || "card").toLowerCase(),
        order.card.firstSix,
        order.card.lastFour,
        order.card.expMonth ?? "",
        order.card.expYear ?? "",
      ].join(":");

      const current = map.get(methodKey) || [];
      current.push(order);
      map.set(methodKey, current);
    }
    return map;
  }, [orders]);

  const filteredMethods = useMemo(() => {
    const search = normalizeSearch(methodSearch);

    return methods.filter((method) => {
      const relatedOrders = cardOrdersByMethod.get(method.id) || [];
      const fallbackGuildId = method.lastContextGuildId || null;

      if (methodStatusFilter !== "all") {
        const matchesStatus = relatedOrders.some((order) => order.status === methodStatusFilter);
        if (!matchesStatus) return false;
      }

      if (methodGuildFilter !== "all") {
        const matchesGuild = relatedOrders.some((order) => order.guildId === methodGuildFilter);
        const matchesFallbackGuild =
          relatedOrders.length === 0 && fallbackGuildId === methodGuildFilter;
        if (!matchesGuild && !matchesFallbackGuild) return false;
      }

      if (!search) return true;

      const brandLabel = cardBrandLabel(method.brand);
      const masked = `${method.firstSix} ${method.lastFour}`;
      const nickname = (method.nickname || "").trim();
      const relatedServerNames = relatedOrders
        .map((order) => serverMap.get(order.guildId)?.guildName || order.guildId)
        .join(" ");
      const fallbackServerName = fallbackGuildId
        ? serverMap.get(fallbackGuildId)?.guildName || fallbackGuildId
        : "";
      const relatedStatuses = relatedOrders.map((order) => order.status).join(" ");
      const verificationLabel =
        method.verificationStatus === "verified"
          ? "verificado"
          : method.verificationStatus === "pending"
            ? "pendente"
            : method.verificationStatus === "failed"
              ? "falhou"
              : "cancelado";
      const haystack = normalizeSearch(
        `${brandLabel} ${nickname} ${masked} ${relatedServerNames} ${fallbackServerName} ${relatedStatuses} ${verificationLabel}`,
      );
      return haystack.includes(search);
    });
  }, [
    cardOrdersByMethod,
    methodGuildFilter,
    methodSearch,
    methodStatusFilter,
    methods,
    serverMap,
  ]);

  const methodById = useMemo(
    () => new Map(methods.map((method) => [method.id, method])),
    [methods],
  );

  const recurringMethod = useMemo(() => {
    if (!planSettings?.recurringMethodId) return null;
    return (
      methodById.get(planSettings.recurringMethodId) ||
      planSettings.recurringMethod ||
      null
    );
  }, [methodById, planSettings]);

  const recurringMethodOptions = useMemo(() => {
    const fromPlan = planSettings?.availableMethods || [];
    if (fromPlan.length) return fromPlan;
    return methods;
  }, [methods, planSettings?.availableMethods]);

  const addMethodCardDigits = useMemo(
    () => normalizeCardDigits(addMethodForm.cardNumber),
    [addMethodForm.cardNumber],
  );

  const addMethodCardBrand = useMemo(
    () => detectCardBrand(addMethodCardDigits),
    [addMethodCardDigits],
  );

  const addMethodExpiryDigits = useMemo(
    () => normalizeCardExpiryDigits(addMethodForm.expiry),
    [addMethodForm.expiry],
  );

  const addMethodCvvDigits = useMemo(
    () => normalizeCardCvvInput(addMethodForm.cvv),
    [addMethodForm.cvv],
  );

  const addMethodBrandIconPath = useMemo(
    () => cardBrandIcon(addMethodCardBrand),
    [addMethodCardBrand],
  );
  const addMethodBrandIconSafePath = useMemo(
    () =>
      typeof addMethodBrandIconPath === "string" &&
      addMethodBrandIconPath.startsWith("/")
        ? addMethodBrandIconPath
        : "/cdn/icons/card_.png",
    [addMethodBrandIconPath],
  );

  const addMethodDocumentDigits = useMemo(
    () => normalizeBrazilDocumentDigits(addMethodForm.document),
    [addMethodForm.document],
  );

  const addMethodValidationErrors = useMemo(() => {
    return resolveAddMethodValidationErrors({
      cardDigits: addMethodCardDigits,
      cardBrand: addMethodCardBrand,
      holderName: addMethodForm.holderName,
      expiry: addMethodForm.expiry,
      expiryDigits: addMethodExpiryDigits,
      cvvDigits: addMethodCvvDigits,
      documentDigits: addMethodDocumentDigits,
      nickname: addMethodForm.nickname,
    });
  }, [
    addMethodCardBrand,
    addMethodCardDigits,
    addMethodCvvDigits,
    addMethodDocumentDigits,
    addMethodForm.expiry,
    addMethodForm.holderName,
    addMethodForm.nickname,
    addMethodExpiryDigits,
  ]);
  const addMethodVisibleErrors = useMemo(
    () => ({
      cardNumber: addMethodTouchedFields.cardNumber
        ? addMethodValidationErrors.cardNumber
        : null,
      holderName: addMethodTouchedFields.holderName
        ? addMethodValidationErrors.holderName
        : null,
      expiry: addMethodTouchedFields.expiry
        ? addMethodValidationErrors.expiry
        : null,
      cvv: addMethodTouchedFields.cvv ? addMethodValidationErrors.cvv : null,
      document: addMethodTouchedFields.document
        ? addMethodValidationErrors.document
        : null,
      nickname: addMethodTouchedFields.nickname
        ? addMethodValidationErrors.nickname
        : null,
    }),
    [addMethodTouchedFields, addMethodValidationErrors],
  );

  const addMethodCanSubmit = useMemo(() => {
    return Boolean(
      addMethodCardDigits &&
        addMethodForm.holderName.trim() &&
        addMethodExpiryDigits.length === 4 &&
        addMethodCvvDigits &&
        addMethodDocumentDigits &&
        Object.values(addMethodValidationErrors).every((error) => !error),
    );
  }, [
    addMethodCardDigits,
    addMethodCvvDigits,
    addMethodDocumentDigits,
    addMethodExpiryDigits.length,
    addMethodForm.holderName,
    addMethodValidationErrors,
  ]);
  const addMethodCooldownMessage = useMemo(
    () => formatCooldownMessage(addMethodClientCooldownRemainingSeconds),
    [addMethodClientCooldownRemainingSeconds],
  );

  const serverSettingsControlHeight = 60;

  const openAddMethodModal = useCallback(
    (options?: { enableRecurringAfterAdd?: boolean }) => {
      if (isViewerOnly) {
        setPaymentsError(null);
        setMethodActionMessage(financialViewerMessage);
        setPlanSuccess(null);
        setPlanError(financialViewerMessage);
        return;
      }

      if (!cardPaymentsEnabled) {
        setAddMethodFlowState("idle");
        setAddMethodStatusMessage(null);
        setAddMethodError(null);
        setShouldEnableRecurringAfterMethodAdd(false);
        if (options?.enableRecurringAfterAdd) {
          setPlanSuccess(null);
          setPlanError(CARD_RECURRING_DISABLED_MESSAGE);
        } else {
          setPaymentsError(null);
          setMethodActionMessage(CARD_PAYMENTS_DISABLED_MESSAGE);
        }
        return;
      }

      setAddMethodFlowState("idle");
      setAddMethodStatusMessage(null);
      setAddMethodError(null);
      setAddMethodTouchedFields(createAddMethodTouchedFields());
      setShouldEnableRecurringAfterMethodAdd(
        Boolean(options?.enableRecurringAfterAdd),
      );
      setIsAddMethodModalOpen(true);
    },
    [cardPaymentsEnabled, financialViewerMessage, isViewerOnly],
  );

  const closeAddMethodModal = useCallback(() => {
    if (isAddingMethod) return;
    setAddMethodFlowState("idle");
    setAddMethodStatusMessage(null);
    setAddMethodError(null);
    setAddMethodClientCooldownUntil(null);
    setAddMethodClientCooldownRemainingSeconds(null);
    setAddMethodTouchedFields(createAddMethodTouchedFields());
    setShouldEnableRecurringAfterMethodAdd(false);
    setIsAddMethodModalOpen(false);
  }, [isAddingMethod]);

  useEffect(() => {
    if (!addMethodClientCooldownUntil) {
      setAddMethodClientCooldownRemainingSeconds(null);
      return;
    }

    const syncRemaining = () => {
      const nextSeconds = Math.max(
        0,
        Math.ceil((addMethodClientCooldownUntil - Date.now()) / 1000),
      );
      if (nextSeconds <= 0) {
        setAddMethodClientCooldownUntil(null);
        setAddMethodClientCooldownRemainingSeconds(null);
        return;
      }

      setAddMethodClientCooldownRemainingSeconds(nextSeconds);
    };

    syncRemaining();
    const intervalId = window.setInterval(syncRemaining, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [addMethodClientCooldownUntil]);

  const markAddMethodFieldTouched = useCallback((field: AddMethodFieldKey) => {
    setAddMethodTouchedFields((current) =>
      current[field] ? current : { ...current, [field]: true },
    );
  }, []);

  const clearAddMethodRealtimeFeedback = useCallback(() => {
    setAddMethodError(null);
    setAddMethodFlowState((current) =>
      current === "rejected" ? "idle" : current,
    );
    setAddMethodStatusMessage((current) =>
      current && current !== "Cartao salvo e liberado para uso no sistema."
        ? null
        : current,
    );
  }, []);

  const isAntiLinkSection = settingsSection === "security_antilink";
  const isAutoRoleSection = settingsSection === "security_autorole";
  const isSecurityLogsSection = settingsSection === "security_logs";
  const isSecuritySection =
    isAntiLinkSection || isAutoRoleSection || isSecurityLogsSection;
  const isTicketSection =
    settingsSection === "overview" || settingsSection === "message";
  const isWelcomeSection =
    settingsSection === "entry_exit_overview" ||
    settingsSection === "entry_exit_message";
  const isTicketMessageSection = settingsSection === "message";
  const isWelcomeMessageSection = settingsSection === "entry_exit_message";

  const entryChannelsProvided = Boolean(
    entryPublicChannelId || entryLogChannelId,
  );
  const exitChannelsProvided = Boolean(exitPublicChannelId || exitLogChannelId);
  const isEntryLayoutValid = !entryChannelsProvided || welcomeLayoutHasContent(entryLayout);
  const isExitLayoutValid = !exitChannelsProvided || welcomeLayoutHasContent(exitLayout);

  const canSaveTicket = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      (!ticketEnabled ||
        (menuChannelId &&
          ticketsCategoryId &&
          logsCreatedChannelId &&
          logsClosedChannelId &&
          panelLayout.length &&
          ticketPanelLayoutHasRequiredParts(panelLayout) &&
          ticketPanelLayoutHasAtMostOneFunctionButton(panelLayout) &&
          adminRoleId &&
          claimRoleIds.length &&
          closeRoleIds.length &&
          notifyRoleIds.length)),
  );

  const canSaveWelcome = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      (!welcomeEnabled ||
        (entryChannelsProvided &&
          exitChannelsProvided &&
          isEntryLayoutValid &&
          isExitLayoutValid)),
  );
  const antiLinkTimeoutValue = normalizeAntiLinkTimeoutMinutes(
    antiLinkTimeoutMinutes,
  );
  const autoRoleAssignmentDelayValue = normalizeAutoRoleAssignmentDelayMinutes(
    autoRoleAssignmentDelayMinutes,
  );
  const canSaveAntiLink = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      (!antiLinkEnabled ||
        (antiLinkLogChannelId &&
          (antiLinkEnforcementAction !== "timeout" ||
            antiLinkTimeoutValue >= 1))),
  );
  const canSaveAutoRole = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      (!autoRoleEnabled || autoRoleRoleIds.length > 0),
  );
  const hasAnySecurityLogEnabled = SECURITY_LOG_EVENT_OPTIONS.some(
    (option) => securityLogsDraft.events[option.key].enabled,
  );
  const hasInvalidSecurityLogChannel = SECURITY_LOG_EVENT_OPTIONS.some(
    (option) =>
      securityLogsDraft.enabled &&
      !securityLogsDraft.useDefaultChannel &&
      securityLogsDraft.events[option.key].enabled &&
      !securityLogsDraft.events[option.key].channelId,
  );
  const hasInvalidSecurityLogsDefaultChannel =
    securityLogsDraft.enabled &&
    securityLogsDraft.useDefaultChannel &&
    hasAnySecurityLogEnabled &&
    !securityLogsDraft.defaultChannelId;
  const canSaveSecurityLogs = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      (!securityLogsDraft.enabled ||
        !hasAnySecurityLogEnabled ||
        (securityLogsDraft.useDefaultChannel
          ? !hasInvalidSecurityLogsDefaultChannel
          : !hasInvalidSecurityLogChannel)),
  );

  const canSendEmbed = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      !isSendingEmbed &&
      ticketEnabled &&
      menuChannelId &&
      panelLayout.length &&
      ticketPanelLayoutHasRequiredParts(panelLayout) &&
      ticketPanelLayoutHasAtMostOneFunctionButton(panelLayout),
  );

  const currentSettingsDraft = useMemo(
    () =>
      normalizeServerSettingsDraft({
        enabled: ticketEnabled,
        menuChannelId,
        ticketsCategoryId,
        logsCreatedChannelId,
        logsClosedChannelId,
        panelLayout,
        adminRoleId,
        claimRoleIds,
        closeRoleIds,
        notifyRoleIds,
      }),
    [
      adminRoleId,
      claimRoleIds,
      closeRoleIds,
      ticketEnabled,
      logsClosedChannelId,
      logsCreatedChannelId,
      menuChannelId,
      notifyRoleIds,
      panelLayout,
      ticketsCategoryId,
    ],
  );

  const currentWelcomeDraft = useMemo(
    () =>
      normalizeWelcomeSettingsDraft({
        enabled: welcomeEnabled,
        entryPublicChannelId,
        entryLogChannelId,
        exitPublicChannelId,
        exitLogChannelId,
        entryLayout,
        exitLayout,
        entryThumbnailMode,
        exitThumbnailMode,
      }),
    [
      entryLayout,
      entryLogChannelId,
      entryPublicChannelId,
      entryThumbnailMode,
      exitLayout,
      exitLogChannelId,
      exitPublicChannelId,
      exitThumbnailMode,
      welcomeEnabled,
    ],
  );
  const currentAntiLinkDraft = useMemo(
    () =>
      normalizeAntiLinkSettingsDraft({
        enabled: antiLinkEnabled,
        logChannelId: antiLinkLogChannelId,
        enforcementAction: antiLinkEnforcementAction,
        timeoutMinutes: antiLinkTimeoutValue,
        ignoredRoleIds: antiLinkIgnoredRoleIds,
        blockExternalLinks: ANTILINK_DEFAULT_DETECTION.blockExternalLinks,
        blockDiscordInvites: ANTILINK_DEFAULT_DETECTION.blockDiscordInvites,
        blockObfuscatedLinks: ANTILINK_DEFAULT_DETECTION.blockObfuscatedLinks,
      }),
    [
      antiLinkEnabled,
      antiLinkEnforcementAction,
      antiLinkIgnoredRoleIds,
      antiLinkLogChannelId,
      antiLinkTimeoutValue,
    ],
  );
  const currentAutoRoleDraft = useMemo(
    () =>
      normalizeAutoRoleSettingsDraft({
        enabled: autoRoleEnabled,
        roleIds: autoRoleRoleIds,
        assignmentDelayMinutes: autoRoleAssignmentDelayValue,
      }),
    [autoRoleAssignmentDelayValue, autoRoleEnabled, autoRoleRoleIds],
  );
  const currentSecurityLogsDraft = useMemo(
    () => normalizeSecurityLogsSettingsDraft(securityLogsDraft),
    [securityLogsDraft],
  );

  const hasLoadedTicketDraft = !isLoading && savedSettingsDraft !== null;
  const hasLoadedWelcomeDraft = !isLoading && savedWelcomeSettingsDraft !== null;
  const hasLoadedAntiLinkDraft =
    !isLoading && savedAntiLinkSettingsDraft !== null;
  const hasLoadedAutoRoleDraft =
    !isLoading && savedAutoRoleSettingsDraft !== null;
  const hasLoadedSecurityLogsDraft =
    !isLoading && savedSecurityLogsDraft !== null;
  const shouldShowBlockingSkeleton = isLoading && !hasLoadedDashboardSnapshot;
  const hasTicketUnsavedChanges = useMemo(
    () =>
      hasLoadedTicketDraft &&
      !areServerSettingsDraftsEqual(currentSettingsDraft, savedSettingsDraft),
    [currentSettingsDraft, hasLoadedTicketDraft, savedSettingsDraft],
  );
  const hasWelcomeUnsavedChanges = useMemo(
    () =>
      hasLoadedWelcomeDraft &&
      !areWelcomeSettingsDraftsEqual(currentWelcomeDraft, savedWelcomeSettingsDraft),
    [currentWelcomeDraft, hasLoadedWelcomeDraft, savedWelcomeSettingsDraft],
  );
  const hasAntiLinkUnsavedChanges = useMemo(
    () =>
      hasLoadedAntiLinkDraft &&
      !areAntiLinkSettingsDraftsEqual(
        currentAntiLinkDraft,
        savedAntiLinkSettingsDraft,
      ),
    [
      currentAntiLinkDraft,
      hasLoadedAntiLinkDraft,
      savedAntiLinkSettingsDraft,
    ],
  );
  const hasAutoRoleUnsavedChanges = useMemo(
    () =>
      hasLoadedAutoRoleDraft &&
      !areAutoRoleSettingsDraftsEqual(
        currentAutoRoleDraft,
        savedAutoRoleSettingsDraft,
      ),
    [currentAutoRoleDraft, hasLoadedAutoRoleDraft, savedAutoRoleSettingsDraft],
  );
  const hasSecurityLogsUnsavedChanges = useMemo(
    () =>
      hasLoadedSecurityLogsDraft &&
      !areSecurityLogsSettingsDraftsEqual(
        currentSecurityLogsDraft,
        savedSecurityLogsDraft,
      ),
    [
      currentSecurityLogsDraft,
      hasLoadedSecurityLogsDraft,
      savedSecurityLogsDraft,
    ],
  );

  const hasLoadedSettingsDraft = isAntiLinkSection
    ? hasLoadedAntiLinkDraft
    : isAutoRoleSection
      ? hasLoadedAutoRoleDraft
    : isSecurityLogsSection
      ? hasLoadedSecurityLogsDraft
    : isWelcomeSection
      ? hasLoadedWelcomeDraft
      : hasLoadedTicketDraft;
  const hasUnsavedChanges = isAntiLinkSection
    ? hasAntiLinkUnsavedChanges
    : isAutoRoleSection
      ? hasAutoRoleUnsavedChanges || autoRoleSyncExistingMembers
    : isSecurityLogsSection
      ? hasSecurityLogsUnsavedChanges
    : isWelcomeSection
      ? hasWelcomeUnsavedChanges
      : hasTicketUnsavedChanges;

  const canResetSettings = Boolean(
    !settingsReadOnly &&
      !isLoading &&
      !isSaving &&
      hasUnsavedChanges &&
      (isAntiLinkSection
        ? savedAntiLinkSettingsDraft
        : isAutoRoleSection
          ? savedAutoRoleSettingsDraft
        : isSecurityLogsSection
          ? savedSecurityLogsDraft
        : isWelcomeSection
          ? savedWelcomeSettingsDraft
          : savedSettingsDraft),
  );

  const functionButtonCount = countTicketPanelFunctionButtons(panelLayout);
  const hasTooManyFunctionButtons = functionButtonCount > 1;
  const isTicketMessageLayoutInvalid =
    !ticketPanelLayoutHasRequiredParts(panelLayout) ||
    hasTooManyFunctionButtons;
  const isWelcomeMessageLayoutInvalid =
    !isEntryLayoutValid || !isExitLayoutValid;
  const canPersistSettings = Boolean(
    (isAntiLinkSection
      ? canSaveAntiLink
      : isAutoRoleSection
        ? canSaveAutoRole
      : isSecurityLogsSection
        ? canSaveSecurityLogs
      : isWelcomeSection
        ? canSaveWelcome
        : canSaveTicket) && hasUnsavedChanges,
  );
  const showFloatingSaveBar =
    activeTab === "settings" &&
    !settingsReadOnly &&
    hasLoadedSettingsDraft &&
    (hasUnsavedChanges || isSaving || showSaveSuccessBar);
  const showSaveBarActions = !showSaveSuccessBar || hasUnsavedChanges || isSaving;
  const showInlineMessages = Boolean(
    isViewerOnly || locked || errorMessage,
  );
  const ticketControlsDisabled = isSaving || settingsReadOnly || !ticketEnabled;
  const welcomeControlsDisabled =
    isSaving || settingsReadOnly || !welcomeEnabled || isActivatingWelcome;
  const antiLinkControlsDisabled =
    isSaving || settingsReadOnly || !antiLinkEnabled || isActivatingAntiLink;
  const autoRoleControlsDisabled =
    isSaving || settingsReadOnly || !autoRoleEnabled;
  const autoRoleSyncExistingMembersDisabled =
    autoRoleControlsDisabled || autoRoleRoleIds.length === 0;
  const securityLogsModuleControlsDisabled = isSaving || settingsReadOnly;
  const securityLogsControlsDisabled =
    securityLogsModuleControlsDisabled || !securityLogsDraft.enabled;
  const securityLogsPerEventChannelControlsDisabled =
    securityLogsControlsDisabled || securityLogsDraft.useDefaultChannel;
  const showInvalidTicketSaveState =
    isTicketMessageSection &&
    ticketEnabled &&
    hasUnsavedChanges &&
    !isSaving &&
    !showSaveSuccessBar &&
    isTicketMessageLayoutInvalid;
  const showInvalidWelcomeSaveState =
    isWelcomeMessageSection &&
    welcomeEnabled &&
    hasUnsavedChanges &&
    !isSaving &&
    !showSaveSuccessBar &&
    isWelcomeMessageLayoutInvalid;
  const showSaveBarSuccessState =
    showSaveSuccessBar &&
    !hasUnsavedChanges &&
    !isSaving;
  const showBlockedNavigationSaveState =
    showNavigationBlockedSaveState &&
    hasUnsavedChanges &&
    !isSaving &&
    !showSaveSuccessBar;
  const showSaveBarErrorState =
    showInvalidTicketSaveState ||
    showInvalidWelcomeSaveState ||
    showBlockedNavigationSaveState;
  const saveActionVisualEnabled = canPersistSettings || isSaving;
  const floatingSaveBarTitle = showSaveBarSuccessState
    ? "Configuracoes salvas com sucesso."
    : isSaving
    ? "Salvando alteracoes do servidor..."
    : errorMessage
      ? "Nao foi possivel salvar agora"
      : showInvalidTicketSaveState
        ? hasTooManyFunctionButtons
          ? "Existe mais de um botao funcional no embed"
          : "Nao da para salvar uma mensagem vazia"
      : showInvalidWelcomeSaveState
          ? "Adicione pelo menos um conteudo na mensagem"
      : showBlockedNavigationSaveState
          ? "Salve as alteracoes antes de sair desta secao."
          : !canPersistSettings && hasUnsavedChanges
            ? isSecuritySection
              ? isAntiLinkSection
                ? "Defina o canal de log para continuar"
                : "Ative eventos validos e defina o canal de cada log ligado"
              : isWelcomeSection
              ? "Complete os canais de entrada e saida para continuar"
              : "Complete os campos obrigatorios para continuar"
            : "Cuidado — voce tem alteracoes que nao foram salvas!";
  const floatingSaveBarDescription = showSaveBarSuccessState
    ? "Tudo ficou sincronizado e o painel ja esta atualizado para a equipe."
    : isSaving
    ? "Estamos sincronizando canais e cargos deste servidor com o painel."
      : errorMessage
      ? errorMessage
      : showInvalidTicketSaveState
        ? hasTooManyFunctionButtons
          ? "Deixe apenas um botao funcional para abrir o ticket. Botoes de link podem continuar em quantidade livre."
          : "Adicione pelo menos um conteudo com texto e uma acao no builder antes de salvar. Enquanto a mensagem estiver sem nada, essa barra continua em alerta."
        : showInvalidWelcomeSaveState
          ? "Preencha a mensagem de entrada ou saida com pelo menos um bloco de texto."
        : showBlockedNavigationSaveState
          ? "Voce tentou trocar de opcao na sidebar com mudancas pendentes. Salve ou redefina antes de continuar."
        : !canPersistSettings && hasUnsavedChanges
          ? isSecuritySection
            ? isAntiLinkSection
              ? "Escolha um canal de log para o modulo anti-link."
              : "Todo evento ligado precisa ter um canal de log configurado."
            : isWelcomeSection
            ? "Defina canais publicos e privados para entrada e saida antes de salvar."
            : "Preencha todos os campos de ticket e staff para liberar o salvamento."
          : "Revise os campos abaixo e confirme para manter a operacao deste servidor atualizada.";

  useEffect(() => {
    setIsPortalMounted(true);
  }, []);

  useEffect(() => {
    setIsStaffCardCollapsed(true);
  }, [guildId]);

  useEffect(() => {
    if (hasUnsavedChanges && successMessage) {
      setSuccessMessage(null);
    }
    if (hasUnsavedChanges && showSaveSuccessBar) {
      setShowSaveSuccessBar(false);
    }
  }, [hasUnsavedChanges, showSaveSuccessBar, successMessage]);

  useEffect(() => {
    if (typeof onUnsavedChangesChange === "function") {
      onUnsavedChangesChange(hasUnsavedChanges);
    }
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(() => {
    return () => {
      if (typeof onUnsavedChangesChange === "function") {
        onUnsavedChangesChange(false);
      }
    };
  }, [onUnsavedChangesChange]);

  useEffect(() => {
    if (!navigationBlockSignal) return;
    if (!hasUnsavedChanges || isSaving || showSaveSuccessBar) return;
    if (activeTab !== "settings") return;

    setShowNavigationBlockedSaveState(true);
    if (navigationBlockedFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(navigationBlockedFeedbackTimeoutRef.current);
    }
    navigationBlockedFeedbackTimeoutRef.current = window.setTimeout(() => {
      setShowNavigationBlockedSaveState(false);
      navigationBlockedFeedbackTimeoutRef.current = null;
    }, 2800);
  }, [
    activeTab,
    hasUnsavedChanges,
    isSaving,
    navigationBlockSignal,
    showSaveSuccessBar,
  ]);

  useEffect(() => {
    if (!hasUnsavedChanges || isSaving || showSaveSuccessBar) {
      setShowNavigationBlockedSaveState(false);
    }
  }, [hasUnsavedChanges, isSaving, showSaveSuccessBar]);

  useEffect(() => {
    return () => {
      if (navigationBlockedFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(navigationBlockedFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showSaveSuccessBar) return;

    const timeoutId = window.setTimeout(() => {
      setShowSaveSuccessBar(false);
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [showSaveSuccessBar]);

  const activeWelcomeLayout =
    welcomeMessageTab === "entry" ? entryLayout : exitLayout;
  const activeWelcomeThumbnailMode =
    welcomeMessageTab === "entry" ? entryThumbnailMode : exitThumbnailMode;
  const activeWelcomeThumbnailPreviewUrl =
    activeWelcomeThumbnailMode === "avatar"
      ? "/cdn/icons/discord-icon.svg"
      : null;

  const handleWelcomeLayoutChange = useCallback(
    (nextLayout: TicketPanelLayout) => {
      if (welcomeMessageTab === "entry") {
        setEntryLayout(nextLayout);
        return;
      }
      setExitLayout(nextLayout);
    },
    [welcomeMessageTab],
  );

  const handleWelcomeThumbnailModeChange = useCallback(
    (mode: WelcomeThumbnailMode) => {
      if (welcomeMessageTab === "entry") {
        setEntryThumbnailMode(mode);
        return;
      }
      setExitThumbnailMode(mode);
    },
    [welcomeMessageTab],
  );

  useEffect(() => {
    if (showFloatingSaveBar) {
      setIsSaveBarRendered(true);
      setIsSaveBarExiting(false);
      return;
    }

    if (!isSaveBarRendered) return;

    setIsSaveBarExiting(true);
    const timeoutId = window.setTimeout(() => {
      setIsSaveBarRendered(false);
      setIsSaveBarExiting(false);
    }, 260);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isSaveBarRendered, showFloatingSaveBar]);

  const persistPlanSettings = useCallback(
    async (input: {
      recurringEnabled: boolean;
      recurringMethodId: string | null;
      successMessage: string;
    }) => {
      if (isViewerOnly) {
        setPlanSuccess(null);
        setPlanError(financialViewerMessage);
        return null;
      }

      if (isPlanSaving) return null;

      setIsPlanSaving(true);
      setPlanError(null);
      setPlanSuccess(null);

      try {
        const response = await fetch("/api/auth/me/servers/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            recurringEnabled: input.recurringEnabled,
            recurringMethodId: input.recurringMethodId,
          }),
        });
        const payload = (await response.json()) as PlanApiResponse;

        if (!response.ok || !payload.ok || !payload.plan) {
          throw new Error(payload.message || "Falha ao atualizar recorrencia.");
        }

        setPlanSettings(payload.plan);
        setPlanSuccess(input.successMessage);
        return payload.plan;
      } catch (error) {
        setPlanError(
          error instanceof Error
            ? error.message
            : "Erro ao atualizar recorrencia.",
        );
        return null;
      } finally {
        setIsPlanSaving(false);
      }
    },
    [financialViewerMessage, guildId, isPlanSaving, isViewerOnly],
  );

  const handleToggleRecurring = useCallback(async () => {
    if (isViewerOnly) {
      setPlanSuccess(null);
      setPlanError(financialViewerMessage);
      return;
    }

    if (!planSettings || isPlanSaving) return;

    if (planSettings.recurringEnabled) {
      setIsRecurringMethodModalOpen(false);
      setRecurringMethodDraftId(null);
      setShouldEnableRecurringAfterMethodAdd(false);
      await persistPlanSettings({
        recurringEnabled: false,
        recurringMethodId: null,
        successMessage: "Cobranca recorrente desativada com sucesso.",
      });
      return;
    }

    if (!cardPaymentsEnabled) {
      setPlanSuccess(null);
      setPlanError(CARD_RECURRING_DISABLED_MESSAGE);
      return;
    }

    const fallbackMethodId =
      planSettings.recurringMethodId || recurringMethodOptions[0]?.id || null;

    if (!fallbackMethodId) {
      setPlanError(
        "Salve um cartao verificado para ativar a cobranca recorrente deste servidor.",
      );
      setPlanSuccess(null);
      openAddMethodModal({ enableRecurringAfterAdd: true });
      return;
    }

    if (recurringMethodOptions.length > 1) {
      setPlanError(null);
      setPlanSuccess(null);
      setRecurringMethodDraftId(fallbackMethodId);
      setIsRecurringMethodModalOpen(true);
      return;
    }

    await persistPlanSettings({
      recurringEnabled: true,
      recurringMethodId: fallbackMethodId,
      successMessage: "Cobranca recorrente ativada com sucesso.",
    });
  }, [
    cardPaymentsEnabled,
    isPlanSaving,
    openAddMethodModal,
    persistPlanSettings,
    planSettings,
    recurringMethodOptions,
    financialViewerMessage,
    isViewerOnly,
  ]);

  const handleRenewByPix = useCallback(() => {
    if (isViewerOnly) {
      setPlanSuccess(null);
      setPlanError(financialViewerMessage);
      return;
    }

    const params = new URLSearchParams({
      guild: guildId,
      method: "pix",
      renew: "1",
      return: "servers",
      returnGuild: guildId,
      returnTab: "plans",
    });

    window.location.assign(`/config?${params.toString()}#/payment`);
  }, [financialViewerMessage, guildId, isViewerOnly]);

  const handleDeleteMethod = useCallback(
    async (methodId: string) => {
      if (deletingMethodId) return;

      setDeletingMethodId(methodId);
      setMethodActionMessage(null);
      setOpenMethodMenuId(null);
      setPaymentsError(null);

      try {
        const response = await fetch("/api/auth/me/payments/methods", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            methodId,
          }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          message?: string;
        };

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Falha ao remover metodo.");
        }

        setMethods((current) => current.filter((method) => method.id !== methodId));
        setMethodActionMessage("Metodo removido com sucesso.");
        setMethodNicknameDrafts((current) => {
          const next = { ...current };
          delete next[methodId];
          return next;
        });
        setPlanSettings((current) =>
          current
            ? {
                ...current,
                availableMethods: (current.availableMethods || []).filter(
                  (method) => method.id !== methodId,
                ),
              }
            : current,
        );

        if (planSettings?.recurringMethodId === methodId) {
          setPlanSettings((current) =>
            current
              ? {
                  ...current,
                  recurringMethodId: null,
                  recurringMethod: null,
                }
              : current,
          );
        }
      } catch (error) {
        setPaymentsError(
          error instanceof Error
            ? error.message
            : "Erro ao remover metodo de pagamento.",
        );
      } finally {
        setDeletingMethodId(null);
      }
    },
    [deletingMethodId, guildId, planSettings?.recurringMethodId],
  );

  const handleSaveMethodNickname = useCallback(
    async (methodId: string) => {
      if (savingMethodNicknameId) return;

      const nickname = (methodNicknameDrafts[methodId] || "").trim();
      setSavingMethodNicknameId(methodId);
      setPaymentsError(null);
      setMethodActionMessage(null);

      try {
        const response = await fetch("/api/auth/me/payments/methods", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            methodId,
            nickname,
          }),
        });
        const payload = (await response.json()) as {
          ok: boolean;
          message?: string;
          method?: SavedMethod;
        };

        if (!response.ok || !payload.ok || !payload.method) {
          throw new Error(payload.message || "Falha ao salvar apelido.");
        }

        setMethods((current) =>
          current.map((method) =>
            method.id === methodId ? { ...method, nickname: payload.method?.nickname || null } : method,
          ),
        );
        setPlanSettings((current) =>
          current
            ? {
                ...current,
                recurringMethod:
                  current.recurringMethodId === methodId && current.recurringMethod
                    ? {
                        ...current.recurringMethod,
                        nickname: payload.method?.nickname || null,
                      }
                    : current.recurringMethod,
                availableMethods: (current.availableMethods || []).map((method) =>
                  method.id === methodId
                    ? {
                        ...method,
                        nickname: payload.method?.nickname || null,
                      }
                    : method,
                ),
              }
            : current,
        );
        setMethodActionMessage("Apelido salvo com sucesso.");
      } catch (error) {
        setPaymentsError(
          error instanceof Error
            ? error.message
            : "Erro ao salvar apelido do cartao.",
        );
      } finally {
        setSavingMethodNicknameId(null);
      }
    },
    [guildId, methodNicknameDrafts, savingMethodNicknameId],
  );

  const handleAddMethodSubmit = useCallback(async () => {
    if (!addMethodCanSubmit || isAddingMethod || isAddMethodSdkLoading) {
      setAddMethodTouchedFields({
        cardNumber: true,
        holderName: true,
        expiry: true,
        cvv: true,
        document: true,
        nickname: true,
      } satisfies Record<AddMethodFieldKey, boolean>);
      setAddMethodFlowState("idle");
      setAddMethodStatusMessage(null);
      setAddMethodError("Revise os campos destacados para continuar.");
      return;
    }
    if (
      addMethodClientCooldownUntil &&
      Date.now() < addMethodClientCooldownUntil
    ) {
      const remainingMessage = formatCooldownMessage(
        Math.max(
          1,
          Math.ceil((addMethodClientCooldownUntil - Date.now()) / 1000),
        ),
      );
      setAddMethodFlowState("rejected");
      setAddMethodStatusMessage("Nova tentativa bloqueada temporariamente.");
      setAddMethodError(
        remainingMessage ||
          "Aguarde alguns instantes para validar este cartao novamente.",
      );
      return;
    }

    const holderName = addMethodForm.holderName.trim().replace(/\s+/g, " ");
    const documentType = resolveBrazilDocumentType(addMethodDocumentDigits);
    const publicKey = resolveCardPublicKey();
    const fallbackPaymentMethodId =
      resolveCardPaymentMethodIdFromBrand(addMethodCardBrand);

    if (!documentType) {
      setAddMethodError("CPF/CNPJ invalido para validar o cartao.");
      return;
    }

    if (!publicKey) {
      setAddMethodError(
        "Chave publica do Mercado Pago nao configurada para validar o cartao.",
      );
      return;
    }

    if (!fallbackPaymentMethodId) {
      setAddMethodError("Nao foi possivel identificar a bandeira do cartao.");
      return;
    }

    setIsAddingMethod(true);
    setAddMethodError(null);
    setMethodActionMessage(null);
    setPaymentsError(null);
    setAddMethodFlowState("validating");
    setAddMethodStatusMessage(
      isAddMethodSdkReady
        ? "Salvando o cartao no cofre seguro do Mercado Pago..."
        : "Preparando o ambiente seguro do cartao...",
    );

    try {
      await loadMercadoPagoSdk();

      if (!isAddMethodSdkReady) {
        setIsAddMethodSdkReady(true);
      }

      try {
        await loadMercadoPagoSecuritySdk();
      } catch {
        setAddMethodStatusMessage(
          "Continuando com a validacao reforcada do cartao...",
        );
      }

      if (!window.MercadoPago) {
        throw new Error("SDK do Mercado Pago indisponivel para validar o cartao.");
      }

      const mercadoPago = new window.MercadoPago(publicKey, {
        locale: "pt-BR",
      });
      const deviceSessionId = resolveMercadoPagoDeviceSessionId();
      let requestId: string | null = null;

      let tokenPayload: MercadoPagoCardTokenPayload;
      try {
        setAddMethodStatusMessage("Protegendo e tokenizando os dados do cartao...");
        tokenPayload = await mercadoPago.createCardToken({
          cardNumber: addMethodCardDigits,
          cardholderName: holderName,
          identificationType: documentType,
          identificationNumber: addMethodDocumentDigits,
          securityCode: addMethodCvvDigits,
          cardExpirationMonth: addMethodExpiryDigits.slice(0, 2),
          cardExpirationYear: `20${addMethodExpiryDigits.slice(2, 4)}`,
          ...(deviceSessionId
            ? {
                device: {
                  id: deviceSessionId,
                },
              }
            : {}),
        });
      } catch (tokenizationError) {
        throw new Error(
          parseUnknownErrorMessage(tokenizationError) ||
            "Falha ao tokenizar o cartao para salvamento seguro.",
        );
      }

      const cardToken = tokenPayload?.id?.trim() || null;
      if (!cardToken) {
        throw new Error(
          parseMercadoPagoCardTokenError(tokenPayload) ||
            "Falha ao tokenizar o cartao.",
        );
      }

      const paymentMethodId =
        tokenPayload?.payment_method_id?.trim()?.toLowerCase() ||
        fallbackPaymentMethodId;
      const issuerId =
        tokenPayload?.issuer_id !== undefined &&
        tokenPayload?.issuer_id !== null &&
        String(tokenPayload.issuer_id).trim()
          ? String(tokenPayload.issuer_id).trim()
          : null;

      const expMonth = Number(addMethodExpiryDigits.slice(0, 2));
      const expYear = Number(addMethodExpiryDigits.slice(2, 4)) + 2000;
      const nickname = addMethodForm.nickname.trim().replace(/\s+/g, " ");

      setAddMethodStatusMessage(
        "Registrando o cartao no cofre seguro do Mercado Pago...",
      );
      const response = await fetch("/api/auth/me/payments/methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          brand: addMethodCardBrand,
          firstSix: addMethodCardDigits.slice(0, 6),
          lastFour: addMethodCardDigits.slice(-4),
          expMonth: Number.isInteger(expMonth) ? expMonth : null,
          expYear: Number.isInteger(expYear) ? expYear : null,
          nickname,
          payerName: holderName,
          payerDocument: addMethodDocumentDigits,
          cardToken,
          paymentMethodId,
          issuerId,
          deviceSessionId,
        }),
      });
      requestId = resolveResponseRequestId(response);

      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        retryAfterSeconds?: number;
        method?: SavedMethod;
        alreadyVerified?: boolean;
        vaulted?: boolean;
        verification?: {
          amount?: number;
          currency?: string;
        };
      };
      const retryAfterSeconds = resolveRetryAfterSeconds(response, payload);

      if (!response.ok || !payload.ok || !payload.method) {
        if (retryAfterSeconds) {
          setAddMethodClientCooldownUntil(
            Date.now() + retryAfterSeconds * 1000,
          );
        }
        throw new Error(
          withSupportRequestId(
            payload.message || "Falha ao adicionar metodo.",
            requestId,
          ),
        );
      }

      const addedMethod = payload.method;
      const shouldAutoEnableRecurring = shouldEnableRecurringAfterMethodAdd;

      setMethods((current) => {
        const methodExists = current.some((method) => method.id === addedMethod.id);
        if (methodExists) {
          return current.map((method) =>
            method.id === addedMethod.id ? { ...method, ...addedMethod } : method,
          );
        }
        return [addedMethod as SavedMethod, ...current];
      });

      setMethodNicknameDrafts((current) => ({
        ...current,
        [addedMethod.id]: addedMethod.nickname || "",
      }));
      setPlanSettings((current) => {
        if (!current) return current;
        const currentMethods = current.availableMethods || [];
        const exists = currentMethods.some((method) => method.id === addedMethod.id);
        const nextMethods = exists
          ? currentMethods.map((method) =>
              method.id === addedMethod.id
                ? {
                    ...method,
                    ...addedMethod,
                  }
                : method,
            )
          : [
              {
                id: addedMethod.id,
                brand: addedMethod.brand,
                firstSix: addedMethod.firstSix,
                lastFour: addedMethod.lastFour,
                expMonth: addedMethod.expMonth,
                expYear: addedMethod.expYear,
                lastUsedAt: addedMethod.lastUsedAt,
                timesUsed: addedMethod.timesUsed ?? 0,
                nickname: addedMethod.nickname || null,
                verificationStatus: addedMethod.verificationStatus,
                verificationStatusDetail: addedMethod.verificationStatusDetail,
                verificationAmount: addedMethod.verificationAmount,
                verifiedAt: addedMethod.verifiedAt,
                lastContextGuildId: addedMethod.lastContextGuildId,
              },
              ...currentMethods,
            ];

        return {
          ...current,
          availableMethods: nextMethods,
          availableMethodsCount: nextMethods.length,
        };
      });

      setAddMethodForm({
        cardNumber: "",
        holderName: "",
        expiry: "",
        cvv: "",
        document: "",
        nickname: "",
      });
      setAddMethodTouchedFields(createAddMethodTouchedFields());
      setAddMethodClientCooldownUntil(null);
      setAddMethodClientCooldownRemainingSeconds(null);
      setMethodSearch("");
      setMethodStatusFilter("all");
      setMethodGuildFilter(guildId);
      setAddMethodFlowState("approved");
      setMethodActionMessage(
        payload.alreadyVerified
          ? "Cartao reativado com sucesso."
          : payload.vaulted
            ? "Cartao salvo com sucesso no cofre seguro do Mercado Pago."
            : "Cartao salvo com sucesso.",
      );
      setAddMethodStatusMessage(
        payload.alreadyVerified
          ? "Cartao reconhecido e liberado para uso."
          : "Cartao salvo e liberado para uso no sistema.",
      );
      setShouldEnableRecurringAfterMethodAdd(false);
      await new Promise((resolve) => setTimeout(resolve, 900));
      setIsAddMethodModalOpen(false);

      if (shouldAutoEnableRecurring) {
        await persistPlanSettings({
          recurringEnabled: true,
          recurringMethodId: addedMethod.id,
          successMessage:
            "Cobranca recorrente ativada com sucesso com o novo cartao.",
        });
      }
    } catch (error) {
      setAddMethodFlowState("rejected");
      setAddMethodStatusMessage(
        "Nao foi possivel concluir o salvamento seguro deste cartao.",
      );
      setAddMethodError(
        parseUnknownErrorMessage(error) ||
          "Erro ao adicionar metodo de pagamento.",
      );
    } finally {
      setIsAddingMethod(false);
    }
  }, [
    addMethodCanSubmit,
    addMethodCardBrand,
    addMethodCardDigits,
    addMethodCvvDigits,
    addMethodDocumentDigits,
    addMethodExpiryDigits,
    addMethodForm.holderName,
    addMethodForm.nickname,
    persistPlanSettings,
    guildId,
    isAddMethodSdkLoading,
    isAddMethodSdkReady,
    isAddingMethod,
    addMethodClientCooldownUntil,
    shouldEnableRecurringAfterMethodAdd,
  ]);

  const handleSelectRecurringMethod = useCallback(
    async (methodId: string) => {
      if (isViewerOnly) {
        setPlanSuccess(null);
        setPlanError(financialViewerMessage);
        return;
      }

      if (!planSettings || isPlanSaving) return;
      if (!methodId) return;
      if (!cardPaymentsEnabled) {
        setPlanSuccess(null);
        setPlanError(CARD_RECURRING_DISABLED_MESSAGE);
        return;
      }

      const savedPlan = await persistPlanSettings({
        recurringEnabled: planSettings.recurringEnabled,
        recurringMethodId: methodId,
        successMessage: "Cartao da recorrencia atualizado com sucesso.",
      });

      if (savedPlan) {
        setIsRecurringMethodModalOpen(false);
      }
    },
    [
      cardPaymentsEnabled,
      financialViewerMessage,
      isPlanSaving,
      isViewerOnly,
      persistPlanSettings,
      planSettings,
    ],
  );

  const handleConfirmRecurringActivation = useCallback(async () => {
    if (isViewerOnly) {
      setPlanSuccess(null);
      setPlanError(financialViewerMessage);
      return;
    }

    if (!cardPaymentsEnabled) {
      setPlanSuccess(null);
      setPlanError(CARD_RECURRING_DISABLED_MESSAGE);
      return;
    }

    if (!recurringMethodDraftId) {
      setPlanError(
        "Escolha um cartao valido para ativar a cobranca recorrente.",
      );
      return;
    }

    const savedPlan = await persistPlanSettings({
      recurringEnabled: true,
      recurringMethodId: recurringMethodDraftId,
      successMessage: "Cobranca recorrente ativada com sucesso.",
    });

    if (savedPlan) {
      setIsRecurringMethodModalOpen(false);
    }
  }, [
    cardPaymentsEnabled,
    financialViewerMessage,
    isViewerOnly,
    persistPlanSettings,
    recurringMethodDraftId,
  ]);

  const handleResetSettings = useCallback(() => {
    if (!canResetSettings) return;

    if (isAntiLinkSection && savedAntiLinkSettingsDraft) {
      setAntiLinkEnabled(savedAntiLinkSettingsDraft.enabled);
      setAntiLinkLogChannelId(savedAntiLinkSettingsDraft.logChannelId);
      setAntiLinkEnforcementAction(savedAntiLinkSettingsDraft.enforcementAction);
      setAntiLinkTimeoutMinutes(savedAntiLinkSettingsDraft.timeoutMinutes);
      setAntiLinkIgnoredRoleIds(savedAntiLinkSettingsDraft.ignoredRoleIds);
      setAntiLinkBlockExternalLinks(savedAntiLinkSettingsDraft.blockExternalLinks);
      setAntiLinkBlockDiscordInvites(savedAntiLinkSettingsDraft.blockDiscordInvites);
      setAntiLinkBlockObfuscatedLinks(savedAntiLinkSettingsDraft.blockObfuscatedLinks);
    } else if (isAutoRoleSection && savedAutoRoleSettingsDraft) {
      setAutoRoleEnabled(savedAutoRoleSettingsDraft.enabled);
      setAutoRoleRoleIds(savedAutoRoleSettingsDraft.roleIds);
      setAutoRoleAssignmentDelayMinutes(
        savedAutoRoleSettingsDraft.assignmentDelayMinutes,
      );
      setAutoRoleSyncExistingMembers(false);
    } else if (isSecurityLogsSection && savedSecurityLogsDraft) {
      setSecurityLogsDraft(savedSecurityLogsDraft);
    } else if (isWelcomeSection && savedWelcomeSettingsDraft) {
      setWelcomeEnabled(savedWelcomeSettingsDraft.enabled);
      setEntryPublicChannelId(savedWelcomeSettingsDraft.entryPublicChannelId);
      setEntryLogChannelId(savedWelcomeSettingsDraft.entryLogChannelId);
      setExitPublicChannelId(savedWelcomeSettingsDraft.exitPublicChannelId);
      setExitLogChannelId(savedWelcomeSettingsDraft.exitLogChannelId);
      setEntryLayout(savedWelcomeSettingsDraft.entryLayout);
      setExitLayout(savedWelcomeSettingsDraft.exitLayout);
      setEntryThumbnailMode(savedWelcomeSettingsDraft.entryThumbnailMode);
      setExitThumbnailMode(savedWelcomeSettingsDraft.exitThumbnailMode);
    } else if (savedSettingsDraft) {
      setTicketEnabled(savedSettingsDraft.enabled);
      setMenuChannelId(savedSettingsDraft.menuChannelId);
      setTicketsCategoryId(savedSettingsDraft.ticketsCategoryId);
      setLogsCreatedChannelId(savedSettingsDraft.logsCreatedChannelId);
      setLogsClosedChannelId(savedSettingsDraft.logsClosedChannelId);
      setPanelLayout(savedSettingsDraft.panelLayout);
      setAdminRoleId(savedSettingsDraft.adminRoleId);
      setClaimRoleIds(savedSettingsDraft.claimRoleIds);
      setCloseRoleIds(savedSettingsDraft.closeRoleIds);
      setNotifyRoleIds(savedSettingsDraft.notifyRoleIds);
    } else {
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
  }, [
    canResetSettings,
    isAntiLinkSection,
    isAutoRoleSection,
    isSecurityLogsSection,
    isWelcomeSection,
    savedAntiLinkSettingsDraft,
    savedAutoRoleSettingsDraft,
    savedSecurityLogsDraft,
    savedSettingsDraft,
    savedWelcomeSettingsDraft,
  ]);

  const handleSave = useCallback(async () => {
    if (!canPersistSettings) return;
    if (isTicketSection && ticketEnabled && !adminRoleId) return;
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (isAutoRoleSection) {
        const response = await fetch("/api/auth/me/guilds/autorole-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            enabled: autoRoleEnabled,
            roleIds: autoRoleRoleIds,
            assignmentDelayMinutes: autoRoleAssignmentDelayValue,
            syncExistingMembers: autoRoleSyncExistingMembers,
          }),
        });

        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(
            payload.message || "Falha ao salvar configuracoes de autorole.",
          );
        }

        if (payload.settings) {
          setAutoRoleEnabled(Boolean(payload.settings.enabled));
          setAutoRoleRoleIds(
            Array.isArray(payload.settings.roleIds)
              ? payload.settings.roleIds.filter((id: unknown): id is string => typeof id === "string")
              : [],
          );
          setAutoRoleAssignmentDelayMinutes(
            normalizeAutoRoleAssignmentDelayMinutes(
              payload.settings.assignmentDelayMinutes,
            ),
          );
          setAutoRoleSyncStatus(
            payload.settings.syncStatus === "pending" ||
              payload.settings.syncStatus === "processing" ||
              payload.settings.syncStatus === "completed" ||
              payload.settings.syncStatus === "failed"
              ? payload.settings.syncStatus
              : "idle",
          );
          setAutoRoleSyncRequestedAt(payload.settings.syncRequestedAt || null);
          setAutoRoleSyncStartedAt(payload.settings.syncStartedAt || null);
          setAutoRoleSyncCompletedAt(payload.settings.syncCompletedAt || null);
          setAutoRoleSyncError(payload.settings.syncError || null);
        }

        setAutoRoleSyncExistingMembers(false);
        setSavedAutoRoleSettingsDraft(currentAutoRoleDraft);
      } else if (isAntiLinkSection) {
        const response = await fetch("/api/auth/me/guilds/antilink-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            enabled: antiLinkEnabled,
            logChannelId: antiLinkLogChannelId,
            enforcementAction: antiLinkEnforcementAction,
            timeoutMinutes: antiLinkTimeoutValue,
            ignoredRoleIds: antiLinkIgnoredRoleIds,
            blockExternalLinks: ANTILINK_DEFAULT_DETECTION.blockExternalLinks,
            blockDiscordInvites: ANTILINK_DEFAULT_DETECTION.blockDiscordInvites,
            blockObfuscatedLinks: ANTILINK_DEFAULT_DETECTION.blockObfuscatedLinks,
          }),
        });

        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(
            payload.message || "Falha ao salvar configuracoes de seguranca.",
          );
        }

        setSavedAntiLinkSettingsDraft(currentAntiLinkDraft);
      } else if (isSecurityLogsSection) {
        const response = await fetch(
          "/api/auth/me/guilds/security-logs-settings",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guildId,
              enabled: currentSecurityLogsDraft.enabled,
              useDefaultChannel: currentSecurityLogsDraft.useDefaultChannel,
              defaultChannelId: currentSecurityLogsDraft.defaultChannelId,
              events: currentSecurityLogsDraft.events,
            }),
          },
        );

        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(
            payload.message ||
              "Falha ao salvar configuracoes de logs de seguranca.",
          );
        }

        setSavedSecurityLogsDraft(currentSecurityLogsDraft);
      } else if (isWelcomeSection) {
        const response = await fetch("/api/auth/me/guilds/welcome-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            enabled: welcomeEnabled,
            entryPublicChannelId,
            entryLogChannelId,
            exitPublicChannelId,
            exitLogChannelId,
            entryLayout,
            exitLayout,
            entryThumbnailMode,
            exitThumbnailMode,
          }),
        });

        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "Falha ao salvar canais de entrada e saida.");
        }

        setSavedWelcomeSettingsDraft(currentWelcomeDraft);
      } else {
        const shouldPersistTicketStaff =
          ticketEnabled ||
          Boolean(
            adminRoleId &&
              claimRoleIds.length &&
              closeRoleIds.length &&
              notifyRoleIds.length,
          );
        const ticketRes = await fetch("/api/auth/me/guilds/ticket-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId,
            enabled: ticketEnabled,
            menuChannelId,
            ticketsCategoryId,
            logsCreatedChannelId,
            logsClosedChannelId,
            panelLayout,
          }),
        });

        const ticket = await ticketRes.json();
        if (!ticketRes.ok || !ticket.ok) {
          throw new Error(ticket.message || "Falha ao salvar canais.");
        }

        let nextStaffSettings = {
          adminRoleId: savedSettingsDraft?.adminRoleId ?? null,
          claimRoleIds: savedSettingsDraft?.claimRoleIds ?? [],
          closeRoleIds: savedSettingsDraft?.closeRoleIds ?? [],
          notifyRoleIds: savedSettingsDraft?.notifyRoleIds ?? [],
        };

        if (shouldPersistTicketStaff) {
          const staffRes = await fetch("/api/auth/me/guilds/ticket-staff-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guildId,
              adminRoleId,
              claimRoleIds,
              closeRoleIds,
              notifyRoleIds,
            }),
          });

          const staff = await staffRes.json();
          if (!staffRes.ok || !staff.ok) {
            throw new Error(staff.message || "Falha ao salvar staff.");
          }

          nextStaffSettings = {
            adminRoleId:
              typeof staff.settings?.adminRoleId === "string"
                ? staff.settings.adminRoleId
                : null,
            claimRoleIds: Array.isArray(staff.settings?.claimRoleIds)
              ? staff.settings.claimRoleIds
              : [],
            closeRoleIds: Array.isArray(staff.settings?.closeRoleIds)
              ? staff.settings.closeRoleIds
              : [],
            notifyRoleIds: Array.isArray(staff.settings?.notifyRoleIds)
              ? staff.settings.notifyRoleIds
              : [],
          };
        }

        const nextSavedTicketDraft = normalizeServerSettingsDraft({
          enabled: ticket.settings?.enabled === true,
          menuChannelId:
            typeof ticket.settings?.menuChannelId === "string"
              ? ticket.settings.menuChannelId
              : null,
          ticketsCategoryId:
            typeof ticket.settings?.ticketsCategoryId === "string"
              ? ticket.settings.ticketsCategoryId
              : null,
          logsCreatedChannelId:
            typeof ticket.settings?.logsCreatedChannelId === "string"
              ? ticket.settings.logsCreatedChannelId
              : null,
          logsClosedChannelId:
            typeof ticket.settings?.logsClosedChannelId === "string"
              ? ticket.settings.logsClosedChannelId
              : null,
          panelLayout: normalizeTicketPanelLayout(
            ticket.settings?.panelLayout,
            ticket.settings || undefined,
          ),
          adminRoleId: nextStaffSettings.adminRoleId,
          claimRoleIds: nextStaffSettings.claimRoleIds,
          closeRoleIds: nextStaffSettings.closeRoleIds,
          notifyRoleIds: nextStaffSettings.notifyRoleIds,
        });

        setTicketEnabled(nextSavedTicketDraft.enabled);
        setMenuChannelId(nextSavedTicketDraft.menuChannelId);
        setTicketsCategoryId(nextSavedTicketDraft.ticketsCategoryId);
        setLogsCreatedChannelId(nextSavedTicketDraft.logsCreatedChannelId);
        setLogsClosedChannelId(nextSavedTicketDraft.logsClosedChannelId);
        setPanelLayout(nextSavedTicketDraft.panelLayout);
        setAdminRoleId(nextSavedTicketDraft.adminRoleId);
        setClaimRoleIds(nextSavedTicketDraft.claimRoleIds);
        setCloseRoleIds(nextSavedTicketDraft.closeRoleIds);
        setNotifyRoleIds(nextSavedTicketDraft.notifyRoleIds);
        setSavedSettingsDraft(nextSavedTicketDraft);
      }

      setSuccessMessage("Configuracoes salvas com sucesso.");
      setShowSaveSuccessBar(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Erro ao salvar configuracoes.");
    } finally {
      setIsSaving(false);
    }
  }, [
    antiLinkEnabled,
    antiLinkEnforcementAction,
    antiLinkIgnoredRoleIds,
    antiLinkLogChannelId,
    antiLinkTimeoutValue,
    autoRoleAssignmentDelayValue,
    autoRoleEnabled,
    autoRoleRoleIds,
    autoRoleSyncExistingMembers,
    adminRoleId,
    canPersistSettings,
    claimRoleIds,
    closeRoleIds,
    currentAntiLinkDraft,
    currentAutoRoleDraft,
    currentWelcomeDraft,
    entryLayout,
    entryLogChannelId,
    entryPublicChannelId,
    entryThumbnailMode,
    exitLayout,
    exitLogChannelId,
    exitPublicChannelId,
    exitThumbnailMode,
    guildId,
    isAntiLinkSection,
    isAutoRoleSection,
    isSecurityLogsSection,
    isTicketSection,
    isWelcomeSection,
    logsClosedChannelId,
    logsCreatedChannelId,
    menuChannelId,
    notifyRoleIds,
    panelLayout,
    savedSettingsDraft,
    setSavedAntiLinkSettingsDraft,
    setSavedAutoRoleSettingsDraft,
    setSavedSecurityLogsDraft,
    setSavedSettingsDraft,
    setSavedWelcomeSettingsDraft,
    ticketEnabled,
    ticketsCategoryId,
    welcomeEnabled,
    currentSecurityLogsDraft,
  ]);

  const handleSendEmbed = useCallback(async () => {
    if (!canSendEmbed || !menuChannelId) return;
    if (isSendingEmbedRef.current) return;
    isSendingEmbedRef.current = true;

    setIsSendingEmbed(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/me/guilds/ticket-panel-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          menuChannelId,
          panelLayout,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Falha ao enviar o embed do ticket.");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Erro ao enviar o embed do ticket.",
      );
    } finally {
      isSendingEmbedRef.current = false;
      setIsSendingEmbed(false);
    }
  }, [canSendEmbed, guildId, menuChannelId, panelLayout]);

  const handleActivateWelcome = useCallback(async () => {
    if (isActivatingWelcome || settingsReadOnly) return;
    setIsActivatingWelcome(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const fallbackChannelId = textChannelOptions[0]?.id ?? null;
    const nextEntryPublicId = entryPublicChannelId || fallbackChannelId;
    const nextEntryLogId = entryLogChannelId || fallbackChannelId;
    const nextExitPublicId = exitPublicChannelId || fallbackChannelId;
    const nextExitLogId = exitLogChannelId || fallbackChannelId;

    if (!nextEntryPublicId || !nextExitPublicId) {
      setErrorMessage(
        "Escolha pelo menos um canal de texto antes de ativar o modulo.",
      );
      setIsActivatingWelcome(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/me/guilds/welcome-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          enabled: true,
          entryPublicChannelId: nextEntryPublicId,
          entryLogChannelId: nextEntryLogId,
          exitPublicChannelId: nextExitPublicId,
          exitLogChannelId: nextExitLogId,
          entryLayout,
          exitLayout,
          entryThumbnailMode,
          exitThumbnailMode,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Falha ao ativar o modulo.");
      }

      setWelcomeEnabled(true);
      setEntryPublicChannelId(nextEntryPublicId);
      setEntryLogChannelId(nextEntryLogId);
      setExitPublicChannelId(nextExitPublicId);
      setExitLogChannelId(nextExitLogId);
      setSavedWelcomeSettingsDraft(
        normalizeWelcomeSettingsDraft({
          enabled: true,
          entryPublicChannelId: nextEntryPublicId,
          entryLogChannelId: nextEntryLogId,
          exitPublicChannelId: nextExitPublicId,
          exitLogChannelId: nextExitLogId,
          entryLayout,
          exitLayout,
          entryThumbnailMode,
          exitThumbnailMode,
        }),
      );
      setShowSaveSuccessBar(true);
      setSuccessMessage("Modulo ativado com sucesso.");
      setIsWelcomeActivationModalOpen(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Erro ao ativar o modulo.",
      );
    } finally {
      setIsActivatingWelcome(false);
    }
  }, [
    entryLayout,
    entryLogChannelId,
    entryPublicChannelId,
    entryThumbnailMode,
    exitLayout,
    exitLogChannelId,
    exitPublicChannelId,
    exitThumbnailMode,
    guildId,
    isActivatingWelcome,
    settingsReadOnly,
    textChannelOptions,
  ]);

  const handleActivateAntiLink = useCallback(async () => {
    if (isActivatingAntiLink || settingsReadOnly) return;

    setIsActivatingAntiLink(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const fallbackLogChannelId = textChannelOptions[0]?.id ?? null;
    const nextLogChannelId = antiLinkLogChannelId || fallbackLogChannelId;

    if (!nextLogChannelId) {
      setErrorMessage(
        "Escolha pelo menos um canal de texto antes de ativar o modulo.",
      );
      setIsActivatingAntiLink(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/me/guilds/antilink-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          enabled: true,
          logChannelId: nextLogChannelId,
          enforcementAction: antiLinkEnforcementAction,
          timeoutMinutes: antiLinkTimeoutValue,
          ignoredRoleIds: antiLinkIgnoredRoleIds,
          blockExternalLinks: ANTILINK_DEFAULT_DETECTION.blockExternalLinks,
          blockDiscordInvites: ANTILINK_DEFAULT_DETECTION.blockDiscordInvites,
          blockObfuscatedLinks: ANTILINK_DEFAULT_DETECTION.blockObfuscatedLinks,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Falha ao ativar o modulo.");
      }

      setAntiLinkEnabled(true);
      setAntiLinkLogChannelId(nextLogChannelId);
      setSavedAntiLinkSettingsDraft(
        normalizeAntiLinkSettingsDraft({
          enabled: true,
          logChannelId: nextLogChannelId,
          enforcementAction: antiLinkEnforcementAction,
          timeoutMinutes: antiLinkTimeoutValue,
          ignoredRoleIds: antiLinkIgnoredRoleIds,
          blockExternalLinks: ANTILINK_DEFAULT_DETECTION.blockExternalLinks,
          blockDiscordInvites: ANTILINK_DEFAULT_DETECTION.blockDiscordInvites,
          blockObfuscatedLinks: ANTILINK_DEFAULT_DETECTION.blockObfuscatedLinks,
        }),
      );
      setShowSaveSuccessBar(true);
      setSuccessMessage("Modulo AntiLink ativado com sucesso.");
      setIsAntiLinkActivationModalOpen(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Erro ao ativar o modulo.",
      );
    } finally {
      setIsActivatingAntiLink(false);
    }
  }, [
    antiLinkEnforcementAction,
    antiLinkIgnoredRoleIds,
    antiLinkLogChannelId,
    antiLinkTimeoutValue,
    guildId,
    isActivatingAntiLink,
    settingsReadOnly,
    textChannelOptions,
  ]);

  const activeSecurityLogModalOption = useMemo(
    () =>
      activeSecurityLogModalEvent
        ? SECURITY_LOG_EVENT_OPTIONS.find(
            (option) => option.key === activeSecurityLogModalEvent,
          ) || null
        : null,
    [activeSecurityLogModalEvent],
  );

  const handleToggleSecurityLogEvent = useCallback(
    (eventKey: SecurityLogEventKey) => {
      if (securityLogsControlsDisabled) return;

      const isEnablingEvent = !securityLogsDraft.events[eventKey].enabled;
      setSecurityLogsDraft((current) => ({
        ...current,
        events: {
          ...current.events,
          [eventKey]: {
            ...current.events[eventKey],
            enabled: !current.events[eventKey].enabled,
          },
        },
      }));

      if (isEnablingEvent && !securityLogsDraft.useDefaultChannel) {
        setActiveSecurityLogModalEvent(eventKey);
        return;
      }

      if (!isEnablingEvent && activeSecurityLogModalEvent === eventKey) {
        setActiveSecurityLogModalEvent(null);
      }
    },
    [
      activeSecurityLogModalEvent,
      securityLogsControlsDisabled,
      securityLogsDraft.events,
      securityLogsDraft.useDefaultChannel,
    ],
  );

  const handleSelectSecurityLogChannel = useCallback(
    (eventKey: SecurityLogEventKey, channelId: string | null) => {
      if (securityLogsPerEventChannelControlsDisabled) return;
      setSecurityLogsDraft((current) => ({
        ...current,
        events: {
          ...current.events,
          [eventKey]: {
            ...current.events[eventKey],
            channelId,
          },
        },
      }));
    },
    [securityLogsPerEventChannelControlsDisabled],
  );

  const handleToggleSecurityLogsModule = useCallback(() => {
    if (securityLogsModuleControlsDisabled) return;
    setSecurityLogsDraft((current) => ({
      ...current,
      enabled: !current.enabled,
    }));
  }, [securityLogsModuleControlsDisabled]);

  const handleToggleSecurityLogsDefaultChannel = useCallback(() => {
    if (securityLogsControlsDisabled) return;
    setSecurityLogsDraft((current) => ({
      ...current,
      useDefaultChannel: !current.useDefaultChannel,
    }));
  }, [securityLogsControlsDisabled]);

  const handleSelectSecurityLogsDefaultChannel = useCallback(
    (channelId: string | null) => {
      if (securityLogsControlsDisabled) return;
      setSecurityLogsDraft((current) => ({
        ...current,
        defaultChannelId: channelId,
      }));
    },
    [securityLogsControlsDisabled],
  );

  const handleCloseSecurityLogModal = useCallback(() => {
    if (!activeSecurityLogModalEvent) return;

    setSecurityLogsDraft((current) => {
      if (!current.enabled || current.useDefaultChannel) {
        return current;
      }

      const eventDraft = current.events[activeSecurityLogModalEvent];
      if (!eventDraft.enabled || eventDraft.channelId) {
        return current;
      }

      return {
        ...current,
        events: {
          ...current.events,
          [activeSecurityLogModalEvent]: {
            ...eventDraft,
            enabled: false,
          },
        },
      };
    });

    setActiveSecurityLogModalEvent(null);
  }, [activeSecurityLogModalEvent]);

  useEffect(() => {
    if (
      activeSecurityLogModalEvent &&
      (!securityLogsDraft.enabled || securityLogsDraft.useDefaultChannel)
    ) {
      setActiveSecurityLogModalEvent(null);
    }
  }, [
    activeSecurityLogModalEvent,
    securityLogsDraft.enabled,
    securityLogsDraft.useDefaultChannel,
  ]);

  useEffect(() => {
    setIsAntiLinkActivationModalOpen(false);
  }, [
    antiLinkEnabled,
    hasDismissedAntiLinkModal,
    hasLoadedDashboardSnapshot,
    isLoading,
    isAntiLinkSection,
    savedAntiLinkSettingsDraft,
  ]);

  return (
    <ClientErrorBoundary
      fallback={
        <section
          className="flowdesk-fade-up-soft"
          style={{
            marginTop: standalone ? "0px" : `${serversScale.cardsTopSpacing}px`,
          }}
        >
          <div className="rounded-[24px] border border-[#161616] bg-[#090909] px-[22px] py-[28px] text-center">
            <div>
              <p className="text-[16px] text-[#D8D8D8]">
                Nao foi possivel carregar as configuracoes deste servidor.
              </p>
              <p className="mt-2 text-[12px] text-[#8E8E8E]">
                Atualize a pagina para tentar novamente.
              </p>
            </div>
          </div>
        </section>
      }
    >
      <section
        className="flowdesk-fade-up-soft relative"
        style={{
          marginTop: standalone ? "0px" : `${serversScale.cardsTopSpacing}px`,
        }}
      >
      <div className="overflow-x-hidden overflow-y-visible">
        <div
          className="flex w-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${TAB_INDEX[activeTab] * 100}%)` }}
        >
          <div className="min-w-0 w-full shrink-0">
            {shouldShowBlockingSkeleton ? (
              <ServerSettingsEditorSkeleton standalone />
            ) : (
              <>
                {isLoading ? (
                  <div className="mb-[10px] inline-flex items-center rounded-full border border-[#1C1C1C] bg-[#0C0C0C] px-[12px] py-[6px] text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
                    Atualizando dados do servidor...
                  </div>
                ) : null}
                <div className={`space-y-[18px] ${showFloatingSaveBar ? "pb-[112px]" : ""} ${isLoading ? "pointer-events-none opacity-[0.78]" : ""}`}>
                  {settingsSection === "overview" ? (
                    <div className="space-y-[14px]">
                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">
                              Modulo Ticket
                            </p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Mantenha a central de atendimento em operacao
                            </h3>
                            <p className="mt-[10px] max-w-[760px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              O Flowdesk libera painel, abertura de tickets, logs e permissoes quando o modulo estiver ativo.
                            </p>
                          </div>

                          <DashboardInlineSwitch
                            checked={ticketEnabled}
                            onChange={() => {
                              if (isSaving || settingsReadOnly) return;
                              setTicketEnabled((current) => !current);
                            }}
                            disabled={isSaving || settingsReadOnly}
                            ariaLabel="Ativar ou desativar modulo de tickets"
                          />
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[12px] lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Ticket</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Canais e logs
                            </h3>
                            <p className="mt-[10px] max-w-[720px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Defina o canal principal, a categoria dos tickets e os logs que sustentam a operacao do servidor.
                            </p>
                          </div>
                        </div>

                        <div className="mt-[18px] grid grid-cols-1 gap-[16px] xl:grid-cols-2">
                          <ConfigStepSelect label="Canal do menu principal de tickets" placeholder="Escolha o canal" options={textChannelOptions} value={menuChannelId} onChange={setMenuChannelId} disabled={ticketControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                          <ConfigStepSelect label="Categoria onde os tickets serao abertos" placeholder="Escolha uma categoria" options={categoryOptions} value={ticketsCategoryId} onChange={setTicketsCategoryId} disabled={ticketControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                          <ConfigStepSelect label="Canal de logs de criacao" placeholder="Escolha o canal de logs" options={textChannelOptions} value={logsCreatedChannelId} onChange={setLogsCreatedChannelId} disabled={ticketControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                          <ConfigStepSelect label="Canal de logs de fechamento" placeholder="Escolha o canal de logs" options={textChannelOptions} value={logsClosedChannelId} onChange={setLogsClosedChannelId} disabled={ticketControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <button
                          type="button"
                          onClick={() => setIsStaffCardCollapsed((current) => !current)}
                          className="group flex w-full items-start justify-between gap-[16px] text-left"
                          aria-expanded={!isStaffCardCollapsed}
                          aria-controls="server-staff-settings-panel"
                        >
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Ticket</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Permissoes e cargos
                            </h3>
                            <p className="mt-[10px] max-w-[720px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Controle quem administra, assume, fecha e recebe notificacoes dos tickets dentro do painel.
                            </p>
                          </div>

                          <span className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[14px] border border-[#1A1A1A] bg-[#0D0D0D] text-[#B9B9B9] transition-colors duration-200 group-hover:border-[#2A2A2A] group-hover:bg-[#111111] group-hover:text-[#F0F0F0]">
                            <svg
                              viewBox="0 0 20 20"
                              aria-hidden="true"
                              className={`h-[18px] w-[18px] transition-transform duration-300 ease-out ${
                                isStaffCardCollapsed ? "rotate-0" : "rotate-180"
                              }`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.1"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M5.5 7.75 10 12.25l4.5-4.5" />
                            </svg>
                          </span>
                        </button>

                        {!isStaffCardCollapsed ? (
                          <div
                            id="server-staff-settings-panel"
                            className="mt-[18px] flowdesk-fade-up-soft"
                          >
                            <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-2">
                              <ConfigStepSelect label="Cargo administrador do ticket" placeholder="Escolha o cargo" options={roleOptions} value={adminRoleId} onChange={setAdminRoleId} disabled={ticketControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                              <ConfigStepMultiSelect label="Cargos que podem assumir tickets" placeholder="Escolha os cargos" options={roleOptions} values={claimRoleIds} onChange={setClaimRoleIds} disabled={ticketControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                              <ConfigStepMultiSelect label="Cargos que podem fechar tickets" placeholder="Escolha os cargos" options={roleOptions} values={closeRoleIds} onChange={setCloseRoleIds} disabled={ticketControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                              <ConfigStepMultiSelect label="Cargos que podem enviar notificacao" placeholder="Escolha os cargos" options={roleOptions} values={notifyRoleIds} onChange={setNotifyRoleIds} disabled={ticketControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : settingsSection === "message" ? (
                    <TicketMessageBuilder
                      guildId={guildId}
                      value={panelLayout}
                      onChange={setPanelLayout}
                      disabled={
                        isSaving ||
                        isSendingEmbed ||
                        settingsReadOnly ||
                        !ticketEnabled
                      }
                      canSendEmbed={canSendEmbed}
                      isSendingEmbed={isSendingEmbed}
                      onSendEmbed={handleSendEmbed}
                    />
                  ) : settingsSection === "entry_exit_overview" ? (
                    <div className="space-y-[14px]">
                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">
                              Mensagem Entrada/Saida
                            </p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Automatize recepcao e despedida do servidor
                            </h3>
                            <p className="mt-[10px] max-w-[760px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              O Flowdesk envia a mensagem publica, registra logs privados e libera o builder quando o modulo estiver ativo.
                            </p>
                          </div>

                          <DashboardInlineSwitch
                            checked={welcomeEnabled}
                            onChange={() => {
                              if (isSaving || settingsReadOnly) return;
                              setWelcomeEnabled((current) => !current);
                            }}
                            disabled={isSaving || settingsReadOnly}
                            ariaLabel="Ativar ou desativar modulo de entrada e saida"
                          />
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[12px] lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Mensagem Entrada/Saida</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Canais e logs de entrada
                            </h3>
                            <p className="mt-[10px] max-w-[720px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Escolha onde a mensagem publica aparece e qual canal privado recebe o log de entrada.
                            </p>
                          </div>
                          <span className="inline-flex h-[30px] items-center justify-center rounded-full border border-[#151515] bg-[#0B0B0B] px-[12px] text-[11px] uppercase tracking-[0.16em] text-[#686868]">
                            Entrada
                          </span>
                        </div>

                        <div className="mt-[18px] grid grid-cols-1 gap-[16px] xl:grid-cols-2">
                          <ConfigStepSelect label="Canal de entrada publico" placeholder="Escolha o canal" options={textChannelOptions} value={entryPublicChannelId} onChange={setEntryPublicChannelId} disabled={welcomeControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                          <ConfigStepSelect label="Log privado de entrada" placeholder="Escolha o canal de log" options={textChannelOptions} value={entryLogChannelId} onChange={setEntryLogChannelId} disabled={welcomeControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[12px] lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Mensagem Entrada/Saida</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Canais e logs de saida
                            </h3>
                            <p className="mt-[10px] max-w-[720px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Defina o canal publico de saida e o log privado para eventos de desligamento.
                            </p>
                          </div>
                          <span className="inline-flex h-[30px] items-center justify-center rounded-full border border-[#151515] bg-[#0B0B0B] px-[12px] text-[11px] uppercase tracking-[0.16em] text-[#686868]">
                            Saida
                          </span>
                        </div>

                        <div className="mt-[18px] grid grid-cols-1 gap-[16px] xl:grid-cols-2">
                          <ConfigStepSelect label="Canal de saida publico" placeholder="Escolha o canal" options={textChannelOptions} value={exitPublicChannelId} onChange={setExitPublicChannelId} disabled={welcomeControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                          <ConfigStepSelect label="Log privado de saida" placeholder="Escolha o canal de log" options={textChannelOptions} value={exitLogChannelId} onChange={setExitLogChannelId} disabled={welcomeControlsDisabled} controlHeightPx={serverSettingsControlHeight} />
                        </div>
                      </div>
                    </div>
                  ) : settingsSection === "security_antilink" ? (
                    <div className="space-y-[14px]">
                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">
                              Modulo AntiLink
                            </p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Proteja o servidor automaticamente
                            </h3>
                            <p className="mt-[10px] max-w-[760px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              O Flowdesk bloqueia links externos, convites do Discord e tentativas de ofuscacao sempre que o evento acontecer.
                            </p>
                          </div>

                          <DashboardInlineSwitch
                            checked={antiLinkEnabled}
                            onChange={() => {
                              if (isSaving || settingsReadOnly) return;
                              setHasDismissedAntiLinkModal(true);
                              setAntiLinkEnabled((current) => !current);
                            }}
                            disabled={isSaving || settingsReadOnly}
                            ariaLabel="Ativar ou desativar modulo AntiLink"
                          />
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[12px] lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Configuracao AntiLink</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Canal, acao e excecoes
                            </h3>
                            <p className="mt-[10px] max-w-[760px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Escolha onde os bloqueios serao registrados, qual acao adicional entra depois da remocao da mensagem e quais cargos ficam fora da regra.
                            </p>
                          </div>
                        </div>

                        <div className="mt-[18px] grid grid-cols-1 gap-[16px] xl:grid-cols-2">
                          <ConfigStepSelect
                            label="Canal de log do AntiLink"
                            placeholder="Escolha o canal para logs"
                            options={textChannelOptions}
                            value={antiLinkLogChannelId}
                            onChange={setAntiLinkLogChannelId}
                            disabled={antiLinkControlsDisabled}
                            controlHeightPx={serverSettingsControlHeight}
                          />
                          <ConfigStepSelect
                            label="Acao adicional apos apagar mensagem"
                            placeholder="Escolha a acao"
                            options={ANTILINK_ACTION_OPTIONS}
                            value={antiLinkEnforcementAction}
                            onChange={(value) =>
                              setAntiLinkEnforcementAction(
                                normalizeAntiLinkEnforcementAction(value),
                              )
                            }
                            disabled={antiLinkControlsDisabled}
                            controlHeightPx={serverSettingsControlHeight}
                          />
                        </div>

                        {antiLinkEnforcementAction === "timeout" ? (
                          <div className="mt-[16px] rounded-[18px] border border-[#161616] bg-[#0A0A0A] px-[14px] py-[14px]">
                            <label
                              htmlFor="anti-link-timeout-minutes"
                              className="block text-[12px] uppercase tracking-[0.16em] text-[#676767]"
                            >
                              Tempo de silencio (minutos)
                            </label>
                            <input
                              id="anti-link-timeout-minutes"
                              type="number"
                              min={1}
                              max={10080}
                              value={antiLinkTimeoutValue}
                              onChange={(event) => {
                                const raw = Number(event.currentTarget.value);
                                setAntiLinkTimeoutMinutes(
                                  Number.isFinite(raw) ? Math.trunc(raw) : 10,
                                );
                              }}
                              disabled={antiLinkControlsDisabled}
                              className="mt-[10px] h-[48px] w-full rounded-[14px] border border-[#171717] bg-[#080808] px-[12px] text-[14px] text-[#E2E2E2] outline-none transition-colors placeholder:text-[#4F4F4F] focus:border-[#262626] disabled:cursor-not-allowed disabled:opacity-60"
                              placeholder="Exemplo: 10"
                            />
                          </div>
                        ) : null}

                        <div className="mt-[16px]">
                          <ConfigStepMultiSelect
                            label="Ignorar cargos (opcional)"
                            placeholder="Selecione cargos que nao passam pelo anti-link"
                            options={roleOptions}
                            values={antiLinkIgnoredRoleIds}
                            onChange={setAntiLinkIgnoredRoleIds}
                            disabled={antiLinkControlsDisabled}
                            controlHeightPx={serverSettingsControlHeight}
                          />
                        </div>
                      </div>
                    </div>
                  ) : settingsSection === "security_autorole" ? (
                    <div className="space-y-[14px]">
                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">
                              Modulo AutoRole
                            </p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Aplique cargos automaticamente
                            </h3>
                            <p className="mt-[10px] max-w-[760px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Selecione cargos para o bot adicionar em novos membros e, se quiser, sincronize quem ja esta no servidor.
                            </p>
                          </div>

                          <DashboardInlineSwitch
                            checked={autoRoleEnabled}
                            onChange={() => {
                              if (isSaving || settingsReadOnly) return;
                              setAutoRoleEnabled((current) => {
                                const next = !current;
                                if (!next) {
                                  setAutoRoleSyncExistingMembers(false);
                                }
                                return next;
                              });
                            }}
                            disabled={isSaving || settingsReadOnly}
                            ariaLabel="Ativar ou desativar modulo AutoRole"
                          />
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[12px] lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">
                              Configuracao AutoRole
                            </p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Cargos, tempo e sincronizacao
                            </h3>
                            <p className="mt-[10px] max-w-[760px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              O bot precisa ter permissao de gerenciar cargos e estar acima (na hierarquia) dos cargos selecionados.
                            </p>
                          </div>
                        </div>

                        <div className="mt-[18px] grid grid-cols-1 gap-[16px] xl:grid-cols-2">
                          <ConfigStepMultiSelect
                            label="Cargos para adicionar"
                            placeholder="Escolha os cargos"
                            options={roleOptions}
                            values={autoRoleRoleIds}
                            onChange={setAutoRoleRoleIds}
                            disabled={autoRoleControlsDisabled}
                            controlHeightPx={serverSettingsControlHeight}
                          />
                          <ConfigStepSelect
                            label="Quando adicionar"
                            placeholder="Escolha o tempo"
                            options={AUTOROLE_DELAY_OPTIONS}
                            value={String(autoRoleAssignmentDelayValue)}
                            onChange={(value) => {
                              const raw = Number(value);
                              setAutoRoleAssignmentDelayMinutes(
                                normalizeAutoRoleAssignmentDelayMinutes(
                                  Number.isFinite(raw) ? raw : 0,
                                ),
                              );
                            }}
                            disabled={autoRoleControlsDisabled}
                            controlHeightPx={serverSettingsControlHeight}
                          />
                        </div>

                        <div className="mt-[16px] space-y-[12px]">
                          <label
                            className={`flex items-start gap-[12px] rounded-[16px] border px-[14px] py-[12px] transition-colors ${
                              autoRoleSyncExistingMembers
                                ? "border-[rgba(0,98,255,0.32)] bg-[rgba(0,98,255,0.08)]"
                                : "border-[#141414] bg-[#0A0A0A] hover:border-[#1F1F1F] hover:bg-[#0D0D0D]"
                            } ${
                              autoRoleSyncExistingMembersDisabled
                                ? "cursor-not-allowed opacity-60 hover:border-[#141414] hover:bg-[#0A0A0A]"
                                : "cursor-pointer"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={autoRoleSyncExistingMembers}
                              onChange={(event) =>
                                setAutoRoleSyncExistingMembers(
                                  event.currentTarget.checked,
                                )
                              }
                              disabled={autoRoleSyncExistingMembersDisabled}
                              className="hidden"
                            />
                            <span
                              className={`mt-[1px] inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border ${
                                autoRoleSyncExistingMembers
                                  ? "border-[#0062FF] bg-[#0062FF]"
                                  : "border-[#303030] bg-[#111111]"
                              }`}
                            >
                              {autoRoleSyncExistingMembers ? (
                                <span className="h-[6px] w-[6px] rounded-full bg-white" />
                              ) : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[14px] leading-none font-medium text-[#E8E8E8]">
                                Adicionar tambem para membros atuais (em massa)
                              </span>
                              <span className="mt-[6px] block text-[12px] leading-[1.55] text-[#6B6B6B]">
                                Ao salvar, o bot tenta adicionar esses cargos em quem ja esta no servidor e ainda nao possui.
                              </span>
                            </span>
                          </label>

                          <div className="rounded-[16px] border border-[#141414] bg-[#0A0A0A] px-[14px] py-[12px]">
                            <p className="text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                              Status da sincronizacao
                            </p>
                            <p className="mt-[8px] text-[13px] leading-[1.6] text-[#7B7B7B]">
                              {autoRoleSyncStatus === "pending"
                                ? `Em fila desde ${formatDateTime(autoRoleSyncRequestedAt)}.`
                                : autoRoleSyncStatus === "processing"
                                  ? `Processando desde ${formatDateTime(autoRoleSyncStartedAt)}.`
                                  : autoRoleSyncStatus === "completed"
                                    ? `Concluido em ${formatDateTime(autoRoleSyncCompletedAt)}.`
                                    : autoRoleSyncStatus === "failed"
                                      ? "Falhou. Veja o erro abaixo."
                                      : "Nenhuma sincronizacao em andamento."}
                            </p>
                            {autoRoleSyncStatus === "failed" && autoRoleSyncError ? (
                              <p className="mt-[8px] text-[12px] leading-[1.55] text-[#D98A8A]">
                                {autoRoleSyncError}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : settingsSection === "security_logs" ? (
                    <>
                      <div className="space-y-[14px]">
                        <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                          <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">
                                Seguranca
                              </p>
                              <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                                Logs de Seguranca
                              </h3>
                              <p className="mt-[10px] max-w-[760px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                                Organize apelidos, mensagens, voz e moderacao com cards individuais. Cada evento pode ser ligado de forma separada e configurado em um canal proprio.
                              </p>
                            </div>

                            <DashboardInlineSwitch
                              checked={securityLogsDraft.enabled}
                              onChange={handleToggleSecurityLogsModule}
                              disabled={securityLogsModuleControlsDisabled}
                              ariaLabel="Ativar ou desativar modulo de logs de seguranca"
                            />
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                          <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
                            <div>
                              <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">
                                Logs de Seguranca
                              </p>
                              <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                                Canal padrao
                              </h3>
                              <p className="mt-[10px] max-w-[760px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                                Quando ativado, todos os eventos usam um unico canal. Os canais isolados de cada card ficam pausados ate voce desligar essa opcao.
                              </p>
                            </div>

                            <DashboardInlineSwitch
                              checked={securityLogsDraft.useDefaultChannel}
                              onChange={handleToggleSecurityLogsDefaultChannel}
                              disabled={securityLogsControlsDisabled}
                              ariaLabel="Ativar ou desativar canal padrao dos logs de seguranca"
                            />
                          </div>

                          <div className="mt-[18px] grid grid-cols-1 gap-[16px] xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                            <ConfigStepSelect
                              label="Canal padrao dos logs"
                              placeholder="Escolha um canal para todos os eventos"
                              options={textChannelOptions}
                              value={securityLogsDraft.defaultChannelId}
                              onChange={handleSelectSecurityLogsDefaultChannel}
                              disabled={securityLogsControlsDisabled || !securityLogsDraft.useDefaultChannel}
                              controlHeightPx={serverSettingsControlHeight}
                            />

                            <span className="inline-flex h-[32px] items-center justify-center rounded-full border border-[#151515] bg-[#0B0B0B] px-[12px] text-[11px] uppercase tracking-[0.16em] text-[#686868]">
                              {securityLogsDraft.useDefaultChannel
                                ? "Canal unico"
                                : "Canais isolados"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-[14px]">
                        {SECURITY_LOG_EVENT_OPTIONS.map((option) => {
                          const eventDraft = securityLogsDraft.events[option.key];
                          const isolatedChannelLabel =
                            textChannelOptions.find(
                              (channel) => channel.id === eventDraft.channelId,
                            )?.name || null;
                          const defaultChannelLabel =
                            textChannelOptions.find(
                              (channel) =>
                                channel.id === securityLogsDraft.defaultChannelId,
                            )?.name || null;
                          const resolvedChannelLabel = securityLogsDraft.useDefaultChannel
                            ? defaultChannelLabel
                            : isolatedChannelLabel;
                          const showChannelWarning =
                            securityLogsDraft.enabled &&
                            eventDraft.enabled &&
                            (securityLogsDraft.useDefaultChannel
                              ? !securityLogsDraft.defaultChannelId
                              : !eventDraft.channelId);
                          const EventIcon = option.icon;

                          return (
                            <div
                              key={option.key}
                              className={`rounded-[22px] border bg-[linear-gradient(180deg,#0D0D0D_0%,#090909_100%)] px-[16px] py-[16px] shadow-[inset_0_1px_0_rgba(255,255,255,0.015)] transition-colors sm:px-[18px] sm:py-[18px] ${
                                eventDraft.enabled
                                  ? "border-[#242424]"
                                  : "border-[#171717]"
                              }`}
                            >
                              <div className="flex flex-col gap-[14px] xl:flex-row xl:items-center xl:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start gap-[12px]">
                                    <span
                                      className={`inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[16px] text-[11px] font-semibold tracking-[0.14em] transition-colors ${
                                        eventDraft.enabled
                                          ? "bg-[#F3F3F3] text-[#080808]"
                                          : "bg-[#101010] text-[#6E6E6E]"
                                      }`}
                                    >
                                      <EventIcon size={16} strokeWidth={2.1} />
                                    </span>

                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-[8px]">
                                        <p className="text-[15px] font-medium tracking-[-0.03em] text-[#E6E6E6]">
                                          {option.title}
                                        </p>
                                        <div className="relative">
                                          <button
                                            type="button"
                                            aria-label={`Ajuda sobre ${option.title}`}
                                            onMouseEnter={() =>
                                              setOpenSecurityLogTooltipKey(option.key)
                                            }
                                            onMouseLeave={() =>
                                              setOpenSecurityLogTooltipKey((current) =>
                                                current === option.key ? null : current,
                                              )
                                            }
                                            onFocus={() =>
                                              setOpenSecurityLogTooltipKey(option.key)
                                            }
                                            onBlur={() =>
                                              setOpenSecurityLogTooltipKey((current) =>
                                                current === option.key ? null : current,
                                              )
                                            }
                                            className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#111111] text-[#808080] transition-colors hover:bg-[#171717] hover:text-[#E0E0E0]"
                                          >
                                            <CircleHelp size={13} strokeWidth={2.2} />
                                          </button>
                                          <div
                                            className={`pointer-events-none absolute left-0 top-full z-30 mt-[10px] w-[280px] rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(9,9,9,0.98)] p-[12px] text-[12px] leading-[1.5] text-[rgba(218,218,218,0.84)] shadow-[0_18px_40px_rgba(0,0,0,0.45)] transition-all duration-150 ${
                                              openSecurityLogTooltipKey === option.key
                                                ? "translate-y-0 opacity-100"
                                                : "translate-y-[-4px] opacity-0"
                                            }`}
                                          >
                                            {option.tooltip}
                                          </div>
                                        </div>
                                      </div>

                                      <p className="mt-[6px] max-w-[760px] text-[13px] leading-[1.6] text-[#7A7A7A]">
                                        {option.description}
                                      </p>

                                      <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
                                        <span className="inline-flex items-center rounded-full bg-[#0A0A0A] px-[10px] py-[6px] text-[11px] uppercase tracking-[0.12em] text-[#696969]">
                                          Canal: {resolvedChannelLabel || "nao definido"}
                                        </span>
                                        {securityLogsDraft.useDefaultChannel ? (
                                          <span className="inline-flex items-center rounded-full bg-[rgba(0,98,255,0.12)] px-[10px] py-[6px] text-[11px] uppercase tracking-[0.12em] text-[#8DB9FF]">
                                            Canal padrao
                                          </span>
                                        ) : null}
                                        {showChannelWarning ? (
                                          <span className="inline-flex items-center rounded-full bg-[rgba(73,24,24,0.42)] px-[10px] py-[6px] text-[11px] uppercase tracking-[0.12em] text-[#D09B9B]">
                                            Canal pendente
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex shrink-0 items-center justify-end gap-[10px] xl:min-w-[126px]">
                                  <button
                                    type="button"
                                    onClick={() => setActiveSecurityLogModalEvent(option.key)}
                                    disabled={securityLogsPerEventChannelControlsDisabled}
                                    className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-[14px] bg-[#101010] text-[#8C8C8C] transition-colors hover:bg-[#171717] hover:text-[#F0F0F0] disabled:cursor-not-allowed disabled:opacity-55"
                                    aria-label={`Configurar canal para ${option.title}`}
                                  >
                                    <Settings2 size={16} strokeWidth={2.1} />
                                  </button>

                                  <DashboardInlineSwitch
                                    checked={eventDraft.enabled}
                                    onChange={() => handleToggleSecurityLogEvent(option.key)}
                                    disabled={securityLogsControlsDisabled}
                                    ariaLabel={`Ativar ou desativar ${option.title}`}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {hasInvalidSecurityLogsDefaultChannel ? (
                        <p className="text-[12px] leading-[1.55] text-[#D7A0A0]">
                          Defina o canal padrao antes de salvar os logs com canal unico.
                        </p>
                      ) : hasInvalidSecurityLogChannel ? (
                        <p className="text-[12px] leading-[1.55] text-[#D7A0A0]">
                          Um ou mais eventos ligados ainda nao possuem canal configurado.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className="rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px]">
                        <div className="flex flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">Mensagem Entrada/Saida</p>
                            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#D1D1D1]">
                              Configure o embed de entrada e saida
                            </h3>
                            <p className="mt-[10px] max-w-[720px] text-[14px] leading-[1.6] text-[#7B7B7B]">
                              Personalize as mensagens automaticas e use variaveis para mencionar o usuario, o convite e o servidor.
                            </p>
                          </div>

                          <div className="inline-flex items-center rounded-full border border-[#151515] bg-[#0B0B0B] p-[4px]">
                            {(["entry", "exit"] as const).map((tab) => {
                              const isActive = welcomeMessageTab === tab;
                              return (
                                <button
                                  key={tab}
                                  type="button"
                                  onClick={() => setWelcomeMessageTab(tab)}
                                  disabled={welcomeControlsDisabled}
                                  className={`rounded-full px-[16px] py-[8px] text-[12px] font-medium uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                    isActive
                                      ? "bg-[#1E1E1E] text-[#F0F0F0]"
                                      : "text-[#7A7A7A] hover:text-[#DADADA]"
                                  }`}
                                >
                                  {tab === "entry" ? "Entrada" : "Saida"}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="mt-[18px] grid grid-cols-1 gap-[16px] lg:grid-cols-[1.2fr_1fr]">
                          <div className="rounded-[18px] border border-[#161616] bg-[#0A0A0A] px-[16px] py-[14px]">
                            <p className="text-[12px] uppercase tracking-[0.16em] text-[#6D6D6D]">
                              Variaveis disponiveis
                            </p>
                            <div className="mt-[12px] grid grid-cols-1 gap-[8px] sm:grid-cols-2">
                              {WELCOME_VARIABLES.map((variable) => (
                                <div
                                  key={variable.token}
                                  className="rounded-[12px] border border-[#141414] bg-[#070707] px-[12px] py-[10px]"
                                >
                                  <p className="text-[13px] font-semibold text-[#E2E2E2]">
                                    {variable.token}
                                  </p>
                                  <p className="mt-[4px] text-[12px] leading-[1.5] text-[#6F6F6F]">
                                    {variable.description}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-[18px] border border-[#161616] bg-[#0A0A0A] px-[16px] py-[14px]">
                            <p className="text-[12px] uppercase tracking-[0.16em] text-[#6D6D6D]">
                              Miniatura do embed
                            </p>
                            <p className="mt-[8px] text-[13px] leading-[1.55] text-[#7A7A7A]">
                              Escolha se a miniatura usa o link informado no embed ou a foto do usuario automaticamente.
                            </p>
                            <div className="mt-[14px] flex flex-col gap-[10px]">
                              {(["custom", "avatar"] as const).map((mode) => {
                                const isActive = activeWelcomeThumbnailMode === mode;
                                return (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() => handleWelcomeThumbnailModeChange(mode)}
                                    disabled={welcomeControlsDisabled}
                                    className={`flex items-center justify-between rounded-[14px] border px-[12px] py-[10px] text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                      isActive
                                        ? "border-[#2A2A2A] bg-[#121212] text-[#F0F0F0]"
                                        : "border-[#141414] bg-[#0B0B0B] text-[#8A8A8A] hover:text-[#D8D8D8]"
                                    }`}
                                  >
                                    <span>
                                      {mode === "custom"
                                        ? "Usar link manual"
                                        : "Usar foto do usuario"}
                                    </span>
                                    <span className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border ${isActive ? "border-[#6AE25A] bg-[#6AE25A]" : "border-[#2A2A2A]"}`}>
                                      {isActive ? (
                                        <span className="text-[10px] font-semibold text-black">OK</span>
                                      ) : null}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>

                      <TicketMessageBuilder
                        guildId={guildId}
                        value={activeWelcomeLayout}
                        onChange={handleWelcomeLayoutChange}
                        disabled={welcomeControlsDisabled}
                        canSendEmbed={false}
                        isSendingEmbed={false}
                        onSendEmbed={undefined}
                        eyebrow={
                          welcomeMessageTab === "entry"
                            ? "Mensagem de entrada"
                            : "Mensagem de saida"
                        }
                        headline={
                          welcomeMessageTab === "entry"
                            ? "Monte a recepcao do servidor"
                            : "Confirme a saida com clareza"
                        }
                        description="O Flowdesk envia este embed automaticamente quando o evento acontecer."
                        hideSendButton
                        thumbnailPreviewUrl={activeWelcomeThumbnailPreviewUrl}
                      />
                    </>
                  )}

                  {showInlineMessages ? (
                    <div className="pt-[2px]">
                      <div className="max-w-[720px] space-y-[8px]">
                        {isViewerOnly ? (
                          <p className="text-[12px] leading-[1.55] text-[#8CC2FF]">
                            {viewerOnlyMessage}
                          </p>
                        ) : null}
                        {locked ? (
                          <p className="text-[12px] leading-[1.55] text-[#C2C2C2]">
                            Plano da conta expirado ou bot desligado neste servidor. Regularize o pagamento ou ajuste o plano da conta para liberar alteracoes novamente.
                          </p>
                        ) : null}
                        {errorMessage ? (
                          <p className="text-[12px] leading-[1.55] text-[#D98A8A]">
                            {errorMessage}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>

          <div className="min-w-0 w-full shrink-0 pl-0 min-[860px]:pl-[8px]">
            <div className="grid grid-cols-1 gap-3 min-[980px]:grid-cols-[1fr_auto_auto]">
              <input
                type="text"
                value={paymentSearch}
                onChange={(event) => setPaymentSearch(event.currentTarget.value)}
                disabled={isViewerOnly}
                placeholder="Pesquisar pagamento por ID, servidor ou metodo"
                className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] placeholder:text-[#3A3A3A] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px]"
              />
              <select value={paymentGuildFilter} onChange={(event) => setPaymentGuildFilter(event.currentTarget.value)} disabled={isViewerOnly} className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px] min-[980px]:min-w-[238px]">
                {serverOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <select value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.currentTarget.value as "all" | PaymentStatus)} disabled={isViewerOnly} className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px] min-[980px]:min-w-[213px]">
                <option value="all">Todos status</option>
                <option value="approved">Pago</option>
                <option value="pending">Pendente</option>
                <option value="expired">Expirado</option>
                <option value="cancelled">Cancelado</option>
                <option value="rejected">Rejeitado</option>
                <option value="failed">Falhou</option>
              </select>
            </div>

            <div className="mt-4 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A]">
              {isViewerOnly ? (
                <p className="px-4 py-8 text-center text-[15px] text-[#C2C2C2]">
                  {financialViewerMessage}
                </p>
              ) : isPaymentsLoading ? (
                <div className="flex h-[275px] items-center justify-center">
                  <ButtonLoader size={28} />
                </div>
              ) : paymentsError ? (
                <p className="px-4 py-8 text-center text-[15px] text-[#C2C2C2]">{paymentsError}</p>
              ) : filteredOrders.length ? (
                <div className="max-h-[575px] overflow-y-auto thin-scrollbar">
                  {filteredOrders.map((order) => {
                    const badge = orderStatusBadge(order.status);
                    const methodIcon = order.method === "pix" ? "/cdn/icons/pix_.png" : cardBrandIcon(order.card?.brand || null);
                    const serverName = serverMap.get(order.guildId)?.guildName || order.guildId;
                    return (
                      <div key={order.id} className="flex flex-col gap-3 border-b border-[#1C1C1C] px-4 py-4 last:border-b-0 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-between min-[720px]:py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[#111111] min-[720px]:h-[38px] min-[720px]:w-[38px]">
                              <PaymentMethodIcon src={methodIcon} alt="Metodo" size={30} />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[15px] text-[#D8D8D8]">Pagamento #{order.orderNumber}</p>
                              <p className="truncate text-[14px] text-[#777777]">{serverName}</p>
                            </div>
                          </div>
                          {order.technicalLabels.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {order.technicalLabels.map((label) => {
                                const technicalBadge = technicalHistoryBadge(label);
                                return (
                                  <span
                                    key={`${order.id}-${label}`}
                                    className={`inline-flex rounded-[3px] border px-[8px] py-[3px] text-[10px] ${technicalBadge.cls}`}
                                  >
                                    {technicalBadge.label}
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                          {order.providerStatusDetail ? (
                            <p className="mt-2 truncate text-[12px] text-[#686868]">{order.providerStatusDetail}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-end justify-between gap-3 text-right min-[720px]:block">
                          <span className={`inline-flex rounded-[3px] border px-[10px] py-[4px] text-[12px] ${badge.cls}`}>{badge.label}</span>
                          <div>
                            <p className="mt-1 text-[12px] text-[#777777]">{formatDateTime(order.createdAt)}</p>
                            <p className="mt-1 text-[14px] text-[#D8D8D8]">{formatAmount(order.amount, order.currency)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-[15px] text-[#C2C2C2]">Nenhum pagamento encontrado para esse filtro.</p>
              )}
            </div>
          </div>

          <div className="min-w-0 w-full shrink-0 pl-0 min-[860px]:pl-[8px]">
            <div className="grid grid-cols-1 gap-3 min-[980px]:grid-cols-[1fr_auto_auto]">
              <input
                type="text"
                value={methodSearch}
                onChange={(event) => setMethodSearch(event.currentTarget.value)}
                disabled={isViewerOnly}
                placeholder="Pesquisar metodo por bandeira, final ou servidor"
                className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] placeholder:text-[#3A3A3A] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px]"
              />
              <select
                value={methodGuildFilter}
                onChange={(event) => setMethodGuildFilter(event.currentTarget.value)}
                disabled={isViewerOnly}
                className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px] min-[980px]:min-w-[238px]"
              >
                {serverOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <select
                value={methodStatusFilter}
                onChange={(event) => setMethodStatusFilter(event.currentTarget.value as "all" | PaymentStatus)}
                disabled={isViewerOnly}
                className="h-[50px] min-w-0 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[14px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50 min-[680px]:h-[52px] min-[680px]:text-[15px] min-[980px]:min-w-[213px]"
              >
                <option value="all">Todos status</option>
                <option value="approved">Pago</option>
                <option value="pending">Pendente</option>
                <option value="expired">Expirado</option>
                <option value="cancelled">Cancelado</option>
                <option value="rejected">Rejeitado</option>
                <option value="failed">Falhou</option>
              </select>
            </div>

            <div className="mt-4">
              {isViewerOnly ? (
                <div className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-8 text-center text-[15px] text-[#C2C2C2]">
                  {financialViewerMessage}
                </div>
              ) : isPaymentsLoading ? (
                <div className="flex h-[275px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A]">
                  <ButtonLoader size={28} />
                </div>
              ) : filteredMethods.length ? (
                <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-2">
                  {filteredMethods.map((method) => {
                    const brandLabel = cardBrandLabel(method.brand);
                    const masked = `${method.firstSix} ****** ${method.lastFour}`;
                    const isDeleting = deletingMethodId === method.id;
                    const verificationBadge = methodVerificationBadge(
                      method.verificationStatus,
                    );
                    return (
                      <article key={method.id} className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-4 min-[900px]:py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[#111111]">
                              <PaymentMethodIcon src={cardBrandIcon(method.brand)} alt={brandLabel} size={32} />
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-[15px] text-[#D8D8D8]">{method.nickname?.trim() || brandLabel}</p>
                                <span className={`inline-flex shrink-0 rounded-[3px] border px-[8px] py-[3px] text-[10px] ${verificationBadge.cls}`}>
                                  {verificationBadge.label}
                                </span>
                              </div>
                              <p className="truncate text-[14px] text-[#777777]">{masked}</p>
                            </div>
                          </div>

                          <div className="relative" data-method-menu-root="true">
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => {
                                setOpenMethodMenuId((current) =>
                                  current === method.id ? null : method.id,
                                );
                              }}
                              className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-[2px] text-[18px] leading-none text-[#4A4A4A] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-[#7A7A7A] disabled:cursor-not-allowed disabled:opacity-45 min-[900px]:h-[26px] min-[900px]:w-[26px]"
                              aria-label="Abrir menu do metodo"
                            >
                              ...
                            </button>

                            {openMethodMenuId === method.id ? (
                              <div className="flowdesk-scale-in-soft absolute right-0 top-[30px] z-20 min-w-[122px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] py-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleDeleteMethod(method.id);
                                  }}
                                  className="block w-full px-3 py-2 text-left text-[12px] text-[#DB4646] transition-colors hover:bg-[#121212]"
                                >
                                  {isDeleting ? "Removendo..." : "Deletar"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2 min-[620px]:grid-cols-[1fr_auto] min-[620px]:items-end">
                          <div>
                            <p className="mb-1 text-[11px] text-[#686868]">Apelido do cartao</p>
                            <div className="flex flex-col gap-2 min-[520px]:flex-row min-[520px]:items-center">
                              <input
                                type="text"
                                value={methodNicknameDrafts[method.id] ?? ""}
                                onChange={(event) => {
                                  const nextValue = event.currentTarget.value.slice(0, 42);
                                  setMethodNicknameDrafts((current) => ({
                                    ...current,
                                    [method.id]: nextValue,
                                  }));
                                }}
                                placeholder="Ex: Cartao principal"
                                className="h-[36px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-3 text-[12px] text-[#D8D8D8] placeholder:text-[#3A3A3A] outline-none min-[520px]:h-[33px] min-[520px]:px-2"
                              />
                              <button
                                type="button"
                                disabled={savingMethodNicknameId === method.id}
                                onClick={() => {
                                  void handleSaveMethodNickname(method.id);
                                }}
                                className="inline-flex h-[36px] w-full items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#121212] px-3 text-[11px] text-[#D8D8D8] transition-colors hover:bg-[#1A1A1A] disabled:cursor-not-allowed disabled:opacity-50 min-[520px]:h-[33px] min-[520px]:w-auto"
                              >
                                {savingMethodNicknameId === method.id ? (
                                  <ButtonLoader size={14} colorClassName="text-[#D8D8D8]" />
                                ) : (
                                  "Salvar"
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col text-[12px] text-[#777777] min-[620px]:items-end">
                            <span>{method.timesUsed} uso(s)</span>
                            <span className="mt-1">
                              Validade:{" "}
                              {method.expMonth && method.expYear
                                ? `${String(method.expMonth).padStart(2, "0")}/${String(method.expYear).slice(-2)}`
                                : "--/--"}
                            </span>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-col gap-1 text-[11px] text-[#686868] min-[620px]:flex-row min-[620px]:items-center min-[620px]:justify-between">
                          <span>
                            Bandeira: {brandLabel}
                          </span>
                          <span>Metodo: {method.id}</span>
                        </div>

                        <div className="mt-3 flex flex-col gap-1 text-[12px] text-[#777777] min-[620px]:flex-row min-[620px]:items-center min-[620px]:justify-between">
                          <span>
                            Ultimo uso: {formatDateTime(method.lastUsedAt)}
                          </span>
                          <span>
                            {method.verifiedAt
                              ? `Validado em ${formatDateTime(method.verifiedAt)}`
                              : "Validacao recente"}
                          </span>
                        </div>

                        {method.verificationStatusDetail ? (
                          <p className="mt-2 text-[11px] text-[#686868]">
                            {method.verificationStatusDetail}
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-8 text-center text-[15px] text-[#C2C2C2]">
                  Nenhum metodo encontrado para esse filtro.
                </div>
              )}

              <button
                type="button"
                onClick={() => openAddMethodModal()}
                disabled={isViewerOnly || !cardPaymentsEnabled}
                className={`mt-4 flex h-[48px] w-full items-center justify-center gap-3 rounded-[3px] border px-4 text-[13px] font-medium transition-colors min-[680px]:mt-3 min-[680px]:h-[46px] ${
                  cardPaymentsEnabled
                    ? "border-transparent bg-[#D8D8D8] text-black hover:opacity-90"
                    : "border-[#2E2E2E] bg-[#0A0A0A] text-[#D8D8D8] disabled:cursor-not-allowed"
                }`}
              >
                <span>ADICIONAR NOVO METODO</span>
                {!cardPaymentsEnabled ? (
                  <span className="pointer-events-none inline-flex h-[22px] items-center justify-center rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-2 text-[10px] tracking-[0.04em] text-[#F2C823] shadow-[0_0_0_1px_rgba(10,10,10,0.55)]">
                    {CARD_PAYMENTS_COMING_SOON_BADGE}
                  </span>
                ) : null}
              </button>

              {methodActionMessage ? (
                <p
                  className={`mt-2 text-[11px] ${
                    methodActionMessage === CARD_PAYMENTS_DISABLED_MESSAGE
                      ? "text-[#F2C823]"
                      : "text-[#9BD694]"
                  }`}
                >
                  {methodActionMessage}
                </p>
              ) : null}
              {paymentsError ? (
                <p className="mt-2 text-[11px] text-[#C2C2C2]">{paymentsError}</p>
              ) : null}
            </div>
          </div>

          <div className="min-w-0 w-full shrink-0 pl-0 min-[860px]:pl-[8px]">
            {isPlanLoading ? (
              <div className="flex h-[275px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A]">
                <ButtonLoader size={28} />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {canRenewPlan ? (
                  <div className="flex flex-col items-start gap-3 rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-4 py-4 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between min-[640px]:px-3 min-[640px]:py-3">
                    <div className="min-w-0">
                      <p className="text-[14px] text-[#F2C823]">
                        {renewalWindowOpen
                          ? "Renovacao antecipada disponivel para a conta"
                          : status === "expired"
                            ? "Plano da conta expirado"
                            : "Bot desligado por plano ou pagamento"}
                      </p>
                      <p className="mt-1 text-[11px] text-[#D6C68A]">
                        {renewalWindowOpen
                          ? `Renove agora e os ${daysUntilExpire} dia${
                              daysUntilExpire === 1 ? "" : "s"
                            } restantes do plano da conta serao somados ao proximo ciclo.`
                          : status === "expired"
                            ? `Renove agora para reativar os servidores da conta. Os ${daysUntilOff} dia${
                                daysUntilOff === 1 ? "" : "s"
                              } de tolerancia em aberto nao viram bonus no proximo ciclo.`
                            : "Renove agora para reativar o Flowdesk assim que o pagamento ou a troca de plano forem confirmados."}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleRenewByPix}
                      disabled={isViewerOnly}
                      className="inline-flex h-[40px] w-full items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#D8D8D8] px-4 text-[13px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 min-[520px]:w-auto min-[520px]:text-[12px] min-[520px]:h-[34px]"
                    >
                      RENOVAR
                    </button>
                  </div>
                ) : null}

                <div className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[16px] font-medium text-[#D8D8D8]">Plano Pro</p>
                      <p className="text-[12px] text-[#8E8E8E]">
                        Cobranca da conta com ciclo padrao de 30 dias
                      </p>
                    </div>
                    <span className="inline-flex h-[23px] items-center justify-center rounded-[3px] border border-[#6AE25A] bg-[rgba(106,226,90,0.2)] px-3 text-[11px] text-[#6AE25A]">
                      R$ 9,99 / mes
                    </span>
                  </div>

                  <div className="mt-4 rounded-[3px] border border-[#2E2E2E] bg-[#090909] px-3 py-3">
                    <div className="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between">
                      <div>
                        <p className="text-[14px] text-[#D8D8D8]">Cobranca recorrente</p>
                        <p className="mt-1 text-[11px] text-[#8E8E8E]">
                          Ative para renovar automaticamente a assinatura da conta a cada ciclo.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          void handleToggleRecurring();
                        }}
                        disabled={
                          isPlanSaving ||
                          !planSettings ||
                          isViewerOnly ||
                          (!cardPaymentsEnabled && !planSettings?.recurringEnabled)
                        }
                        className={`inline-flex h-[36px] w-full min-w-[92px] items-center justify-center rounded-[3px] border px-3 text-[12px] transition-opacity disabled:cursor-not-allowed min-[640px]:h-[31px] min-[640px]:w-auto ${
                          planSettings?.recurringEnabled
                            ? "border-[#6AE25A] bg-[rgba(106,226,90,0.2)] text-[#6AE25A]"
                            : !cardPaymentsEnabled
                              ? "border-[#4A4020] bg-[rgba(242,200,35,0.08)] text-[#CDBA64]"
                              : "border-[#2E2E2E] bg-[#0A0A0A] text-[#D8D8D8]"
                        }`}
                      >
                        {isPlanSaving ? (
                          <ButtonLoader size={16} colorClassName="text-[#D8D8D8]" />
                        ) : planSettings?.recurringEnabled ? (
                          "Ativado"
                        ) : (
                          "Desativado"
                        )}
                      </button>
                    </div>
                    {!cardPaymentsEnabled && !planSettings?.recurringEnabled ? (
                      <div className="mt-3 flex justify-end">
                        <span className="inline-flex h-[22px] items-center justify-center rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-2 text-[10px] tracking-[0.04em] text-[#F2C823]">
                          {CARD_PAYMENTS_COMING_SOON_BADGE}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-[3px] border border-[#2E2E2E] bg-[#090909] px-3 py-3">
                    <div className="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between">
                      <p className="text-[12px] text-[#8E8E8E]">Cartao vinculado a recorrencia</p>
                      <button
                        type="button"
                        onClick={() => openAddMethodModal()}
                        disabled={isViewerOnly || !cardPaymentsEnabled}
                        className="inline-flex h-[36px] w-full items-center justify-center gap-2 rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-3 text-[11px] text-[#D8D8D8] transition-colors hover:bg-[#111111] disabled:cursor-not-allowed disabled:opacity-55 min-[640px]:h-[31px] min-[640px]:w-auto"
                      >
                        <span>Adicionar cartao</span>
                        {!cardPaymentsEnabled ? (
                          <span className="inline-flex h-[18px] items-center justify-center rounded-[3px] border border-[#F2C823] bg-[rgba(242,200,35,0.12)] px-2 text-[9px] tracking-[0.04em] text-[#F2C823]">
                            {CARD_PAYMENTS_COMING_SOON_BADGE}
                          </span>
                        ) : null}
                      </button>
                    </div>

                    {recurringMethodOptions.length > 1 ? (
                      <div className="mt-2">
                        <label className="mb-1 block text-[11px] text-[#686868]">
                          Escolha o cartao da conta
                        </label>
                        <select
                          value={planSettings?.recurringMethodId || ""}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            if (!value) return;
                            void handleSelectRecurringMethod(value);
                          }}
                          disabled={
                            isPlanSaving ||
                            isViewerOnly ||
                            !planSettings?.recurringEnabled ||
                            !cardPaymentsEnabled
                          }
                          className="h-[38px] w-full rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-3 text-[12px] text-[#D8D8D8] outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {recurringMethodOptions.map((method) => (
                            <option key={method.id} value={method.id}>
                              {(method.nickname?.trim() || cardBrandLabel(method.brand)) +
                                " - " +
                                `${method.firstSix} ****** ${method.lastFour}`}
                            </option>
                          ))}
                        </select>
                        {!planSettings?.recurringEnabled ? (
                          <p className="mt-1 text-[11px] text-[#686868]">
                            Ative a cobranca recorrente para escolher o cartao.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {recurringMethod ? (
                      <div className="mt-2 flex items-center gap-3">
                        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[#111111]">
                          <PaymentMethodIcon
                            src={cardBrandIcon(recurringMethod.brand)}
                            alt={cardBrandLabel(recurringMethod.brand)}
                            size={32}
                          />
                        </span>
                        <div>
                          <p className="text-[14px] text-[#D8D8D8]">
                            {recurringMethod.nickname?.trim() || cardBrandLabel(recurringMethod.brand)}
                          </p>
                          <p className="text-[12px] text-[#777777]">
                            {recurringMethod.firstSix} ****** {recurringMethod.lastFour}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-[12px] text-[#777777]">
                        {cardPaymentsEnabled
                          ? "Nenhum cartao vinculado. Adicione ou valide um cartao para usar na recorrencia."
                          : "Cartoes para recorrencia ficarao disponiveis em breve."}
                      </p>
                    )}
                  </div>

                  {isViewerOnly ? (
                    <p className="mt-3 text-[11px] text-[#8CC2FF]">
                      {financialViewerMessage}
                    </p>
                  ) : null}
                  {locked ? (
                    <p className="mt-3 text-[11px] text-[#C2C2C2]">
                      Mesmo com o servidor expirado ou desligado, voce ainda pode configurar a cobranca recorrente para reativacao automatica.
                    </p>
                  ) : null}
                  {!cardPaymentsEnabled ? (
                    <p className="mt-3 text-[11px] text-[#C2C2C2]">
                      Pagamentos com cartao e cobranca recorrente estao temporariamente desativados e retornarao em breve.
                    </p>
                  ) : null}

                  {planError ? <p className="mt-2 text-[11px] text-[#C2C2C2]">{planError}</p> : null}
                  {planSuccess ? <p className="mt-2 text-[11px] text-[#9BD694]">{planSuccess}</p> : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isPortalMounted && isSaveBarRendered
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-[22px] z-[170] flex justify-center px-4 md:px-6 lg:px-8 xl:pl-[358px] xl:pr-[42px]">
              <div className="w-full max-w-[1220px]">
                <div
                  className={`pointer-events-auto relative w-full overflow-hidden rounded-[26px] shadow-[0_26px_90px_rgba(0,0,0,0.48)] backdrop-blur-[18px] ${
                    isSaveBarExiting ? "flowdesk-sheet-down" : "flowdesk-sheet-up"
                  } ${showSaveBarErrorState ? "flowdesk-savebar-shake-soft" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 rounded-[26px] border ${
                      showSaveBarErrorState
                        ? "border-[rgba(219,70,70,0.38)]"
                        : showSaveBarSuccessState
                          ? "border-[rgba(106,226,90,0.34)]"
                          : "border-[#0E0E0E]"
                    }`}
                  />
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-[-2px] rounded-[26px] ${
                      showSaveBarErrorState
                        ? "flowdesk-tag-border-glow-danger"
                        : showSaveBarSuccessState
                          ? "flowdesk-tag-border-glow-success"
                        : "flowdesk-tag-border-glow"
                    }`}
                  />
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-[-1px] rounded-[26px] ${
                      showSaveBarErrorState
                        ? "flowdesk-tag-border-core-danger"
                        : showSaveBarSuccessState
                          ? "flowdesk-tag-border-core-success"
                        : "flowdesk-tag-border-core"
                    }`}
                  />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-[1px] rounded-[25px] bg-[#070707]"
                  />

                  <div className="relative z-10 flex flex-col gap-[16px] px-[18px] py-[16px] sm:px-[22px] sm:py-[18px] xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] leading-[1.2] font-medium tracking-[-0.03em] text-[#D8D8D8]">
                        {floatingSaveBarTitle}
                      </p>
                      <p className="mt-[8px] max-w-[680px] text-[13px] leading-[1.55] text-[#7F7F7F]">
                        {floatingSaveBarDescription}
                      </p>
                    </div>

                    {showSaveBarActions ? (
                      <div className="flex shrink-0 flex-col-reverse gap-[10px] sm:flex-row sm:items-center">
                        <button
                          type="button"
                          onClick={handleResetSettings}
                          disabled={!canResetSettings}
                          className={`group relative inline-flex h-[46px] items-center justify-center overflow-hidden whitespace-nowrap rounded-[12px] px-6 text-[15px] leading-none font-semibold transition-colors ${
                            canResetSettings ? "" : "cursor-not-allowed"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute inset-0 rounded-[12px] border transition-colors ${
                              canResetSettings
                                ? "border-[#1B1B1B] bg-[#111111]"
                                : "border-[#151515] bg-[#0E0E0E]"
                            }`}
                          />
                          <span
                            className={`relative z-10 inline-flex items-center justify-center whitespace-nowrap ${
                              canResetSettings ? "text-[#D0D0D0]" : "text-[#666666]"
                            }`}
                          >
                            Redefinir
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            void handleSave();
                          }}
                          disabled={!canPersistSettings}
                          className={`group relative inline-flex h-[46px] items-center justify-center overflow-hidden whitespace-nowrap rounded-[12px] px-6 text-[15px] leading-none font-semibold ${
                            canPersistSettings ? "" : "cursor-not-allowed"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute inset-0 rounded-[12px] transition-transform duration-150 ease-out ${
                              saveActionVisualEnabled
                                ? "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] group-hover:scale-[1.02] group-active:scale-[0.985]"
                                : "bg-[#111111]"
                            }`}
                          />
                          <span
                            className={`relative z-10 inline-flex items-center justify-center whitespace-nowrap transition-opacity ${
                              saveActionVisualEnabled ? "text-[#282828]" : "text-[#B7B7B7]"
                            } ${isSaving ? "opacity-0" : "opacity-100"}`}
                          >
                            Salvar alteracoes
                          </span>
                          {isSaving ? (
                            <span className="absolute inset-0 z-20 inline-flex items-center justify-center">
                              <ButtonLoader
                                size={20}
                                colorClassName={saveActionVisualEnabled ? "text-[#282828]" : "text-[#B7B7B7]"}
                              />
                            </span>
                          ) : null}
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex h-[40px] shrink-0 items-center justify-center rounded-full border border-[rgba(155,214,148,0.28)] bg-[rgba(155,214,148,0.08)] px-[14px] text-[12px] font-medium text-[#9BD694]">
                        Tudo sincronizado
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {isPortalMounted && isRecurringMethodModalOpen
        ? createPortal(
        <div className="fixed inset-y-0 left-0 right-0 z-[2600] overflow-y-auto overscroll-contain bg-black/75 px-4 py-6 xl:left-[318px]">
          <div className="flex min-h-full items-center justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Escolha o cartao da renovacao"
            className="relative w-full max-w-[560px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] p-6"
          >
            <button
              type="button"
              onClick={() => {
                if (isPlanSaving) return;
                setIsRecurringMethodModalOpen(false);
              }}
              className="absolute right-4 top-4 inline-flex h-[28px] w-[28px] items-center justify-center rounded-[3px] text-[#8A8A8A] transition-colors hover:text-[#D8D8D8]"
              aria-label="Fechar modal de recorrencia"
            >
              X
            </button>

            <h3 className="text-center text-[24px] text-[#D8D8D8]">
              Escolha o cartao da conta
            </h3>

            <div className="mt-6 h-[1px] w-full bg-[#242424]" />

            <p className="mt-5 text-center text-[12px] text-[#8E8E8E]">
              Selecione qual cartao sera usado para renovar automaticamente a conta.
            </p>

            <div className="thin-scrollbar mt-5 flex max-h-[320px] flex-col gap-3 overflow-y-auto pr-1">
              {recurringMethodOptions.map((method) => {
                const isSelected = recurringMethodDraftId === method.id;
                const label =
                  method.nickname?.trim() || cardBrandLabel(method.brand);

                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => setRecurringMethodDraftId(method.id)}
                    className={`flex items-center gap-3 rounded-[3px] border px-3 py-3 text-left transition-colors ${
                      isSelected
                        ? "border-[#6AE25A] bg-[rgba(106,226,90,0.12)]"
                        : "border-[#2E2E2E] bg-[#090909] hover:bg-[#101010]"
                    }`}
                  >
                    <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[3px] bg-[#111111]">
                      <PaymentMethodIcon
                        src={cardBrandIcon(method.brand)}
                        alt={cardBrandLabel(method.brand)}
                        size={32}
                      />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] text-[#D8D8D8]">
                        {label}
                      </p>
                      <p className="mt-1 text-[12px] text-[#777777]">
                        {method.firstSix} ****** {method.lastFour}
                      </p>
                    </div>

                    <span
                      className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${
                        isSelected
                          ? "border-[#6AE25A] bg-[#6AE25A]"
                          : "border-[#3A3A3A] bg-transparent"
                      }`}
                    >
                      {isSelected ? (
                        <span className="text-[10px] font-semibold text-black">OK</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isPlanSaving) return;
                  setIsRecurringMethodModalOpen(false);
                }}
                className="inline-flex h-[40px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[13px] text-[#D8D8D8] transition-colors hover:bg-[#111111]"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => {
                  void handleConfirmRecurringActivation();
                }}
                disabled={!recurringMethodDraftId || isPlanSaving}
                className="inline-flex h-[40px] min-w-[180px] items-center justify-center rounded-[3px] bg-[#D8D8D8] px-4 text-[13px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPlanSaving ? <ButtonLoader size={20} /> : "Ativar recorrencia"}
              </button>
            </div>
          </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {isPortalMounted && isAddMethodModalOpen
        ? createPortal(
        <ClientErrorBoundary
          fallback={
            <div className="fixed inset-y-0 left-0 right-0 z-[2600] overflow-y-auto overscroll-contain bg-black/75 px-4 py-6 xl:left-[318px]">
              <div className="flex min-h-full items-center justify-center">
              <div className="w-full max-w-[520px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] p-6 text-center">
                <p className="text-[16px] text-[#D8D8D8]">
                  Nao foi possivel abrir o modal de cartao.
                </p>
                <p className="mt-2 text-[12px] text-[#8E8E8E]">
                  Feche e tente novamente em alguns segundos.
                </p>
                <button
                  type="button"
                  onClick={closeAddMethodModal}
                  className="mt-5 inline-flex h-[40px] items-center justify-center rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 text-[13px] text-[#D8D8D8] transition-colors hover:bg-[#121212]"
                >
                  Fechar
                </button>
              </div>
              </div>
            </div>
          }
        >
          <div className="fixed inset-y-0 left-0 right-0 z-[2600] overflow-y-auto overscroll-contain bg-black/75 px-4 py-6 xl:left-[318px]">
            <div className="flex min-h-full items-center justify-center">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Adicionar um cartao"
              className="relative w-full max-w-[760px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] p-6"
            >
            <button
              type="button"
              onClick={closeAddMethodModal}
              className="absolute right-4 top-4 inline-flex h-[28px] w-[28px] items-center justify-center rounded-[3px] text-[#8A8A8A] transition-colors hover:text-[#D8D8D8]"
              aria-label="Fechar modal"
            >
              X
            </button>

            <h3 className="text-center text-[24px] text-[#D8D8D8]">
              Adicionar um cartao
            </h3>

            <div className="mt-6 h-[1px] w-full bg-[#242424]" />

            {addMethodFlowState !== "idle" || addMethodStatusMessage ? (
              <div
                className={`mt-4 flex min-h-[46px] items-center gap-3 rounded-[3px] border px-4 py-3 ${
                  addMethodFlowState === "approved"
                    ? "border-[#6AE25A] bg-[rgba(106,226,90,0.12)] text-[#9FE88F]"
                    : addMethodFlowState === "rejected"
                      ? "border-[#DB4646] bg-[rgba(219,70,70,0.12)] text-[#F09A9A]"
                      : "border-[#2E2E2E] bg-[#0F0F0F] text-[#D8D8D8]"
                }`}
                aria-live="polite"
              >
                <span className="inline-flex h-[22px] w-[22px] items-center justify-center">
                  {addMethodFlowState === "approved" ? (
                    <span className="text-[14px] font-semibold text-[#6AE25A]">OK</span>
                  ) : addMethodFlowState === "rejected" ? (
                    <span className="text-[14px] font-semibold text-[#DB4646]">ER</span>
                  ) : (
                    <ButtonLoader
                      size={18}
                      colorClassName="text-[#D8D8D8]"
                    />
                  )}
                </span>
                <p className="text-[12px]">
                  {addMethodStatusMessage ||
                    (addMethodFlowState === "preparing"
                      ? "Preparando ambiente seguro..."
                      : "Salvando cartao...")}
                </p>
              </div>
            ) : null}

            <div className="mt-6">
              <p className="mb-3 text-[12px] text-[#D8D8D8]">Dados do Cartao</p>
              <p className="mb-3 text-[11px] text-[#8A8A8A]">
                O cartao so e liberado depois de ser salvo com seguranca no cofre do Mercado Pago.
              </p>

              <div className="grid grid-cols-1 gap-3">
                <div className="relative">
                  <input
                    type="text"
                    value={addMethodForm.cardNumber}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      markAddMethodFieldTouched("cardNumber");
                      clearAddMethodRealtimeFeedback();
                      setAddMethodForm((current) => ({
                        ...current,
                        cardNumber: formatCardNumberInput(nextValue),
                      }));
                    }}
                    onBlur={() => {
                      markAddMethodFieldTouched("cardNumber");
                    }}
                    placeholder="Numero do Cartao"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 pr-[52px] text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                      addMethodVisibleErrors.cardNumber
                        ? "border-[#DB4646]"
                        : "border-[#2E2E2E]"
                    }`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 inline-flex h-[26px] w-[26px] -translate-y-1/2 items-center justify-center rounded-[3px] bg-[#111111]">
                    <PaymentMethodIcon
                      src={addMethodBrandIconSafePath}
                      alt={addMethodCardBrand ? cardBrandLabel(addMethodCardBrand) : "Cartao"}
                      size={18}
                    />
                  </span>
                </div>
                {addMethodVisibleErrors.cardNumber ? (
                  <p className="mt-[-4px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                    {addMethodVisibleErrors.cardNumber}
                  </p>
                ) : null}

                <div>
                  <input
                    type="text"
                    value={addMethodForm.holderName}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      markAddMethodFieldTouched("holderName");
                      clearAddMethodRealtimeFeedback();
                      setAddMethodForm((current) => ({
                        ...current,
                        holderName: nextValue.slice(0, 120),
                      }));
                    }}
                    onBlur={() => {
                      markAddMethodFieldTouched("holderName");
                    }}
                    placeholder="Nome do Titular"
                    className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                      addMethodVisibleErrors.holderName
                        ? "border-[#DB4646]"
                        : "border-[#2E2E2E]"
                    }`}
                  />
                  {addMethodVisibleErrors.holderName ? (
                    <p className="mt-[8px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                      {addMethodVisibleErrors.holderName}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input
                      type="text"
                      value={addMethodForm.expiry}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        markAddMethodFieldTouched("expiry");
                        clearAddMethodRealtimeFeedback();
                        setAddMethodForm((current) => ({
                          ...current,
                          expiry: formatCardExpiryInput(nextValue),
                        }));
                      }}
                      onBlur={() => {
                        markAddMethodFieldTouched("expiry");
                      }}
                      placeholder="Data de Validade"
                      className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                        addMethodVisibleErrors.expiry
                          ? "border-[#DB4646]"
                          : "border-[#2E2E2E]"
                      }`}
                    />
                    {addMethodVisibleErrors.expiry ? (
                      <p className="mt-[8px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                        {addMethodVisibleErrors.expiry}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <input
                      type="text"
                      value={addMethodForm.cvv}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value;
                        markAddMethodFieldTouched("cvv");
                        clearAddMethodRealtimeFeedback();
                        setAddMethodForm((current) => ({
                          ...current,
                          cvv: normalizeCardCvvInput(nextValue),
                        }));
                      }}
                      onBlur={() => {
                        markAddMethodFieldTouched("cvv");
                      }}
                      placeholder="CVV/CVC"
                      className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                        addMethodVisibleErrors.cvv
                          ? "border-[#DB4646]"
                          : "border-[#2E2E2E]"
                      }`}
                    />
                    {addMethodVisibleErrors.cvv ? (
                      <p className="mt-[8px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                        {addMethodVisibleErrors.cvv}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    value={addMethodForm.document}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      const digits = normalizeBrazilDocumentDigits(nextValue).slice(0, 14);
                      markAddMethodFieldTouched("document");
                      clearAddMethodRealtimeFeedback();
                      setAddMethodForm((current) => ({
                        ...current,
                        document: formatDocumentInput(digits),
                      }));
                    }}
                    onBlur={() => {
                      markAddMethodFieldTouched("document");
                    }}
                    placeholder="CPF/CNPJ"
                    className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                      addMethodVisibleErrors.document
                        ? "border-[#DB4646]"
                        : "border-[#2E2E2E]"
                    }`}
                  />
                  {addMethodVisibleErrors.document ? (
                    <p className="mt-[8px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                      {addMethodVisibleErrors.document}
                    </p>
                  ) : null}
                </div>

                <div>
                  <input
                    type="text"
                    value={addMethodForm.nickname}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      markAddMethodFieldTouched("nickname");
                      clearAddMethodRealtimeFeedback();
                      setAddMethodForm((current) => ({
                        ...current,
                        nickname: nextValue.slice(0, 42),
                      }));
                    }}
                    onBlur={() => {
                      markAddMethodFieldTouched("nickname");
                    }}
                    placeholder="Apelido do cartao (opcional)"
                    className={`h-[51px] w-full rounded-[3px] border bg-[#0A0A0A] px-4 text-[16px] text-[#D8D8D8] placeholder:text-[#242424] outline-none transition-colors ${
                      addMethodVisibleErrors.nickname
                        ? "border-[#DB4646]"
                        : "border-[#2E2E2E]"
                    }`}
                  />
                  {addMethodVisibleErrors.nickname ? (
                    <p className="mt-[8px] flowdesk-slide-down text-[12px] text-[#DB4646]">
                      {addMethodVisibleErrors.nickname}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                void handleAddMethodSubmit();
              }}
              disabled={!addMethodCanSubmit || isAddingMethod || isAddMethodSdkLoading}
              className="mt-5 flex h-[51px] w-full items-center justify-center rounded-[3px] bg-[#D8D8D8] text-[16px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAddingMethod || isAddMethodSdkLoading ? (
                <ButtonLoader size={24} />
              ) : (
                "Validar e salvar cartao"
              )}
            </button>

            {addMethodCooldownMessage ? (
              <p className="mt-3 text-center text-[12px] text-[#8E8E8E]">
                {addMethodCooldownMessage}
              </p>
            ) : null}

            {addMethodError ? (
              <p className="mt-3 text-[14px] text-[#DB4646]" aria-live="polite">
                {addMethodError}
              </p>
            ) : null}
            </div>
            </div>
          </div>
        </ClientErrorBoundary>,
        document.body,
      ) : null}

      {isPortalMounted &&
      activeSecurityLogModalEvent &&
      activeSecurityLogModalOption
        ? createPortal(
        <div className="fixed inset-y-0 left-0 right-0 z-[2600] isolate overflow-y-auto overscroll-contain xl:left-[318px]">
          <button
            type="button"
            aria-label="Fechar modal de canal"
            className="absolute inset-0 bg-[rgba(0,0,0,0.84)] backdrop-blur-[7px]"
            onClick={handleCloseSecurityLogModal}
          />

          <div className="relative z-[10] min-h-full px-[20px] py-[32px] md:px-6 lg:px-8 xl:pl-[40px] xl:pr-[42px]">
            <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[1220px] items-center justify-center">
              <div
              role="dialog"
              aria-modal="true"
              aria-label={`Configurar canal de ${activeSecurityLogModalOption.title}`}
              className="flowdesk-stage-fade relative w-full max-w-[720px] overflow-hidden rounded-[32px] bg-transparent px-[22px] py-[22px] shadow-[0_34px_110px_rgba(0,0,0,0.52)] sm:px-[28px] sm:py-[28px]"
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
                    <LandingGlowTag className="px-[18px]">
                      Logs de Seguranca
                    </LandingGlowTag>

                    <div className="mt-[18px]">
                      <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[36px]">
                        {activeSecurityLogModalOption.title}
                      </h2>
                      <p className="mt-[14px] max-w-[560px] text-[14px] leading-[1.62] text-[#787878]">
                        {activeSecurityLogModalOption.tooltip}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleCloseSecurityLogModal}
                    className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4]"
                    aria-label="Fechar modal"
                  >
                    <span className="text-[18px] leading-none">x</span>
                  </button>
                </div>

                <div className="mt-[24px] rounded-[22px] border border-[#161616] bg-[#090909] px-[18px] py-[18px]">
                  <p className="text-[12px] uppercase tracking-[0.16em] text-[#666666]">
                    Canal de destino
                  </p>
                  <p className="mt-[8px] text-[13px] leading-[1.6] text-[#787878]">
                    Escolha em qual canal este evento vai registrar os embeds de auditoria.
                  </p>

                  <div className="mt-[16px]">
                    <ConfigStepSelect
                      label=""
                      placeholder="Escolha o canal de log"
                      options={textChannelOptions}
                      value={
                        securityLogsDraft.events[activeSecurityLogModalEvent].channelId
                      }
                      onChange={(value) =>
                        handleSelectSecurityLogChannel(
                          activeSecurityLogModalEvent,
                          value,
                        )
                      }
                      disabled={securityLogsPerEventChannelControlsDisabled}
                      controlHeightPx={serverSettingsControlHeight}
                      variant="immersive"
                    />
                  </div>
                </div>

                <div className="mt-[24px] flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={handleCloseSecurityLogModal}
                    className="inline-flex h-[46px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] px-[18px] text-[14px] font-medium text-[#CACACA] transition-colors hover:border-[#232323] hover:bg-[#111111] hover:text-[#F1F1F1]"
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    onClick={handleCloseSecurityLogModal}
                    className="group relative inline-flex h-[46px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[14px] leading-none font-semibold"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[12px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                    />
                    <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap leading-none text-[#111111]">
                      Concluir
                    </span>
                  </button>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      <BotMissingModal
        isOpen={isWelcomeActivationModalOpen}
        onClose={() => {
          setIsWelcomeActivationModalOpen(false);
          setHasDismissedWelcomeModal(true);
        }}
        onContinue={() => {
          void handleActivateWelcome();
        }}
        isChecking={isActivatingWelcome}
        title="Modulo nao ativado"
        description="O modulo de mensagens de entrada e saida ainda nao esta ativo neste servidor. Deseja ativar agora?"
        scope="workspace-main"
      />
      <BotMissingModal
        isOpen={isAntiLinkActivationModalOpen}
        onClose={() => {
          setIsAntiLinkActivationModalOpen(false);
          setHasDismissedAntiLinkModal(true);
        }}
        onContinue={() => {
          void handleActivateAntiLink();
        }}
        isChecking={isActivatingAntiLink}
        title="Modulo nao ativado"
        description="O modulo de seguranca AntiLink ainda nao esta ativo neste servidor. Deseja ativar agora?"
        scope="workspace-main"
      />
      </section>
    </ClientErrorBoundary>
  );
}
