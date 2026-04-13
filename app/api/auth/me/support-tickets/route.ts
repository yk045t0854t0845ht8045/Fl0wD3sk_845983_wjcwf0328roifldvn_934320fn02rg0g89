import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders } from "@/lib/security/http";

import { OFFICIAL_DISCORD_GUILD_ID } from "@/lib/discordLink/config";

export async function GET() {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    console.error("[Tickets API] No session found");
    return NextResponse.json({ ok: false, message: "Não autorizado" }, { status: 401 });
  }

  const discordUserId = sessionData.authSession.user.discord_user_id;
  const supabase = getSupabaseAdminClientOrThrow();
  
  const { data, error } = await supabase
    .from("tickets")
    .select("id, protocol, status, guild_id, opened_at, closed_at, transcript_file, opened_reason, closed_by")
    .eq("user_id", discordUserId)
    .eq("guild_id", OFFICIAL_DISCORD_GUILD_ID)
    .order("opened_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error(`[Tickets API] Database error for user ${discordUserId}:`, error);
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return applyNoStoreHeaders(NextResponse.json({ 
    ok: true, 
    tickets: data,
    debug_user_id: discordUserId,
    count: data?.length || 0
  }));
}
