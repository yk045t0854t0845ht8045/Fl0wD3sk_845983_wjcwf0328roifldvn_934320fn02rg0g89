import { NextResponse } from "next/server";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const user = await getCurrentUserFromSessionCookie();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const { webhookUrl, notifyEmail, notifySms } = await req.json();

  // 1. Buscar Perfil de Afiliado
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("affiliates")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ ok: false, message: "Affiliate profile not found" }, { status: 404 });
  }

  // 2. Upsert nas configurações
  const { error: settingsError } = await supabaseAdmin
    .from("affiliate_settings")
    .upsert({
      affiliate_id: profile.id,
      webhook_url: webhookUrl,
      notify_email: notifyEmail,
      notify_sms: notifySms,
      updated_at: new Date().toISOString()
    });

  if (settingsError) {
    console.error("Error updating affiliate settings:", settingsError);
    return NextResponse.json({ ok: false, message: "Failed to update settings" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const user = await getCurrentUserFromSessionCookie();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabaseAdmin
    .from("affiliates")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!profile) return NextResponse.json({ ok: false });

  const { data: settings } = await supabaseAdmin
    .from("affiliate_settings")
    .select("*")
    .eq("affiliate_id", profile.id)
    .single();

  return NextResponse.json({ ok: true, settings });
}
