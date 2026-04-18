import { NextRequest } from "next/server";
import { handleMicrosoftAuthCallback } from "@/lib/auth/microsoftCallback";

export async function GET(request: NextRequest) {
  return handleMicrosoftAuthCallback(request);
}
