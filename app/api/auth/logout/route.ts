import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/config";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import { revokeCurrentSessionFromCookie } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    const securityResponse = ensureSameOriginJsonMutationRequest(request);
    if (securityResponse) return securityResponse;

    await revokeCurrentSessionFromCookie();

    const response = NextResponse.json({ ok: true });
    response.cookies.delete(authConfig.sessionCookieName);
    return applyNoStoreHeaders(response);
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Erro ao encerrar sessao.",
      },
      { status: 500 },
      ),
    );
  }
}
