import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getAccountSummary } from "@/lib/account/summary";

export async function GET() {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) return NextResponse.json({ ok: false }, { status: 401 });

  const userId = sessionData.authSession.user.id;
  const discordUserId = sessionData.authSession.user.discord_user_id;

  try {
    const summary = await getAccountSummary(userId.toString(), discordUserId);

    return applyNoStoreHeaders(NextResponse.json({
      ok: true,
      summary
    }));
  } catch (error) {
    console.error("Error in account summary API:", error);
    return NextResponse.json({ ok: false, message: "Erro ao buscar resumo." }, { status: 500 });
  }
}
