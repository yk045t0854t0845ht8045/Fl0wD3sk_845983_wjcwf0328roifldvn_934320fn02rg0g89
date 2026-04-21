import {
  buildOfficialDiscordChannelUrl,
  OFFICIAL_DISCORD_GUILD_ID,
  OFFICIAL_DISCORD_INVITE_URL,
  OFFICIAL_DISCORD_LINK_CHANNEL_ID,
  OFFICIAL_DISCORD_LINKED_ROLE_ID,
  OFFICIAL_DISCORD_LINKED_ROLE_NAME,
} from "@/lib/discordLink/config";
import {
  DiscordRateLimitError,
  fetchDiscordCurrentUserGuildMember,
  fetchDiscordGuilds,
  type DiscordGuild,
  type DiscordGuildMember,
} from "@/lib/auth/discord";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type DiscordLinkStatus = "pending" | "pending_member" | "linked" | "failed";

class DiscordApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DiscordApiRequestError";
    this.status = status;
  }
}

type DiscordLinkRecord = {
  id: number;
  user_id: number;
  discord_user_id: string;
  guild_id: string;
  channel_id: string | null;
  role_id: string;
  status: DiscordLinkStatus;
  linked_at: string | null;
  role_granted_at: string | null;
  last_role_sync_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type SyncDiscordLinkResult = {
  status: DiscordLinkStatus;
  message: string;
  linkRecord: DiscordLinkRecord;
  alreadyLinked: boolean;
  openDiscordUrl: string;
  inviteUrl: string;
  roleName: string;
};

function resolveBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

function assertOfficialDiscordConfig() {
  if (
    !OFFICIAL_DISCORD_GUILD_ID ||
    !OFFICIAL_DISCORD_LINK_CHANNEL_ID ||
    !OFFICIAL_DISCORD_LINKED_ROLE_ID
  ) {
    throw new Error(
      "OFFICIAL_SUPPORT_GUILD_ID, OFFICIAL_LINK_CHANNEL_ID ou OFFICIAL_LINKED_ROLE_ID nao configurados.",
    );
  }
}

async function parseDiscordErrorMessage(response: Response) {
  try {
    const payload = (await response.clone().json()) as {
      message?: string;
      code?: number;
    };

    if (payload?.message) {
      return payload.code
        ? `${payload.message} (codigo ${payload.code})`
        : payload.message;
    }
  } catch {
    // ignore JSON parse failure
  }

  try {
    const text = await response.text();
    return text || `Discord respondeu com status ${response.status}.`;
  } catch {
    return `Discord respondeu com status ${response.status}.`;
  }
}

async function fetchOfficialGuildMember(discordUserId: string) {
  assertOfficialDiscordConfig();
  const botToken = resolveBotToken();
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado para sincronizar a vinculacao.");
  }

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${OFFICIAL_DISCORD_GUILD_ID}/members/${discordUserId}`,
    {
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
    const message = await parseDiscordErrorMessage(response);
    throw new DiscordApiRequestError(
      `Falha ao validar membro no Discord oficial: ${message}`,
      response.status,
    );
  }

  return (await response.json()) as DiscordGuildMember;
}

async function grantOfficialLinkedRole(discordUserId: string) {
  assertOfficialDiscordConfig();
  const botToken = resolveBotToken();
  if (!botToken) {
    throw new Error("DISCORD_BOT_TOKEN nao configurado para aplicar o cargo de vinculacao.");
  }

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${OFFICIAL_DISCORD_GUILD_ID}/members/${discordUserId}/roles/${OFFICIAL_DISCORD_LINKED_ROLE_ID}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${botToken}`,
        "X-Audit-Log-Reason": "Flowdesk - vinculacao segura da conta",
      },
      cache: "no-store",
    },
  );

  if (response.ok || response.status === 204) {
    return;
  }

  const message = await parseDiscordErrorMessage(response);
  throw new DiscordApiRequestError(
    `Falha ao aplicar o cargo de vinculacao: ${message}`,
    response.status,
  );
}

async function isOfficialGuildVisibleToAuthenticatedUser(
  discordAccessToken: string | null | undefined,
) {
  if (!discordAccessToken) return null;

  try {
    const guilds = await fetchDiscordGuilds(discordAccessToken);
    return guilds.some(
      (guild: DiscordGuild) => guild.id === OFFICIAL_DISCORD_GUILD_ID,
    );
  } catch (error) {
    if (error instanceof DiscordRateLimitError) {
      return null;
    }

    throw error;
  }
}

async function fetchOfficialGuildMemberFromAuthenticatedUser(
  discordAccessToken: string | null | undefined,
) {
  if (!discordAccessToken) return null;

  try {
    return await fetchDiscordCurrentUserGuildMember(
      discordAccessToken,
      OFFICIAL_DISCORD_GUILD_ID,
    );
  } catch (error) {
    if (error instanceof DiscordRateLimitError) {
      return null;
    }

    throw error;
  }
}

export async function getDiscordLinkRecordForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_discord_links")
    .select(
      "id, user_id, discord_user_id, guild_id, channel_id, role_id, status, linked_at, role_granted_at, last_role_sync_at, last_error, metadata, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("guild_id", OFFICIAL_DISCORD_GUILD_ID)
    .maybeSingle<DiscordLinkRecord>();

  if (result.error) {
    throw new Error(`Erro ao consultar vinculacao Discord: ${result.error.message}`);
  }

  return result.data || null;
}

async function upsertDiscordLinkRecord(
  currentRecord: DiscordLinkRecord | null,
  input: {
    userId: number;
    discordUserId: string;
    status: DiscordLinkStatus;
    linkedAt?: string | null;
    roleGrantedAt?: string | null;
    lastRoleSyncAt?: string | null;
    lastError?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const supabase = getSupabaseAdminClientOrThrow();
  const payload = {
    user_id: input.userId,
    discord_user_id: input.discordUserId,
    guild_id: OFFICIAL_DISCORD_GUILD_ID,
    channel_id: OFFICIAL_DISCORD_LINK_CHANNEL_ID,
    role_id: OFFICIAL_DISCORD_LINKED_ROLE_ID,
    status: input.status,
    linked_at: input.linkedAt ?? currentRecord?.linked_at ?? null,
    role_granted_at:
      input.roleGrantedAt ?? currentRecord?.role_granted_at ?? null,
    last_role_sync_at:
      input.lastRoleSyncAt ?? currentRecord?.last_role_sync_at ?? null,
    last_error:
      typeof input.lastError === "string"
        ? input.lastError
        : currentRecord?.last_error ?? null,
    metadata: input.metadata || {},
  };

  const result = await supabase
    .from("auth_user_discord_links")
    .upsert(payload, { onConflict: "user_id,guild_id" })
    .select(
      "id, user_id, discord_user_id, guild_id, channel_id, role_id, status, linked_at, role_granted_at, last_role_sync_at, last_error, metadata, created_at, updated_at",
    )
    .single<DiscordLinkRecord>();

  if (result.error) {
    throw new Error(`Erro ao salvar vinculacao Discord: ${result.error.message}`);
  }

  return result.data;
}

export async function syncOfficialDiscordLink(input: {
  userId: number;
  discordUserId: string;
  requestId: string;
  discordAccessToken?: string | null;
}) {
  assertOfficialDiscordConfig();
  const nowIso = new Date().toISOString();
  const currentRecord = await getDiscordLinkRecordForUser(input.userId);
  const openDiscordUrl = buildOfficialDiscordChannelUrl();
  const inviteUrl = OFFICIAL_DISCORD_INVITE_URL;
  const roleName = OFFICIAL_DISCORD_LINKED_ROLE_NAME;

  try {
    const authenticatedUserMember =
      await fetchOfficialGuildMemberFromAuthenticatedUser(
        input.discordAccessToken || null,
      );
    const member =
      authenticatedUserMember || (await fetchOfficialGuildMember(input.discordUserId));

    if (!member) {
      const guildVisibleToAuthenticatedUser =
        await isOfficialGuildVisibleToAuthenticatedUser(
          input.discordAccessToken || null,
        );

      if (guildVisibleToAuthenticatedUser) {
        try {
          await grantOfficialLinkedRole(input.discordUserId);

          const linkedAt = currentRecord?.linked_at || nowIso;
          const roleGrantedAt = currentRecord?.role_granted_at || nowIso;
          const linkRecord = await upsertDiscordLinkRecord(currentRecord, {
            userId: input.userId,
            discordUserId: input.discordUserId,
            status: "linked",
            linkedAt,
            roleGrantedAt,
            lastRoleSyncAt: nowIso,
            lastError: null,
            metadata: {
              requestId: input.requestId,
              source: "discord_link_sync",
              membership: "oauth_visible",
              roleGrantedWithoutMemberFetch: true,
            },
          });

          return {
            status: "linked",
            message:
              "Conta localizada no Discord oficial e vinculada com sucesso. O cargo ja foi sincronizado.",
            linkRecord,
            alreadyLinked: Boolean(currentRecord?.linked_at),
            openDiscordUrl,
            inviteUrl,
            roleName,
          } satisfies SyncDiscordLinkResult;
        } catch (error) {
          if (
            error instanceof DiscordApiRequestError &&
            error.status === 404
          ) {
            const linkRecord = await upsertDiscordLinkRecord(currentRecord, {
              userId: input.userId,
              discordUserId: input.discordUserId,
              status: "pending",
              lastRoleSyncAt: nowIso,
              lastError: null,
              metadata: {
                requestId: input.requestId,
                source: "discord_link_sync",
                membership: "oauth_visible_pending_role",
              },
            });

            return {
              status: "pending",
              message:
                "Conta localizada no Discord oficial. Estamos finalizando a sincronizacao do cargo automaticamente.",
              linkRecord,
              alreadyLinked: false,
              openDiscordUrl,
              inviteUrl,
              roleName,
            } satisfies SyncDiscordLinkResult;
          }

          throw error;
        }
      }

      const linkRecord = await upsertDiscordLinkRecord(currentRecord, {
        userId: input.userId,
        discordUserId: input.discordUserId,
        status: "pending_member",
        lastRoleSyncAt: nowIso,
        lastError: null,
        metadata: {
          requestId: input.requestId,
          source: "discord_link_sync",
          membership: "missing",
        },
      });

      return {
        status: "pending_member",
        message:
          "Estamos aguardando a conta autenticada aparecer no servidor oficial do Discord para concluir a vinculacao automaticamente.",
        linkRecord,
        alreadyLinked: false,
        openDiscordUrl,
        inviteUrl,
        roleName,
      } satisfies SyncDiscordLinkResult;
    }

    const alreadyHasRole = Array.isArray(member.roles)
      ? member.roles.includes(OFFICIAL_DISCORD_LINKED_ROLE_ID)
      : false;

    if (!alreadyHasRole) {
      await grantOfficialLinkedRole(input.discordUserId);
    }

    const linkedAt = currentRecord?.linked_at || nowIso;
    const roleGrantedAt = currentRecord?.role_granted_at || nowIso;
    const linkRecord = await upsertDiscordLinkRecord(currentRecord, {
      userId: input.userId,
      discordUserId: input.discordUserId,
      status: "linked",
      linkedAt,
      roleGrantedAt,
      lastRoleSyncAt: nowIso,
      lastError: null,
      metadata: {
        requestId: input.requestId,
        source: "discord_link_sync",
        membership: "present",
        roleAlreadyPresent: alreadyHasRole,
        joinedAt: member.joined_at || null,
      },
    });

    return {
      status: "linked",
      message:
        "Conta vinculada com sucesso. Seu acesso foi sincronizado e o cargo ja pode ser usado no Discord oficial.",
      linkRecord,
      alreadyLinked: Boolean(currentRecord?.linked_at),
      openDiscordUrl,
      inviteUrl,
      roleName,
    } satisfies SyncDiscordLinkResult;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha ao sincronizar a vinculacao com o Discord oficial.";
    const linkRecord = await upsertDiscordLinkRecord(currentRecord, {
      userId: input.userId,
      discordUserId: input.discordUserId,
      status: "failed",
      lastRoleSyncAt: nowIso,
      lastError: message,
      metadata: {
        requestId: input.requestId,
        source: "discord_link_sync",
        failure: "discord_sync_error",
      },
    });

    return {
      status: "failed",
      message,
      linkRecord,
      alreadyLinked: false,
      openDiscordUrl,
      inviteUrl,
      roleName,
    } satisfies SyncDiscordLinkResult;
  }
}
