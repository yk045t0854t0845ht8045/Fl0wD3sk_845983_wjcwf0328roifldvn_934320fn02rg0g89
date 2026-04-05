import { NextResponse } from "next/server";

import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
  hasAcceptedTeamAccessToGuild,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import { getGuildLicenseStatus } from "@/lib/payments/licenseStatus";
import {
  ensureSameOriginJsonMutationRequest,
  applyNoStoreHeaders,
} from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  enforceRequestRateLimit,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import {
  buildTicketPanelDispatchPayload,
  ticketPanelMessageLooksManaged,
} from "@/lib/servers/ticketPanelDiscordPayload";
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
  normalizeTicketPanelLayout,
  ticketPanelLayoutHasAtMostOneFunctionButton,
  ticketPanelLayoutHasRequiredParts,
} from "@/lib/servers/ticketPanelBuilder";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const DISCORD_RETRY_DELAYS_MS = [180, 420];
const TICKET_PANEL_DISPATCH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const TICKET_PANEL_DISPATCH_RATE_LIMIT_MAX_ATTEMPTS = 6;
const INFLIGHT_DISPATCH_TTL_MS = 25 * 1000;
const LOCAL_RATE_LIMIT_MAX_KEYS = 2000;

const inflightTicketPanelDispatches = new Map<
  string,
  { startedAtMs: number; requestId: string }
>();
const localRateLimitCooldownUntilByKey = new Map<string, number>();

function resolveLocalRateLimitKey(input: {
  sessionId: string | null;
  ipFingerprint: string | null;
  userId: number | null;
}) {
  if (input.sessionId) return `session:${input.sessionId}`;
  if (input.ipFingerprint) return `ip:${input.ipFingerprint}`;
  if (typeof input.userId === "number") return `user:${input.userId}`;
  return null;
}

function pruneLocalRateLimitMapIfNeeded() {
  if (localRateLimitCooldownUntilByKey.size > LOCAL_RATE_LIMIT_MAX_KEYS) {
    localRateLimitCooldownUntilByKey.clear();
  }
}

type TicketPanelMessageBody = {
  guildId?: unknown;
  menuChannelId?: unknown;
  panelLayout?: unknown;
};

type DiscordChannelMessage = {
  id?: unknown;
  author?: {
    bot?: unknown;
  } | null;
  components?: unknown;
};

function getTrimmedId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

function isValidTextChannelType(type?: number) {
  return type === GUILD_TEXT || type === GUILD_ANNOUNCEMENT;
}

function tryAcquireInflightDispatchLock(guildId: string, requestId: string) {
  const now = Date.now();
  const existing = inflightTicketPanelDispatches.get(guildId);

  if (existing) {
    const ageMs = now - existing.startedAtMs;
    if (ageMs < INFLIGHT_DISPATCH_TTL_MS) {
      return {
        ok: false as const,
        retryAfterSeconds: Math.max(
          3,
          Math.ceil((INFLIGHT_DISPATCH_TTL_MS - ageMs) / 1000),
        ),
      };
    }

    inflightTicketPanelDispatches.delete(guildId);
  }

  inflightTicketPanelDispatches.set(guildId, { startedAtMs: now, requestId });
  return { ok: true as const };
}

function releaseInflightDispatchLock(guildId: string, requestId: string) {
  const existing = inflightTicketPanelDispatches.get(guildId);
  if (existing?.requestId === requestId) {
    inflightTicketPanelDispatches.delete(guildId);
  }
}

async function getStoredPanelMessageId(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_ticket_settings")
    .select("panel_message_id")
    .eq("guild_id", guildId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return typeof result.data?.panel_message_id === "string"
    ? result.data.panel_message_id.trim()
    : "";
}

async function updateStoredPanelMessageId(
  guildId: string,
  panelMessageId: string | null,
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("guild_ticket_settings")
    .update({
      panel_message_id: panelMessageId || null,
    })
    .eq("guild_id", guildId);

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function fetchDiscordMessageByIdWithBot({
  channelId,
  messageId,
  botToken,
}: {
  channelId: string;
  messageId: string;
  botToken: string;
}) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= DISCORD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bot ${botToken}`,
          },
          cache: "no-store",
        },
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const text = await response.text();
        const isRetryable = response.status === 429 || response.status >= 500;

        if (isRetryable && attempt < DISCORD_RETRY_DELAYS_MS.length) {
          await sleep(DISCORD_RETRY_DELAYS_MS[attempt]);
          continue;
        }

        throw new Error(
          `Discord respondeu com erro ao buscar a mensagem armazenada do ticket: ${text || response.statusText}`,
        );
      }

      return (await response.json()) as DiscordChannelMessage;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("Falha ao buscar a mensagem armazenada do ticket.");

      if (attempt < DISCORD_RETRY_DELAYS_MS.length) {
        await sleep(DISCORD_RETRY_DELAYS_MS[attempt]);
        continue;
      }
    }
  }

  throw lastError || new Error("Falha ao buscar a mensagem armazenada do ticket.");
}

async function requestDiscordWithBot<T>({
  url,
  botToken,
  method = "GET",
  body,
  resourceLabel,
}: {
  url: string;
  botToken: string;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  resourceLabel: string;
}) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= DISCORD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bot ${botToken}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });

      if (!response.ok) {
        const text = await response.text();
        const isRetryable = response.status === 429 || response.status >= 500;

        if (isRetryable && attempt < DISCORD_RETRY_DELAYS_MS.length) {
          await sleep(DISCORD_RETRY_DELAYS_MS[attempt]);
          continue;
        }

        throw new Error(
          `Discord respondeu com erro ao ${resourceLabel}: ${text || response.statusText}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error(`Falha ao ${resourceLabel}.`);

      if (attempt < DISCORD_RETRY_DELAYS_MS.length) {
        await sleep(DISCORD_RETRY_DELAYS_MS[attempt]);
        continue;
      }
    }
  }

  throw lastError || new Error(`Falha ao ${resourceLabel}.`);
}

export async function POST(request: Request) {
  const baseRequestContext = createSecurityRequestContext(request);
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      baseRequestContext.requestId,
    );

  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) {
    return attachRequestId(
      applyNoStoreHeaders(invalidMutationResponse),
      baseRequestContext.requestId,
    );
  }

  let diagnostic = createServerSaveDiagnosticContext("ticket_panel_dispatch");
  let inflightGuildId: string | null = null;
  let auditContext = baseRequestContext;

  try {
    let body: TicketPanelMessageBody = {};
    try {
      body = (await request.json()) as TicketPanelMessageBody;
    } catch {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Payload JSON invalido.",
      });
      return respond({ ok: false, message: "Payload JSON invalido." }, { status: 400 });
    }

    const guildId = getTrimmedId(body.guildId);
    const menuChannelId = getTrimmedId(body.menuChannelId);
    diagnostic = createServerSaveDiagnosticContext("ticket_panel_dispatch", guildId);

    if (!Array.isArray(body.panelLayout)) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Layout do ticket ausente ou invalido.",
      });
      return respond(
        { ok: false, message: "Layout do ticket ausente ou invalido." },
        { status: 400 },
      );
    }

    const panelLayout = normalizeTicketPanelLayout(body.panelLayout);

    if (!isGuildId(guildId) || !isGuildId(menuChannelId)) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Guild ID ou canal informados sao invalidos.",
      });
      return respond(
        { ok: false, message: "Guild ID ou canal informados sao invalidos." },
        { status: 400 },
      );
    }

    auditContext = extendSecurityRequestContext(baseRequestContext, { guildId });

    if (
      !panelLayout.length ||
      !ticketPanelLayoutHasRequiredParts(panelLayout) ||
      !ticketPanelLayoutHasAtMostOneFunctionButton(panelLayout)
    ) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "payload_invalid",
        httpStatus: 400,
        detail: "Layout do ticket vazio ou invalido para envio.",
      });
      return respond(
        {
          ok: false,
          message:
            "Adicione pelo menos um conteudo com texto e uma acao antes de enviar o embed. O painel aceita apenas um botao funcional.",
        },
        { status: 400 },
      );
    }

    const sessionData = await resolveSessionAccessToken();
    if (!sessionData?.authSession) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        outcome: "access_denied",
        httpStatus: 401,
        detail: "Sessao ausente para envio do embed do ticket.",
      });
      return respond({ ok: false, message: "Nao autenticado." }, { status: 401 });
    }

    const authUserId = sessionData.authSession.user.id;
    auditContext = extendSecurityRequestContext(auditContext, {
      sessionId: sessionData.authSession.id,
      userId: authUserId,
      guildId,
    });

    if (!sessionData.accessToken) {
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        outcome: "access_denied",
        httpStatus: 401,
        detail: "Token OAuth ausente na sessao.",
      });
      return respond(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      );
    }

    pruneLocalRateLimitMapIfNeeded();
    const localRateLimitKey = resolveLocalRateLimitKey({
      sessionId: auditContext.sessionId,
      ipFingerprint: auditContext.ipFingerprint,
      userId: auditContext.userId,
    });
    if (localRateLimitKey) {
      const cooldownUntilMs = localRateLimitCooldownUntilByKey.get(localRateLimitKey) || 0;
      if (cooldownUntilMs > Date.now()) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((cooldownUntilMs - Date.now()) / 1000),
        );

        recordServerSaveDiagnostic({
          context: diagnostic,
          authUserId,
          outcome: "access_denied",
          httpStatus: 429,
          detail: "Bloqueio local de rate limit (cooldown).",
        });

        const response = respond(
          { ok: false, message: "Muitas tentativas. Tente novamente em instantes." },
          { status: 429 },
        );
        response.headers.set("Retry-After", String(retryAfterSeconds));
        return response;
      }
    }

    const rateLimit = await enforceRequestRateLimit({
      action: "guild_ticket_panel_dispatch_post",
      windowMs: TICKET_PANEL_DISPATCH_RATE_LIMIT_WINDOW_MS,
      maxAttempts: TICKET_PANEL_DISPATCH_RATE_LIMIT_MAX_ATTEMPTS,
      context: auditContext,
    });

    if (!rateLimit.ok) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "guild_ticket_panel_dispatch_post",
        outcome: "blocked",
        metadata: {
          reason: "rate_limit",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
      });

      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        outcome: "access_denied",
        httpStatus: 429,
        detail: "Rate limit acionado para envio do embed do ticket.",
        meta: {
          counts: rateLimit.counts,
        },
      });

      const response = respond(
        { ok: false, message: "Muitas tentativas. Tente novamente em instantes." },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      if (localRateLimitKey) {
        localRateLimitCooldownUntilByKey.set(
          localRateLimitKey,
          Date.now() + rateLimit.retryAfterSeconds * 1000,
        );
      }
      return response;
    }

    await logSecurityAuditEventSafe(auditContext, {
      action: "guild_ticket_panel_dispatch_post",
      outcome: "started",
      metadata: {
        guildId,
      },
    });

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
      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        outcome: "access_denied",
        httpStatus: 403,
        detail: "Servidor nao encontrado para este usuario.",
      });
      await logSecurityAuditEventSafe(auditContext, {
        action: "guild_ticket_panel_dispatch_post",
        outcome: "blocked",
        metadata: {
          reason: "guild_access_denied",
        },
      });
      return respond(
        { ok: false, message: "Servidor nao encontrado para este usuario." },
        { status: 403 },
      );
    }

    const accessMode = resolveServerSaveAccessMode({
      accessibleGuild,
      hasTeamAccess,
    });
    const canManageServer = Boolean(
      accessibleGuild?.owner || hasTeamAccess,
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
      await logSecurityAuditEventSafe(auditContext, {
        action: "guild_ticket_panel_dispatch_post",
        outcome: "blocked",
        metadata: {
          reason: "view_only",
        },
      });

      return respond(
        {
          ok: false,
          message:
            "Esta conta esta em modo somente visualizacao para este servidor.",
        },
        { status: 403 },
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
        detail: "Servidor com plano expirado ou desligado para envio do painel.",
      });
      await logSecurityAuditEventSafe(auditContext, {
        action: "guild_ticket_panel_dispatch_post",
        outcome: "blocked",
        metadata: {
          reason: "license_blocked",
          licenseStatus,
        },
      });

      return respond(
        {
          ok: false,
          message:
            "Servidor com plano expirado/desligado. Renove o pagamento para enviar o embed.",
        },
        { status: 403 },
      );
    }

    if (licenseStatus === "not_paid") {
      const cleanupSummary = await cleanupExpiredUnpaidServerSetups({
        userId: authUserId,
        guildId,
        source: "guild_ticket_panel_dispatch_post",
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
        });
        await logSecurityAuditEventSafe(auditContext, {
          action: "guild_ticket_panel_dispatch_post",
          outcome: "blocked",
          metadata: {
            reason: "setup_expired",
            licenseStatus,
          },
        });

        return respond(
          {
            ok: false,
            message:
              "A configuracao desse servidor expirou apos 30 minutos sem pagamento. Recomece a ativacao para continuar.",
          },
          { status: 409 },
        );
      }
    }

    const inflightLock = tryAcquireInflightDispatchLock(
      guildId,
      baseRequestContext.requestId,
    );
    if (!inflightLock.ok) {
      await logSecurityAuditEventSafe(auditContext, {
        action: "guild_ticket_panel_dispatch_post",
        outcome: "blocked",
        metadata: {
          reason: "inflight_lock",
          retryAfterSeconds: inflightLock.retryAfterSeconds,
        },
      });

      recordServerSaveDiagnostic({
        context: diagnostic,
        authUserId,
        accessMode,
        licenseStatus,
        outcome: "access_denied",
        httpStatus: 409,
        detail: "Envio do painel ja em andamento (inflight lock).",
      });

      const response = respond(
        {
          ok: false,
          message:
            "Ja existe um envio do embed em andamento para este servidor. Aguarde alguns segundos e tente novamente.",
        },
        { status: 409 },
      );
      response.headers.set("Retry-After", String(inflightLock.retryAfterSeconds));
      return response;
    }
    inflightGuildId = guildId;

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
      await logSecurityAuditEventSafe(auditContext, {
        action: "guild_ticket_panel_dispatch_post",
        outcome: "blocked",
        metadata: {
          reason: "bot_access_missing",
        },
      });

      return respond(
        { ok: false, message: "Bot nao possui acesso aos canais deste servidor." },
        { status: 403 },
      );
    }

    const menuChannel = rawChannels.find((channel) => channel.id === menuChannelId);
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
      await logSecurityAuditEventSafe(auditContext, {
        action: "guild_ticket_panel_dispatch_post",
        outcome: "blocked",
        metadata: {
          reason: "invalid_menu_channel",
          menuChannelId,
        },
      });

      return respond(
        { ok: false, message: "Canal do menu principal invalido." },
        { status: 400 },
      );
    }

    const botToken = resolveBotToken();
    if (!botToken) {
      throw new Error("DISCORD_BOT_TOKEN nao configurado no ambiente do site.");
    }

    const payload = buildTicketPanelDispatchPayload(panelLayout);
    const storedPanelMessageId = await getStoredPanelMessageId(guildId);
    const storedManagedMessage = storedPanelMessageId
      ? await fetchDiscordMessageByIdWithBot({
          channelId: menuChannelId,
          messageId: storedPanelMessageId,
          botToken,
        })
      : null;

    const managedMessage =
      storedManagedMessage && ticketPanelMessageLooksManaged(storedManagedMessage)
        ? storedManagedMessage
        : (
            await requestDiscordWithBot<DiscordChannelMessage[]>({
              url: `https://discord.com/api/v10/channels/${menuChannelId}/messages?limit=25`,
              botToken,
              resourceLabel: "buscar mensagens recentes do canal",
            })
          ).find((message) => ticketPanelMessageLooksManaged(message));

    const dispatchedMessage = managedMessage && typeof managedMessage.id === "string"
      ? await requestDiscordWithBot<{ id: string }>({
          url: `https://discord.com/api/v10/channels/${menuChannelId}/messages/${managedMessage.id}`,
          method: "PATCH",
          body: payload,
          botToken,
          resourceLabel: "atualizar o embed do ticket",
        })
      : await requestDiscordWithBot<{ id: string }>({
          url: `https://discord.com/api/v10/channels/${menuChannelId}/messages`,
          method: "POST",
          body: payload,
          botToken,
          resourceLabel: "enviar o embed do ticket",
        });

    if (typeof dispatchedMessage.id === "string") {
      await updateStoredPanelMessageId(guildId, dispatchedMessage.id);
    }

    recordServerSaveDiagnostic({
      context: diagnostic,
      authUserId,
      accessMode,
      licenseStatus,
      outcome: "saved",
      httpStatus: 200,
      detail: managedMessage
        ? "Embed do ticket atualizado com sucesso."
        : "Embed do ticket enviado com sucesso.",
      meta: {
        channelId: menuChannelId,
        mode: managedMessage ? "updated" : "created",
        messageId: dispatchedMessage.id,
      },
    });

    await logSecurityAuditEventSafe(auditContext, {
      action: "guild_ticket_panel_dispatch_post",
      outcome: "succeeded",
      metadata: {
        guildId,
        menuChannelId,
        mode: managedMessage ? "updated" : "created",
        messageId: dispatchedMessage.id,
      },
    });

    return respond({
      ok: true,
      mode: managedMessage ? "updated" : "created",
      channelId: menuChannelId,
      messageId: dispatchedMessage.id,
    });
  } catch (error) {
    recordServerSaveDiagnostic({
      context: diagnostic,
      outcome: "failed",
      httpStatus: 500,
      detail: extractAuditErrorMessage(
        error,
        "Erro ao enviar o embed do ticket.",
      ),
    });
    await logSecurityAuditEventSafe(auditContext, {
      action: "guild_ticket_panel_dispatch_post",
      outcome: "failed",
      metadata: {
        error: extractAuditErrorMessage(error, "Erro interno."),
      },
    });

    return respond(
      {
        ok: false,
        message: sanitizeErrorMessage(
          error,
          "Erro ao enviar o embed do ticket.",
        ),
      },
      { status: 500 },
    );
  } finally {
    if (inflightGuildId) {
      releaseInflightDispatchLock(inflightGuildId, baseRequestContext.requestId);
    }
  }
}
