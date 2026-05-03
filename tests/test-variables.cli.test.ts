import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cliPath = path.join(
  process.cwd(),
  "packages",
  "test-variables",
  "src",
  "cli.ts",
);

function runCli(args: string[], homeDir?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: homeDir
      ? {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
        }
      : process.env,
  });
}

test("flw help advertises the supported commands", () => {
  const result = runCli(["--help"]);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0);
  assert.match(output, /flw login/i);
  assert.match(output, /flw ip request/i);
  assert.match(output, /flw env pull/i);
  assert.match(output, /flw dev --project flowdesk --env test -- npm run dev/i);
});

test("flw whoami fails safely when no local credential exists", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "flowdesk-cli-"));
  const result = runCli(["whoami", "--base-url", "http://127.0.0.1:3000"], tempHome);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0);
  assert.match(output, /Nenhuma credencial local encontrada/i);
  assert.doesNotMatch(output, /Bearer\s+/i);
});
