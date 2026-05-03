import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type FlowdeskCliConfig = {
  baseUrl: string;
  authToken: string;
  savedAt: string;
};

const DEFAULT_BASE_URL = "https://www.flwdesk.com";

export function resolveBaseUrl(explicitBaseUrl?: string | null) {
  const rawBaseUrl =
    explicitBaseUrl?.trim() ||
    process.env.FLOWDESK_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    DEFAULT_BASE_URL;

  return rawBaseUrl.replace(/\/+$/, "");
}

export function getConfigDir() {
  return path.join(os.homedir(), ".flowdesk");
}

export function getConfigPath() {
  return path.join(getConfigDir(), "test-variables.json");
}

export async function readConfig() {
  try {
    const raw = await fs.readFile(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<FlowdeskCliConfig>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.authToken !== "string" ||
      typeof parsed.savedAt !== "string"
    ) {
      return null;
    }

    return parsed as FlowdeskCliConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(config: FlowdeskCliConfig) {
  await fs.mkdir(getConfigDir(), { recursive: true });
  await fs.writeFile(
    getConfigPath(),
    JSON.stringify(config, null, 2),
    "utf8",
  );
}

export async function clearConfig() {
  try {
    await fs.unlink(getConfigPath());
  } catch {
    // noop
  }
}

export function assertConfig(config: FlowdeskCliConfig | null) {
  if (!config?.authToken) {
    throw new Error("Nenhuma credencial local encontrada. Rode `flw login` primeiro.");
  }

  return config;
}
