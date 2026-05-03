import { spawn } from "node:child_process";
import { clearConfig, readConfig, resolveBaseUrl, writeConfig } from "./config.ts";

type LoginStartResponse = {
  ok: boolean;
  verificationUrl: string;
  pollToken: string;
  expiresAt: string;
  message?: string;
};

type LoginPollResponse = {
  ok: boolean;
  status: "pending" | "completed" | "expired" | "revoked";
  authToken?: string | null;
  expiresAt?: string | null;
  message?: string;
};

type DevMeResponse = {
  ok: boolean;
  user?: {
    id: number;
    displayName: string;
    email: string | null;
    permissions: string[];
    authMethod: "session" | "token";
  };
  snapshot?: {
    currentIp: string | null;
    ipStatus: string;
    grants: Array<unknown>;
    certificates: Array<unknown>;
  };
  message?: string;
};

async function requestJson<T>(
  baseUrl: string,
  pathname: string,
  init?: RequestInit,
  authToken?: string | null,
) {
  const headers = new Headers(init?.headers || {});
  headers.set("Content-Type", "application/json");
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers,
  });
  const payload = (await response.json().catch(() => null)) as T | null;

  if (!response.ok || !payload) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message || "Falha na requisicao.")
        : "Falha na requisicao.";
    throw new Error(message);
  }

  return payload;
}

function openBrowser(url: string) {
  try {
    if (process.platform === "win32") {
      const child = spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return true;
    }

    if (process.platform === "darwin") {
      const child = spawn("open", [url], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return true;
    }

    const child = spawn("xdg-open", [url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loginCli(explicitBaseUrl?: string | null) {
  const baseUrl = resolveBaseUrl(explicitBaseUrl);
  const started = await requestJson<LoginStartResponse>(
    baseUrl,
    "/api/dev-auth/login/start",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );

  const opened = openBrowser(started.verificationUrl);
  if (opened) {
    console.log(`Abrindo navegador em ${started.verificationUrl}`);
  } else {
    console.log(`Abra manualmente esta URL para concluir o login:\n${started.verificationUrl}`);
  }

  const expiresAtMs = Date.parse(started.expiresAt);
  while (Number.isFinite(expiresAtMs) ? Date.now() < expiresAtMs : true) {
    await sleep(2_000);

    const polled = await requestJson<LoginPollResponse>(
      baseUrl,
      "/api/dev-auth/login/complete",
      {
        method: "POST",
        body: JSON.stringify({
          pollToken: started.pollToken,
        }),
      },
    );

    if (polled.status === "pending") {
      process.stdout.write(".");
      continue;
    }

    if (polled.status === "completed" && polled.authToken) {
      await writeConfig({
        baseUrl,
        authToken: polled.authToken,
        savedAt: new Date().toISOString(),
      });
      console.log("\nLogin do CLI concluido com sucesso.");
      return;
    }

    throw new Error(
      polled.status === "completed"
        ? "A aprovacao foi concluida, mas o token nao foi entregue ao terminal."
        : "A tentativa de login do CLI expirou ou foi revogada.",
    );
  }

  throw new Error("Tempo esgotado aguardando a aprovacao do login.");
}

export async function logoutCli() {
  await clearConfig();
  console.log("Credencial local removida.");
}

export async function whoamiCli(explicitBaseUrl?: string | null) {
  const config = await readConfig();
  if (!config?.authToken) {
    throw new Error("Nenhuma credencial local encontrada. Rode `flw login` primeiro.");
  }

  const baseUrl = resolveBaseUrl(explicitBaseUrl || config.baseUrl);
  const payload = await requestJson<DevMeResponse>(
    baseUrl,
    "/api/dev/me",
    { method: "GET" },
    config.authToken,
  );

  if (!payload.user || !payload.snapshot) {
    throw new Error(payload.message || "Sessao dev invalida.");
  }

  console.log(`Usuario: ${payload.user.displayName}`);
  console.log(`Email: ${payload.user.email || "nao informado"}`);
  console.log(`IP atual: ${payload.snapshot.currentIp || "nao detectado"}`);
  console.log(`Status IP: ${payload.snapshot.ipStatus}`);
  console.log(`Grants ativos: ${payload.snapshot.grants.length}`);
  console.log(`Certificados: ${payload.snapshot.certificates.length}`);
}

export async function getAuthenticatedRequestContext(explicitBaseUrl?: string | null) {
  const config = await readConfig();
  if (!config?.authToken) {
    throw new Error("Nenhuma credencial local encontrada. Rode `flw login` primeiro.");
  }

  return {
    baseUrl: resolveBaseUrl(explicitBaseUrl || config.baseUrl),
    authToken: config.authToken,
  };
}
