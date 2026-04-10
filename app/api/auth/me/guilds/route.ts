import { NextResponse } from "next/server";
import {
  getAccessibleGuildsForSession,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { getLockedGuildLicenseMap } from "@/lib/payments/licenseStatus";
import { getPlanGuildsForUser } from "@/lib/plans/planGuilds";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type GuildSavedSetupRecord = {
  guild_id: string;
  updated_at: string | null;
};

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

async function getGuildSavedSetupMap(userId: number, guildIds: string[]) {
  if (!guildIds.length) {
    return new Map<string, { hasSavedSetup: boolean; lastConfiguredAt: string | null }>();
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const [
    ticketSettingsResult,
    staffSettingsResult,
    welcomeSettingsResult,
    antiLinkSettingsResult,
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
  for (const record of planSettingsResult.data || []) registerRecord(record);

  return savedSetupMap;
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
          { ok: false, message: "Token OAuth ausente na sessao." },
          { status: 401 },
        ),
      );
    }

    let guilds = (await getAccessibleGuildsForSession({
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    })).map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon_url: buildGuildIconUrl(guild.id, guild.icon),
      owner: guild.owner,
      admin: true,
      hasSavedSetup: false,
      lastConfiguredAt: null as string | null,
    }));

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
