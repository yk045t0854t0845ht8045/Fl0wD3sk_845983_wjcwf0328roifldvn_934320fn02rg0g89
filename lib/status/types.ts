export type SystemStatus =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage";

export type IncidentImpact = "critical" | "warning" | "info";
export type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved";

export type StatusSubscriptionType =
  | "email"
  | "discord_dm"
  | "webhook"
  | "discord_channel";

export type StatusSubscriptionRecord = {
  id: string;
  type: StatusSubscriptionType;
  target: string;
  label: string | null;
  metadata?: Record<string, unknown> | null;
  is_active?: boolean;
  verified_at?: string | null;
  last_tested_at?: string | null;
  last_delivery_at?: string | null;
  last_delivery_status?: number | null;
  last_delivery_error?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type StatusSubscriptionViewer = {
  authenticated: boolean;
  userId: number | null;
  discordUserId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
};

export type StatusHistoryEntry = {
  date: string;
  status: SystemStatus;
};

export type ComponentStatus = {
  id: string;
  name: string;
  description: string | null;
  status: SystemStatus;
  is_core?: boolean;
  updated_at: string;
  created_at: string;
  history: StatusHistoryEntry[];
  status_message?: string | null;
  source_key?: string | null;
  last_checked_at?: string | null;
  latency_ms?: number | null;
};

export type StatusTeamNote = {
  title: string;
  description: string;
  source: "ai" | "fallback";
  generated_at: string;
  affected_components: string[];
};

export type IncidentUpdate = {
  id: string;
  message: string;
  status: IncidentStatus;
  created_at: string;
};

export type Incident = {
  id: string;
  title: string;
  impact: IncidentImpact;
  status: IncidentStatus;
  created_at: string;
  updated_at: string;
  updates: IncidentUpdate[];
  summary?: string | null;
  affected_components?: string[];
};

export type StatusCheckResult = {
  ok: boolean;
  checkedAt: string;
  latencyMs: number | null;
  status: SystemStatus;
  message: string | null;
  source: string;
};

export const SYSTEM_STATUS_RANK: Record<SystemStatus, number> = {
  operational: 0,
  degraded_performance: 1,
  partial_outage: 2,
  major_outage: 3,
};

export function getWorstSystemStatus(statuses: SystemStatus[]) {
  if (statuses.length === 0) {
    return "operational" as const;
  }

  return statuses.slice(1).reduce<SystemStatus>(
    (worst, current) =>
      SYSTEM_STATUS_RANK[current] > SYSTEM_STATUS_RANK[worst] ? current : worst,
    statuses[0],
  );
}
