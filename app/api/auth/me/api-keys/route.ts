import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import crypto from "crypto";
import { applyNoStoreHeaders } from "@/lib/security/http";

export async function GET() {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) return NextResponse.json({ ok: false }, { status: 401 });

  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("auth_user_api_keys")
    .select("id, name, last_four, created_at, revoked_at")
    .eq("user_id", sessionData.authSession.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return applyNoStoreHeaders(NextResponse.json({ ok: true, keys: data }));
}

export async function POST(req: Request) {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) return NextResponse.json({ ok: false }, { status: 401 });

  const { name } = await req.json();
  if (!name) return NextResponse.json({ ok: false, message: "Nome é obrigatório." }, { status: 400 });

  const rawKey = `fdk_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const lastFour = rawKey.slice(-4);

  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("auth_user_api_keys")
    .insert({
      user_id: sessionData.authSession.user.id,
      name,
      key_hash: keyHash,
      last_four: lastFour
    })
    .select("id, name, last_four, created_at, revoked_at")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, key: data, secret: rawKey });
}
