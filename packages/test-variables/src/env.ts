import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { getAuthenticatedRequestContext } from "./auth.ts";

type PullResponse = {
  ok: boolean;
  projectCode: string;
  environment: string;
  deliveredKeys: string[];
  values: Record<string, string>;
  message?: string;
};

type PullOptions = {
  projectCode: string;
  environment: string;
  requestedKeys?: string[] | null;
  writePath?: string | null;
  json?: boolean;
  baseUrl?: string | null;
};

async function requestJson<T>(
  baseUrl: string,
  pathname: string,
  init: RequestInit,
  authToken: string,
) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
      ...(init.headers || {}),
    },
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

function serializeEnv(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
}

export async function pullEnv(options: PullOptions) {
  const { baseUrl, authToken } = await getAuthenticatedRequestContext(options.baseUrl);
  const payload = await requestJson<PullResponse>(
    baseUrl,
    "/api/dev/test-variables/pull",
    {
      method: "POST",
      body: JSON.stringify({
        projectCode: options.projectCode,
        environment: options.environment,
        requestedKeys: options.requestedKeys?.length ? options.requestedKeys : undefined,
      }),
    },
    authToken,
  );

  if (options.writePath) {
    await fs.writeFile(options.writePath, serializeEnv(payload.values), "utf8");
    console.log(`Variaveis gravadas em ${options.writePath}`);
    return payload;
  }

  if (options.json) {
    console.log(JSON.stringify(payload.values, null, 2));
    return payload;
  }

  console.log(
    `Pull concluido para ${payload.projectCode}/${payload.environment}. ${payload.deliveredKeys.length} chave(s) entregues.`,
  );
  if (payload.deliveredKeys.length) {
    console.log(`Chaves: ${payload.deliveredKeys.join(", ")}`);
  }

  return payload;
}

export async function runDevCommand(input: {
  projectCode: string;
  environment: string;
  command: string[];
  baseUrl?: string | null;
}) {
  if (!input.command.length) {
    throw new Error("Informe um comando apos `flw dev --`.");
  }

  const payload = await pullEnv({
    projectCode: input.projectCode,
    environment: input.environment,
    baseUrl: input.baseUrl,
  });

  const [command, ...args] = input.command;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        ...payload.values,
      },
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`O comando terminou com codigo ${code ?? 1}.`));
    });
  });
}
