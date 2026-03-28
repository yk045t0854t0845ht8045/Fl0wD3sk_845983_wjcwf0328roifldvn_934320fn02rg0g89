import { NextRequest, NextResponse } from "next/server";
import {
  clearTranscriptSessionCookie,
  getTranscriptSessionTtlSeconds,
  hashTranscriptAccessCode,
  setTranscriptSessionCookie,
} from "@/lib/transcripts/access";
import {
  getTicketTranscriptByProtocol,
  normalizeTranscriptProtocol,
} from "@/lib/transcripts/data";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";

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

  try {
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

    const body = (await request.json().catch(() => null)) as
      | { code?: string }
      | null;
    const code = String(body?.code || "").replace(/\D/g, "").slice(0, 4);

    if (code.length !== 4) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Informe o codigo de 4 digitos." },
          { status: 400 },
        ),
      );
    }

    const transcript = await getTicketTranscriptByProtocol(protocol);
    if (!transcript) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Transcript nao encontrado." },
          { status: 404 },
        ),
      );
    }

    const submittedHash = hashTranscriptAccessCode(protocol, code);
    if (submittedHash !== transcript.access_code_hash) {
      const response = applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Codigo invalido." },
          { status: 401 },
        ),
      );
      clearTranscriptSessionCookie(response, request, protocol);
      return response;
    }

    const expiresAtMs = Date.now() + getTranscriptSessionTtlSeconds() * 1000;
    const response = applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        expiresAt: new Date(expiresAtMs).toISOString(),
      }),
    );

    setTranscriptSessionCookie(response, request, protocol, expiresAtMs);
    return response;
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "Erro ao validar o codigo do transcript.",
        },
        { status: 500 },
      ),
    );
  }
}
