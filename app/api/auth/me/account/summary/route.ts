import { NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getAccountSummary } from "@/lib/account/summary";

export async function GET() {
  const authSession = await getCurrentAuthSessionFromCookie();
  if (!authSession) return NextResponse.json({ ok: false }, { status: 401 });

  const userId = authSession.user.id;
  const discordUserId = authSession.user.discord_user_id;

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
