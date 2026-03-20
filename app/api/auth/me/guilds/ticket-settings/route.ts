import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  fetchGuildChannelsByBot,
  isGuildId,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { getGuildLicenseStatus } from "@/lib/payments/licenseStatus";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const GUILD_CATEGORY = 4;
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;

type TicketSettingsBody = {
  guildId?: unknown;
  menuChannelId?: unknown;
  ticketsCategoryId?: unknown;
  logsCreatedChannelId?: unknown;
  logsClosedChannelId?: unknown;
};

type GuildAccessContext = {
  sessionData: NonNullable<Awaited<ReturnType<typeof resolveSessionAccessToken>>>;
};

function getTrimmedId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function upsertTicketSettingsWithRetry(input: {
  guildId: string;
  menuChannelId: string;
  ticketsCategoryId: string;
  logsCreatedChannelId: string;
  logsClosedChannelId: string;
  configuredByUserId: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await supabase
      .from("guild_ticket_settings")
      .upsert(
        {
          guild_id: input.guildId,
          menu_channel_id: input.menuChannelId,
          tickets_category_id: input.ticketsCategoryId,
          logs_created_channel_id: input.logsCreatedChannelId,
          logs_closed_channel_id: input.logsClosedChannelId,
          configured_by_user_id: input.configuredByUserId,
        },
        { onConflict: "guild_id" },
      )
      .select(
        "guild_id, menu_channel_id, tickets_category_id, logs_created_channel_id, logs_closed_channel_id, updated_at",
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

  if (!accessibleGuild && sessionData.authSession.activeGuildId !== guildId) {
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
    } satisfies GuildAccessContext,
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

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return access.response;
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const result = await supabase
      .from("guild_ticket_settings")
      .select(
        "menu_channel_id, tickets_category_id, logs_created_channel_id, logs_closed_channel_id, updated_at",
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
        menuChannelId: result.data.menu_channel_id,
        ticketsCategoryId: result.data.tickets_category_id,
        logsCreatedChannelId: result.data.logs_created_channel_id,
        logsClosedChannelId: result.data.logs_closed_channel_id,
        updatedAt: result.data.updated_at,
      },
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao carregar configuracoes do servidor.",
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

  try {
    let body: TicketSettingsBody = {};
    try {
      body = (await request.json()) as TicketSettingsBody;
    } catch {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Payload JSON invalido." },
        { status: 400 },
        ),
      );
    }

    const guildId = getTrimmedId(body.guildId);
    const menuChannelId = getTrimmedId(body.menuChannelId);
    const ticketsCategoryId = getTrimmedId(body.ticketsCategoryId);
    const logsCreatedChannelId = getTrimmedId(body.logsCreatedChannelId);
    const logsClosedChannelId = getTrimmedId(body.logsClosedChannelId);

    if (
      !isGuildId(guildId) ||
      !isGuildId(menuChannelId) ||
      !isGuildId(ticketsCategoryId) ||
      !isGuildId(logsCreatedChannelId) ||
      !isGuildId(logsClosedChannelId)
    ) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Um ou mais IDs informados sao invalidos." },
        { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return access.response;
    }

    const licenseStatus = await getGuildLicenseStatus(guildId);
    if (licenseStatus === "expired" || licenseStatus === "off") {
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

    const rawChannels = await fetchGuildChannelsByBot(guildId);
    if (!rawChannels) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Bot nao possui acesso aos canais deste servidor." },
        { status: 403 },
        ),
      );
    }

    const channelsById = new Map(rawChannels.map((channel) => [channel.id, channel]));
    const menuChannel = channelsById.get(menuChannelId);
    const ticketsCategory = channelsById.get(ticketsCategoryId);
    const createdLogChannel = channelsById.get(logsCreatedChannelId);
    const closedLogChannel = channelsById.get(logsClosedChannelId);

    if (!menuChannel || !isValidTextChannelType(menuChannel.type)) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Canal do menu principal invalido." },
        { status: 400 },
        ),
      );
    }

    if (!ticketsCategory || ticketsCategory.type !== GUILD_CATEGORY) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Categoria de tickets invalida." },
        { status: 400 },
        ),
      );
    }

    if (!createdLogChannel || !isValidTextChannelType(createdLogChannel.type)) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Canal de log de criacao invalido." },
        { status: 400 },
        ),
      );
    }

    if (!closedLogChannel || !isValidTextChannelType(closedLogChannel.type)) {
      return applyNoStoreHeaders(
        NextResponse.json(
        { ok: false, message: "Canal de log de fechamento invalido." },
        { status: 400 },
        ),
      );
    }

    const savedSettings = await upsertTicketSettingsWithRetry({
      guildId,
      menuChannelId,
      ticketsCategoryId,
      logsCreatedChannelId,
      logsClosedChannelId,
      configuredByUserId: access.context.sessionData.authSession.user.id,
    });

    return applyNoStoreHeaders(
      NextResponse.json({
      ok: true,
      settings: {
        guildId: savedSettings.guild_id,
        menuChannelId: savedSettings.menu_channel_id,
        ticketsCategoryId: savedSettings.tickets_category_id,
        logsCreatedChannelId: savedSettings.logs_created_channel_id,
        logsClosedChannelId: savedSettings.logs_closed_channel_id,
        updatedAt: savedSettings.updated_at,
      },
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao salvar configuracoes do servidor.",
      },
      { status: 500 },
      ),
    );
  }
}
