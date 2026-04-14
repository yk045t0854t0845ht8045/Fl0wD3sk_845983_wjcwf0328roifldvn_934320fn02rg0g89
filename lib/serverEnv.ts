import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const envCache = new Map<string, string | undefined>();

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function unescapeEnvValue(value: string) {
  return value
    .replace(/\\\$/g, "$")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r");
}

function parseEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    const rawValue = line.slice(separatorIndex + 1).trim();
    envCache.set(key, unescapeEnvValue(stripWrappingQuotes(rawValue)));
  }
}

function primeCache() {
  if (envCache.size > 0) {
    return;
  }

  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, "..", ".env"),
    path.resolve(cwd, "..", ".env.local"),
    path.resolve(cwd, ".env"),
    path.resolve(cwd, ".env.local"),
  ];

  for (const candidate of candidates) {
    parseEnvFile(candidate);
  }
}

export function getServerEnv(key: string) {
  const currentValue = process.env[key];
  if (typeof currentValue === "string" && currentValue.trim()) {
    return currentValue;
  }

  primeCache();
  const cached = envCache.get(key);
  if (cached) {
    process.env[key] = cached;
  }

  return cached;
}

export function getServerEnvList(key: string) {
  const value = getServerEnv(key);
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
