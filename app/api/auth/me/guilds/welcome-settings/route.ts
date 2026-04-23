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
  createDefaultWelcomeEntryLayout,
  createDefaultWelcomeExitLayout,
  normalizeWelcomeLayout,
  welcomeLayoutHasContent,
  type WelcomeThumbnailMode,
} from "@/lib/servers/welcomeMessageBuilder";
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

function resolveThumbnailMode(value: unknown): WelcomeThumbnailMode {
  return value === "avatar" ? "avatar" : "custom";
}

type WelcomeSecureSnapshot = {
  enabled: boolean;
  entryPublicChannelId: string | null;
  entryLogChannelId: string | null;
  exitPublicChannelId: string | null;
  exitLogChannelId: string | null;
  entryPublicLayout: Record<string, unknown>[];
  entryLogLayout: Record<string, unknown>[];
  exitPublicLayout: Record<string, unknown>[];
  exitLogLayout: Record<string, unknown>[];
  entryPublicThumbnailMode: WelcomeThumbnailMode;
  entryLogThumbnailMode: WelcomeThumbnailMode;
  exitPublicThumbnailMode: WelcomeThumbnailMode;
  exitLogThumbnailMode: WelcomeThumbnailMode;
};

function normalizeWelcomeSecureSnapshot(
  value: unknown,
): WelcomeSecureSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const fallbackEntryLayout = normalizeWelcomeLayout(
    record.entryLayout,
    createDefaultWelcomeEntryLayout(),
  );
  const fallbackExitLayout = normalizeWelcomeLayout(
    record.exitLayout,
    createDefaultWelcomeExitLayout(),
  );

  return {
    enabled: record.enabled === true,
    entryPublicChannelId: resolveOptionalId(record.entryPublicChannelId),
    entryLogChannelId: resolveOptionalId(record.entryLogChannelId),
    exitPublicChannelId: resolveOptionalId(record.exitPublicChannelId),
    exitLogChannelId: resolveOptionalId(record.exitLogChannelId),
    entryPublicLayout: normalizeWelcomeLayout(
      record.entryPublicLayout ?? record.entryLayout,
      fallbackEntryLayout,
    ),
    entryLogLayout: normalizeWelcomeLayout(
      record.entryLogLayout ?? record.entryLayout,
      fallbackEntryLayout,
    ),
    exitPublicLayout: normalizeWelcomeLayout(
      record.exitPublicLayout ?? record.exitLayout,
      fallbackExitLayout,
    ),
    exitLogLayout: normalizeWelcomeLayout(
      record.exitLogLayout ?? record.exitLayout,
      fallbackExitLayout,
    ),
    entryPublicThumbnailMode: resolveThumbnailMode(
      record.entryPublicThumbnailMode ?? record.entryThumbnailMode,
    ),
    entryLogThumbnailMode: resolveThumbnailMode(
      record.entryLogThumbnailMode ?? record.entryThumbnailMode,
    ),
    exitPublicThumbnailMode: resolveThumbnailMode(
      record.exitPublicThumbnailMode ?? record.exitThumbnailMode,
    ),
    exitLogThumbnailMode: resolveThumbnailMode(
      record.exitLogThumbnailMode ?? record.exitThumbnailMode,
    ),
  };
}

function buildWelcomeResponseFromSecureSnapshot(input: {
  snapshot: WelcomeSecureSnapshot;
  updatedAt: string | null;
}) {
  return {
    enabled: input.snapshot.enabled,
    entryPublicChannelId: input.snapshot.entryPublicChannelId,
    entryLogChannelId: input.snapshot.entryLogChannelId,
    exitPublicChannelId: input.snapshot.exitPublicChannelId,
    exitLogChannelId: input.snapshot.exitLogChannelId,
    entryLayout: input.snapshot.entryPublicLayout,
    exitLayout: input.snapshot.exitPublicLayout,
    entryPublicLayout: input.snapshot.entryPublicLayout,
    entryLogLayout: input.snapshot.entryLogLayout,
    exitPublicLayout: input.snapshot.exitPublicLayout,
    exitLogLayout: input.snapshot.exitLogLayout,
    entryThumbnailMode: input.snapshot.entryPublicThumbnailMode,
    exitThumbnailMode: input.snapshot.exitPublicThumbnailMode,
    entryPublicThumbnailMode: input.snapshot.entryPublicThumbnailMode,
    entryLogThumbnailMode: input.snapshot.entryLogThumbnailMode,
    exitPublicThumbnailMode: input.snapshot.exitPublicThumbnailMode,
    exitLogThumbnailMode: input.snapshot.exitLogThumbnailMode,
    updatedAt: input.updatedAt,
  };
}

function isValidTextChannelType(type?: number) {
  return type === GUILD_TEXT || type === GUILD_ANNOUNCEMENT;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function upsertWelcomeSettingsWithRetry(input: {
  guildId: string;
  enabled: boolean;
  entryPublicChannelId: string | null;
  entryLogChannelId: string | null;
  exitPublicChannelId: string | null;
  exitLogChannelId: string | null;
  entryLayout: unknown;
  exitLayout: unknown;
  entryThumbnailMode: WelcomeThumbnailMode;
  exitThumbnailMode: WelcomeThumbnailMode;
  configuredByUserId: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await supabase
      .from("guild_welcome_settings")
      .upsert(
        {
          guild_id: input.guildId,
          enabled: input.enabled,
          entry_public_channel_id: input.entryPublicChannelId,
          entry_log_channel_id: input.entryLogChannelId,
          exit_public_channel_id: input.exitPublicChannelId,
          exit_log_channel_id: input.exitLogChannelId,
          entry_layout: input.entryLayout,
          exit_layout: input.exitLayout,
          entry_thumbnail_mode: input.entryThumbnailMode,
          exit_thumbnail_mode: input.exitThumbnailMode,
          configured_by_user_id: input.configuredByUserId,
        },
        { onConflict: "guild_id" },
      )
      .select(
        "guild_id, enabled, entry_public_channel_id, entry_log_channel_id, exit_public_channel_id, exit_log_channel_id, entry_layout, exit_layout, entry_thumbnail_mode, exit_thumbnail_mode, updated_at",
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

  throw lastError || new Error("Falha ao salvar configuracoes do servidor.");
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

    const access = await ensureGuildAccess(guildId, "server_manage_welcome_overview");
    if (!access.ok) {
      return access.response;
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: access.context.sessionData.authSession.user.id,
      guildId,
      source: "guild_welcome_settings_get",
    });

    const supabase = getSupabaseAdminClientOrThrow();
    const [result, secureSnapshotResult] = await Promise.all([
      supabase
        .from("guild_welcome_settings")
        .select(
          "enabled, entry_public_channel_id, entry_log_channel_id, exit_public_channel_id, exit_log_channel_id, entry_layout, exit_layout, entry_thumbnail_mode, exit_thumbnail_mode, updated_at",
        )
        .eq("guild_id", guildId)
        .maybeSingle(),
      readServerSettingsVaultSnapshot<WelcomeSecureSnapshot>({
        guildId,
        moduleKey: "welcome_settings",
      }),
    ]);

    if (result.error) {
      throw new Error(result.error.message);
    }

    const secureSnapshot = normalizeWelcomeSecureSnapshot(
      secureSnapshotResult?.payload,
    );
    if (secureSnapshot) {
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          settings: buildWelcomeResponseFromSecureSnapshot({
            snapshot: secureSnapshot,
            updatedAt: secureSnapshotResult?.updatedAt || null,
          }),
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
          entryPublicChannelId: result.data.entry_public_channel_id,
          entryLogChannelId: result.data.entry_log_channel_id,
          exitPublicChannelId: result.data.exit_public_channel_id,
          exitLogChannelId: result.data.exit_log_channel_id,
          entryLayout: normalizeWelcomeLayout(
            result.data.entry_layout,
            createDefaultWelcomeEntryLayout(),
          ),
          exitLayout: normalizeWelcomeLayout(
            result.data.exit_layout,
            createDefaultWelcomeExitLayout(),
          ),
          entryThumbnailMode: resolveThumbnailMode(result.data.entry_thumbnail_mode),
          exitThumbnailMode: resolveThumbnailMode(result.data.exit_thumbnail_mode),
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
            "Erro ao carregar configuracoes do servidor.",
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

  let diagnostic = createServerSaveDiagnosticContext("welcome_settings");

  try {
    let body: {
      guildId: string;
      enabled?: boolean;
      entryPublicChannelId?: string | null;
      entryLogChannelId?: string | null;
      exitPublicChannelId?: string | null;
      exitLogChannelId?: string | null;
      entryLayout?: Record<string, unknown>[];
      exitLayout?: Record<string, unknown>[];
      entryPublicLayout?: Record<string, unknown>[];
      entryLogLayout?: Record<string, unknown>[];
      exitPublicLayout?: Record<string, unknown>[];
      exitLogLayout?: Record<string, unknown>[];
      entryThumbnailMode?: WelcomeThumbnailMode;
      exitThumbnailMode?: WelcomeThumbnailMode;
      entryPublicThumbnailMode?: WelcomeThumbnailMode;
      entryLogThumbnailMode?: WelcomeThumbnailMode;
      exitPublicThumbnailMode?: WelcomeThumbnailMode;
      exitLogThumbnailMode?: WelcomeThumbnailMode;
    };
    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.discordSnowflake(),
          enabled: flowSecureDto.optional(flowSecureDto.boolean()),
          entryPublicChannelId: flowSecureDto.optional(
            flowSecureDto.nullable(OPTIONAL_DISCORD_SNOWFLAKE_TEXT),
          ),
          entryLogChannelId: flowSecureDto.optional(
            flowSecureDto.nullable(OPTIONAL_DISCORD_SNOWFLAKE_TEXT),
          ),
          exitPublicChannelId: flowSecureDto.optional(
            flowSecureDto.nullable(OPTIONAL_DISCORD_SNOWFLAKE_TEXT),
          ),
          exitLogChannelId: flowSecureDto.optional(
            flowSecureDto.nullable(OPTIONAL_DISCORD_SNOWFLAKE_TEXT),
          ),
          entryLayout: flowSecureDto.optional(
            flowSecureDto.array(flowSecureDto.record()),
          ),
          exitLayout: flowSecureDto.optional(
            flowSecureDto.array(flowSecureDto.record()),
          ),
          entryPublicLayout: flowSecureDto.optional(
            flowSecureDto.array(flowSecureDto.record()),
          ),
          entryLogLayout: flowSecureDto.optional(
            flowSecureDto.array(flowSecureDto.record()),
          ),
          exitPublicLayout: flowSecureDto.optional(
            flowSecureDto.array(flowSecureDto.record()),
          ),
          exitLogLayout: flowSecureDto.optional(
            flowSecureDto.array(flowSecureDto.record()),
          ),
          entryThumbnailMode: flowSecureDto.optional(
            flowSecureDto.enum(["avatar", "custom"] as const),
          ),
          exitThumbnailMode: flowSecureDto.optional(
            flowSecureDto.enum(["avatar", "custom"] as const),
          ),
          entryPublicThumbnailMode: flowSecureDto.optional(
            flowSecureDto.enum(["avatar", "custom"] as const),
          ),
          entryLogThumbnailMode: flowSecureDto.optional(
            flowSecureDto.enum(["avatar", "custom"] as const),
          ),
          exitPublicThumbnailMode: flowSecureDto.optional(
            flowSecureDto.enum(["avatar", "custom"] as const),
          ),
          exitLogThumbnailMode: flowSecureDto.optional(
            flowSecureDto.enum(["avatar", "custom"] as const),
          ),
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
    const enabled = body.enabled ?? true;
    const entryPublicChannelId = resolveOptionalId(body.entryPublicChannelId);
    const entryLogChannelId = resolveOptionalId(body.entryLogChannelId);
    const exitPublicChannelId = resolveOptionalId(body.exitPublicChannelId);
    const exitLogChannelId = resolveOptionalId(body.exitLogChannelId);
    const fallbackEntryLayout = normalizeWelcomeLayout(
      body.entryLayout,
      createDefaultWelcomeEntryLayout(),
    );
    const fallbackExitLayout = normalizeWelcomeLayout(
      body.exitLayout,
      createDefaultWelcomeExitLayout(),
    );
    const entryPublicLayout = normalizeWelcomeLayout(
      body.entryPublicLayout ?? body.entryLayout,
      fallbackEntryLayout,
    );
    const entryLogLayout = normalizeWelcomeLayout(
      body.entryLogLayout ?? body.entryLayout,
      fallbackEntryLayout,
    );
    const exitPublicLayout = normalizeWelcomeLayout(
      body.exitPublicLayout ?? body.exitLayout,
      fallbackExitLayout,
    );
    const exitLogLayout = normalizeWelcomeLayout(
      body.exitLogLayout ?? body.exitLayout,
      fallbackExitLayout,
    );
    const entryPublicThumbnailMode = resolveThumbnailMode(
      body.entryPublicThumbnailMode ?? body.entryThumbnailMode,
    );
    const entryLogThumbnailMode = resolveThumbnailMode(
      body.entryLogThumbnailMode ?? body.entryThumbnailMode,
    );
    const exitPublicThumbnailMode = resolveThumbnailMode(
      body.exitPublicThumbnailMode ?? body.exitThumbnailMode,
    );
    const exitLogThumbnailMode = resolveThumbnailMode(
      body.exitLogThumbnailMode ?? body.exitThumbnailMode,
    );
    const entryLayout = entryPublicChannelId ? entryPublicLayout : entryLogLayout;
    const exitLayout = exitPublicChannelId ? exitPublicLayout : exitLogLayout;
    const entryThumbnailMode = entryPublicChannelId
      ? entryPublicThumbnailMode
      : entryLogThumbnailMode;
    const exitThumbnailMode = exitPublicChannelId
      ? exitPublicThumbnailMode
      : exitLogThumbnailMode;

    diagnostic = createServerSaveDiagnosticContext("welcome_settings", guildId);

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

    const entryChannelsProvided = Boolean(entryPublicChannelId || entryLogChannelId);
    const exitChannelsProvided = Boolean(exitPublicChannelId || exitLogChannelId);

    if (
      enabled &&
      (!entryChannelsProvided || !exitChannelsProvided)
    ) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Canais de entrada ou saida incompletos.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Escolha pelo menos um canal para entrada e um canal para saida.",
          },
          { status: 400 },
        ),
      );
    }

    if (enabled && entryPublicChannelId && !welcomeLayoutHasContent(entryPublicLayout)) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Layout de entrada vazio.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Adicione pelo menos um bloco de conteudo na mensagem de entrada.",
          },
          { status: 400 },
        ),
      );
    }

    if (enabled && entryLogChannelId && !welcomeLayoutHasContent(entryLogLayout)) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Layout de log de entrada vazio.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Adicione pelo menos um bloco de conteudo na mensagem de log de entrada.",
          },
          { status: 400 },
        ),
      );
    }

    if (enabled && exitPublicChannelId && !welcomeLayoutHasContent(exitPublicLayout)) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Layout de saida vazio.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Adicione pelo menos um bloco de conteudo na mensagem de saida.",
          },
          { status: 400 },
        ),
      );
    }

    if (enabled && exitLogChannelId && !welcomeLayoutHasContent(exitLogLayout)) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Layout de log de saida vazio.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Adicione pelo menos um bloco de conteudo na mensagem de log de saida.",
          },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_welcome_overview");
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
        detail: "Servidor com plano expirado ou desligado para edicao.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Servidor com plano expirado/desligado. Renove o pagamento para editar configuracoes.",
          },
          { status: 403 },
        ),
      );
    }

    if (licenseStatus === "not_paid") {
      const cleanupSummary = await cleanupExpiredUnpaidServerSetups({
        userId: authUserId,
        guildId,
        source: "guild_welcome_settings_post",
      });

      if (cleanupSummary.cleanedGuildIds.includes(guildId)) {
        recordServerSaveDiagnostic({
          context: diagnostic,
          authUserId,
          accessMode,
          licenseStatus,
          outcome: "cleanup_expired",
          httpStatus: 409,
          detail: "Setup expirado apos 30 minutos sem pagamento.",
          meta: {
            cleanedGuildCount: cleanupSummary.cleanedGuildIds.length,
          },
        });
        return applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              message:
                "A configuracao desse servidor expirou apos 30 minutos sem pagamento. Recomece a ativacao para continuar.",
            },
            { status: 409 },
          ),
        );
      }
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
    const entryPublicChannel = entryPublicChannelId
      ? channelsById.get(entryPublicChannelId)
      : null;
    const entryLogChannel = entryLogChannelId
      ? channelsById.get(entryLogChannelId)
      : null;
    const exitPublicChannel = exitPublicChannelId
      ? channelsById.get(exitPublicChannelId)
      : null;
    const exitLogChannel = exitLogChannelId
      ? channelsById.get(exitLogChannelId)
      : null;

    if (
      entryPublicChannelId &&
      (!entryPublicChannel || !isValidTextChannelType(entryPublicChannel.type))
    ) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "validation_failed",
        httpStatus: 400,
        detail: "Canal publico de entrada invalido.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Canal publico de entrada invalido." },
          { status: 400 },
        ),
      );
    }

    if (
      entryLogChannelId &&
      (!entryLogChannel || !isValidTextChannelType(entryLogChannel.type))
    ) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "validation_failed",
        httpStatus: 400,
        detail: "Canal privado de entrada invalido.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Canal privado de entrada invalido." },
          { status: 400 },
        ),
      );
    }

    if (
      exitPublicChannelId &&
      (!exitPublicChannel || !isValidTextChannelType(exitPublicChannel.type))
    ) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "validation_failed",
        httpStatus: 400,
        detail: "Canal publico de saida invalido.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Canal publico de saida invalido." },
          { status: 400 },
        ),
      );
    }

    if (
      exitLogChannelId &&
      (!exitLogChannel || !isValidTextChannelType(exitLogChannel.type))
    ) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "validation_failed",
        httpStatus: 400,
        detail: "Canal privado de saida invalido.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Canal privado de saida invalido." },
          { status: 400 },
        ),
      );
    }

    const savedSettings = await upsertWelcomeSettingsWithRetry({
      guildId,
      enabled,
      entryPublicChannelId,
      entryLogChannelId,
      exitPublicChannelId,
      exitLogChannelId,
      entryLayout,
      exitLayout,
      entryThumbnailMode,
      exitThumbnailMode,
      configuredByUserId: authUserId,
    });

    const secureUpdated = await writeServerSettingsVaultSnapshot({
      guildId,
      moduleKey: "welcome_settings",
      configuredByUserId: authUserId,
      payload: {
        enabled,
        entryPublicChannelId,
        entryLogChannelId,
        exitPublicChannelId,
        exitLogChannelId,
        entryPublicLayout,
        entryLogLayout,
        exitPublicLayout,
        exitLogLayout,
        entryPublicThumbnailMode,
        entryLogThumbnailMode,
        exitPublicThumbnailMode,
        exitLogThumbnailMode,
      } satisfies WelcomeSecureSnapshot,
    });
    invalidateDashboardSettingsCache({ guildId });

    recordServerSaveDiagnostic({
      context: diagnostic,
      authUserId,
      accessMode,
      licenseStatus,
      outcome: "saved",
      httpStatus: 200,
      detail: "Configuracoes de entrada e saida salvas com sucesso.",
      meta: {
        channelCount: rawChannels.length,
      },
    });
    void sendServerSettingsSavedEmailSafe({
      user: access.context.sessionData.authSession.user,
      guildId,
      moduleLabel: "Entrada e saida",
      detail: enabled ? "Modulo ativo" : "Modulo desativado",
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        settings: buildWelcomeResponseFromSecureSnapshot({
          snapshot: {
            enabled,
            entryPublicChannelId,
            entryLogChannelId,
            exitPublicChannelId,
            exitLogChannelId,
            entryPublicLayout,
            entryLogLayout,
            exitPublicLayout,
            exitLogLayout,
            entryPublicThumbnailMode,
            entryLogThumbnailMode,
            exitPublicThumbnailMode,
            exitLogThumbnailMode,
          },
          updatedAt: secureUpdated?.updatedAt || savedSettings.updated_at,
        }),
      }),
    );
  } catch (error) {
    recordServerSaveDiagnostic({
      context: diagnostic,
      outcome: "failed",
      httpStatus: 500,
      detail: extractAuditErrorMessage(
        error,
        "Erro ao salvar configuracoes do servidor.",
      ),
    });
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao salvar configuracoes do servidor.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
