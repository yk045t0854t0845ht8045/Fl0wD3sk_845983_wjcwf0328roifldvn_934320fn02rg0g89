import { authConfig } from "@/lib/auth/config";

type ExchangeCodeInput = {
  code: string;
  redirectUri: string;
};

type DiscordTokenResponse = {
  access_token: string;
  token_type: string;
};

export type DiscordUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  email?: string | null;
  locale?: string | null;
};

export function buildDiscordAuthorizeUrl(state: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: authConfig.discordClientId,
    response_type: "code",
    scope: "identify email",
    state,
    redirect_uri: redirectUri,
    prompt: "consent",
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken({
  code,
  redirectUri,
}: ExchangeCodeInput) {
  const body = new URLSearchParams({
    client_id: authConfig.discordClientId,
    client_secret: authConfig.discordClientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao trocar codigo OAuth: ${text}`);
  }

  const payload = (await response.json()) as DiscordTokenResponse;

  if (!payload.access_token) {
    throw new Error("Discord nao retornou access_token.");
  }

  return payload.access_token;
}

export async function fetchDiscordUser(accessToken: string) {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao buscar usuario Discord: ${text}`);
  }

  return (await response.json()) as DiscordUser;
}
