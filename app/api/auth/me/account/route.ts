import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export async function DELETE() {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) return NextResponse.json({ ok: false }, { status: 401 });

  const supabase = getSupabaseAdminClientOrThrow();
  
  // Note: Using an anonymization technique or just straight up deleting it.
  // Straight up delete will fail if there's payment orders with RESTRICT. 
  // We'll update the display_name to 'Deleted User' and clear info.
  const { error } = await supabase
    .from("auth_users")
    .update({
      display_name: "Deleted User",
      username: "deleted",
      avatar: null,
      email: null,
      raw_user: {}
    })
    .eq("id", sessionData.authSession.user.id);

  if (error) {
     return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
