import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders } from "@/lib/security/http";

export async function GET() {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) return NextResponse.json({ ok: false }, { status: 401 });

  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("tickets")
    .select("id, protocol, status, guild_id, opened_at, closed_at")
    .eq("user_id", sessionData.authSession.user.discord_user_id)
    .order("opened_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return applyNoStoreHeaders(NextResponse.json({ ok: true, tickets: data }));
}
