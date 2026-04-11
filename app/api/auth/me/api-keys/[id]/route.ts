import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) return NextResponse.json({ ok: false }, { status: 401 });

  const resolvedParams = await params;
  const id = resolvedParams.id;

  const supabase = getSupabaseAdminClientOrThrow();
  const { error } = await supabase
    .from("auth_user_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", sessionData.authSession.user.id);

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
