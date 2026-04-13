import { NextResponse } from "next/server";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const user = await getCurrentUserFromSessionCookie();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const { planSlug, period } = await req.json();

  if (!planSlug || !period) {
    return NextResponse.json({ ok: false, message: "Plan and period are required" }, { status: 400 });
  }

  // 1. Buscar Perfil de Afiliado
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("affiliates")
    .select("id, affiliate_id")
    .eq("user_id", user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ ok: false, message: "Affiliate profile not found" }, { status: 404 });
  }

  // 2. Gerar URL Curta (Ex: flwdesk.com/r/AFF-123/pro-anual)
  // Nota: Isso é apenas uma string demonstrativa para o dashboard. 
  // Em produção, você teria um redirecionador real.
  const shortUrl = `flwdesk.com/r/${profile.affiliate_id}/${planSlug}-${period}`;
  const targetUrl = `https://flwdesk.com/register?aff=${profile.affiliate_id}&plan=${planSlug}&period=${period}`;

  // 3. Salvar link no banco
  const { data: newLink, error: linkError } = await supabaseAdmin
    .from("affiliate_links")
    .insert([{
      affiliate_id: profile.id,
      plan_slug: planSlug,
      period: period,
      short_url: shortUrl,
      target_url: targetUrl
    }])
    .select()
    .single();

  if (linkError) {
    console.error("Error creating affiliate link:", linkError);
    return NextResponse.json({ ok: false, message: "Failed to create link" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, link: newLink });
}
