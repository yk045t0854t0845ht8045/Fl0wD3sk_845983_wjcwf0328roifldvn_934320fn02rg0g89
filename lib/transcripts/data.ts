import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

const TICKET_TRANSCRIPTS_TABLE = "ticket_transcripts";

export type TicketTranscriptRecord = {
  id: number;
  ticket_id: number;
  protocol: string;
  guild_id: string;
  channel_id: string;
  user_id: string;
  closed_by: string;
  transcript_html: string;
  access_code_hash: string;
  created_at: string;
  updated_at: string;
};

export function normalizeTranscriptProtocol(value: string | null | undefined) {
  const trimmed = decodeURIComponent(String(value || "").trim()).toUpperCase();
  if (!trimmed || trimmed.length > 80) return null;
  if (!/^TK-[A-Z0-9-]+$/.test(trimmed)) return null;
  return trimmed;
}

export async function getTicketTranscriptByProtocol(
  protocol: string,
): Promise<TicketTranscriptRecord | null> {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from(TICKET_TRANSCRIPTS_TABLE)
    .select("*")
    .eq("protocol", protocol)
    .maybeSingle<TicketTranscriptRecord>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar transcript do ticket: ${result.error.message}`,
    );
  }

  return result.data || null;
}

export async function getTicketTranscriptPreviewByProtocol(protocol: string) {
  const supabase = getSupabaseAdminClientOrThrow();

  const result = await supabase
    .from(TICKET_TRANSCRIPTS_TABLE)
    .select("id, protocol, user_id, created_at, updated_at")
    .eq("protocol", protocol)
    .maybeSingle<Pick<
      TicketTranscriptRecord,
      "id" | "protocol" | "user_id" | "created_at" | "updated_at"
    >>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar preview do transcript: ${result.error.message}`,
    );
  }

  return result.data || null;
}
