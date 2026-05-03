import { headers } from "next/headers";
import {
  hashFlowSecureValue,
  redactSensitiveRecord,
} from "@/lib/security/flowSecure";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type AdminAuditRiskLevel = "low" | "medium" | "high" | "critical";

export type AdminAuditInput = {
  actorUserId: number;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  riskLevel?: AdminAuditRiskLevel;
};

type HeaderStore = {
  get(key: string): string | null;
};

function extractHeaderValue(
  headerStore: HeaderStore,
  keys: string[],
) {
  for (const key of keys) {
    const value = headerStore.get(key)?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function extractClientIp(headerStore: HeaderStore) {
  const forwardedFor = extractHeaderValue(headerStore, ["x-forwarded-for"]);
  if (forwardedFor) {
    const candidate = forwardedFor.split(",")[0]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return extractHeaderValue(headerStore, [
    "x-real-ip",
    "cf-connecting-ip",
  ]);
}

function hashAdminContextValue(
  value: string | null,
  subcontext: string,
) {
  if (!value) {
    return null;
  }

  return hashFlowSecureValue(value, {
    purpose: "admin_audit_hash",
    subcontext,
    encoding: "hex",
  });
}

export async function getAdminRequestHashes() {
  const headerStore = await headers();
  const ipAddress = extractClientIp(headerStore);
  const userAgent = extractHeaderValue(headerStore, ["user-agent"]);

  return {
    ipHash: hashAdminContextValue(ipAddress, "ip_address"),
    userAgentHash: hashAdminContextValue(userAgent, "user_agent"),
  };
}

export async function logAdminAction(input: AdminAuditInput) {
  const supabase = getSupabaseAdminClientOrThrow();
  const requestHashes = await getAdminRequestHashes();

  const insertResult = await supabase
    .from("admin_audit_logs")
    .insert({
      actor_user_id: input.actorUserId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId || null,
      metadata: redactSensitiveRecord(input.metadata || {}),
      ip_hash: requestHashes.ipHash,
      user_agent_hash: requestHashes.userAgentHash,
      risk_level: input.riskLevel || "medium",
    });

  if (insertResult.error) {
    throw new Error(insertResult.error.message);
  }
}

export async function logAdminActionSafe(input: AdminAuditInput) {
  try {
    await logAdminAction(input);
  } catch {
    // auditoria administrativa nao pode derrubar a acao principal
  }
}

export async function touchAdminSession(input: {
  authSessionId: string;
  authUserId: number;
  staffProfileId: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const requestHashes = await getAdminRequestHashes();
  const nowIso = new Date().toISOString();

  const existingResult = await supabase
    .from("admin_sessions")
    .select("id")
    .eq("auth_session_id", input.authSessionId)
    .maybeSingle<{ id: string }>();

  if (existingResult.error) {
    throw new Error(existingResult.error.message);
  }

  if (existingResult.data?.id) {
    const updateResult = await supabase
      .from("admin_sessions")
      .update({
        auth_user_id: input.authUserId,
        staff_profile_id: input.staffProfileId,
        last_seen_at: nowIso,
        ip_hash: requestHashes.ipHash,
        user_agent_hash: requestHashes.userAgentHash,
        status: "active",
      })
      .eq("id", existingResult.data.id);

    if (updateResult.error) {
      throw new Error(updateResult.error.message);
    }

    return existingResult.data.id;
  }

  const insertResult = await supabase
    .from("admin_sessions")
    .insert({
      auth_session_id: input.authSessionId,
      auth_user_id: input.authUserId,
      staff_profile_id: input.staffProfileId,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      ip_hash: requestHashes.ipHash,
      user_agent_hash: requestHashes.userAgentHash,
      status: "active",
    })
    .select("id")
    .single<{ id: string }>();

  if (insertResult.error || !insertResult.data) {
    throw new Error(insertResult.error?.message || "Nao foi possivel abrir a sessao administrativa.");
  }

  return insertResult.data.id;
}
