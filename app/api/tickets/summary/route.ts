import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

async function getCount(status: "open" | "closed", guildId?: string) {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    throw new Error(
      "Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente do site.",
    );
  }

  let query = supabase
    .from("tickets")
    .select("id", { head: true, count: "exact" })
    .eq("status", status);

  if (guildId) {
    query = query.eq("guild_id", guildId);
  }

  const result = await query;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.count || 0;
}

export async function GET() {
  try {
    const guildId = process.env.DISCORD_GUILD_ID;
    const [open, closed] = await Promise.all([
      getCount("open", guildId),
      getCount("closed", guildId),
    ]);

    return NextResponse.json({
      ok: true,
      guildId: guildId || null,
      totals: { open, closed },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erro ao consultar resumo de tickets.",
      },
      { status: 500 },
    );
  }
}
