import { NextRequest, NextResponse } from "next/server";
import {
  consumeHostingGitHubHandoffToken,
  fetchHostingGitHubProfile,
  setHostingGitHubTokenCookie,
} from "@/lib/hosting/github";
import { applyNoStoreHeaders } from "@/lib/security/http";

type CompleteGitHubBody = {
  handoffToken?: unknown;
};

export async function POST(request: NextRequest) {
  let body: CompleteGitHubBody;
  try {
    body = await request.json() as CompleteGitHubBody;
  } catch {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        connected: false,
        message: "Payload invalido ao concluir GitHub.",
      }, { status: 400 }),
    );
  }

  const token = consumeHostingGitHubHandoffToken(body.handoffToken);
  if (!token) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        connected: false,
        message: "Autorizacao temporaria do GitHub expirou ou nao chegou completa.",
      }, { status: 400 }),
    );
  }

  try {
    const profile = await fetchHostingGitHubProfile(token);
    const response = NextResponse.json({
      ok: true,
      connected: true,
      ...profile,
    });
    setHostingGitHubTokenCookie(request, response, token);
    return applyNoStoreHeaders(response);
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        connected: false,
        message: error instanceof Error ? error.message : "Nao foi possivel validar o GitHub.",
      }, { status: 502 }),
    );
  }
}
