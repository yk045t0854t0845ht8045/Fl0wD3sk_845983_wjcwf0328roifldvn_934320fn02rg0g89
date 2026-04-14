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
import {
  getGuildLicenseStatus,
} from "@/lib/payments/licenseStatus";
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
  ticketPanelLayoutHasAtMostOneFunctionButton,
  deriveLegacyTicketPanelFields,
  normalizeTicketPanelLayout,
  ticketPanelLayoutHasRequiredParts,
  type TicketPanelLayout,
} from "@/lib/servers/ticketPanelBuilder";
import {
  encodeLegacyTicketAiSettings,
  isMissingDedicatedTicketAiColumnsError,
  normalizeTicketAiSettings,
} from "@/lib/servers/ticketAiSettings";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const GUILD_CATEGORY = 4;
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const PANEL_TITLE_MAX_LENGTH = 80;
const PANEL_DESCRIPTION_MAX_LENGTH = 400;
const PANEL_BUTTON_LABEL_MAX_LENGTH = 40;
const AI_COMPANY_NAME_MAX_LENGTH = 100;
const AI_COMPANY_BIO_MAX_LENGTH = 1000;
const AI_RULES_MAX_LENGTH = 4000;
const AI_ALLOWED_TONES = ["formal", "friendly"];
const TICKET_SETTINGS_SELECT_BASE =
  "enabled, menu_channel_id, tickets_category_id, logs_created_channel_id, logs_closed_channel_id, panel_layout, panel_title, panel_description, panel_button_label, ai_rules, updated_at";
const TICKET_SETTINGS_SELECT_WITH_DEDICATED_AI = `${TICKET_SETTINGS_SELECT_BASE}, ai_enabled, ai_company_name, ai_company_bio, ai_tone`;
const TICKET_SETTINGS_RETURNING_SELECT_BASE = `guild_id, ${TICKET_SETTINGS_SELECT_BASE}`;
const TICKET_SETTINGS_RETURNING_SELECT_WITH_DEDICATED_AI = `guild_id, ${TICKET_SETTINGS_SELECT_WITH_DEDICATED_AI}`;

type TicketSettingsBody = {
  guildId?: unknown;
  enabled?: unknown;
  menuChannelId?: unknown;
  ticketsCategoryId?: unknown;
  logsCreatedChannelId?: unknown;
  logsClosedChannelId?: unknown;
  panelLayout?: unknown;
  panelTitle?: unknown;
  panelDescription?: unknown;
  panelButtonLabel?: unknown;
  aiRules?: unknown;
  aiEnabled?: unknown;
  aiCompanyName?: unknown;
  aiCompanyBio?: unknown;
  aiTone?: unknown;
};

function getTrimmedId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getTrimmedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidTicketPanelDraft(input: {
  panelLayout: TicketPanelLayout;
  panelTitle: string;
  panelDescription: string;
  panelButtonLabel: string;
}) {
  return Boolean(
    input.panelLayout.length &&
      ticketPanelLayoutHasRequiredParts(input.panelLayout) &&
      ticketPanelLayoutHasAtMostOneFunctionButton(input.panelLayout) &&
      input.panelTitle &&
      input.panelDescription &&
      input.panelButtonLabel,
  );
}

function exceedsTicketPanelTextLimit(input: {
  panelTitle: string;
  panelDescription: string;
  panelButtonLabel: string;
}) {
  return (
    input.panelTitle.length > PANEL_TITLE_MAX_LENGTH ||
    input.panelDescription.length > PANEL_DESCRIPTION_MAX_LENGTH ||
    input.panelButtonLabel.length > PANEL_BUTTON_LABEL_MAX_LENGTH
  );
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loadGuildTicketSettingsRecord(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const modernResult = await supabase
    .from("guild_ticket_settings")
    .select(TICKET_SETTINGS_SELECT_WITH_DEDICATED_AI)
    .eq("guild_id", guildId)
    .maybeSingle();

  if (!modernResult.error) {
    return modernResult.data;
  }

  if (!isMissingDedicatedTicketAiColumnsError(modernResult.error)) {
    throw new Error(modernResult.error.message);
  }

  const legacyResult = await supabase
    .from("guild_ticket_settings")
    .select(TICKET_SETTINGS_SELECT_BASE)
    .eq("guild_id", guildId)
    .maybeSingle();

  if (legacyResult.error) {
    throw new Error(legacyResult.error.message);
  }

  return legacyResult.data;
}

function buildTicketSettingsResponse(
  record: Record<string, unknown> | null | undefined,
) {
  if (!record) {
    return null;
  }

  const ticketAiSettings = normalizeTicketAiSettings(record);

  return {
    guildId: typeof record.guild_id === "string" ? record.guild_id : null,
    enabled: Boolean(record.enabled),
    menuChannelId:
      typeof record.menu_channel_id === "string" ? record.menu_channel_id : null,
    ticketsCategoryId:
      typeof record.tickets_category_id === "string"
        ? record.tickets_category_id
        : null,
    logsCreatedChannelId:
      typeof record.logs_created_channel_id === "string"
        ? record.logs_created_channel_id
        : null,
    logsClosedChannelId:
      typeof record.logs_closed_channel_id === "string"
        ? record.logs_closed_channel_id
        : null,
    panelLayout: normalizeTicketPanelLayout(record.panel_layout, {
      panelTitle:
        typeof record.panel_title === "string" ? record.panel_title : "",
      panelDescription:
        typeof record.panel_description === "string"
          ? record.panel_description
          : "",
      panelButtonLabel:
        typeof record.panel_button_label === "string"
          ? record.panel_button_label
          : "",
    }),
    panelTitle: typeof record.panel_title === "string" ? record.panel_title : "",
    panelDescription:
      typeof record.panel_description === "string"
        ? record.panel_description
        : "",
    panelButtonLabel:
      typeof record.panel_button_label === "string"
        ? record.panel_button_label
        : "",
    aiRules: ticketAiSettings.aiRules,
    aiEnabled: ticketAiSettings.aiEnabled,
    aiCompanyName: ticketAiSettings.aiCompanyName,
    aiCompanyBio: ticketAiSettings.aiCompanyBio,
    aiTone: ticketAiSettings.aiTone,
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : null,
  };
}

async function upsertTicketSettingsWithRetry(input: {
  guildId: string;
  enabled: boolean;
  menuChannelId: string;
  ticketsCategoryId: string;
  logsCreatedChannelId: string;
  logsClosedChannelId: string;
  panelLayout: TicketPanelLayout;
  panelTitle: string;
  panelDescription: string;
  panelButtonLabel: string;
  aiRules: string;
  aiEnabled: boolean;
  aiCompanyName: string;
  aiCompanyBio: string;
  aiTone: string;
  configuredByUserId: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const maxAttempts = 2;
  let lastError: Error | null = null;
  const modernPayload = {
    guild_id: input.guildId,
    enabled: input.enabled,
    menu_channel_id: input.menuChannelId,
    tickets_category_id: input.ticketsCategoryId,
    logs_created_channel_id: input.logsCreatedChannelId,
    logs_closed_channel_id: input.logsClosedChannelId,
    panel_layout: input.panelLayout,
    panel_title: input.panelTitle,
    panel_description: input.panelDescription,
    panel_button_label: input.panelButtonLabel,
    ai_rules: input.aiRules,
    ai_enabled: input.aiEnabled,
    ai_company_name: input.aiCompanyName,
    ai_company_bio: input.aiCompanyBio,
    ai_tone: input.aiTone,
    configured_by_user_id: input.configuredByUserId,
  };
  const legacyPayload = {
    guild_id: input.guildId,
    enabled: input.enabled,
    menu_channel_id: input.menuChannelId,
    tickets_category_id: input.ticketsCategoryId,
    logs_created_channel_id: input.logsCreatedChannelId,
    logs_closed_channel_id: input.logsClosedChannelId,
    panel_layout: input.panelLayout,
    panel_title: input.panelTitle,
    panel_description: input.panelDescription,
    panel_button_label: input.panelButtonLabel,
    ai_rules: encodeLegacyTicketAiSettings({
      aiRules: input.aiRules,
      aiEnabled: input.aiEnabled,
      aiCompanyName: input.aiCompanyName,
      aiCompanyBio: input.aiCompanyBio,
      aiTone: input.aiTone === "friendly" ? "friendly" : "formal",
    }),
    configured_by_user_id: input.configuredByUserId,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await supabase
      .from("guild_ticket_settings")
      .upsert(
        modernPayload,
        { onConflict: "guild_id" },
      )
      .select(TICKET_SETTINGS_RETURNING_SELECT_WITH_DEDICATED_AI)
      .single();

    if (!result.error) {
      return result.data;
    }

    if (isMissingDedicatedTicketAiColumnsError(result.error)) {
      const legacyResult = await supabase
        .from("guild_ticket_settings")
        .upsert(legacyPayload, { onConflict: "guild_id" })
        .select(TICKET_SETTINGS_RETURNING_SELECT_BASE)
        .single();

      if (!legacyResult.error) {
        return legacyResult.data;
      }

      lastError = new Error(legacyResult.error.message);
    } else {
      lastError = new Error(result.error.message);
    }

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

function isValidTextChannelType(type?: number) {
  return type === GUILD_TEXT || type === GUILD_ANNOUNCEMENT;
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

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) {
      return access.response;
    }

    await cleanupExpiredUnpaidServerSetups({
      userId: access.context.sessionData.authSession.user.id,
      guildId,
      source: "guild_ticket_settings_get",
    });

    const result = await loadGuildTicketSettingsRecord(guildId);

    if (!result) {
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
      settings: buildTicketSettingsResponse(
        result as Record<string, unknown>,
      ),
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

  let diagnostic = createServerSaveDiagnosticContext("ticket_settings");

  try {
    let body: TicketSettingsBody = {};
    try {
      body = (await request.json()) as TicketSettingsBody;
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
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const menuChannelId = getTrimmedId(body.menuChannelId);
    const ticketsCategoryId = getTrimmedId(body.ticketsCategoryId);
    const logsCreatedChannelId = getTrimmedId(body.logsCreatedChannelId);
    const logsClosedChannelId = getTrimmedId(body.logsClosedChannelId);
    const aiRules = typeof body.aiRules === "string"
      ? body.aiRules.trim().slice(0, AI_RULES_MAX_LENGTH)
      : "";
    const aiEnabled = typeof body.aiEnabled === "boolean" ? body.aiEnabled : false;
    const aiCompanyName = typeof body.aiCompanyName === "string"
      ? body.aiCompanyName.trim().slice(0, AI_COMPANY_NAME_MAX_LENGTH)
      : "";
    const aiCompanyBio = typeof body.aiCompanyBio === "string"
      ? body.aiCompanyBio.trim().slice(0, AI_COMPANY_BIO_MAX_LENGTH)
      : "";
    const aiToneRaw = typeof body.aiTone === "string" ? body.aiTone.trim().toLowerCase() : "formal";
    const aiTone = AI_ALLOWED_TONES.includes(aiToneRaw) ? aiToneRaw : "formal";
    const panelLayout = normalizeTicketPanelLayout(body.panelLayout, {
      panelTitle: getTrimmedText(body.panelTitle),
      panelDescription: getTrimmedText(body.panelDescription),
      panelButtonLabel: getTrimmedText(body.panelButtonLabel),
    });
    const { panelTitle, panelDescription, panelButtonLabel } =
      deriveLegacyTicketPanelFields(panelLayout);
    const hasValidIncomingChannelIds =
      isGuildId(menuChannelId) &&
      isGuildId(ticketsCategoryId) &&
      isGuildId(logsCreatedChannelId) &&
      isGuildId(logsClosedChannelId);
    const hasValidIncomingPanelDraft = isValidTicketPanelDraft({
      panelLayout,
      panelTitle,
      panelDescription,
      panelButtonLabel,
    });
    const incomingPanelTextExceedsLimit = exceedsTicketPanelTextLimit({
      panelTitle,
      panelDescription,
      panelButtonLabel,
    });
    diagnostic = createServerSaveDiagnosticContext("ticket_settings", guildId);

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

    if (enabled && !hasValidIncomingChannelIds) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Um ou mais IDs informados sao invalidos.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Um ou mais IDs informados sao invalidos." },
          { status: 400 },
        ),
      );
    }

    if (enabled && !ticketPanelLayoutHasRequiredParts(panelLayout)) {
      const detail = "O layout da mensagem do ticket esta vazio ou invalido.";
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail,
      });
      const response = NextResponse.json(
        {
          ok: false,
          message: "Adicione pelo menos um conteudo com texto e uma acao valida na mensagem do ticket. O embed tambem aceita apenas um botao funcional.",
        },
        { status: 400 }
      );
      return applyNoStoreHeaders(response);
    }

    if (aiEnabled) {
      if (aiCompanyName.length > AI_COMPANY_NAME_MAX_LENGTH) {
        const res = NextResponse.json(
          { ok: false, message: `O nome da empresa nao pode exceder ${AI_COMPANY_NAME_MAX_LENGTH} caracteres.` },
          { status: 400 }
        );
        return applyNoStoreHeaders(res);
      }
      if (aiCompanyBio.length > AI_COMPANY_BIO_MAX_LENGTH) {
        const res = NextResponse.json(
          { ok: false, message: `A descricao do negocio nao pode exceder ${AI_COMPANY_BIO_MAX_LENGTH} caracteres.` },
          { status: 400 }
        );
        return applyNoStoreHeaders(res);
      }
      if (aiRules.length > AI_RULES_MAX_LENGTH) {
        const res = NextResponse.json(
          { ok: false, message: `As regras da IA nao podem exceder ${AI_RULES_MAX_LENGTH} caracteres.` },
          { status: 400 }
        );
        return applyNoStoreHeaders(res);
      }
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
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
        source: "guild_ticket_settings_post",
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

    const existingSettings = await loadGuildTicketSettingsRecord(guildId);
    const existingSettingsResponse = buildTicketSettingsResponse(
      existingSettings as Record<string, unknown> | null | undefined,
    );
    const fallbackPanelLayout = existingSettings
      ? normalizeTicketPanelLayout(existingSettings.panel_layout, {
          panelTitle: existingSettings.panel_title,
          panelDescription: existingSettings.panel_description,
          panelButtonLabel: existingSettings.panel_button_label,
        })
      : panelLayout;
    const fallbackPanelTitle =
      typeof existingSettings?.panel_title === "string"
        ? existingSettings.panel_title
        : panelTitle;
    const fallbackPanelDescription =
      typeof existingSettings?.panel_description === "string"
        ? existingSettings.panel_description
        : panelDescription;
    const fallbackPanelButtonLabel =
      typeof existingSettings?.panel_button_label === "string"
        ? existingSettings.panel_button_label
        : panelButtonLabel;
    const resolvedMenuChannelId = isGuildId(menuChannelId)
      ? menuChannelId
      : typeof existingSettings?.menu_channel_id === "string"
        ? existingSettings.menu_channel_id
        : "";
    const resolvedTicketsCategoryId = isGuildId(ticketsCategoryId)
      ? ticketsCategoryId
      : typeof existingSettings?.tickets_category_id === "string"
        ? existingSettings.tickets_category_id
        : "";
    const resolvedLogsCreatedChannelId = isGuildId(logsCreatedChannelId)
      ? logsCreatedChannelId
      : typeof existingSettings?.logs_created_channel_id === "string"
        ? existingSettings.logs_created_channel_id
        : "";
    const resolvedLogsClosedChannelId = isGuildId(logsClosedChannelId)
      ? logsClosedChannelId
      : typeof existingSettings?.logs_closed_channel_id === "string"
        ? existingSettings.logs_closed_channel_id
        : "";
    const shouldUseIncomingPanelDraft =
      hasValidIncomingPanelDraft && !incomingPanelTextExceedsLimit;
    const resolvedPanelLayout = shouldUseIncomingPanelDraft
      ? panelLayout
      : fallbackPanelLayout;
    const resolvedPanelTitle = shouldUseIncomingPanelDraft
      ? panelTitle
      : fallbackPanelTitle;
    const resolvedPanelDescription = shouldUseIncomingPanelDraft
      ? panelDescription
      : fallbackPanelDescription;
    const resolvedPanelButtonLabel = shouldUseIncomingPanelDraft
      ? panelButtonLabel
      : fallbackPanelButtonLabel;
    const hasPersistableResolvedSettings =
      isGuildId(resolvedMenuChannelId) &&
      isGuildId(resolvedTicketsCategoryId) &&
      isGuildId(resolvedLogsCreatedChannelId) &&
      isGuildId(resolvedLogsClosedChannelId) &&
      isValidTicketPanelDraft({
        panelLayout: resolvedPanelLayout,
        panelTitle: resolvedPanelTitle,
        panelDescription: resolvedPanelDescription,
        panelButtonLabel: resolvedPanelButtonLabel,
      }) &&
      !exceedsTicketPanelTextLimit({
        panelTitle: resolvedPanelTitle,
        panelDescription: resolvedPanelDescription,
        panelButtonLabel: resolvedPanelButtonLabel,
      });

    if (!enabled && !hasPersistableResolvedSettings) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "saved",
        httpStatus: 200,
        detail: "Modulo de ticket desligado sem configuracao persistente anterior.",
      });

      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          settings: {
            enabled: false,
            menuChannelId:
              typeof existingSettings?.menu_channel_id === "string"
                ? existingSettings.menu_channel_id
                : null,
            ticketsCategoryId:
              typeof existingSettings?.tickets_category_id === "string"
                ? existingSettings.tickets_category_id
                : null,
            logsCreatedChannelId:
              typeof existingSettings?.logs_created_channel_id === "string"
                ? existingSettings.logs_created_channel_id
                : null,
            logsClosedChannelId:
              typeof existingSettings?.logs_closed_channel_id === "string"
                ? existingSettings.logs_closed_channel_id
                : null,
            panelLayout: resolvedPanelLayout,
            panelTitle: resolvedPanelTitle,
            panelDescription: resolvedPanelDescription,
            panelButtonLabel: resolvedPanelButtonLabel,
            aiRules: existingSettingsResponse?.aiRules || "",
            aiEnabled: existingSettingsResponse?.aiEnabled || false,
            aiCompanyName: existingSettingsResponse?.aiCompanyName || "",
            aiCompanyBio: existingSettingsResponse?.aiCompanyBio || "",
            aiTone: existingSettingsResponse?.aiTone || "formal",
            updatedAt:
              typeof existingSettings?.updated_at === "string"
                ? existingSettings.updated_at
                : null,
          },
        }),
      );
    }

    let rawChannels:
      | Awaited<ReturnType<typeof fetchGuildChannelsByBot>>
      | null = null;

    if (enabled) {
      rawChannels = await fetchGuildChannelsByBot(guildId);
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
      const menuChannel = channelsById.get(resolvedMenuChannelId);
      const ticketsCategory = channelsById.get(resolvedTicketsCategoryId);
      const createdLogChannel = channelsById.get(resolvedLogsCreatedChannelId);
      const closedLogChannel = channelsById.get(resolvedLogsClosedChannelId);

      if (!menuChannel || !isValidTextChannelType(menuChannel.type)) {
        recordServerSaveDiagnostic({
          context: diagnostic,
          authUserId,
          accessMode,
          licenseStatus,
          outcome: "validation_failed",
          httpStatus: 400,
          detail: "Canal do menu principal invalido.",
        });
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Canal do menu principal invalido." },
            { status: 400 },
          ),
        );
      }

      if (!ticketsCategory || ticketsCategory.type !== GUILD_CATEGORY) {
        recordServerSaveDiagnostic({
          context: diagnostic,
          authUserId,
          accessMode,
          licenseStatus,
          outcome: "validation_failed",
          httpStatus: 400,
          detail: "Categoria de tickets invalida.",
        });
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Categoria de tickets invalida." },
            { status: 400 },
          ),
        );
      }

      if (!createdLogChannel || !isValidTextChannelType(createdLogChannel.type)) {
        recordServerSaveDiagnostic({
          context: diagnostic,
          authUserId,
          accessMode,
          licenseStatus,
          outcome: "validation_failed",
          httpStatus: 400,
          detail: "Canal de log de criacao invalido.",
        });
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Canal de log de criacao invalido." },
            { status: 400 },
          ),
        );
      }

      if (!closedLogChannel || !isValidTextChannelType(closedLogChannel.type)) {
        recordServerSaveDiagnostic({
          context: diagnostic,
          authUserId,
          accessMode,
          licenseStatus,
          outcome: "validation_failed",
          httpStatus: 400,
          detail: "Canal de log de fechamento invalido.",
        });
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: "Canal de log de fechamento invalido." },
            { status: 400 },
          ),
        );
      }
    }

    const savedSettings = await upsertTicketSettingsWithRetry({
      guildId,
      enabled,
      menuChannelId: resolvedMenuChannelId,
      ticketsCategoryId: resolvedTicketsCategoryId,
      logsCreatedChannelId: resolvedLogsCreatedChannelId,
      logsClosedChannelId: resolvedLogsClosedChannelId,
      panelLayout: resolvedPanelLayout,
      panelTitle: resolvedPanelTitle,
      panelDescription: resolvedPanelDescription,
      panelButtonLabel: resolvedPanelButtonLabel,
      aiRules: aiRules,
      aiEnabled: aiEnabled,
      aiCompanyName: aiCompanyName,
      aiCompanyBio: aiCompanyBio,
      aiTone: aiTone,
      configuredByUserId: authUserId,
    });

    recordServerSaveDiagnostic({
      context: diagnostic,
      authUserId,
      accessMode,
      licenseStatus,
      outcome: "saved",
      httpStatus: 200,
      detail: "Configuracoes do servidor salvas com sucesso.",
      meta: {
        channelCount: rawChannels?.length || 0,
      },
    });

    return applyNoStoreHeaders(
      NextResponse.json({
      ok: true,
      settings: buildTicketSettingsResponse(
        savedSettings as Record<string, unknown>,
      ),
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

