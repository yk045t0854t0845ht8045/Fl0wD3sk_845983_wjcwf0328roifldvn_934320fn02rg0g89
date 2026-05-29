import { NextRequest, NextResponse } from "next/server";
import {
  fetchHostingGitHubRepositories,
  isHostingGitHubConfigured,
  readHostingGitHubToken,
} from "@/lib/hosting/github";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { applyNoStoreHeaders } from "@/lib/security/http";

export async function GET(request: NextRequest) {
  if (!isHostingGitHubConfigured()) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        repositories: [],
        message: "GitHub OAuth nao configurado.",
      }, { status: 503 }),
    );
  }

  const session = await getCurrentAuthSessionFromCookie();
  const token = await readHostingGitHubToken(session?.user?.id);
  if (!token) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        repositories: [],
        message: "Conecte sua conta GitHub primeiro.",
      }, { status: 401 }),
    );
  }

  try {
    const repositories = await fetchHostingGitHubRepositories({
      token,
      owner: request.nextUrl.searchParams.get("owner"),
      ownerType: request.nextUrl.searchParams.get("ownerType"),
      query: request.nextUrl.searchParams.get("q"),
    });
    return applyNoStoreHeaders(NextResponse.json({ ok: true, repositories }));
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: false,
        repositories: [],
        message: error instanceof Error ? error.message : "Nao foi possivel carregar repositorios.",
      }, { status: 502 }),
    );
  }
}
