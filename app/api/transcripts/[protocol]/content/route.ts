import { NextResponse } from "next/server";
import { getTranscriptSessionFromCookie } from "@/lib/transcripts/access";
import {
  getTicketTranscriptByProtocol,
  normalizeTranscriptProtocol,
} from "@/lib/transcripts/data";

type TranscriptRouteParams = {
  params: Promise<{
    protocol: string;
  }>;
};

function buildTranscriptHtmlResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control":
        "private, no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "same-origin",
    },
  });
}

function buildUnauthorizedHtml() {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Transcript protegido</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #050505;
        color: #d6d6d6;
        font: 500 16px/1.6 ui-sans-serif, system-ui, sans-serif;
      }
      main {
        max-width: 520px;
        padding: 32px 28px;
        border-radius: 24px;
        border: 1px solid #141414;
        background: linear-gradient(180deg, rgba(11,11,11,.98), rgba(6,6,6,.98));
        box-shadow: 0 28px 90px rgba(0,0,0,.4);
        text-align: center;
      }
      h1 { margin: 0 0 10px; font-size: 24px; color: #f1f1f1; }
      p { margin: 0; color: #8a8a8a; }
    </style>
  </head>
  <body>
    <main>
      <h1>Transcript protegido</h1>
      <p>Valide o codigo de 4 digitos na pagina principal para liberar este transcript.</p>
    </main>
  </body>
</html>`;
}

export async function GET(_: Request, { params }: TranscriptRouteParams) {
  try {
    const routeParams = await params;
    const protocol = normalizeTranscriptProtocol(routeParams.protocol);

    if (!protocol) {
      return buildTranscriptHtmlResponse(buildUnauthorizedHtml(), 404);
    }

    const session = await getTranscriptSessionFromCookie(protocol);
    if (!session) {
      return buildTranscriptHtmlResponse(buildUnauthorizedHtml(), 401);
    }

    const transcript = await getTicketTranscriptByProtocol(protocol);
    if (!transcript) {
      return buildTranscriptHtmlResponse(buildUnauthorizedHtml(), 404);
    }

    return buildTranscriptHtmlResponse(transcript.transcript_html, 200);
  } catch {
    return buildTranscriptHtmlResponse(buildUnauthorizedHtml(), 500);
  }
}
