import { NextRequest, NextResponse } from "next/server";
import {
  clearHostingGitHubStateCookie,
  createHostingGitHubHandoffToken,
  exchangeHostingGitHubCode,
  isHostingGitHubConfigured,
  readHostingGitHubStateCookie,
  setHostingGitHubTokenCookie,
  validateHostingGitHubState,
} from "@/lib/hosting/github";
import { applyNoStoreHeaders } from "@/lib/security/http";

const HANDOFF_STORAGE_KEY = "flowdesk_hosting_github_handoff_v1";

function popupHtml(input: { ok: boolean; message: string; handoffToken?: string | null }) {
  const payload = {
    source: "flowdesk-hosting-github",
    ...input,
  };

  return new NextResponse(
    `<!doctype html><html><body><script>
      const payload = ${JSON.stringify(payload)};
      const storagePayload = JSON.stringify({ ...payload, storedAt: Date.now() });
      try {
        window.opener?.postMessage(payload, "*");
      } catch {}
      try {
        window.opener?.localStorage?.setItem(${JSON.stringify(HANDOFF_STORAGE_KEY)}, storagePayload);
      } catch {}
      try {
        window.localStorage?.setItem(${JSON.stringify(HANDOFF_STORAGE_KEY)}, storagePayload);
      } catch {}
      window.setTimeout(() => window.close(), 250);
    </script>${input.message}</body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim() || "";
  const state = request.nextUrl.searchParams.get("state")?.trim() || "";
  const expectedState = await readHostingGitHubStateCookie();

  if (!isHostingGitHubConfigured()) {
    return applyNoStoreHeaders(
      popupHtml({ ok: false, message: "GitHub OAuth nao configurado." }),
    );
  }

  const stateMatchesCookie = Boolean(expectedState && state === expectedState);
  const stateMatchesSignedPayload = validateHostingGitHubState(state);

  if (!code || !state || (!stateMatchesCookie && !stateMatchesSignedPayload)) {
    return applyNoStoreHeaders(
      popupHtml({
        ok: false,
        message:
          "Validacao de seguranca do GitHub falhou. Reabra a conexao pelo painel.",
      }),
    );
  }

  try {
    const token = await exchangeHostingGitHubCode({ code, request });
    const handoffToken = createHostingGitHubHandoffToken(token);
    const response = popupHtml({
      ok: true,
      message: "GitHub conectado com sucesso.",
      handoffToken,
    });
    setHostingGitHubTokenCookie(request, response, token);
    clearHostingGitHubStateCookie(request, response);
    return applyNoStoreHeaders(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao conectar GitHub.";
    const response = popupHtml({ ok: false, message });
    clearHostingGitHubStateCookie(request, response);
    return applyNoStoreHeaders(response);
  }
}
