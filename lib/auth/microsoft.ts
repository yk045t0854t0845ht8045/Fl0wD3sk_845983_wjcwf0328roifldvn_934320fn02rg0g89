import { authConfig } from "@/lib/auth/config";

type ExchangeMicrosoftCodeInput = {
  code: string;
  redirectUri: string;
};

export type MicrosoftTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
};

type MicrosoftGraphMeResponse = {
  id?: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  mail?: string | null;
  userPrincipalName?: string | null;
  preferredLanguage?: string | null;
};

export type MicrosoftUser = {
  id: string;
  displayName: string | null;
  givenName: string | null;
  surname: string | null;
  email: string;
  preferredLanguage: string | null;
};

const MICROSOFT_AUTHORIZE_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_GRAPH_ME_ENDPOINT =
  "https://graph.microsoft.com/v1.0/me?$select=id,displayName,givenName,surname,mail,userPrincipalName,preferredLanguage";
const MICROSOFT_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read"];

function requireMicrosoftClientConfig() {
  if (!authConfig.microsoftClientId || !authConfig.microsoftClientSecret) {
    throw new Error("O login com Microsoft ainda nao esta configurado neste ambiente.");
  }

  return {
    clientId: authConfig.microsoftClientId,
    clientSecret: authConfig.microsoftClientSecret,
  };
}

export function buildMicrosoftAuthorizeUrl(state: string, redirectUri: string) {
  const { clientId } = requireMicrosoftClientConfig();
  const url = new URL(MICROSOFT_AUTHORIZE_ENDPOINT);

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeMicrosoftCodeForToken({
  code,
  redirectUri,
}: ExchangeMicrosoftCodeInput) {
  const { clientId, clientSecret } = requireMicrosoftClientConfig();
  const response = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao trocar codigo OAuth da Microsoft: ${text}`);
  }

  const payload = (await response.json()) as MicrosoftTokenResponse;
  if (!payload.access_token) {
    throw new Error("Microsoft nao retornou access_token.");
  }

  return payload;
}

export async function fetchMicrosoftUser(accessToken: string) {
  const response = await fetch(MICROSOFT_GRAPH_ME_ENDPOINT, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao buscar usuario Microsoft: ${text}`);
  }

  const payload = (await response.json()) as MicrosoftGraphMeResponse;
  const email = payload.mail?.trim() || payload.userPrincipalName?.trim() || "";

  if (!payload.id || !email) {
    throw new Error("Microsoft nao retornou os dados minimos do usuario.");
  }

  return {
    id: payload.id,
    displayName: payload.displayName?.trim() || null,
    givenName: payload.givenName?.trim() || null,
    surname: payload.surname?.trim() || null,
    email,
    preferredLanguage: payload.preferredLanguage?.trim() || null,
  } satisfies MicrosoftUser;
}
