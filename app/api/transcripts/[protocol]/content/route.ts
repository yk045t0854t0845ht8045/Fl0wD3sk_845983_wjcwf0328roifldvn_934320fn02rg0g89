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

const TRANSCRIPT_VIEWER_THEME_OVERRIDE = `
<style id="flowdesk-transcript-theme-override">
  body {
    background: #070707 !important;
    color: #dcddde !important;
  }
  .fd-shell {
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 14px 18px 44px !important;
  }
  .fd-head {
    margin: 0 0 8px !important;
    padding: 10px 0 12px !important;
    border: 0 !important;
    border-bottom: 1px solid #1a1a1a !important;
    border-radius: 0 !important;
    background: linear-gradient(
      180deg,
      rgba(7, 7, 7, 0.97),
      rgba(7, 7, 7, 0.84)
    ) !important;
  }
  .fd-head h1 {
    margin: 0 !important;
    font-size: 13px !important;
    font-weight: 600 !important;
    color: #f2f3f5 !important;
  }
  .fd-head p {
    margin: 4px 0 0 !important;
    color: #9fa1a6 !important;
  }
  .fd-stream {
    gap: 0 !important;
  }
  .fd-message {
    border: 0 !important;
    border-radius: 8px !important;
    background: transparent !important;
    grid-template-columns: 40px minmax(0, 1fr) !important;
    gap: 12px !important;
    padding: 4px 12px 10px !important;
  }
  .fd-message:hover {
    background: rgba(255, 255, 255, 0.03) !important;
  }
  .fd-message-continuation {
    padding-top: 0 !important;
  }
  .fd-avatar {
    border: 0 !important;
    background: #111111 !important;
  }
  .fd-avatar-spacer {
    width: 40px !important;
    display: block !important;
  }
  .fd-message-continuation .fd-bubble {
    padding-top: 0 !important;
  }
  .fd-meta {
    margin-bottom: 2px !important;
  }
  .fd-reference {
    border-left: 2px solid #4a4a4a !important;
    background: rgba(255, 255, 255, 0.04) !important;
  }
  .fd-attachment {
    border-color: #1e1e1e !important;
    background: #0c0c0c !important;
  }
  .fd-file {
    border-color: #242424 !important;
    background: #0c0c0c !important;
  }
  .fd-embed {
    border: 1px solid #2a2a2a !important;
    border-left: 4px solid #4b4b4b !important;
    background: #0f0f0f !important;
  }
  .fd-embed-field {
    border-color: #2b2b2b !important;
    background: #0b0b0b !important;
  }
  .fd-reaction {
    border-color: #2a2a2a !important;
    background: #121212 !important;
  }
  .fd-sticker {
    border-color: #252525 !important;
    background: #101010 !important;
  }
  @media (max-width: 640px) {
    .fd-avatar-spacer {
      width: 36px !important;
    }
  }
</style>
`;

const TRANSCRIPT_VIEWER_GROUPING_SCRIPT = `
<script id="flowdesk-transcript-grouping">
  (function () {
    var stream = document.querySelector(".fd-stream");
    if (!stream) return;

    var messages = stream.querySelectorAll(".fd-message");
    var previousSender = "";

    for (var index = 0; index < messages.length; index += 1) {
      var message = messages[index];
      var authorElement = message.querySelector(".fd-author");
      var currentSender = "";
      if (authorElement && authorElement.textContent) {
        currentSender = authorElement.textContent.trim().toLowerCase();
      }

      if (currentSender && currentSender === previousSender) {
        message.classList.add("fd-message-continuation");
        var meta = message.querySelector(".fd-meta");
        if (meta) meta.remove();

        var avatar = message.querySelector(".fd-avatar");
        if (avatar) {
          var spacer = document.createElement("span");
          spacer.className = "fd-avatar-spacer";
          spacer.setAttribute("aria-hidden", "true");
          avatar.replaceWith(spacer);
        }
      } else if (currentSender) {
        previousSender = currentSender;
      }
    }
  })();
</script>
`;

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

function applyTranscriptViewerTheme(html: string) {
  if (!html) {
    return html;
  }

  if (
    html.includes("flowdesk-transcript-theme-override") &&
    html.includes("flowdesk-transcript-grouping")
  ) {
    return html;
  }

  if (!html.includes("fd-message")) {
    return html;
  }

  let themedHtml = html;
  if (/<\/head>/i.test(html)) {
    themedHtml = html.replace(
      /<\/head>/i,
      `${TRANSCRIPT_VIEWER_THEME_OVERRIDE}</head>`,
    );
  } else {
    themedHtml = `${TRANSCRIPT_VIEWER_THEME_OVERRIDE}${html}`;
  }

  if (/<\/body>/i.test(themedHtml)) {
    return themedHtml.replace(
      /<\/body>/i,
      `${TRANSCRIPT_VIEWER_GROUPING_SCRIPT}</body>`,
    );
  }

  return `${themedHtml}${TRANSCRIPT_VIEWER_GROUPING_SCRIPT}`;
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

    return buildTranscriptHtmlResponse(
      applyTranscriptViewerTheme(transcript.transcript_html),
      200,
    );
  } catch {
    return buildTranscriptHtmlResponse(buildUnauthorizedHtml(), 500);
  }
}
