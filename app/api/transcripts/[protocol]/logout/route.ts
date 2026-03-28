import { NextRequest, NextResponse } from "next/server";
import { buildTranscriptCookieName } from "@/lib/transcripts/access";
import { normalizeTranscriptProtocol } from "@/lib/transcripts/data";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import { isSecureRequest } from "@/lib/auth/config";

type TranscriptRouteParams = {
  params: Promise<{
    protocol: string;
  }>;
};

export async function POST(request: NextRequest, { params }: TranscriptRouteParams) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) {
    return applyNoStoreHeaders(originGuard);
  }

  const routeParams = await params;
  const protocol = normalizeTranscriptProtocol(routeParams.protocol);

  if (!protocol) {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: "Transcript invalido." },
        { status: 400 },
      ),
    );
  }

  const response = applyNoStoreHeaders(NextResponse.json({ ok: true }));
  response.cookies.set(buildTranscriptCookieName(protocol), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    maxAge: 0,
    path: "/",
    expires: new Date(0),
  });
  return response;
}
