export type ManagedServerStatus = "paid" | "expired" | "off" | "pending_payment";

export type ManagedServer = {
  guildId: string;
  guildName: string;
  iconUrl: string | null;
  status: ManagedServerStatus;
  accessMode: "owner" | "viewer";
  canManage: boolean;
  blockedByPlanLimit: boolean;
  pendingDowngradePayment: boolean;
  licenseOwnerUserId: number;
  licensePaidAt: string;
  licenseExpiresAt: string;
  graceExpiresAt: string;
  daysUntilExpire: number;
  daysUntilOff: number;
};

export type ManagedServersSyncReason =
  | "ok"
  | "discord_not_linked"
  | "discord_oauth_missing"
  | "discord_sync_failed";

export type ManagedServersSyncState = {
  degraded: boolean;
  requiresDiscordRelink: boolean;
  usedDatabaseFallback: boolean;
  reason: ManagedServersSyncReason;
  diagnosticsFingerprint: string | null;
};

export type ManagedServersSnapshot = {
  servers: ManagedServer[];
  sync: ManagedServersSyncState;
};

export const DEFAULT_MANAGED_SERVERS_SYNC_STATE: ManagedServersSyncState = {
  degraded: false,
  requiresDiscordRelink: false,
  usedDatabaseFallback: false,
  reason: "ok",
  diagnosticsFingerprint: null,
};
