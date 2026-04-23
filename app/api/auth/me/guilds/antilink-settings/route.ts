import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
  fetchGuildRolesByBot,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { 
  getEffectiveDashboardPermissions, 
  type TeamRolePermission 
} from "@/lib/teams/userTeams";
import { getGuildLicenseStatus } from "@/lib/payments/licenseStatus";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import {
  createServerSaveDiagnosticContext,
  recordServerSaveDiagnostic,
  resolveServerSaveAccessMode,
} from "@/lib/servers/serverSaveDiagnostics";
import { invalidateDashboardSettingsCache } from "@/lib/servers/serverDashboardSettingsCache";
import {
  readServerSettingsVaultSnapshot,
  writeServerSettingsVaultSnapshot,
} from "@/lib/servers/serverSettingsVault";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import { sendServerSettingsSavedEmailSafe } from "@/lib/mail/transactional";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const MAX_IGNORED_ROLE_IDS = 30;

type AntiLinkEnforcementAction = "delete_only" | "timeout" | "kick" | "ban";

const OPTIONAL_DISCORD_SNOWFLAKE_TEXT = flowSecureDto.string({
  maxLength: 20,
  pattern: /^(?:\d{17,20})?$/,
  allowEmpty: true,
  disallowAngleBrackets: true,
  rejectThreatPatterns: false,
});

function getTrimmedId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveOptionalId(value: unknown) {
  const trimmed = getTrimmedId(value);
  return trimmed || null;
}

function normalizeAction(value: unknown): AntiLinkEnforcementAction {
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

function normalizeTimeoutMinutes(value: unknown) {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(10080, Math.max(1, parsed));
}

function normalizeRoleIdList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => isGuildId(item)),
    ),
  ).slice(0, MAX_IGNORED_ROLE_IDS);
}

function normalizeChannelIdList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => isGuildId(item)),
    ),
  ).slice(0, 30);
}

function isValidTextChannelType(type?: number) {
  return type === GUILD_TEXT || type === GUILD_ANNOUNCEMENT;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function upsertAntiLinkSettingsWithRetry(input: {
  guildId: string;
  enabled: boolean;
  logChannelId: string | null;
  enforcementAction: AntiLinkEnforcementAction;
  timeoutMinutes: number;
  ignoredRoleIds: string[];
  ignoredChannelIds: string[];
  blockExternalLinks: boolean;
  blockDiscordInvites: boolean;
  blockObfuscatedLinks: boolean;
  configuredByUserId: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await supabase
      .from("guild_antilink_settings")
      .upsert(
        {
          guild_id: input.guildId,
          enabled: input.enabled,
          log_channel_id: input.logChannelId,
          enforcement_action: input.enforcementAction,
          timeout_minutes: input.timeoutMinutes,
          ignored_role_ids: input.ignoredRoleIds,
          ignored_channel_ids: input.ignoredChannelIds,
          block_external_links: input.blockExternalLinks,
          block_discord_invites: input.blockDiscordInvites,
          block_obfuscated_links: input.blockObfuscatedLinks,
          configured_by_user_id: input.configuredByUserId,
        },
        { onConflict: "guild_id" },
      )
      .select(
        "guild_id, enabled, log_channel_id, enforcement_action, timeout_minutes, ignored_role_ids, ignored_channel_ids, block_external_links, block_discord_invites, block_obfuscated_links, updated_at",
      )
      .single();

    if (!result.error) {
      return result.data;
    }

    lastError = new Error(result.error.message);

    if (attempt < maxAttempts) {
      await wait(240 * attempt);
    }
  }

  throw lastError || new Error("Falha ao salvar configuracoes anti-link.");
}

async function ensureGuildAccess(guildId: string, requiredPermission: TeamRolePermission) {
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

  const { permissions: dashboardPerms, isTeamServer } = await getEffectiveDashboardPermissions({
    authUserId: sessionData.authSession.user.id,
    guildId: guildId,
  });

  const accessibleGuild = await assertUserAdminInGuildOrNull(
    {
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    },
    guildId,
  );

  const hasFullAccess = dashboardPerms === "full";
  const hasSpecificPerm = dashboardPerms instanceof Set && dashboardPerms.has(requiredPermission);
  
  // Rule: Team server requires Team Permission. Personal server requires Discord Admin.
  const canManage = hasFullAccess || hasSpecificPerm || (!isTeamServer && accessibleGuild);

  if (!canManage) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Voce nao possui permissao para gerenciar este modulo." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    context: {
      sessionData,
      accessibleGuild,
      hasTeamAccess: isTeamServer,
      dashboardPerms,
    },
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

    const access = await ensureGuildAccess(guildId, "server_manage_antilink");
    if (!access.ok) {
      return access.response;
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: access.context.sessionData.authSession.user.id,
      guildId,
      source: "guild_antilink_settings_get",
    });

    const supabase = getSupabaseAdminClientOrThrow();
    const [result, secureSnapshotResult] = await Promise.all([
      supabase
        .from("guild_antilink_settings")
        .select(
          "enabled, log_channel_id, enforcement_action, timeout_minutes, ignored_role_ids, ignored_channel_ids, block_external_links, block_discord_invites, block_obfuscated_links, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
      readServerSettingsVaultSnapshot<Record<string, unknown>>({
        guildId,
        moduleKey: "antilink_settings",
      }),
    ]);

    if (result.error) {
      throw new Error(result.error.message);
    }

    const secureSnapshot =
      secureSnapshotResult?.payload &&
      typeof secureSnapshotResult.payload === "object"
        ? (secureSnapshotResult.payload as Record<string, unknown>)
        : null;
    if (secureSnapshot) {
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          settings: {
            enabled: secureSnapshot.enabled === true,
            logChannelId:
              typeof secureSnapshot.logChannelId === "string"
                ? secureSnapshot.logChannelId
                : null,
            enforcementAction: normalizeAction(secureSnapshot.enforcementAction),
            timeoutMinutes: normalizeTimeoutMinutes(secureSnapshot.timeoutMinutes),
            ignoredRoleIds: Array.isArray(secureSnapshot.ignoredRoleIds)
              ? secureSnapshot.ignoredRoleIds.filter(
                  (roleId): roleId is string => typeof roleId === "string",
                )
              : [],
            ignoredChannelIds: Array.isArray(secureSnapshot.ignoredChannelIds)
              ? secureSnapshot.ignoredChannelIds.filter(
                  (channelId): channelId is string => typeof channelId === "string",
                )
              : [],
            blockExternalLinks: secureSnapshot.blockExternalLinks !== false,
            blockDiscordInvites: secureSnapshot.blockDiscordInvites !== false,
            blockObfuscatedLinks: secureSnapshot.blockObfuscatedLinks !== false,
            updatedAt: secureSnapshotResult?.updatedAt || null,
          },
        }),
      );
    }

    if (!result.data) {
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          settings: null,
        }),
      );
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        settings: {
          enabled: Boolean(result.data.enabled),
          logChannelId: result.data.log_channel_id,
          enforcementAction: normalizeAction(result.data.enforcement_action),
          timeoutMinutes: normalizeTimeoutMinutes(result.data.timeout_minutes),
          ignoredRoleIds: Array.isArray(result.data.ignored_role_ids)
            ? result.data.ignored_role_ids.filter(
                (roleId): roleId is string => typeof roleId === "string",
              )
            : [],
          ignoredChannelIds: Array.isArray(result.data.ignored_channel_ids)
            ? result.data.ignored_channel_ids.filter(
                (channelId): channelId is string => typeof channelId === "string",
              )
            : [],
          blockExternalLinks: true,
          blockDiscordInvites: true,
          blockObfuscatedLinks: true,
          updatedAt: result.data.updated_at,
        },
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao carregar configuracoes anti-link.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}

export async function POST(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) {
    return applyNoStoreHeaders(invalidMutationResponse);
  }

  let diagnostic = createServerSaveDiagnosticContext("antilink_settings");

  try {
    let body: {
      guildId: string;
      enabled?: boolean;
      logChannelId?: string | null;
      enforcementAction?: AntiLinkEnforcementAction;
      timeoutMinutes?: number;
      ignoredRoleIds?: string[];
      ignoredChannelIds?: string[];
      blockExternalLinks?: boolean;
      blockDiscordInvites?: boolean;
      blockObfuscatedLinks?: boolean;
    };
    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.discordSnowflake(),
          enabled: flowSecureDto.optional(flowSecureDto.boolean()),
          logChannelId: flowSecureDto.optional(
            flowSecureDto.nullable(OPTIONAL_DISCORD_SNOWFLAKE_TEXT),
          ),
          enforcementAction: flowSecureDto.optional(
            flowSecureDto.enum(["delete_only", "timeout", "kick", "ban"] as const),
          ),
          timeoutMinutes: flowSecureDto.optional(
            flowSecureDto.number({
              integer: true,
              min: 1,
              max: 10080,
            }),
          ),
          ignoredRoleIds: flowSecureDto.optional(
            flowSecureDto.array(flowSecureDto.discordSnowflake(), {
              maxLength: MAX_IGNORED_ROLE_IDS,
            }),
          ),
          ignoredChannelIds: flowSecureDto.optional(
            flowSecureDto.array(flowSecureDto.discordSnowflake(), {
              maxLength: 30,
            }),
          ),
          blockExternalLinks: flowSecureDto.optional(flowSecureDto.boolean()),
          blockDiscordInvites: flowSecureDto.optional(flowSecureDto.boolean()),
          blockObfuscatedLinks: flowSecureDto.optional(flowSecureDto.boolean()),
        },
        {
          rejectUnknown: true,
        },
      );
    } catch (error) {
      if (!(error instanceof FlowSecureDtoError)) {
        throw error;
      }
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: error.issues[0] || error.message,
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: error.issues[0] || error.message },
          { status: 400 },
        ),
      );
    }

    const guildId = body.guildId;
    const enabled = body.enabled ?? false;
    const logChannelId = resolveOptionalId(body.logChannelId);
    const enforcementAction = normalizeAction(body.enforcementAction);
    const timeoutMinutes = normalizeTimeoutMinutes(body.timeoutMinutes);
    const ignoredRoleIds = normalizeRoleIdList(body.ignoredRoleIds);
    const ignoredChannelIds = normalizeChannelIdList(body.ignoredChannelIds);
    const blockExternalLinks = true;
    const blockDiscordInvites = true;
    const blockObfuscatedLinks = true;

    diagnostic = createServerSaveDiagnosticContext("antilink_settings", guildId);

    if (!isGuildId(guildId)) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Guild ID invalido.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Guild ID invalido." },
          { status: 400 },
        ),
      );
    }

    if (enabled && !logChannelId) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Canal de log obrigatorio quando o modulo esta ativo.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Escolha um canal de log para registrar as acoes do anti-link.",
          },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_antilink");
    if (!access.ok) {
      return access.response;
    }

    const authUserId = access.context.sessionData.authSession.user.id;
    const accessMode = resolveServerSaveAccessMode({
      accessibleGuild: access.context.accessibleGuild,
      hasTeamAccess: access.context.hasTeamAccess,
    });

    let licenseStatus = await getGuildLicenseStatus(guildId);
    if (licenseStatus !== "paid") {
      licenseStatus = await getGuildLicenseStatus(guildId, { forceFresh: true });
    }

    if (licenseStatus === "expired" || licenseStatus === "off") {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "license_blocked",
        httpStatus: 403,
        detail: "Licenca sem permissao para salvar configuracoes.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "A licenca deste servidor nao permite alterar configuracoes agora.",
          },
          { status: 403 },
        ),
      );
    }

    const [rawChannels, rawRoles] = await Promise.all([
      fetchGuildChannelsByBot(guildId),
      fetchGuildRolesByBot(guildId),
    ]);

    if (!rawChannels) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "bot_access_missing",
        httpStatus: 403,
        detail: "Bot sem acesso aos canais do servidor.",
      });
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
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "bot_access_missing",
        httpStatus: 403,
        detail: "Bot sem acesso aos cargos do servidor.",
      });
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

    const textChannelIds = new Set(
      rawChannels
        .filter((channel) => isValidTextChannelType(channel.type))
        .map((channel) => channel.id),
    );

    if (enabled && logChannelId && !textChannelIds.has(logChannelId)) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "validation_failed",
        httpStatus: 400,
        detail: "Canal de log anti-link invalido.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "O canal de log informado nao existe mais ou nao e um canal de texto.",
          },
          { status: 400 },
        ),
      );
    }

    const guildRoleIds = new Set(
      rawRoles
        .filter((role) => role.id !== guildId && !role.managed)
        .map((role) => role.id),
    );
    const hasInvalidRole = ignoredRoleIds.some((roleId) => !guildRoleIds.has(roleId));
    if (hasInvalidRole) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "validation_failed",
        httpStatus: 400,
        detail: "Lista de cargos ignorados contem IDs invalidos.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Um ou mais cargos ignorados nao existem mais neste servidor.",
          },
          { status: 400 },
        ),
      );
    }

    const hasInvalidChannel = ignoredChannelIds.some((channelId) => !textChannelIds.has(channelId));
    if (hasInvalidChannel) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "validation_failed",
        httpStatus: 400,
        detail: "Lista de canais ignorados contem IDs invalidos.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Um ou mais canais ignorados nao existem mais neste servidor.",
          },
          { status: 400 },
        ),
      );
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: authUserId,
      guildId,
      source: "guild_antilink_settings_post",
    });

    let savedSettings: Awaited<ReturnType<typeof upsertAntiLinkSettingsWithRetry>>;
    try {
      savedSettings = await upsertAntiLinkSettingsWithRetry({
        guildId,
        enabled,
        logChannelId,
        enforcementAction,
        timeoutMinutes,
        ignoredRoleIds,
        ignoredChannelIds,
        blockExternalLinks,
        blockDiscordInvites,
        blockObfuscatedLinks,
        configuredByUserId: authUserId,
      });
      await writeServerSettingsVaultSnapshot({
        guildId,
        moduleKey: "antilink_settings",
        configuredByUserId: authUserId,
        payload: {
          enabled,
          logChannelId,
          enforcementAction,
          timeoutMinutes,
          ignoredRoleIds,
          ignoredChannelIds,
          blockExternalLinks,
          blockDiscordInvites,
          blockObfuscatedLinks,
        },
      });
      invalidateDashboardSettingsCache({ guildId });
    } catch (error) {
      const auditDetail = extractAuditErrorMessage(error);
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "failed",
        httpStatus: 500,
        detail: auditDetail,
      });
      throw error;
    }

    recordServerSaveDiagnostic({
      context: diagnostic,
      authUserId,
      accessMode,
      licenseStatus,
      outcome: "saved",
      httpStatus: 200,
      detail: "Configuracoes anti-link salvas com sucesso.",
      meta: {
        enabled,
        enforcementAction,
        timeoutMinutes,
        ignoredRoleCount: ignoredRoleIds.length,
      },
    });
    void sendServerSettingsSavedEmailSafe({
      user: access.context.sessionData.authSession.user,
      guildId,
      moduleLabel: "Anti-link",
      detail: enabled ? "Modulo ativo" : "Modulo desativado",
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        settings: {
          enabled: Boolean(savedSettings.enabled),
          logChannelId: savedSettings.log_channel_id,
          enforcementAction: normalizeAction(savedSettings.enforcement_action),
          timeoutMinutes: normalizeTimeoutMinutes(savedSettings.timeout_minutes),
          ignoredRoleIds: Array.isArray(savedSettings.ignored_role_ids)
            ? savedSettings.ignored_role_ids.filter(
                (roleId): roleId is string => typeof roleId === "string",
              )
            : [],
          ignoredChannelIds: Array.isArray(savedSettings.ignored_channel_ids)
            ? savedSettings.ignored_channel_ids.filter(
                (channelId): channelId is string => typeof channelId === "string",
              )
            : [],
          blockExternalLinks: true,
          blockDiscordInvites: true,
          blockObfuscatedLinks: true,
          updatedAt: savedSettings.updated_at,
        },
      }),
    );
  } catch (error) {
    const statusCode =
      error instanceof Error && /nao autenticado|acesso negado/i.test(error.message)
        ? 401
        : 500;

    recordServerSaveDiagnostic({
      context: diagnostic,
      outcome: "failed",
      httpStatus: statusCode,
      detail: extractAuditErrorMessage(error),
    });

    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao salvar configuracoes anti-link.",
          ),
        },
        { status: statusCode },
      ),
    );
  }
}
