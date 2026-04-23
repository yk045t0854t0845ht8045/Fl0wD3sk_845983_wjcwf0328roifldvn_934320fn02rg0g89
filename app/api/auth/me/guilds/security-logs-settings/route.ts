import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
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
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;

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
  | "voiceMute";

type SecurityLogEventConfig = {
  enabled: boolean;
  channelId: string | null;
};

type SecurityLogsSettings = Record<SecurityLogEventKey, SecurityLogEventConfig>;

type SecurityLogsSettingsBody = {
  guildId?: unknown;
  enabled?: unknown;
  useDefaultChannel?: unknown;
  defaultChannelId?: unknown;
  events?: unknown;
};

type SecurityLogsSettingsPayload = {
  enabled: boolean;
  useDefaultChannel: boolean;
  defaultChannelId: string | null;
  events: SecurityLogsSettings;
};

const OPTIONAL_DISCORD_SNOWFLAKE_TEXT = flowSecureDto.string({
  maxLength: 20,
  pattern: /^(?:\d{17,20})?$/,
  allowEmpty: true,
  disallowAngleBrackets: true,
  rejectThreatPatterns: false,
});

const SECURITY_LOG_EVENT_DESCRIPTORS = [
  {
    key: "nicknameChange",
    enabledColumn: "nickname_change_enabled",
    channelColumn: "nickname_change_channel_id",
    label: "alteracao de nickname",
  },
  {
    key: "avatarChange",
    enabledColumn: "avatar_change_enabled",
    channelColumn: "avatar_change_channel_id",
    label: "alteracao de avatar",
  },
  {
    key: "voiceJoin",
    enabledColumn: "voice_join_enabled",
    channelColumn: "voice_join_channel_id",
    label: "entrada em canal de voz",
  },
  {
    key: "voiceLeave",
    enabledColumn: "voice_leave_enabled",
    channelColumn: "voice_leave_channel_id",
    label: "saida de canal de voz",
  },
  {
    key: "messageDelete",
    enabledColumn: "message_delete_enabled",
    channelColumn: "message_delete_channel_id",
    label: "mensagem deletada",
  },
  {
    key: "messageEdit",
    enabledColumn: "message_edit_enabled",
    channelColumn: "message_edit_channel_id",
    label: "mensagem editada",
  },
  {
    key: "memberBan",
    enabledColumn: "member_ban_enabled",
    channelColumn: "member_ban_channel_id",
    label: "banimento de membro",
  },
  {
    key: "memberUnban",
    enabledColumn: "member_unban_enabled",
    channelColumn: "member_unban_channel_id",
    label: "desbanimento de membro",
  },
  {
    key: "memberKick",
    enabledColumn: "member_kick_enabled",
    channelColumn: "member_kick_channel_id",
    label: "expulsao de membro",
  },
  {
    key: "memberTimeout",
    enabledColumn: "member_timeout_enabled",
    channelColumn: "member_timeout_channel_id",
    label: "silenciamento de membro",
  },

  {
    key: "voiceMute",
    enabledColumn: "voice_mute_enabled",
    channelColumn: "voice_mute_channel_id",
    label: "mute e desmute em call",
  },
] as const satisfies ReadonlyArray<{
  key: SecurityLogEventKey;
  enabledColumn: string;
  channelColumn: string;
  label: string;
}>;

function getTrimmedId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveOptionalId(value: unknown) {
  const trimmed = getTrimmedId(value);
  return trimmed || null;
}

function isValidTextChannelType(type?: number) {
  return type === GUILD_TEXT || type === GUILD_ANNOUNCEMENT;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function createDefaultSecurityLogsSettings(): SecurityLogsSettings {
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
    voiceMute: { enabled: false, channelId: null },
  };
}

function normalizeSecurityLogsBodyInput(
  body: SecurityLogsSettingsBody,
): SecurityLogsSettingsPayload {
  return {
    enabled: body.enabled === true,
    useDefaultChannel: body.useDefaultChannel === true,
    defaultChannelId: resolveOptionalId(body.defaultChannelId),
    events: normalizeSecurityLogEventsInput(body.events),
  };
}

function normalizeSecurityLogEventsInput(value: unknown): SecurityLogsSettings {
  const defaults = createDefaultSecurityLogsSettings();
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  for (const descriptor of SECURITY_LOG_EVENT_DESCRIPTORS) {
    const rawValue = record[descriptor.key];
    const rawRecord =
      rawValue && typeof rawValue === "object"
        ? (rawValue as Record<string, unknown>)
        : {};

    defaults[descriptor.key] = {
      enabled:
        typeof rawRecord.enabled === "boolean" ? rawRecord.enabled : false,
      channelId: resolveOptionalId(rawRecord.channelId),
    };
  }

  return defaults;
}

function mapSecurityLogsRecordToPayload(
  data: Record<string, unknown>,
): SecurityLogsSettingsPayload {
  const output = createDefaultSecurityLogsSettings();

  for (const descriptor of SECURITY_LOG_EVENT_DESCRIPTORS) {
    const channelValue = data[descriptor.channelColumn];
    output[descriptor.key] = {
      enabled: data[descriptor.enabledColumn] === true,
      channelId:
        typeof channelValue === "string" && channelValue.trim().length > 0
          ? channelValue.trim()
          : null,
    };
  }

  return {
    enabled: data.enabled === true,
    useDefaultChannel: data.use_default_channel === true,
    defaultChannelId:
      typeof data.default_channel_id === "string" &&
      data.default_channel_id.trim().length > 0
        ? data.default_channel_id.trim()
        : null,
    events: output,
  };
}

function buildUpsertPayload(input: {
  guildId: string;
  settings: SecurityLogsSettingsPayload;
  configuredByUserId: number;
}) {
  const payload: Record<string, unknown> = {
    guild_id: input.guildId,
    configured_by_user_id: input.configuredByUserId,
    enabled: input.settings.enabled,
    use_default_channel: input.settings.useDefaultChannel,
    default_channel_id: input.settings.defaultChannelId,
  };

  for (const descriptor of SECURITY_LOG_EVENT_DESCRIPTORS) {
    payload[descriptor.enabledColumn] = input.settings.events[descriptor.key].enabled;
    payload[descriptor.channelColumn] = input.settings.events[descriptor.key].channelId;
  }

  return payload;
}

function buildSelectColumns() {
  const columns: string[] = ["enabled", "use_default_channel", "default_channel_id"];
  columns.push(
    ...SECURITY_LOG_EVENT_DESCRIPTORS.flatMap(
    (descriptor) => [
    descriptor.enabledColumn,
    descriptor.channelColumn,
    ],
  ));
  columns.push("updated_at");
  return columns.join(", ");
}

async function upsertSecurityLogsSettingsWithRetry(input: {
  guildId: string;
  settings: SecurityLogsSettingsPayload;
  configuredByUserId: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await supabase
      .from("guild_security_logs_settings")
      .upsert(buildUpsertPayload(input), { onConflict: "guild_id" })
      .select(buildSelectColumns())
      .single();

    if (!result.error) {
      const record = toRecordOrNull(result.data);
      if (record) {
        return record;
      }
      lastError = new Error(
        "Resposta invalida ao salvar configuracoes de logs de seguranca.",
      );
      continue;
    }

    lastError = new Error(result.error.message);

    if (attempt < maxAttempts) {
      await wait(240 * attempt);
    }
  }

  throw lastError || new Error("Falha ao salvar configuracoes de logs.");
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

    const access = await ensureGuildAccess(guildId, "server_view_security_logs");
    if (!access.ok) {
      return access.response;
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: access.context.sessionData.authSession.user.id,
      guildId,
      source: "guild_security_logs_settings_get",
    });

    const supabase = getSupabaseAdminClientOrThrow();
    const [result, secureSnapshotResult] = await Promise.all([
      supabase
        .from("guild_security_logs_settings")
        .select(buildSelectColumns())
        .eq("guild_id", guildId)
        .maybeSingle(),
      readServerSettingsVaultSnapshot<Record<string, unknown>>({
        guildId,
        moduleKey: "security_logs_settings",
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
      const mapped =
        secureSnapshot.events && typeof secureSnapshot.events === "object"
          ? (secureSnapshot.events as Record<string, unknown>)
          : {};
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          settings: {
            enabled: secureSnapshot.enabled === true,
            useDefaultChannel: secureSnapshot.useDefaultChannel === true,
            defaultChannelId:
              typeof secureSnapshot.defaultChannelId === "string"
                ? secureSnapshot.defaultChannelId
                : null,
            events: {
              nicknameChange: normalizeSecurityLogEventsInput({ nicknameChange: mapped.nicknameChange }).nicknameChange,
              avatarChange: normalizeSecurityLogEventsInput({ avatarChange: mapped.avatarChange }).avatarChange,
              voiceJoin: normalizeSecurityLogEventsInput({ voiceJoin: mapped.voiceJoin }).voiceJoin,
              voiceLeave: normalizeSecurityLogEventsInput({ voiceLeave: mapped.voiceLeave }).voiceLeave,
              messageDelete: normalizeSecurityLogEventsInput({ messageDelete: mapped.messageDelete }).messageDelete,
              messageEdit: normalizeSecurityLogEventsInput({ messageEdit: mapped.messageEdit }).messageEdit,
              memberBan: normalizeSecurityLogEventsInput({ memberBan: mapped.memberBan }).memberBan,
              memberUnban: normalizeSecurityLogEventsInput({ memberUnban: mapped.memberUnban }).memberUnban,
              memberKick: normalizeSecurityLogEventsInput({ memberKick: mapped.memberKick }).memberKick,
              memberTimeout: normalizeSecurityLogEventsInput({ memberTimeout: mapped.memberTimeout }).memberTimeout,
              voiceMute: normalizeSecurityLogEventsInput({ voiceMute: mapped.voiceMute }).voiceMute,
            },
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

    const settingsRecord = toRecordOrNull(result.data);
    if (!settingsRecord) {
      throw new Error(
        "Resposta invalida ao carregar configuracoes de logs de seguranca.",
      );
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        settings: {
          ...mapSecurityLogsRecordToPayload(settingsRecord),
          updatedAt: settingsRecord.updated_at || null,
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
            "Erro ao carregar configuracoes de logs de seguranca.",
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

  let diagnostic = createServerSaveDiagnosticContext("security_logs_settings");

  try {
    let body: {
      guildId: string;
      enabled?: boolean;
      useDefaultChannel?: boolean;
      defaultChannelId?: string | null;
      events?: Record<string, unknown>;
    };
    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.discordSnowflake(),
          enabled: flowSecureDto.optional(flowSecureDto.boolean()),
          useDefaultChannel: flowSecureDto.optional(flowSecureDto.boolean()),
          defaultChannelId: flowSecureDto.optional(
            flowSecureDto.nullable(OPTIONAL_DISCORD_SNOWFLAKE_TEXT),
          ),
          events: flowSecureDto.optional(flowSecureDto.record()),
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
    const settings = normalizeSecurityLogsBodyInput(body);

    diagnostic = createServerSaveDiagnosticContext(
      "security_logs_settings",
      guildId,
    );

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

    const hasAnyEnabledEvent = SECURITY_LOG_EVENT_DESCRIPTORS.some(
      (descriptor) => settings.events[descriptor.key].enabled,
    );

    if (
      settings.enabled &&
      settings.useDefaultChannel &&
      hasAnyEnabledEvent &&
      !settings.defaultChannelId
    ) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Canal padrao obrigatorio para logs ativos.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Escolha o canal padrao antes de ativar essa forma de roteamento dos logs.",
          },
          { status: 400 },
        ),
      );
    }

    if (settings.enabled && !settings.useDefaultChannel) {
      for (const descriptor of SECURITY_LOG_EVENT_DESCRIPTORS) {
        const config = settings.events[descriptor.key];
        if (config.enabled && !config.channelId) {
          recordServerSaveDiagnostic({
            context: diagnostic,
            outcome: "payload_invalid",
            httpStatus: 400,
            detail: `Canal obrigatorio para ${descriptor.label}.`,
          });
          return applyNoStoreHeaders(
            NextResponse.json(
              {
                ok: false,
                message: `Escolha o canal da log de ${descriptor.label} antes de ativar esta opcao.`,
              },
              { status: 400 },
            ),
          );
        }
      }
    }

    const access = await ensureGuildAccess(guildId, "server_view_security_logs");
    if (!access.ok) {
      return access.response;
    }

    const authUserId = access.context.sessionData.authSession.user.id;
    const accessMode = resolveServerSaveAccessMode({
      accessibleGuild: access.context.accessibleGuild,
      hasTeamAccess: access.context.hasTeamAccess,
    });
    const canManageServer = true; // ensureGuildAccess already checked this

    if (!canManageServer) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        outcome: "view_only",
        httpStatus: 403,
        detail: "Conta em modo somente visualizacao.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Esta conta esta em modo somente visualizacao para este servidor.",
          },
          { status: 403 },
        ),
      );
    }

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

    const rawChannels = await fetchGuildChannelsByBot(guildId);
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
          { ok: false, message: "Bot nao possui acesso aos canais deste servidor." },
          { status: 403 },
        ),
      );
    }

    const channelsById = new Map(rawChannels.map((channel) => [channel.id, channel]));

    if (settings.defaultChannelId) {
      const channel = channelsById.get(settings.defaultChannelId);
      if (!channel || !isValidTextChannelType(channel.type)) {
        recordServerSaveDiagnostic({
          context: diagnostic,
          authUserId,
          accessMode,
          licenseStatus,
          outcome: "validation_failed",
          httpStatus: 400,
          detail: "Canal padrao invalido para logs de seguranca.",
        });
        return applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              message:
                "O canal padrao configurado para os logs nao existe mais ou nao e um canal de texto.",
            },
            { status: 400 },
          ),
        );
      }
    }

    for (const descriptor of SECURITY_LOG_EVENT_DESCRIPTORS) {
      const config = settings.events[descriptor.key];
      if (!config.channelId) continue;
      const channel = channelsById.get(config.channelId);
      if (!channel || !isValidTextChannelType(channel.type)) {
        recordServerSaveDiagnostic({
          context: diagnostic,
          authUserId,
          accessMode,
          licenseStatus,
          outcome: "validation_failed",
          httpStatus: 400,
          detail: `Canal invalido para ${descriptor.label}.`,
        });
        return applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              message: `O canal configurado para ${descriptor.label} nao existe mais ou nao e um canal de texto.`,
            },
            { status: 400 },
          ),
        );
      }
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: authUserId,
      guildId,
      source: "guild_security_logs_settings_post",
    });

    let savedSettings: Record<string, unknown>;
    try {
      savedSettings = await upsertSecurityLogsSettingsWithRetry({
        guildId,
        settings,
        configuredByUserId: authUserId,
      });
      await writeServerSettingsVaultSnapshot({
        guildId,
        moduleKey: "security_logs_settings",
        configuredByUserId: authUserId,
        payload: settings,
      });
      invalidateDashboardSettingsCache({ guildId });
    } catch (error) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "failed",
        httpStatus: 500,
        detail: extractAuditErrorMessage(error),
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
      detail: "Configuracoes de logs de seguranca salvas com sucesso.",
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        settings: {
          ...mapSecurityLogsRecordToPayload(savedSettings),
          updatedAt: savedSettings.updated_at || null,
        },
      }),
    );
  } catch (error) {
    recordServerSaveDiagnostic({
      context: diagnostic,
      outcome: "failed",
      httpStatus: 500,
      detail: extractAuditErrorMessage(
        error,
        "Erro ao salvar configuracoes de logs de seguranca.",
      ),
    });
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao salvar configuracoes de logs de seguranca.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
