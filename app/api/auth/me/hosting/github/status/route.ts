import { NextResponse } from "next/server";
import {
  fetchHostingGitHubProfile,
  hasHostingGitHubTokenCookie,
  isHostingGitHubConfigured,
  readHostingGitHubToken,
} from "@/lib/hosting/github";
import { applyNoStoreHeaders } from "@/lib/security/http";

export async function GET() {
  if (!isHostingGitHubConfigured()) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        connected: false,
        diagnostics: {
          configured: false,
          tokenPresent: false,
          accountsCount: 0,
        },
        message: "Configure GITHUB_CLIENT_ID e GITHUB_CLIENT_SECRET para ativar o GitHub real.",
      }),
    );
  }

  const tokenPresent = await hasHostingGitHubTokenCookie();
  const token = await readHostingGitHubToken();
  if (!token) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        connected: false,
        accounts: [],
        diagnostics: {
          configured: true,
          tokenPresent,
          accountsCount: 0,
        },
        message: tokenPresent
          ? "Token do GitHub encontrado, mas nao consegui descriptografar neste host. Confira se voce esta usando o mesmo dominio do callback."
          : "A autorizacao do GitHub ainda nao chegou neste dominio.",
      }),
    );
  }

  try {
    const profile = await fetchHostingGitHubProfile(token);
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        connected: true,
        diagnostics: {
          configured: true,
          tokenPresent: true,
          accountsCount: profile.accounts.length,
        },
        ...profile,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        connected: false,
        accounts: [],
        diagnostics: {
          configured: true,
          tokenPresent: true,
          accountsCount: 0,
        },
        message: error instanceof Error ? error.message : "Nao foi possivel ler o GitHub.",
      }, { status: 502 }),
    );
  }
}
