import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { getGuildLicenseStatus } from "@/lib/payments/licenseStatus";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import {
  createServerSaveDiagnosticContext,
  recordServerSaveDiagnostic,
  resolveServerSaveAccessMode,
} from "@/lib/servers/serverSaveDiagnostics";
import {
  extractAuditErrorMessage,
  sanitizeErrorMessage,
} from "@/lib/security/errors";
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
  | "voiceMove";

type SecurityLogEventConfig = {
  enabled: boolean;
  channelId: string | null;
};

type SecurityLogsSettings = Record<SecurityLogEventKey, SecurityLogEventConfig>;

type SecurityLogsSettingsBody = {
  guildId?: unknown;
  events?: unknown;
};

type GuildAccessContext = {
  sessionData: NonNullable<Awaited<ReturnType<typeof resolveSessionAccessToken>>>;
  accessibleGuild: Awaited<ReturnType<typeof assertUserAdminInGuildOrNull>>;
  hasTeamAccess: boolean;
};

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
    key: "voiceMove",
    enabledColumn: "voice_move_enabled",
    channelColumn: "voice_move_channel_id",
    label: "movimentacao entre calls",
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
    voiceMove: { enabled: false, channelId: null },
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
): SecurityLogsSettings {
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

  return output;
}

function buildUpsertPayload(input: {
  guildId: string;
  events: SecurityLogsSettings;
  configuredByUserId: number;
}) {
  const payload: Record<string, unknown> = {
    guild_id: input.guildId,
    configured_by_user_id: input.configuredByUserId,
  };

  for (const descriptor of SECURITY_LOG_EVENT_DESCRIPTORS) {
    payload[descriptor.enabledColumn] = input.events[descriptor.key].enabled;
    payload[descriptor.channelColumn] = input.events[descriptor.key].channelId;
  }

  return payload;
}

function buildSelectColumns() {
  const columns: string[] = SECURITY_LOG_EVENT_DESCRIPTORS.flatMap(
    (descriptor) => [
    descriptor.enabledColumn,
    descriptor.channelColumn,
    ],
  );
  columns.push("updated_at");
  return columns.join(", ");
}

async function upsertSecurityLogsSettingsWithRetry(input: {
  guildId: string;
  events: SecurityLogsSettings;
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

  const accessibleGuild = await assertUserAdminInGuildOrNull(
    {
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    },
    guildId,
  );

  const hasTeamAccess = accessibleGuild
    ? false
    : await hasAcceptedTeamAccessToGuild(
        {
          authSession: sessionData.authSession,
          accessToken: sessionData.accessToken,
        },
        guildId,
      );

  if (
    !accessibleGuild &&
    !hasTeamAccess &&
    sessionData.authSession.activeGuildId !== guildId
  ) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    context: {
      sessionData,
      accessibleGuild,
      hasTeamAccess,
    } satisfies GuildAccessContext,
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
      return access.response;
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: access.context.sessionData.authSession.user.id,
      guildId,
      source: "guild_security_logs_settings_get",
    });

    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase
      .from("guild_security_logs_settings")
      .select(buildSelectColumns())
      .eq("guild_id", guildId)
      .maybeSingle();

    if (result.error) {
      throw new Error(result.error.message);
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
          events: mapSecurityLogsRecordToPayload(settingsRecord),
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
    let body: SecurityLogsSettingsBody = {};
    try {
      body = (await request.json()) as SecurityLogsSettingsBody;
    } catch {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Payload JSON invalido.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Payload JSON invalido." },
          { status: 400 },
        ),
      );
    }

    const guildId = getTrimmedId(body.guildId);
    const events = normalizeSecurityLogEventsInput(body.events);

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

    for (const descriptor of SECURITY_LOG_EVENT_DESCRIPTORS) {
      const config = events[descriptor.key];
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

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return access.response;
    }

    const authUserId = access.context.sessionData.authSession.user.id;
    const accessMode = resolveServerSaveAccessMode({
      accessibleGuild: access.context.accessibleGuild,
      hasTeamAccess: access.context.hasTeamAccess,
    });
    const canManageServer = Boolean(
      access.context.accessibleGuild?.owner || access.context.hasTeamAccess,
    );

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

    for (const descriptor of SECURITY_LOG_EVENT_DESCRIPTORS) {
      const config = events[descriptor.key];
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
        events,
        configuredByUserId: authUserId,
      });
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
          events: mapSecurityLogsRecordToPayload(savedSettings),
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
