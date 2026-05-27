import { NextRequest, NextResponse } from "next/server";
import {
  buildHostingGitHubAuthorizeUrl,
  createHostingGitHubState,
  isHostingGitHubConfigured,
  setHostingGitHubStateCookie,
} from "@/lib/hosting/github";
import { applyNoStoreHeaders } from "@/lib/security/http";

function popupHtml(input: { ok: boolean; message: string }) {
  return new NextResponse(
    `<!doctype html><html><body><script>
      window.opener?.postMessage(${JSON.stringify({
        source: "flowdesk-hosting-github",
        ...input,
      })}, "*");
      window.close();
    </script>${input.message}</body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

export async function GET(request: NextRequest) {
  if (!isHostingGitHubConfigured()) {
    return applyNoStoreHeaders(
      popupHtml({
        ok: false,
        message: "GitHub OAuth nao configurado.",
      }),
    );
  }

  const state = createHostingGitHubState();
  const response = NextResponse.redirect(
    buildHostingGitHubAuthorizeUrl(request, state),
    302,
  );
  setHostingGitHubStateCookie(request, response, state);
  return applyNoStoreHeaders(response);
}
