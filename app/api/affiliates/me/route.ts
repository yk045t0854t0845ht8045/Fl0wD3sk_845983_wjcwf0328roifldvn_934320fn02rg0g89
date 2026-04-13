import { NextResponse } from "next/server";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const user = await getCurrentUserFromSessionCookie();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  // 1. Buscar Perfil de Afiliado
  let { data: profile, error: profileError } = await supabaseAdmin
    .from("affiliates")
    .select("*")
    .eq("user_id", user.id)
    .single();

  // 1.1 Se não existir, criar automaticamente
  if (!profile) {
    const generatedId = `AFF-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    
    const { data: newProfile, error: createError } = await supabaseAdmin
      .from("affiliates")
      .insert([{
        user_id: user.id,
        affiliate_id: generatedId,
        level: 'bronze'
      }])
      .select()
      .single();

    if (createError) {
      console.error("Error creating affiliate profile:", createError);
      return NextResponse.json({ ok: false, message: "Failed to create affiliate profile" }, { status: 500 });
    }
    
    profile = newProfile;

    // Criar configurações padrão também
    await supabaseAdmin.from("affiliate_settings").insert([{ affiliate_id: profile.id }]);
  }

  // 2. Buscar Dados Relacionados em Paralelo
  const [linksResult, conversionsResult, withdrawalsResult, rankingResult, settingsResult] = await Promise.all([
    supabaseAdmin.from("affiliate_links").select("*").eq("affiliate_id", profile.id),
    supabaseAdmin.from("affiliate_conversions").select("*").eq("affiliate_id", profile.id),
    supabaseAdmin.from("affiliate_withdrawals").select("*").eq("affiliate_id", profile.id),
    supabaseAdmin.from("affiliates")
      .select("affiliate_id, total_earned, user:auth_users(username, display_name, avatar)")
      .order("total_earned", { ascending: false })
      .limit(10),
    supabaseAdmin.from("affiliate_settings").select("*").eq("affiliate_id", profile.id).single()
  ]);

  const links = linksResult.data || [];
  const conversions = conversionsResult.data || [];
  const rankingRaw = rankingResult.data || [];

  // Calcular estatísticas agregadas
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const stats = {
    totalClicks: links.reduce((acc, l) => acc + (l.clicks_count || 0), 0),
    clicksToday: 0, // Necessita de tabela de logs de cliques para ser real
    clicksThisMonth: 0, // Necessita de tabela de logs de cliques para ser real
    totalSales: conversions.filter(c => c.status === 'approved').length,
    salesThisMonth: conversions.filter(c => {
      const cDate = new Date(c.conversion_date);
      return cDate >= startOfMonth && c.status === 'approved';
    }).length,
    availableBalance: Number(profile.balance_available) || 0,
    totalCommissionPending: Number(profile.balance_pending) || 0,
    totalCommissionEarned: Number(profile.total_earned) || 0,
    rankThisMonth: rankingRaw.findIndex(r => r.affiliate_id === profile.affiliate_id) + 1 || null,
  };

  // Formatar Ranking para o Frontend
  const ranking = rankingRaw.map((r, i) => ({
    rank: i + 1,
    affiliateId: r.affiliate_id,
    displayName: (r.user as any)?.display_name || (r.user as any)?.username || "Usuário",
    avatarUrl: (r.user as any)?.avatar ? `https://cdn.discordapp.com/avatars/${(r.user as any)?.discord_user_id}/${(r.user as any)?.avatar}.png` : null,
    totalEarned: Number(r.total_earned),
  }));

  return NextResponse.json({
    ok: true,
    profile: {
      id: profile.id,
      affiliateId: profile.affiliate_id || (profile as any).affiliateId,
      userId: profile.user_id || (profile as any).userId,
      level: profile.level,
      couponCode: profile.coupon_code || (profile as any).couponCode,
      whatsappGroupUrl: profile.whatsapp_group_url || (profile as any).whatsappGroupUrl,
      isActive: profile.is_active || (profile as any).isActive,
      createdAt: profile.created_at || (profile as any).createdAt
    },
    stats,
    settings: settingsResult.data || null,
    links: links.map(l => ({
      linkId: l.id,
      affiliateId: l.affiliate_id,
      plan: l.plan_slug,
      period: l.period,
      url: l.target_url,
      shortUrl: l.short_url,
      clicks: l.clicks_count || 0,
      conversions: l.conversions_count || 0,
      conversionRate: l.clicks_count > 0 ? (l.conversions_count / l.clicks_count) * 100 : 0,
      createdAt: l.created_at
    })),
    conversions: conversions.map(c => ({
      commissionId: c.id,
      saleAmount: Number(c.amount_total),
      commissionAmount: Number(c.commission_amount),
      status: c.status,
      createdAt: c.conversion_date
    })),
    withdrawals: (withdrawalsResult.data || []).map(w => ({
      withdrawalId: w.id,
      amount: Number(w.amount),
      pixKey: w.pix_key,
      status: w.status,
      requestedAt: w.created_at
    })),
    ranking
  });
}
