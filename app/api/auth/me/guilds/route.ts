import { NextResponse } from "next/server";
import {
  fetchGuildSummaryByBot,
  getAccessibleGuildsForSession,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { getAcceptedTeamGuildIdsForUser } from "@/lib/teams/userTeams";
import { getLockedGuildLicenseMap } from "@/lib/payments/licenseStatus";
import { getPlanGuildsForUser } from "@/lib/plans/planGuilds";
import { repairOrphanPlanGuildLinkForUser } from "@/lib/plans/state";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type GuildSavedSetupRecord = {
  guild_id: string;
  updated_at: string | null;
};

type GuildSavedSetupMapValue = {
  hasSavedSetup: boolean;
  lastConfiguredAt: string | null;
};

type GuildSavedSetupCacheEntry = {
  expiresAt: number;
  value: Map<string, GuildSavedSetupMapValue>;
};

const GUILD_SAVED_SETUP_CACHE_TTL_MS = 30_000;
const guildSavedSetupCache = new Map<string, GuildSavedSetupCacheEntry>();
const guildSavedSetupInflight = new Map<
  string,
  Promise<Map<string, GuildSavedSetupMapValue>>
>();

function buildDiscordReconnectPayload(input: {
  sessionHasDiscordIdentity: boolean;
  message?: string;
}) {
  return {
    ok: false,
    code: input.sessionHasDiscordIdentity
      ? "discord_reconnect_required"
      : "discord_link_required",
    requiresDiscordReconnect: input.sessionHasDiscordIdentity,
    requiresDiscordLink: !input.sessionHasDiscordIdentity,
    message:
      input.message ||
      (input.sessionHasDiscordIdentity
        ? "Sua conexao com o Discord expirou e precisa ser renovada para listar os servidores."
        : "Esta conta ainda precisa ser vinculada a um Discord para listar os servidores."),
  };
}

function shouldTreatGuildsFailureAsReconnect(error: unknown) {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("falha ao renovar token discord") ||
    message.includes("invalid_grant") ||
    message.includes("invalid token") ||
    message.includes("unauthorized") ||
    message.includes("401 unauthorized") ||
    message.includes("403 forbidden") ||
    message.includes("oauth")
  );
}

function buildGuildIconUrl(guildId: string, icon: string | null) {
  if (!icon) return null;

  const extension = icon.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${extension}?size=64`;
}

function toComparableTimestamp(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function buildGuildSavedSetupCacheKey(userId: number, guildIds: string[]) {
  return `${userId}:${[...guildIds].sort().join(",")}`;
}

function cloneGuildSavedSetupMap(value: Map<string, GuildSavedSetupMapValue>) {
  return new Map(
    Array.from(value.entries()).map(([guildId, setup]) => [
      guildId,
      { ...setup },
    ]),
  );
}

function shouldForceFreshGuildSync(url: URL) {
  const value =
    url.searchParams.get("fresh") ||
    url.searchParams.get("forceFresh") ||
    url.searchParams.get("refresh");

  return value === "1" || value === "true" || value === "yes";
}

async function getGuildSavedSetupMap(userId: number, guildIds: string[]) {
  if (!guildIds.length) {
    return new Map<string, { hasSavedSetup: boolean; lastConfiguredAt: string | null }>();
  }

  const cacheKey = buildGuildSavedSetupCacheKey(userId, guildIds);
  const cached = guildSavedSetupCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cloneGuildSavedSetupMap(cached.value);
  }

  if (cached) {
    guildSavedSetupCache.delete(cacheKey);
  }

  const inflight = guildSavedSetupInflight.get(cacheKey);
  if (inflight) {
    return cloneGuildSavedSetupMap(await inflight);
  }

  const loadPromise = (async () => {
    const supabase = getSupabaseAdminClientOrThrow();
    const [
      ticketSettingsResult,
      staffSettingsResult,
      welcomeSettingsResult,
      antiLinkSettingsResult,
      autoRoleSettingsResult,
      planSettingsResult,
    ] = await Promise.all([
      supabase
        .from("guild_ticket_settings")
        .select("guild_id, updated_at")
        .eq("configured_by_user_id", userId)
        .in("guild_id", guildIds)
        .returns<GuildSavedSetupRecord[]>(),
      supabase
        .from("guild_ticket_staff_settings")
        .select("guild_id, updated_at")
        .eq("configured_by_user_id", userId)
        .in("guild_id", guildIds)
        .returns<GuildSavedSetupRecord[]>(),
      supabase
        .from("guild_welcome_settings")
        .select("guild_id, updated_at")
        .eq("configured_by_user_id", userId)
        .in("guild_id", guildIds)
        .returns<GuildSavedSetupRecord[]>(),
      supabase
        .from("guild_antilink_settings")
        .select("guild_id, updated_at")
        .eq("configured_by_user_id", userId)
        .in("guild_id", guildIds)
        .returns<GuildSavedSetupRecord[]>(),
      supabase
        .from("guild_autorole_settings")
        .select("guild_id, updated_at")
        .eq("configured_by_user_id", userId)
        .in("guild_id", guildIds)
        .returns<GuildSavedSetupRecord[]>(),
      supabase
        .from("guild_plan_settings")
        .select("guild_id, updated_at")
        .eq("user_id", userId)
        .in("guild_id", guildIds)
        .returns<GuildSavedSetupRecord[]>(),
    ]);

    if (ticketSettingsResult.error) {
      throw new Error(ticketSettingsResult.error.message);
    }

    if (staffSettingsResult.error) {
      throw new Error(staffSettingsResult.error.message);
    }

    if (welcomeSettingsResult.error) {
      throw new Error(welcomeSettingsResult.error.message);
    }

    if (antiLinkSettingsResult.error) {
      throw new Error(antiLinkSettingsResult.error.message);
    }

    if (autoRoleSettingsResult.error) {
      throw new Error(autoRoleSettingsResult.error.message);
    }

    if (planSettingsResult.error) {
      throw new Error(planSettingsResult.error.message);
    }

    const savedSetupMap = new Map<
      string,
      { hasSavedSetup: boolean; lastConfiguredAt: string | null }
    >();

    const registerRecord = (record: GuildSavedSetupRecord) => {
      const current = savedSetupMap.get(record.guild_id);
      if (!current) {
        savedSetupMap.set(record.guild_id, {
          hasSavedSetup: true,
          lastConfiguredAt: record.updated_at || null,
        });
        return;
      }

      if (
        toComparableTimestamp(record.updated_at) >
        toComparableTimestamp(current.lastConfiguredAt)
      ) {
        current.lastConfiguredAt = record.updated_at || null;
      }
    };

    for (const record of ticketSettingsResult.data || []) registerRecord(record);
    for (const record of staffSettingsResult.data || []) registerRecord(record);
    for (const record of welcomeSettingsResult.data || []) registerRecord(record);
    for (const record of antiLinkSettingsResult.data || []) registerRecord(record);
    for (const record of autoRoleSettingsResult.data || []) registerRecord(record);
    for (const record of planSettingsResult.data || []) registerRecord(record);

    guildSavedSetupCache.set(cacheKey, {
      value: cloneGuildSavedSetupMap(savedSetupMap),
      expiresAt: Date.now() + GUILD_SAVED_SETUP_CACHE_TTL_MS,
    });

    return savedSetupMap;
  })().finally(() => {
    guildSavedSetupInflight.delete(cacheKey);
  });

  guildSavedSetupInflight.set(cacheKey, loadPromise);
  return cloneGuildSavedSetupMap(await loadPromise);
}

export async function GET(request: Request) {
  try {
    const sessionData = await resolveSessionAccessToken();
    const url = new URL(request.url);
    const excludePaid =
      url.searchParams.get("excludePaid") === "1" ||
      url.searchParams.get("excludePaid") === "true";

    if (!sessionData?.authSession) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Nao autenticado." },
          { status: 401 },
        ),
      );
    }

    if (!sessionData.accessToken) {
      return applyNoStoreHeaders(
        NextResponse.json(
          buildDiscordReconnectPayload({
            sessionHasDiscordIdentity: Boolean(
              sessionData.authSession.user.discord_user_id,
            ),
            message: sessionData.authSession.user.discord_user_id
              ? "Sua sessao do Discord nao esta mais conectada. Reconecte a mesma conta para sincronizar os servidores novamente."
              : "Sua conta Flowdesk ainda nao possui um Discord conectado para carregar os servidores.",
          }),
          { status: 401 },
        ),
      );
    }

    await repairOrphanPlanGuildLinkForUser({
      userId: sessionData.authSession.user.id,
      source: "auth_me_guilds_list",
    });

    const personalGuilds = await getAccessibleGuildsForSession({
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    }, { forceFresh: shouldForceFreshGuildSync(url) });

    const teamGuildIds = await getAcceptedTeamGuildIdsForUser({
      authUserId: sessionData.authSession.user.id,
      discordUserId: sessionData.authSession.user.discord_user_id,
    });

    const guildIdSet = new Set(personalGuilds.map((g) => g.id));
    const missingTeamGuildIds = teamGuildIds.filter((id) => !guildIdSet.has(id));

    const teamGuildSummaries = await Promise.all(
      missingTeamGuildIds.map((id) => fetchGuildSummaryByBot(id))
    );

    let guilds = personalGuilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon_url: buildGuildIconUrl(guild.id, guild.icon),
      owner: guild.owner,
      admin: true,
      is_team_guild: false,
      hasSavedSetup: false,
      lastConfiguredAt: null as string | null,
    }));

    for (const summary of teamGuildSummaries) {
      if (!summary) continue;
      guilds.push({
        id: summary.id,
        name: summary.name,
        icon_url: buildGuildIconUrl(summary.id, summary.icon),
        owner: false,
        admin: false, // Not a Discord admin, but has team access
        is_team_guild: true,
        hasSavedSetup: false,
        lastConfiguredAt: null,
      });
    }

    const savedSetupMap = await getGuildSavedSetupMap(
      sessionData.authSession.user.id,
      guilds.map((guild) => guild.id),
    );
    guilds = guilds.map((guild) => {
      const savedSetup = savedSetupMap.get(guild.id);
      return {
        ...guild,
        hasSavedSetup: savedSetup?.hasSavedSetup || false,
        lastConfiguredAt: savedSetup?.lastConfiguredAt || null,
      };
    });

    if (excludePaid) {
      const [lockedGuilds, ownedPlanGuilds] = await Promise.all([
        getLockedGuildLicenseMap(guilds.map((guild) => guild.id)),
        getPlanGuildsForUser(sessionData.authSession.user.id),
      ]);
      const ownedPlanGuildIdSet = new Set(
        ownedPlanGuilds.map((record) => record.guild_id),
      );
      guilds = guilds.filter(
        (guild) =>
          !lockedGuilds.has(guild.id) && !ownedPlanGuildIdSet.has(guild.id),
      );
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        user: {
          discord_user_id: sessionData.authSession.user.discord_user_id,
          display_name: sessionData.authSession.user.display_name,
        },
        guilds,
      }),
    );
  } catch (error) {
    const sessionData = await resolveSessionAccessToken().catch(() => null);
    if (sessionData?.authSession && shouldTreatGuildsFailureAsReconnect(error)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          buildDiscordReconnectPayload({
            sessionHasDiscordIdentity: Boolean(
              sessionData.authSession.user.discord_user_id,
            ),
            message:
              "Nao foi possivel renovar sua conexao com o Discord. Reconecte a conta para listar os servidores novamente.",
          }),
          { status: 401 },
        ),
      );
    }

    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Erro ao listar servidores do usuario.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
