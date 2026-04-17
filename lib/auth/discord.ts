import { authConfig } from "@/lib/auth/config";

type ExchangeCodeInput = {
  code: string;
  redirectUri: string;
};

export type DiscordTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

export type DiscordUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  email?: string | null;
  verified?: boolean | null;
  locale?: string | null;
};

export type DiscordGuild = {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  features: string[];
};

export type DiscordGuildMember = {
  roles?: string[];
  joined_at?: string;
  pending?: boolean;
};

type DiscordRateLimitPayload = {
  message?: string;
  retry_after?: number;
  global?: boolean;
};

export class DiscordRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = 1) {
    super(message);
    this.name = "DiscordRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterSeconds(
  response: Response,
  payload: DiscordRateLimitPayload | null,
) {
  const headerRetryAfter = Number(response.headers.get("retry-after") || "");
  const headerResetAfter = Number(
    response.headers.get("x-ratelimit-reset-after") || "",
  );

  const payloadRetryAfter = Number(payload?.retry_after || "");

  const resolved = [payloadRetryAfter, headerRetryAfter, headerResetAfter].find(
    (value) => Number.isFinite(value) && value > 0,
  );

  return resolved || 1;
}

export function buildDiscordAuthorizeUrl(state: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: authConfig.discordClientId,
    response_type: "code",
    scope: "identify email guilds guilds.members.read",
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

  return payload;
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

export async function fetchDiscordGuilds(accessToken: string) {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt <= maxRetries) {
    const response = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    if (response.status === 429) {
      const payload = (await response.json().catch(() => null)) as DiscordRateLimitPayload | null;
      const retryAfterSeconds = parseRetryAfterSeconds(response, payload);
      const baseRetryAfterMs = Math.max(350, Math.ceil(retryAfterSeconds * 1000));
      const backoffMs = attempt * 220;
      const jitterMs = Math.floor(Math.random() * 140);
      const retryAfterMs = baseRetryAfterMs + backoffMs + jitterMs;

      if (attempt < maxRetries) {
        await wait(retryAfterMs);
        attempt += 1;
        continue;
      }

      throw new DiscordRateLimitError(
        "Falha ao buscar servidores do Discord: limite temporario de requisicoes (429). Tente novamente em alguns segundos.",
        retryAfterSeconds,
      );
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Falha ao buscar servidores do Discord: ${text}`);
    }

    return (await response.json()) as DiscordGuild[];
  }

  return [];
}

export async function fetchDiscordCurrentUserGuildMember(
  accessToken: string,
  guildId: string,
) {
  const response = await fetch(
    `https://discord.com/api/users/@me/guilds/${guildId}/member`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (response.status === 429) {
    const payload = (await response.json().catch(() => null)) as DiscordRateLimitPayload | null;
    const retryAfterSeconds = parseRetryAfterSeconds(response, payload);
    throw new DiscordRateLimitError(
      "Falha ao verificar membro da guilda no Discord: limite temporario de requisicoes (429).",
      retryAfterSeconds,
    );
  }

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha ao buscar membro atual da guilda no Discord: ${text}`);
  }

  return (await response.json()) as DiscordGuildMember;
}

export async function refreshDiscordToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: authConfig.discordClientId,
    client_secret: authConfig.discordClientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
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
    throw new Error(`Falha ao renovar token Discord: ${text}`);
  }

  return (await response.json()) as DiscordTokenResponse;
}
