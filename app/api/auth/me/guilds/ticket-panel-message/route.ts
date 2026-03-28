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
  buildTicketPanelDispatchPayload,
  ticketPanelMessageLooksManaged,
} from "@/lib/servers/ticketPanelDiscordPayload";
import {
  createServerSaveDiagnosticContext,
  recordServerSaveDiagnostic,
  resolveServerSaveAccessMode,
} from "@/lib/servers/serverSaveDiagnostics";
import {
  normalizeTicketPanelLayout,
  ticketPanelLayoutHasAtMostOneFunctionButton,
  ticketPanelLayoutHasRequiredParts,
} from "@/lib/servers/ticketPanelBuilder";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const DISCORD_RETRY_DELAYS_MS = [180, 420];

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

type GuildAccessContext = {
  sessionData: NonNullable<Awaited<ReturnType<typeof resolveSessionAccessToken>>>;
  accessibleGuild: Awaited<ReturnType<typeof assertUserAdminInGuildOrNull>>;
  hasTeamAccess: boolean;
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
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) {
    return applyNoStoreHeaders(invalidMutationResponse);
  }

  let diagnostic = createServerSaveDiagnosticContext("ticket_panel_dispatch");

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
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Payload JSON invalido." },
          { status: 400 },
        ),
      );
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
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Layout do ticket ausente ou invalido." },
          { status: 400 },
        ),
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
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Guild ID ou canal informados sao invalidos." },
          { status: 400 },
        ),
      );
    }

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
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Adicione pelo menos um conteudo com texto e uma acao antes de enviar o embed. O painel aceita apenas um botao funcional.",
          },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return applyNoStoreHeaders(access.response);
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
        detail: "Servidor com plano expirado ou desligado para envio do painel.",
      });
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            message:
              "Servidor com plano expirado/desligado. Renove o pagamento para enviar o embed.",
          },
          { status: 403 },
        ),
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
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Canal do menu principal invalido." },
          { status: 400 },
        ),
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

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        mode: managedMessage ? "updated" : "created",
        channelId: menuChannelId,
        messageId: dispatchedMessage.id,
      }),
    );
  } catch (error) {
    recordServerSaveDiagnostic({
      context: diagnostic,
      outcome: "failed",
      httpStatus: 500,
      detail:
        error instanceof Error
          ? error.message
          : "Erro ao enviar o embed do ticket.",
    });
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Erro ao enviar o embed do ticket.",
        },
        { status: 500 },
      ),
    );
  }
}
