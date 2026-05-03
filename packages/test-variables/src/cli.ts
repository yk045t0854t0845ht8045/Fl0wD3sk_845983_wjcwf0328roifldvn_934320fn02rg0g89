#!/usr/bin/env node

import { loginCli, logoutCli, whoamiCli } from "./auth.ts";
import { pullEnv, runDevCommand } from "./env.ts";
import { requestIp, showIpStatus } from "./ip.ts";

function printHelp() {
  console.log(`Flowdesk Test Variables CLI

Uso:
  flw login
  flw logout
  flw whoami
  flw ip
  flw ip request [--project flowdesk] [--env test] [--device "Notebook"] [--reason "Motivo"]
  flw env pull --project flowdesk --env test [--write .env.local] [--json]
  flw dev --project flowdesk --env test -- npm run dev
`);
}

function readOption(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index < 0) {
    return null;
  }

  return args[index + 1] || null;
}

function hasOption(args: string[], name: string) {
  return args.includes(name);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "login") {
    await loginCli(readOption(args, "--base-url"));
    return;
  }

  if (command === "logout") {
    await logoutCli();
    return;
  }

  if (command === "whoami") {
    await whoamiCli(readOption(args, "--base-url"));
    return;
  }

  if (command === "ip" && args[1] !== "request") {
    await showIpStatus(readOption(args, "--base-url"));
    return;
  }

  if (command === "ip" && args[1] === "request") {
    await requestIp({
      projectCode: readOption(args, "--project"),
      environment: readOption(args, "--env"),
      deviceName: readOption(args, "--device"),
      reason: readOption(args, "--reason"),
      notes: readOption(args, "--notes"),
      requestedExpiresAt: readOption(args, "--expires-at"),
      baseUrl: readOption(args, "--base-url"),
    });
    return;
  }

  if (command === "env" && args[1] === "pull") {
    const projectCode = readOption(args, "--project");
    const environment = readOption(args, "--env");
    if (!projectCode || !environment) {
      throw new Error("Use `flw env pull --project <codigo> --env <ambiente>`.");
    }

    const rawKeys = readOption(args, "--keys");
    await pullEnv({
      projectCode,
      environment,
      requestedKeys: rawKeys
        ? rawKeys
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : null,
      writePath: readOption(args, "--write"),
      json: hasOption(args, "--json"),
      baseUrl: readOption(args, "--base-url"),
    });
    return;
  }

  if (command === "dev") {
    const separatorIndex = args.indexOf("--");
    if (separatorIndex < 0) {
      throw new Error("Use `flw dev -- <comando>`.");
    }

    const projectCode = readOption(args, "--project") || "flowdesk";
    const environment = readOption(args, "--env") || "test";
    const commandArgs = args.slice(separatorIndex + 1);
    await runDevCommand({
      projectCode,
      environment,
      command: commandArgs,
      baseUrl: readOption(args, "--base-url"),
    });
    return;
  }

  throw new Error("Comando CLI desconhecido. Use `flw help`.");
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Falha inesperada no CLI do Flowdesk.",
  );
  process.exitCode = 1;
});
