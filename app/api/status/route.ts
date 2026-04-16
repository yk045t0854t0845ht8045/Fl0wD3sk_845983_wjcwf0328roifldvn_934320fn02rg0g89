import { NextResponse } from "next/server";
import { getSystemStatus, subscribeToStatus } from "../../../lib/status/service";
import type { StatusSubscriptionType } from "../../../lib/status/service";

const ALLOWED_SUBSCRIPTION_TYPES: StatusSubscriptionType[] = [
  "email",
  "discord_dm",
  "webhook",
  "discord_channel",
];

export async function GET() {
  try {
    const status = await getSystemStatus();
    return NextResponse.json(
      { ok: true, ...status },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Error fetching system status:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao buscar o status do sistema.",
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const type = body?.type as StatusSubscriptionType | undefined;
    const target = typeof body?.target === "string" ? body.target : "";

    if (!type || !target) {
      return NextResponse.json(
        { ok: false, error: "Tipo e destino da inscricao sao obrigatorios." },
        { status: 400 },
      );
    }

    if (!ALLOWED_SUBSCRIPTION_TYPES.includes(type)) {
      return NextResponse.json(
        { ok: false, error: "Tipo de inscricao invalido." },
        { status: 400 },
      );
    }

    await subscribeToStatus(type, target);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error subscribing to system status:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao registrar a inscricao.",
      },
      { status: 500 },
    );
  }
}
