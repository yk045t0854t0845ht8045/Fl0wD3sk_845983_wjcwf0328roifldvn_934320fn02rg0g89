import { randomUUID } from "crypto";

import type { GuildLicenseStatus } from "@/lib/payments/licenseStatus";

export type ServerSaveRouteName =
  | "ticket_settings"
  | "ticket_staff_settings"
  | "ticket_panel_dispatch"
  | "welcome_settings"
  | "antilink_settings"
  | "autorole_settings"
  | "security_logs_settings";
export type ServerSaveAccessMode = "owner" | "team" | "viewer" | "unknown";
export type ServerSaveOutcome =
  | "payload_invalid"
  | "access_denied"
  | "view_only"
  | "license_blocked"
  | "cleanup_expired"
  | "bot_access_missing"
  | "validation_failed"
  | "saved"
  | "failed";

export type ServerSaveDiagnosticEntry = {
  route: ServerSaveRouteName;
  requestId: string;
  guildId: string;
  authUserId: number | null;
  accessMode: ServerSaveAccessMode;
  licenseStatus: GuildLicenseStatus | "unknown" | null;
  outcome: ServerSaveOutcome;
  httpStatus: number;
  detail: string | null;
  durationMs: number;
  recordedAt: string;
  meta: Record<string, unknown> | null;
};

type ServerSaveDiagnosticContext = {
  route: ServerSaveRouteName;
  guildId: string;
  requestId: string;
  startedAtMs: number;
};

type RecordServerSaveDiagnosticInput = {
  context: ServerSaveDiagnosticContext;
  authUserId?: number | null;
  accessMode?: ServerSaveAccessMode;
  licenseStatus?: GuildLicenseStatus | "unknown" | null;
  outcome: ServerSaveOutcome;
  httpStatus: number;
  detail?: string | null;
  meta?: Record<string, unknown> | null;
};

const MAX_RECENT_SERVER_SAVE_DIAGNOSTICS = 200;
const recentServerSaveDiagnostics: ServerSaveDiagnosticEntry[] = [];

export function createServerSaveDiagnosticContext(
  route: ServerSaveRouteName,
  guildId?: string,
): ServerSaveDiagnosticContext {
  return {
    route,
    guildId: typeof guildId === "string" && guildId.trim().length > 0
      ? guildId.trim()
      : "unknown",
    requestId: randomUUID().slice(0, 12),
    startedAtMs: Date.now(),
  };
}

export function getRecentServerSaveDiagnostics() {
  return [...recentServerSaveDiagnostics];
}

function pushRecentDiagnostic(entry: ServerSaveDiagnosticEntry) {
  recentServerSaveDiagnostics.unshift(entry);
  if (recentServerSaveDiagnostics.length > MAX_RECENT_SERVER_SAVE_DIAGNOSTICS) {
    recentServerSaveDiagnostics.length = MAX_RECENT_SERVER_SAVE_DIAGNOSTICS;
  }
}

export function resolveServerSaveAccessMode(input: {
  accessibleGuild?: { owner?: boolean } | null;
  hasTeamAccess?: boolean | null;
}): ServerSaveAccessMode {
  if (input.accessibleGuild?.owner) return "owner";
  if (input.hasTeamAccess) return "team";
  if (input.accessibleGuild) return "viewer";
  return "unknown";
}

export function recordServerSaveDiagnostic(
  input: RecordServerSaveDiagnosticInput,
) {
  const entry: ServerSaveDiagnosticEntry = {
    route: input.context.route,
    requestId: input.context.requestId,
    guildId: input.context.guildId,
    authUserId:
      typeof input.authUserId === "number" ? input.authUserId : null,
    accessMode: input.accessMode || "unknown",
    licenseStatus:
      typeof input.licenseStatus === "string" || input.licenseStatus === null
        ? input.licenseStatus
        : "unknown",
    outcome: input.outcome,
    httpStatus: input.httpStatus,
    detail: input.detail || null,
    durationMs: Math.max(0, Date.now() - input.context.startedAtMs),
    recordedAt: new Date().toISOString(),
    meta: input.meta || null,
  };

  pushRecentDiagnostic(entry);

  const serialized = JSON.stringify(entry);
  if (input.httpStatus >= 500 || input.outcome === "failed") {
    console.error(`[server-save:${entry.route}] ${serialized}`);
  } else if (input.httpStatus >= 400) {
    console.warn(`[server-save:${entry.route}] ${serialized}`);
  } else {
    console.info(`[server-save:${entry.route}] ${serialized}`);
  }

  return entry;
}
