import { NextResponse } from "next/server";
import {
  getAccessibleGuildsForSession,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  EXPIRED_GRACE_MS,
  LICENSE_VALIDITY_MS,
  getLockedGuildLicenseMap,
  resolveLicenseBaseTimestamp,
} from "@/lib/payments/licenseStatus";
import { reconcileRecentPaymentOrders } from "@/lib/payments/reconciliation";
import { cleanupExpiredUnpaidServerSetups } from "@/lib/payments/setupCleanup";
import { applyNoStoreHeaders } from "@/lib/security/http";
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

    const supabase = getSupabaseAdminClientOrThrow();
    try {
      await cleanupExpiredUnpaidServerSetups({
        userId: sessionData.authSession.user.id,
        source: "auth_servers",
      });
    } catch {
      // melhor esforco; nao bloquear dashboard por limpeza de onboarding
    }

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

    const accessibleGuilds = await getAccessibleGuildsForSession({
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    });

    const lockedGuildMap = await getLockedGuildLicenseMap(
      accessibleGuilds.map((guild) => guild.id),
    );

    if (!latestApprovedOrderByGuild.size && !lockedGuildMap.size) {
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          servers: [],
        }),
      );
    }

    const servers = accessibleGuilds
      .filter(
        (guild) =>
          latestApprovedOrderByGuild.has(guild.id) || lockedGuildMap.has(guild.id),
      )
      .map((guild) => {
        const ownedOrder = latestApprovedOrderByGuild.get(guild.id) || null;
        const lockedRecord = lockedGuildMap.get(guild.id) || null;
        const currentLicenseBelongsToViewer =
          lockedRecord?.userId !== sessionData.authSession.user.id;
        const isLicenseOwner = lockedRecord
          ? !currentLicenseBelongsToViewer
          : Boolean(ownedOrder);
        const baseTimestamp = lockedRecord
          ? resolveLicenseBaseTimestamp({
              paid_at: lockedRecord?.paidAt || null,
              created_at: lockedRecord?.createdAt || new Date().toISOString(),
            })
          : resolveLicenseBaseTimestamp(
              ownedOrder || {
                paid_at: null,
                created_at: new Date().toISOString(),
              },
            );
        const licenseExpiresAtMs = baseTimestamp + LICENSE_VALIDITY_MS;
        const graceExpiresAtMs = licenseExpiresAtMs + EXPIRED_GRACE_MS;
        const nowMs = Date.now();

        let status: "paid" | "expired" | "off" = "off";
        if (lockedRecord) {
          status = lockedRecord.status;
        } else if (ownedOrder) {
          if (nowMs <= licenseExpiresAtMs) {
            status = "paid";
          } else if (nowMs <= graceExpiresAtMs) {
            status = "expired";
          }
        }

        const referencePaidAt = lockedRecord?.paidAt || ownedOrder?.paid_at || null;
        const referenceCreatedAt = lockedRecord?.createdAt || ownedOrder?.created_at;

        return {
          guildId: guild.id,
          guildName: guild.name,
          iconUrl: buildGuildIconUrl(guild.id, guild.icon),
          status,
          accessMode: isLicenseOwner ? "owner" : "viewer",
          licenseOwnerUserId: lockedRecord?.userId || sessionData.authSession.user.id,
          licensePaidAt: referencePaidAt || referenceCreatedAt,
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

    return applyNoStoreHeaders(
      NextResponse.json({
      ok: true,
      servers,
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
            : "Erro ao carregar servidores gerenciados.",
      },
      { status: 500 },
      ),
    );
  }
}
