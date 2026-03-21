import { NextResponse } from "next/server";
import {
  getAccessibleGuildsForSession,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import {
  getLockedGuildLicenseMap,
  resolveLatestLicenseCoverageMapForGuilds,
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

    const latestApprovedOrderByGuild = new Map<string, ApprovedOrderRecord[]>();
    for (const order of approvedOrdersResult.data || []) {
      const current = latestApprovedOrderByGuild.get(order.guild_id) || [];
      current.push(order);
      latestApprovedOrderByGuild.set(order.guild_id, current);
    }
    const latestOwnedCoverageByGuild =
      resolveLatestLicenseCoverageMapForGuilds(latestApprovedOrderByGuild);

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
          latestOwnedCoverageByGuild.has(guild.id) || lockedGuildMap.has(guild.id),
      )
      .map((guild) => {
        const ownedCoverage = latestOwnedCoverageByGuild.get(guild.id) || null;
        const lockedRecord = lockedGuildMap.get(guild.id) || null;
        const currentLicenseBelongsToViewer =
          lockedRecord?.userId !== sessionData.authSession.user.id;
        const isLicenseOwner = lockedRecord
          ? !currentLicenseBelongsToViewer
          : Boolean(ownedCoverage);

        const status: "paid" | "expired" | "off" = currentLicenseBelongsToViewer
          ? lockedRecord?.status || "off"
          : ownedCoverage?.status || "off";
        const referencePaidAt = currentLicenseBelongsToViewer
          ? lockedRecord?.paidAt || null
          : ownedCoverage?.paidAt || null;
        const referenceCreatedAt = currentLicenseBelongsToViewer
          ? lockedRecord?.createdAt || null
          : ownedCoverage?.createdAt || null;
        const licenseExpiresAt = currentLicenseBelongsToViewer
          ? lockedRecord?.licenseExpiresAt || null
          : ownedCoverage?.licenseExpiresAt || null;
        const graceExpiresAt = currentLicenseBelongsToViewer
          ? lockedRecord?.graceExpiresAt || null
          : ownedCoverage?.graceExpiresAt || null;
        const licenseExpiresAtMs = licenseExpiresAt
          ? Date.parse(licenseExpiresAt)
          : Number.NaN;
        const graceExpiresAtMs = graceExpiresAt
          ? Date.parse(graceExpiresAt)
          : Number.NaN;

        return {
          guildId: guild.id,
          guildName: guild.name,
          iconUrl: buildGuildIconUrl(guild.id, guild.icon),
          status,
          accessMode: isLicenseOwner ? "owner" : "viewer",
          licenseOwnerUserId: lockedRecord?.userId || sessionData.authSession.user.id,
          licensePaidAt: referencePaidAt || referenceCreatedAt,
          licenseExpiresAt:
            licenseExpiresAt || referenceCreatedAt || new Date().toISOString(),
          graceExpiresAt:
            graceExpiresAt || referenceCreatedAt || new Date().toISOString(),
          daysUntilExpire: Number.isFinite(licenseExpiresAtMs)
            ? daysLeft(licenseExpiresAtMs)
            : 0,
          daysUntilOff: Number.isFinite(graceExpiresAtMs)
            ? daysLeft(graceExpiresAtMs)
            : 0,
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
