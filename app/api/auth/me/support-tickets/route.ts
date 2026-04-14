import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/auth/discordGuildAccess";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getSupportTicketsForDiscordUser } from "@/lib/account/supportTickets";

export async function GET() {
  try {
    const sessionData = await resolveSessionAccessToken();
    if (!sessionData?.authSession) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Nao autorizado." },
          { status: 401 },
        ),
      );
    }

    const discordUserId = sessionData.authSession.user.discord_user_id;
    const tickets = await getSupportTicketsForDiscordUser(discordUserId);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        tickets,
        count: tickets.length,
      }),
    );
  } catch (error) {
    console.error("[Tickets API] Failed to load support tickets:", error);
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: "Erro ao carregar tickets." },
        { status: 500 },
      ),
    );
  }
}
