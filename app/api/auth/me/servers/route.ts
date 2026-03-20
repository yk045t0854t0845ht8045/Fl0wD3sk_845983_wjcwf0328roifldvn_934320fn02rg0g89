import { NextResponse } from "next/server";
import {
  getAccessibleGuildsForSession,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  EXPIRED_GRACE_MS,
  LICENSE_VALIDITY_MS,
  resolveLicenseBaseTimestamp,
} from "@/lib/payments/licenseStatus";
import { reconcileRecentPaymentOrders } from "@/lib/payments/reconciliation";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type ApprovedOrderRecord = {
  guild_id: string;
  paid_at: string | null;
  created_at: string;
};

function buildGuildIconUrl(guildId: string, icon: string | null) {
  if (!icon) return null;

  const extension = icon.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${extension}?size=64`;
}

function toUtcIso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function daysLeft(targetMs: number) {
  const diff = targetMs - Date.now();
  const rounded = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return Math.max(0, rounded);
}

export async function GET() {
  try {
    const sessionData = await resolveSessionAccessToken();

    if (!sessionData?.authSession) {
      return NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      );
    }

    if (!sessionData.accessToken) {
      return NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      );
    }

    const supabase = getSupabaseAdminClientOrThrow();
    try {
      await reconcileRecentPaymentOrders({
        userId: sessionData.authSession.user.id,
        limit: 6,
        source: "auth_servers",
      });
    } catch {
      // melhor esforco; nao bloquear dashboard por reconciliacao oportunista
    }

    const approvedOrdersResult = await supabase
      .from("payment_orders")
      .select("guild_id, paid_at, created_at")
      .eq("user_id", sessionData.authSession.user.id)
      .eq("status", "approved")
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .returns<ApprovedOrderRecord[]>();

    if (approvedOrdersResult.error) {
      throw new Error(approvedOrdersResult.error.message);
    }

    const latestApprovedOrderByGuild = new Map<string, ApprovedOrderRecord>();
    for (const order of approvedOrdersResult.data || []) {
      if (!latestApprovedOrderByGuild.has(order.guild_id)) {
        latestApprovedOrderByGuild.set(order.guild_id, order);
      }
    }

    if (!latestApprovedOrderByGuild.size) {
      return NextResponse.json({
        ok: true,
        servers: [],
      });
    }

    const accessibleGuilds = await getAccessibleGuildsForSession({
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    });

    const servers = accessibleGuilds
      .filter((guild) => latestApprovedOrderByGuild.has(guild.id))
      .map((guild) => {
        const approvedOrder = latestApprovedOrderByGuild.get(
          guild.id,
        ) as ApprovedOrderRecord;
        const baseTimestamp = resolveLicenseBaseTimestamp(approvedOrder);
        const licenseExpiresAtMs = baseTimestamp + LICENSE_VALIDITY_MS;
        const graceExpiresAtMs = licenseExpiresAtMs + EXPIRED_GRACE_MS;
        const nowMs = Date.now();

        let status: "paid" | "expired" | "off" = "off";
        if (nowMs <= licenseExpiresAtMs) {
          status = "paid";
        } else if (nowMs <= graceExpiresAtMs) {
          status = "expired";
        }

        return {
          guildId: guild.id,
          guildName: guild.name,
          iconUrl: buildGuildIconUrl(guild.id, guild.icon),
          status,
          licensePaidAt: approvedOrder.paid_at || approvedOrder.created_at,
          licenseExpiresAt: toUtcIso(licenseExpiresAtMs),
          graceExpiresAt: toUtcIso(graceExpiresAtMs),
          daysUntilExpire: daysLeft(licenseExpiresAtMs),
          daysUntilOff: daysLeft(graceExpiresAtMs),
        };
      })
      .sort((a, b) => {
        const priority = {
          paid: 0,
          expired: 1,
          off: 2,
        } as const;

        const statusDiff = priority[a.status] - priority[b.status];
        if (statusDiff !== 0) return statusDiff;

        return a.guildName.localeCompare(b.guildName, "pt-BR");
      });

    return NextResponse.json({
      ok: true,
      servers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao carregar servidores gerenciados.",
      },
      { status: 500 },
    );
  }
}
