import { OFFICIAL_DISCORD_GUILD_ID } from "@/lib/discordLink/config";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type SupportTicket = {
  id: number;
  protocol: string;
  status: string;
  guild_id: string | null;
  opened_at: string;
  closed_at: string | null;
  transcript_file: string | null;
  opened_reason: string | null;
  closed_by: string | null;
  access_code: string | null;
};

type SupportTicketRow = Omit<SupportTicket, "access_code"> & {
  ticket_transcripts?:
    | {
        access_code?: string | null;
      }
    | Array<{
        access_code?: string | null;
      }>
    | null;
};

export async function getSupportTicketsForDiscordUser(
  discordUserId: string,
): Promise<SupportTicket[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const { data, error } = await supabase
    .from("tickets")
    .select(
      `
        id, protocol, status, guild_id, opened_at, closed_at, transcript_file, opened_reason, closed_by,
        ticket_transcripts!ticket_id (
          access_code
        )
      `,
    )
    .eq("user_id", discordUserId)
    .eq("guild_id", OFFICIAL_DISCORD_GUILD_ID)
    .order("opened_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  return ((data || []) as SupportTicketRow[]).map((ticket) => {
    const transcripts = ticket.ticket_transcripts;
    const accessCode = Array.isArray(transcripts)
      ? transcripts[0]?.access_code
      : transcripts?.access_code;

    return {
      id: ticket.id,
      protocol: ticket.protocol,
      status: ticket.status,
      guild_id: ticket.guild_id,
      opened_at: ticket.opened_at,
      closed_at: ticket.closed_at,
      transcript_file: ticket.transcript_file,
      opened_reason: ticket.opened_reason,
      closed_by: ticket.closed_by,
      access_code: accessCode || null,
    };
  });
}
