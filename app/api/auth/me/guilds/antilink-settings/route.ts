import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
  fetchGuildRolesByBot,
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
const MAX_IGNORED_ROLE_IDS = 30;

type AntiLinkEnforcementAction = "delete_only" | "timeout" | "kick" | "ban";

type AntiLinkSettingsBody = {
  guildId?: unknown;
  enabled?: unknown;
  logChannelId?: unknown;
  enforcementAction?: unknown;
  timeoutMinutes?: unknown;
  ignoredRoleIds?: unknown;
  blockExternalLinks?: unknown;
  blockDiscordInvites?: unknown;
  blockObfuscatedLinks?: unknown;
};

type GuildAccessContext = {
  sessionData: NonNullable<Awaited<ReturnType<typeof resolveSessionAccessToken>>>;
  accessibleGuild: Awaited<ReturnType<typeof assertUserAdminInGuildOrNull>>;
  hasTeamAccess: boolean;
};

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
          block_external_links: input.blockExternalLinks,
          block_discord_invites: input.blockDiscordInvites,
          block_obfuscated_links: input.blockObfuscatedLinks,
          configured_by_user_id: input.configuredByUserId,
        },
        { onConflict: "guild_id" },
      )
      .select(
        "guild_id, enabled, log_channel_id, enforcement_action, timeout_minutes, ignored_role_ids, block_external_links, block_discord_invites, block_obfuscated_links, updated_at",
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

  if (!accessibleGuild && !hasTeamAccess && sessionData.authSession.activeGuildId !== guildId) {
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
      source: "guild_antilink_settings_get",
    });

    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase
      .from("guild_antilink_settings")
      .select(
        "enabled, log_channel_id, enforcement_action, timeout_minutes, ignored_role_ids, block_external_links, block_discord_invites, block_obfuscated_links, updated_at",
      )
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
    let body: AntiLinkSettingsBody = {};
    try {
      body = (await request.json()) as AntiLinkSettingsBody;
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
    const enabled = typeof body.enabled === "boolean" ? body.enabled : false;
    const logChannelId = resolveOptionalId(body.logChannelId);
    const enforcementAction = normalizeAction(body.enforcementAction);
    const timeoutMinutes = normalizeTimeoutMinutes(body.timeoutMinutes);
    const ignoredRoleIds = normalizeRoleIdList(body.ignoredRoleIds);
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
        blockExternalLinks,
        blockDiscordInvites,
        blockObfuscatedLinks,
        configuredByUserId: authUserId,
      });
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
