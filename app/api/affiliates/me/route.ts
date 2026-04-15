import { NextResponse } from "next/server";
import { generateAffiliateInsight } from "@/lib/affiliates/intelligence";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RankingUser = {
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
  discord_user_id?: string | null;
};

type RankingAffiliateRow = {
  id: string;
  affiliate_id: string;
  level?: string | null;
  total_earned?: number | string | null;
  user?: RankingUser | RankingUser[] | null;
};

function toNumber(value: unknown) {
  const numeric =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));

  return Number.isFinite(numeric) ? numeric : 0;
}

function pickRankingUser(user: RankingAffiliateRow["user"]) {
  if (Array.isArray(user)) {
    return (user[0] || null) as RankingUser | null;
  }

  return (user || null) as RankingUser | null;
}

function buildDiscordAvatarUrl(user: RankingUser | null) {
  const avatar = String(user?.avatar || "").trim();
  const discordUserId = String(user?.discord_user_id || "").trim();

  if (!avatar || !discordUserId) {
    return null;
  }

  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.png`;
}

export async function GET() {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  let { data: profile } = await supabaseAdmin
    .from("affiliates")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    const generatedId = `AFF-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

    const { data: newProfile, error: createError } = await supabaseAdmin
      .from("affiliates")
      .insert([
        {
          user_id: user.id,
          affiliate_id: generatedId,
          level: "bronze",
        },
      ])
      .select()
      .single();

    if (createError || !newProfile) {
      console.error("Error creating affiliate profile:", createError);
      return NextResponse.json(
        { ok: false, message: "Failed to create affiliate profile" },
        { status: 500 },
      );
    }

    profile = newProfile;
    await supabaseAdmin
      .from("affiliate_settings")
      .insert([{ affiliate_id: profile.id }]);
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    linksResult,
    conversionsResult,
    withdrawalsResult,
    rankingAffiliatesResult,
    currentMonthConversionsResult,
    settingsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("affiliate_links")
      .select("*")
      .eq("affiliate_id", profile.id)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("affiliate_conversions")
      .select("*")
      .eq("affiliate_id", profile.id)
      .order("conversion_date", { ascending: false }),
    supabaseAdmin
      .from("affiliate_withdrawals")
      .select("*")
      .eq("affiliate_id", profile.id)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("affiliates")
      .select(
        "id, affiliate_id, level, total_earned, user:auth_users(username, display_name, avatar, discord_user_id)",
      ),
    supabaseAdmin
      .from("affiliate_conversions")
      .select("affiliate_id, commission_amount, status, conversion_date")
      .eq("status", "approved")
      .gte("conversion_date", startOfMonth.toISOString()),
    supabaseAdmin
      .from("affiliate_settings")
      .select("*")
      .eq("affiliate_id", profile.id)
      .single(),
  ]);

  const links = linksResult.data || [];
  const conversions = conversionsResult.data || [];
  const withdrawals = withdrawalsResult.data || [];
  const linksById = new Map(links.map((link) => [link.id, link]));

  const totalClicks = links.reduce(
    (total, link) => total + Math.max(0, Math.round(toNumber(link.clicks_count))),
    0,
  );
  const totalApprovedSales = conversions.filter(
    (conversion) => conversion.status === "approved",
  );
  const salesThisMonth = totalApprovedSales.filter((conversion) => {
    const conversionDate = new Date(conversion.conversion_date);
    return !Number.isNaN(conversionDate.getTime()) && conversionDate >= startOfMonth;
  });

  const totalCommissionWithdrawn = withdrawals.reduce((total, withdrawal) => {
    const normalizedStatus = String(withdrawal.status || "").toLowerCase();
    if (normalizedStatus === "paid" || normalizedStatus === "processed") {
      return total + toNumber(withdrawal.amount);
    }

    return total;
  }, 0);

  const rankingMetrics = new Map<string, { salesThisMonth: number; commissionThisMonth: number }>();
  for (const conversion of currentMonthConversionsResult.data || []) {
    const affiliateId = String(conversion.affiliate_id || "").trim();
    if (!affiliateId) {
      continue;
    }

    const current = rankingMetrics.get(affiliateId) || {
      salesThisMonth: 0,
      commissionThisMonth: 0,
    };

    current.salesThisMonth += 1;
    current.commissionThisMonth += toNumber(conversion.commission_amount);
    rankingMetrics.set(affiliateId, current);
  }

  const rankingCandidates = (rankingAffiliatesResult.data || [])
    .map((entry) => {
      const userInfo = pickRankingUser((entry as RankingAffiliateRow).user);
      const metrics = rankingMetrics.get(entry.id) || {
        salesThisMonth: 0,
        commissionThisMonth: 0,
      };

      return {
        id: entry.id,
        affiliateId: entry.affiliate_id,
        level: (entry.level || "bronze") as "bronze" | "silver" | "gold" | "diamond",
        totalEarned: toNumber(entry.total_earned),
        salesThisMonth: metrics.salesThisMonth,
        commissionThisMonth: metrics.commissionThisMonth,
        displayName:
          userInfo?.display_name ||
          userInfo?.username ||
          `Afiliado ${String(entry.affiliate_id || "").slice(-4)}`,
        avatarUrl: buildDiscordAvatarUrl(userInfo),
      };
    })
    .sort(
      (left, right) =>
        right.commissionThisMonth - left.commissionThisMonth ||
        right.salesThisMonth - left.salesThisMonth ||
        right.totalEarned - left.totalEarned ||
        left.affiliateId.localeCompare(right.affiliateId),
    );

  const currentRankIndex = rankingCandidates.findIndex(
    (entry) => entry.affiliateId === profile.affiliate_id,
  );
  const rankThisMonth = currentRankIndex >= 0 ? currentRankIndex + 1 : null;

  const insight = await generateAffiliateInsight({
    affiliateId: profile.affiliate_id || profile.id,
    affiliateLevel: profile.level,
    links,
    conversions,
  });

  const stats = {
    totalClicks,
    clicksToday: 0,
    clicksThisMonth: 0,
    totalSales: totalApprovedSales.length,
    salesThisMonth: salesThisMonth.length,
    availableBalance: toNumber(profile.balance_available),
    totalCommissionPending: toNumber(profile.balance_pending),
    totalCommissionEarned: toNumber(profile.total_earned),
    totalCommissionWithdrawn,
    conversionRate: totalClicks > 0 ? (totalApprovedSales.length / totalClicks) * 100 : 0,
    rankThisMonth:
      rankThisMonth === 1 || rankThisMonth === 2 || rankThisMonth === 3
        ? rankThisMonth
        : null,
  };

  const ranking = rankingCandidates.slice(0, 10).map((entry, index) => ({
    rank: index + 1,
    affiliateId: entry.affiliateId,
    displayName: entry.displayName,
    avatarUrl: entry.avatarUrl,
    level: entry.level,
    salesThisMonth: entry.salesThisMonth,
    commissionThisMonth: entry.commissionThisMonth,
    bonusPct: index === 0 ? 5 : index === 1 ? 3 : index === 2 ? 2 : 0,
  }));

  return NextResponse.json({
    ok: true,
    profile: {
      id: profile.id,
      affiliateId: profile.affiliate_id || profile.affiliateId,
      userId: profile.user_id || profile.userId,
      level: profile.level,
      couponCode: profile.coupon_code || profile.couponCode,
      whatsappGroupUrl: profile.whatsapp_group_url || profile.whatsappGroupUrl,
      isActive: profile.is_active || profile.isActive,
      createdAt: profile.created_at || profile.createdAt,
    },
    stats,
    settings: settingsResult.data || null,
    insight,
    links: links.map((link) => ({
      linkId: link.id,
      affiliateId: link.affiliate_id,
      plan: link.plan_slug,
      period: link.period,
      url: link.target_url,
      shortUrl: link.short_url,
      clicks: Math.max(0, Math.round(toNumber(link.clicks_count))),
      conversions: Math.max(0, Math.round(toNumber(link.conversions_count))),
      conversionRate:
        toNumber(link.clicks_count) > 0
          ? (toNumber(link.conversions_count) / toNumber(link.clicks_count)) * 100
          : 0,
      createdAt: link.created_at,
    })),
    conversions: conversions.map((conversion) => {
      const link = linksById.get(conversion.link_id);
      const saleAmount = toNumber(conversion.amount_total);
      const commissionAmount = toNumber(conversion.commission_amount);

      return {
        commissionId: conversion.id,
        affiliateId: conversion.affiliate_id,
        plan: conversion.plan_slug,
        period: link?.period || "monthly",
        saleAmount,
        commissionAmount,
        commissionPct: saleAmount > 0 ? (commissionAmount / saleAmount) * 100 : 0,
        status: conversion.status,
        approvedAt: conversion.status === "approved" ? conversion.conversion_date : null,
        createdAt: conversion.conversion_date,
      };
    }),
    withdrawals: withdrawals.map((withdrawal) => ({
      withdrawalId: withdrawal.id,
      affiliateId: withdrawal.affiliate_id,
      amount: toNumber(withdrawal.amount),
      pixKey: withdrawal.pix_key,
      status: withdrawal.status === "processed" ? "paid" : withdrawal.status,
      requestedAt: withdrawal.created_at,
      paidAt:
        withdrawal.status === "processed" || withdrawal.status === "paid"
          ? withdrawal.processed_at || withdrawal.created_at
          : null,
      notes: null,
    })),
    ranking,
  });
}
