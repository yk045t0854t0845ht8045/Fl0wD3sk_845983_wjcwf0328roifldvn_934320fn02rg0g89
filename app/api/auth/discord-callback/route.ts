import type { NextRequest } from "next/server";
import { handleDiscordAuthCallback } from "@/lib/auth/discordCallback";

export async function GET(request: NextRequest) {
  return handleDiscordAuthCallback(request);
}
