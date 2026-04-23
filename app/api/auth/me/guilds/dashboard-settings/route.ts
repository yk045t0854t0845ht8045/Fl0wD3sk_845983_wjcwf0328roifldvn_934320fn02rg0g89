import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
  fetchGuildRolesByBot,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import {
  buildDashboardSettingsCacheKey,
  readDashboardSettingsCache,
  writeDashboardSettingsCache,
} from "@/lib/servers/serverDashboardSettingsCache";
import { getPanelManagedServersForCurrentSession } from "@/lib/servers/managedServers";
import {
  readServerSettingsVaultSnapshots,
  type ServerSettingsVaultModule,
} from "@/lib/servers/serverSettingsVault";
import { normalizeTicketPanelLayout } from "@/lib/servers/ticketPanelBuilder";
import {
  createDefaultWelcomeEntryLayout,
  createDefaultWelcomeExitLayout,
  normalizeWelcomeLayout,
} from "@/lib/servers/welcomeMessageBuilder";
import {
  isMissingDedicatedTicketAiColumnsError,
  normalizeTicketAiSettings,
} from "@/lib/servers/ticketAiSettings";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { getEffectiveDashboardPermissions } from "@/lib/teams/userTeams";

const GUILD_CATEGORY = 4;
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const DASHBOARD_SETTINGS_CACHE_TTL_MS = 15_000;
const TICKET_SETTINGS_SELECT_BASE =
  "enabled, menu_channel_id, tickets_category_id, logs_created_channel_id, logs_closed_channel_id, panel_layout, panel_title, panel_description, panel_button_label, ai_rules, updated_at";
const TICKET_SETTINGS_SELECT_WITH_DEDICATED_AI = `${TICKET_SETTINGS_SELECT_BASE}, ai_enabled, ai_company_name, ai_company_bio, ai_tone`;

type ChannelOption = {
  id: string;
  name: string;
  type: number;
  position: number;
};

type RoleOption = {
  id: string;
  name: string;
  color: number;
  position: number;
};

type SecurityLogEventPayload = {
  enabled: boolean;
  channelId: string | null;
};

function sortChannels(channels: ChannelOption[]) {
  return [...channels].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

function sortRoles(roles: RoleOption[]) {
  return [...roles].sort((a, b) => {
    if (a.position !== b.position) return b.position - a.position;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

function normalizeWelcomeThumbnailMode(value: unknown) {
  return value === "avatar" ? "avatar" : "custom";
}

function normalizeAntiLinkAction(value: unknown) {
  if (
    value === "delete_only" ||
    value === "timeout" ||
    value === "kick" ||
    value === "ban"
  ) {
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

function toRecordOrNull(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function resolveSecurityLogEvent(data: Record<string, unknown>, input: {
  enabledColumn: string;
  channelColumn: string;
  textSet: Set<string>;
}) {
  const enabled = data[input.enabledColumn] === true;
  const rawChannelId = data[input.channelColumn];
  const channelId =
    typeof rawChannelId === "string" && input.textSet.has(rawChannelId)
      ? rawChannelId
      : null;

  return {
    enabled,
    channelId,
  };
}

function resolveOptionalTextChannelId(
  value: unknown,
  textSet: Set<string>,
) {
  return typeof value === "string" && textSet.has(value) ? value : null;
}

async function loadGuildTicketSettings(
  supabase: ReturnType<typeof getSupabaseAdminClientOrThrow>,
  guildId: string,
) {
  const modernResult = await supabase
    .from("guild_ticket_settings")
    .select(TICKET_SETTINGS_SELECT_WITH_DEDICATED_AI)
    .eq("guild_id", guildId)
    .maybeSingle();

  if (!modernResult.error) {
    return modernResult;
  }

  if (!isMissingDedicatedTicketAiColumnsError(modernResult.error)) {
    return modernResult;
  }

  return await supabase
    .from("guild_ticket_settings")
    .select(TICKET_SETTINGS_SELECT_BASE)
    .eq("guild_id", guildId)
    .maybeSingle();
}

function buildTicketSettingsPayload(input: {
  record: Record<string, unknown> | null;
  snapshot: Record<string, unknown> | null;
  textSet: Set<string>;
  categorySet: Set<string>;
  updatedAt: string | null;
}) {
  if (!input.record && !input.snapshot) {
    return null;
  }

  const ticketAiSettings = normalizeTicketAiSettings(input.record);
  const menuChannelId =
    typeof input.snapshot?.menuChannelId === "string" &&
    input.textSet.has(input.snapshot.menuChannelId)
      ? input.snapshot.menuChannelId
      : typeof input.record?.menu_channel_id === "string" &&
          input.textSet.has(input.record.menu_channel_id)
        ? input.record.menu_channel_id
        : null;
  const ticketsCategoryId =
    typeof input.snapshot?.ticketsCategoryId === "string" &&
    input.categorySet.has(input.snapshot.ticketsCategoryId)
      ? input.snapshot.ticketsCategoryId
      : typeof input.record?.tickets_category_id === "string" &&
          input.categorySet.has(input.record.tickets_category_id)
        ? input.record.tickets_category_id
        : null;
  const logsCreatedChannelId =
    typeof input.snapshot?.logsCreatedChannelId === "string" &&
    input.textSet.has(input.snapshot.logsCreatedChannelId)
      ? input.snapshot.logsCreatedChannelId
      : typeof input.record?.logs_created_channel_id === "string" &&
          input.textSet.has(input.record.logs_created_channel_id)
        ? input.record.logs_created_channel_id
        : null;
  const logsClosedChannelId =
    typeof input.snapshot?.logsClosedChannelId === "string" &&
    input.textSet.has(input.snapshot.logsClosedChannelId)
      ? input.snapshot.logsClosedChannelId
      : typeof input.record?.logs_closed_channel_id === "string" &&
          input.textSet.has(input.record.logs_closed_channel_id)
        ? input.record.logs_closed_channel_id
        : null;
  const panelTitle =
    typeof input.snapshot?.panelTitle === "string"
      ? input.snapshot.panelTitle
      : typeof input.record?.panel_title === "string"
        ? input.record.panel_title
        : "";
  const panelDescription =
    typeof input.snapshot?.panelDescription === "string"
      ? input.snapshot.panelDescription
      : typeof input.record?.panel_description === "string"
        ? input.record.panel_description
        : "";
  const panelButtonLabel =
    typeof input.snapshot?.panelButtonLabel === "string"
      ? input.snapshot.panelButtonLabel
      : typeof input.record?.panel_button_label === "string"
        ? input.record.panel_button_label
        : "";

  return {
    enabled:
      typeof input.snapshot?.enabled === "boolean"
        ? input.snapshot.enabled
        : input.record?.enabled === true,
    menuChannelId,
    ticketsCategoryId,
    logsCreatedChannelId,
    logsClosedChannelId,
    panelLayout: normalizeTicketPanelLayout(
      input.snapshot?.panelLayout ?? input.record?.panel_layout,
      {
        panelTitle,
        panelDescription,
        panelButtonLabel,
      },
    ),
    panelTitle,
    panelDescription,
    panelButtonLabel,
    aiRules:
      typeof input.snapshot?.aiRules === "string"
        ? input.snapshot.aiRules
        : ticketAiSettings.aiRules,
    aiEnabled:
      typeof input.snapshot?.aiEnabled === "boolean"
        ? input.snapshot.aiEnabled
        : ticketAiSettings.aiEnabled,
    aiCompanyName:
      typeof input.snapshot?.aiCompanyName === "string"
        ? input.snapshot.aiCompanyName
        : ticketAiSettings.aiCompanyName,
    aiCompanyBio:
      typeof input.snapshot?.aiCompanyBio === "string"
        ? input.snapshot.aiCompanyBio
        : ticketAiSettings.aiCompanyBio,
    aiTone:
      typeof input.snapshot?.aiTone === "string"
        ? input.snapshot.aiTone
        : ticketAiSettings.aiTone,
    updatedAt: input.updatedAt,
  };
}

function buildTicketStaffPayload(input: {
  record: Record<string, unknown> | null;
  snapshot: Record<string, unknown> | null;
  roleSet: Set<string>;
  updatedAt: string | null;
}) {
  if (!input.record && !input.snapshot) {
    return null;
  }

  const sanitizeRoleIds = (value: unknown) =>
    Array.isArray(value)
      ? value.filter(
          (roleId): roleId is string =>
            typeof roleId === "string" && input.roleSet.has(roleId),
        )
      : [];

  return {
    adminRoleId:
      typeof input.snapshot?.adminRoleId === "string" &&
      input.roleSet.has(input.snapshot.adminRoleId)
        ? input.snapshot.adminRoleId
        : typeof input.record?.admin_role_id === "string" &&
            input.roleSet.has(input.record.admin_role_id)
          ? input.record.admin_role_id
          : null,
    claimRoleIds: sanitizeRoleIds(
      input.snapshot?.claimRoleIds ?? input.record?.claim_role_ids,
    ),
    closeRoleIds: sanitizeRoleIds(
      input.snapshot?.closeRoleIds ?? input.record?.close_role_ids,
    ),
    notifyRoleIds: sanitizeRoleIds(
      input.snapshot?.notifyRoleIds ?? input.record?.notify_role_ids,
    ),
    updatedAt: input.updatedAt,
  };
}

function buildWelcomePayload(input: {
  record: Record<string, unknown> | null;
  snapshot: Record<string, unknown> | null;
  textSet: Set<string>;
  updatedAt: string | null;
}) {
  if (!input.record && !input.snapshot) {
    return null;
  }

  const defaultEntryLayout = createDefaultWelcomeEntryLayout();
  const defaultExitLayout = createDefaultWelcomeExitLayout();

  return {
    enabled:
      typeof input.snapshot?.enabled === "boolean"
        ? input.snapshot.enabled
        : input.record?.enabled === true,
    entryPublicChannelId:
      typeof input.snapshot?.entryPublicChannelId === "string" &&
      input.textSet.has(input.snapshot.entryPublicChannelId)
        ? input.snapshot.entryPublicChannelId
        : typeof input.record?.entry_public_channel_id === "string" &&
            input.textSet.has(input.record.entry_public_channel_id)
          ? input.record.entry_public_channel_id
          : null,
    entryLogChannelId:
      typeof input.snapshot?.entryLogChannelId === "string" &&
      input.textSet.has(input.snapshot.entryLogChannelId)
        ? input.snapshot.entryLogChannelId
        : typeof input.record?.entry_log_channel_id === "string" &&
            input.textSet.has(input.record.entry_log_channel_id)
          ? input.record.entry_log_channel_id
          : null,
    exitPublicChannelId:
      typeof input.snapshot?.exitPublicChannelId === "string" &&
      input.textSet.has(input.snapshot.exitPublicChannelId)
        ? input.snapshot.exitPublicChannelId
        : typeof input.record?.exit_public_channel_id === "string" &&
            input.textSet.has(input.record.exit_public_channel_id)
          ? input.record.exit_public_channel_id
          : null,
    exitLogChannelId:
      typeof input.snapshot?.exitLogChannelId === "string" &&
      input.textSet.has(input.snapshot.exitLogChannelId)
        ? input.snapshot.exitLogChannelId
        : typeof input.record?.exit_log_channel_id === "string" &&
            input.textSet.has(input.record.exit_log_channel_id)
          ? input.record.exit_log_channel_id
          : null,
    entryLayout: normalizeWelcomeLayout(
      input.snapshot?.entryPublicLayout ?? input.snapshot?.entryLayout ?? input.record?.entry_layout,
      defaultEntryLayout,
    ),
    exitLayout: normalizeWelcomeLayout(
      input.snapshot?.exitPublicLayout ?? input.snapshot?.exitLayout ?? input.record?.exit_layout,
      defaultExitLayout,
    ),
    entryPublicLayout: normalizeWelcomeLayout(
      input.snapshot?.entryPublicLayout ?? input.snapshot?.entryLayout ?? input.record?.entry_layout,
      defaultEntryLayout,
    ),
    entryLogLayout: normalizeWelcomeLayout(
      input.snapshot?.entryLogLayout ?? input.snapshot?.entryLayout ?? input.record?.entry_layout,
      defaultEntryLayout,
    ),
    exitPublicLayout: normalizeWelcomeLayout(
      input.snapshot?.exitPublicLayout ?? input.snapshot?.exitLayout ?? input.record?.exit_layout,
      defaultExitLayout,
    ),
    exitLogLayout: normalizeWelcomeLayout(
      input.snapshot?.exitLogLayout ?? input.snapshot?.exitLayout ?? input.record?.exit_layout,
      defaultExitLayout,
    ),
    entryThumbnailMode: normalizeWelcomeThumbnailMode(
      input.snapshot?.entryPublicThumbnailMode ??
        input.snapshot?.entryThumbnailMode ??
        input.record?.entry_thumbnail_mode,
    ),
    exitThumbnailMode: normalizeWelcomeThumbnailMode(
      input.snapshot?.exitPublicThumbnailMode ??
        input.snapshot?.exitThumbnailMode ??
        input.record?.exit_thumbnail_mode,
    ),
    entryPublicThumbnailMode: normalizeWelcomeThumbnailMode(
      input.snapshot?.entryPublicThumbnailMode ??
        input.snapshot?.entryThumbnailMode ??
        input.record?.entry_thumbnail_mode,
    ),
    entryLogThumbnailMode: normalizeWelcomeThumbnailMode(
      input.snapshot?.entryLogThumbnailMode ??
        input.snapshot?.entryThumbnailMode ??
        input.record?.entry_thumbnail_mode,
    ),
    exitPublicThumbnailMode: normalizeWelcomeThumbnailMode(
      input.snapshot?.exitPublicThumbnailMode ??
        input.snapshot?.exitThumbnailMode ??
        input.record?.exit_thumbnail_mode,
    ),
    exitLogThumbnailMode: normalizeWelcomeThumbnailMode(
      input.snapshot?.exitLogThumbnailMode ??
        input.snapshot?.exitThumbnailMode ??
        input.record?.exit_thumbnail_mode,
    ),
    updatedAt: input.updatedAt,
  };
}

function buildAntiLinkPayload(input: {
  record: Record<string, unknown> | null;
  snapshot: Record<string, unknown> | null;
  textSet: Set<string>;
  roleSet: Set<string>;
  updatedAt: string | null;
}) {
  if (!input.record && !input.snapshot) {
    return null;
  }

  const ignoredRoleIdsSource =
    input.snapshot?.ignoredRoleIds ?? input.record?.ignored_role_ids;
  const ignoredChannelIdsSource =
    input.snapshot?.ignoredChannelIds ?? input.record?.ignored_channel_ids;

  return {
    enabled:
      typeof input.snapshot?.enabled === "boolean"
        ? input.snapshot.enabled
        : input.record?.enabled === true,
    logChannelId:
      typeof input.snapshot?.logChannelId === "string" &&
      input.textSet.has(input.snapshot.logChannelId)
        ? input.snapshot.logChannelId
        : typeof input.record?.log_channel_id === "string" &&
            input.textSet.has(input.record.log_channel_id)
          ? input.record.log_channel_id
          : null,
    enforcementAction: normalizeAntiLinkAction(
      input.snapshot?.enforcementAction ?? input.record?.enforcement_action,
    ),
    timeoutMinutes: normalizeAntiLinkTimeoutMinutes(
      input.snapshot?.timeoutMinutes ?? input.record?.timeout_minutes,
    ),
    ignoredRoleIds: Array.isArray(ignoredRoleIdsSource)
      ? ignoredRoleIdsSource.filter(
          (roleId: unknown): roleId is string =>
            typeof roleId === "string" && input.roleSet.has(roleId),
        )
      : [],
    ignoredChannelIds: Array.isArray(ignoredChannelIdsSource)
      ? ignoredChannelIdsSource.filter(
          (channelId: unknown): channelId is string =>
            typeof channelId === "string" && input.textSet.has(channelId),
        )
      : [],
    blockExternalLinks:
      input.snapshot?.blockExternalLinks !== false,
    blockDiscordInvites:
      input.snapshot?.blockDiscordInvites !== false,
    blockObfuscatedLinks:
      input.snapshot?.blockObfuscatedLinks !== false,
    updatedAt: input.updatedAt,
  };
}

function buildAutoRolePayload(input: {
  record: Record<string, unknown> | null;
  snapshot: Record<string, unknown> | null;
  roleSet: Set<string>;
  updatedAt: string | null;
}) {
  if (!input.record && !input.snapshot) {
    return null;
  }

  const assignmentDelay =
    input.snapshot?.assignmentDelayMinutes ?? input.record?.assignment_delay_minutes;
  const syncStatus =
    input.snapshot?.syncStatus ?? input.record?.existing_members_sync_status;
  const roleIdsSource = input.snapshot?.roleIds ?? input.record?.role_ids;

  return {
    enabled:
      typeof input.snapshot?.enabled === "boolean"
        ? input.snapshot.enabled
        : input.record?.enabled === true,
    roleIds: Array.isArray(roleIdsSource)
      ? roleIdsSource.filter(
          (roleId: unknown): roleId is string =>
            typeof roleId === "string" && input.roleSet.has(roleId),
        )
      : [],
    assignmentDelayMinutes:
      assignmentDelay === 10 || assignmentDelay === 20 || assignmentDelay === 30
        ? assignmentDelay
        : 0,
    syncStatus:
      syncStatus === "pending" ||
      syncStatus === "processing" ||
      syncStatus === "completed" ||
      syncStatus === "failed"
        ? syncStatus
        : "idle",
    syncRequestedAt:
      typeof input.snapshot?.syncRequestedAt === "string"
        ? input.snapshot.syncRequestedAt
        : typeof input.record?.existing_members_sync_requested_at === "string"
          ? input.record.existing_members_sync_requested_at
          : null,
    syncStartedAt:
      typeof input.snapshot?.syncStartedAt === "string"
        ? input.snapshot.syncStartedAt
        : typeof input.record?.existing_members_sync_started_at === "string"
          ? input.record.existing_members_sync_started_at
          : null,
    syncCompletedAt:
      typeof input.snapshot?.syncCompletedAt === "string"
        ? input.snapshot.syncCompletedAt
        : typeof input.record?.existing_members_sync_completed_at === "string"
          ? input.record.existing_members_sync_completed_at
          : null,
    syncError:
      typeof input.snapshot?.syncError === "string"
        ? input.snapshot.syncError
        : typeof input.record?.existing_members_sync_error === "string"
          ? input.record.existing_members_sync_error
          : null,
    updatedAt: input.updatedAt,
  };
}

function resolveSnapshotSecurityLogEvent(
  value: unknown,
  textSet: Set<string>,
): SecurityLogEventPayload {
  const record = toRecordOrNull(value);
  return {
    enabled: record?.enabled === true,
    channelId:
      typeof record?.channelId === "string" && textSet.has(record.channelId)
        ? record.channelId
        : null,
  };
}

function buildSecurityLogsPayload(input: {
  record: Record<string, unknown> | null;
  snapshot: Record<string, unknown> | null;
  textSet: Set<string>;
  updatedAt: string | null;
}) {
  if (!input.record && !input.snapshot) {
    return null;
  }

  if (input.snapshot) {
    const events = toRecordOrNull(input.snapshot.events);
    return {
      enabled: input.snapshot.enabled === true,
      useDefaultChannel: input.snapshot.useDefaultChannel === true,
      defaultChannelId:
        typeof input.snapshot.defaultChannelId === "string" &&
        input.textSet.has(input.snapshot.defaultChannelId)
          ? input.snapshot.defaultChannelId
          : null,
      events: {
        nicknameChange: resolveSnapshotSecurityLogEvent(
          events?.nicknameChange,
          input.textSet,
        ),
        avatarChange: resolveSnapshotSecurityLogEvent(
          events?.avatarChange,
          input.textSet,
        ),
        voiceJoin: resolveSnapshotSecurityLogEvent(
          events?.voiceJoin,
          input.textSet,
        ),
        voiceLeave: resolveSnapshotSecurityLogEvent(
          events?.voiceLeave,
          input.textSet,
        ),
        messageDelete: resolveSnapshotSecurityLogEvent(
          events?.messageDelete,
          input.textSet,
        ),
        messageEdit: resolveSnapshotSecurityLogEvent(
          events?.messageEdit,
          input.textSet,
        ),
        memberBan: resolveSnapshotSecurityLogEvent(
          events?.memberBan,
          input.textSet,
        ),
        memberUnban: resolveSnapshotSecurityLogEvent(
          events?.memberUnban,
          input.textSet,
        ),
        memberKick: resolveSnapshotSecurityLogEvent(
          events?.memberKick,
          input.textSet,
        ),
        memberTimeout: resolveSnapshotSecurityLogEvent(
          events?.memberTimeout,
          input.textSet,
        ),
        voiceMute: resolveSnapshotSecurityLogEvent(
          events?.voiceMute,
          input.textSet,
        ),
      },
      updatedAt: input.updatedAt,
    };
  }

  return {
    enabled: input.record?.enabled === true,
    useDefaultChannel: input.record?.use_default_channel === true,
    defaultChannelId: resolveOptionalTextChannelId(
      input.record?.default_channel_id,
      input.textSet,
    ),
    events: {
      nicknameChange: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "nickname_change_enabled",
        channelColumn: "nickname_change_channel_id",
        textSet: input.textSet,
      }),
      avatarChange: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "avatar_change_enabled",
        channelColumn: "avatar_change_channel_id",
        textSet: input.textSet,
      }),
      voiceJoin: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "voice_join_enabled",
        channelColumn: "voice_join_channel_id",
        textSet: input.textSet,
      }),
      voiceLeave: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "voice_leave_enabled",
        channelColumn: "voice_leave_channel_id",
        textSet: input.textSet,
      }),
      messageDelete: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "message_delete_enabled",
        channelColumn: "message_delete_channel_id",
        textSet: input.textSet,
      }),
      messageEdit: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "message_edit_enabled",
        channelColumn: "message_edit_channel_id",
        textSet: input.textSet,
      }),
      memberBan: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "member_ban_enabled",
        channelColumn: "member_ban_channel_id",
        textSet: input.textSet,
      }),
      memberUnban: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "member_unban_enabled",
        channelColumn: "member_unban_channel_id",
        textSet: input.textSet,
      }),
      memberKick: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "member_kick_enabled",
        channelColumn: "member_kick_channel_id",
        textSet: input.textSet,
      }),
      memberTimeout: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "member_timeout_enabled",
        channelColumn: "member_timeout_channel_id",
        textSet: input.textSet,
      }),
      voiceMute: resolveSecurityLogEvent(input.record!, {
        enabledColumn: "voice_mute_enabled",
        channelColumn: "voice_mute_channel_id",
        textSet: input.textSet,
      }),
    },
    updatedAt: input.updatedAt,
  };
}

async function ensureGuildAccess(guildId: string) {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    };
  }

  if (!sessionData.accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      ),
    };
  }

  const [
    { permissions: dashboardPerms, isTeamServer },
    accessibleGuild,
    managedServers,
  ] = await Promise.all([
    getEffectiveDashboardPermissions({
      authUserId: sessionData.authSession.user.id,
      guildId,
    }),
    assertUserAdminInGuildOrNull(
      {
        authSession: sessionData.authSession,
        accessToken: sessionData.accessToken,
      },
      guildId,
    ),
    getPanelManagedServersForCurrentSession(),
  ]);

  const isPanelServer = managedServers.some((server) => server.guildId === guildId);
  const hasTeamAccess =
    dashboardPerms === "full" ||
    (dashboardPerms instanceof Set && dashboardPerms.size > 0);
  const hasOwnerAccess = Boolean(
    !isTeamServer && isPanelServer && accessibleGuild && dashboardPerms === "full",
  );
  const hasAccess = isTeamServer ? hasTeamAccess : hasOwnerAccess;

  if (!hasAccess) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Acesso negado." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    sessionData,
    accessibleGuild,
    dashboardPerms:
      dashboardPerms instanceof Set && hasOwnerAccess
        ? "full"
        : dashboardPerms,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const guildId = (url.searchParams.get("guildId") || "").trim();

    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Guild ID invalido." },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return applyNoStoreHeaders(access.response);
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: access.sessionData.authSession.user.id,
      guildId,
      source: "guild_dashboard_settings_get",
    });

    const cacheKey = buildDashboardSettingsCacheKey({
      userId: access.sessionData.authSession.user.id,
      guildId,
      dashboardPermissions:
        access.dashboardPerms === "full"
          ? "full"
          : new Set(Array.from(access.dashboardPerms)),
    });
    const cachedPayload =
      readDashboardSettingsCache<Record<string, unknown>>(cacheKey);
    if (cachedPayload) {
      return applyNoStoreHeaders(NextResponse.json(cachedPayload));
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const [
      rawChannels,
      rawRoles,
      ticketResult,
      staffResult,
      welcomeResult,
      antiLinkResult,
      autoRoleResult,
      securityLogsResult,
      secureSnapshots,
    ] = await Promise.all([
      fetchGuildChannelsByBot(guildId),
      fetchGuildRolesByBot(guildId),
      loadGuildTicketSettings(supabase, guildId),
      supabase
        .from("guild_ticket_staff_settings")
        .select(
          "admin_role_id, claim_role_ids, close_role_ids, notify_role_ids, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
      supabase
        .from("guild_welcome_settings")
        .select(
          "enabled, entry_public_channel_id, entry_log_channel_id, exit_public_channel_id, exit_log_channel_id, entry_layout, exit_layout, entry_thumbnail_mode, exit_thumbnail_mode, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
      supabase
        .from("guild_antilink_settings")
        .select(
          "enabled, log_channel_id, enforcement_action, timeout_minutes, ignored_role_ids, ignored_channel_ids, block_external_links, block_discord_invites, block_obfuscated_links, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
      supabase
        .from("guild_autorole_settings")
        .select(
          "enabled, role_ids, assignment_delay_minutes, existing_members_sync_requested_at, existing_members_sync_started_at, existing_members_sync_completed_at, existing_members_sync_status, existing_members_sync_error, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
      supabase
        .from("guild_security_logs_settings")
        .select(
          "enabled, use_default_channel, default_channel_id, nickname_change_enabled, nickname_change_channel_id, avatar_change_enabled, avatar_change_channel_id, voice_join_enabled, voice_join_channel_id, voice_leave_enabled, voice_leave_channel_id, message_delete_enabled, message_delete_channel_id, message_edit_enabled, message_edit_channel_id, member_ban_enabled, member_ban_channel_id, member_unban_enabled, member_unban_channel_id, member_kick_enabled, member_kick_channel_id, member_timeout_enabled, member_timeout_channel_id, voice_mute_enabled, voice_mute_channel_id, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
      readServerSettingsVaultSnapshots({
        guildId,
        moduleKeys: [
          "ticket_settings",
          "ticket_staff_settings",
          "welcome_settings",
          "antilink_settings",
          "autorole_settings",
          "security_logs_settings",
        ] satisfies ServerSettingsVaultModule[],
      }),
    ]);

    if (!rawChannels) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message: "Bot nao possui acesso aos canais deste servidor.",
          },
          { status: 403 },
        ),
      );
    }

    if (!rawRoles) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message: "Bot nao possui acesso aos cargos deste servidor.",
          },
          { status: 403 },
        ),
      );
    }

    if (ticketResult.error) throw new Error(ticketResult.error.message);
    if (staffResult.error) throw new Error(staffResult.error.message);
    if (welcomeResult.error) throw new Error(welcomeResult.error.message);
    if (antiLinkResult.error) throw new Error(antiLinkResult.error.message);
    if (autoRoleResult.error) throw new Error(autoRoleResult.error.message);
    if (securityLogsResult.error) {
      throw new Error(securityLogsResult.error.message);
    }

    const categories = sortChannels(
      rawChannels
        .filter((channel) => channel.type === GUILD_CATEGORY)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          position: channel.position || 0,
        })),
    );

    const textChannels = sortChannels(
      rawChannels
        .filter(
          (channel) =>
            channel.type === GUILD_TEXT || channel.type === GUILD_ANNOUNCEMENT,
        )
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          position: channel.position || 0,
        })),
    );
    const textSet = new Set(textChannels.map((channel) => channel.id));

    const roles = sortRoles(
      rawRoles
        .filter((role) => role.id !== guildId && !role.managed)
        .map((role) => ({
          id: role.id,
          name: role.name,
          color: role.color,
          position: role.position,
        })),
    );
    const roleSet = new Set(roles.map((role) => role.id));
    const categorySet = new Set(categories.map((channel) => channel.id));

    const payload = {
      ok: true as const,
      guild: {
        id: access.accessibleGuild?.id || guildId,
        name: access.accessibleGuild?.name || "Servidor selecionado",
      },
      channels: {
        text: textChannels,
        categories,
      },
      roles,
      ticketSettings: buildTicketSettingsPayload({
        record: toRecordOrNull(ticketResult.data),
        snapshot: toRecordOrNull(secureSnapshots.get("ticket_settings")?.payload),
        textSet,
        categorySet,
        updatedAt:
          secureSnapshots.get("ticket_settings")?.updatedAt ||
          (typeof ticketResult.data?.updated_at === "string"
            ? ticketResult.data.updated_at
            : null),
      }),
      staffSettings: buildTicketStaffPayload({
        record: toRecordOrNull(staffResult.data),
        snapshot: toRecordOrNull(
          secureSnapshots.get("ticket_staff_settings")?.payload,
        ),
        roleSet,
        updatedAt:
          secureSnapshots.get("ticket_staff_settings")?.updatedAt ||
          (typeof staffResult.data?.updated_at === "string"
            ? staffResult.data.updated_at
            : null),
      }),
      welcomeSettings: buildWelcomePayload({
        record: toRecordOrNull(welcomeResult.data),
        snapshot: toRecordOrNull(secureSnapshots.get("welcome_settings")?.payload),
        textSet,
        updatedAt:
          secureSnapshots.get("welcome_settings")?.updatedAt ||
          (typeof welcomeResult.data?.updated_at === "string"
            ? welcomeResult.data.updated_at
            : null),
      }),
      antiLinkSettings: buildAntiLinkPayload({
        record: toRecordOrNull(antiLinkResult.data),
        snapshot: toRecordOrNull(
          secureSnapshots.get("antilink_settings")?.payload,
        ),
        textSet,
        roleSet,
        updatedAt:
          secureSnapshots.get("antilink_settings")?.updatedAt ||
          (typeof antiLinkResult.data?.updated_at === "string"
            ? antiLinkResult.data.updated_at
            : null),
      }),
      autoRoleSettings: buildAutoRolePayload({
        record: toRecordOrNull(autoRoleResult.data),
        snapshot: toRecordOrNull(
          secureSnapshots.get("autorole_settings")?.payload,
        ),
        roleSet,
        updatedAt:
          secureSnapshots.get("autorole_settings")?.updatedAt ||
          (typeof autoRoleResult.data?.updated_at === "string"
            ? autoRoleResult.data.updated_at
            : null),
      }),
      securityLogsSettings: buildSecurityLogsPayload({
        record: toRecordOrNull(securityLogsResult.data),
        snapshot: toRecordOrNull(
          secureSnapshots.get("security_logs_settings")?.payload,
        ),
        textSet,
        updatedAt:
          secureSnapshots.get("security_logs_settings")?.updatedAt ||
          (typeof securityLogsResult.data?.updated_at === "string"
            ? securityLogsResult.data.updated_at
            : null),
      }),
      dashboardPermissions:
        access.dashboardPerms === "full"
          ? "full"
          : Array.from(access.dashboardPerms),
    };

    writeDashboardSettingsCache(
      cacheKey,
      payload,
      DASHBOARD_SETTINGS_CACHE_TTL_MS,
    );
    return applyNoStoreHeaders(NextResponse.json(payload));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao carregar configuracoes do servidor.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
