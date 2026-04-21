import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

// ─── Constants ──────────────────────────────────────────────────────────────
export const OFFICIAL_GUILD_ID =
  process.env.OFFICIAL_SUPPORT_GUILD_ID?.trim() || "";

export const VIOLATION_ROLE_IDS: Partial<Record<ViolationStatusLevel, string>> = {
  1: process.env.OFFICIAL_VIOLATION_ROLE_LEVEL_1_ID?.trim() || undefined,
  2: process.env.OFFICIAL_VIOLATION_ROLE_LEVEL_2_ID?.trim() || undefined,
  3: process.env.OFFICIAL_VIOLATION_ROLE_LEVEL_3_ID?.trim() || undefined,
  4: process.env.OFFICIAL_VIOLATION_ROLE_LEVEL_4_ID?.trim() || undefined,
};

// All violation role ids as a set for easy removal
export const ALL_VIOLATION_ROLE_IDS = Object.values(VIOLATION_ROLE_IDS).filter(
  (roleId): roleId is string => typeof roleId === "string" && roleId.length > 0,
);

export type ViolationStatusLevel = 0 | 1 | 2 | 3 | 4;

export type ViolationStatus = {
  level: ViolationStatusLevel;
  label: string;
  discordRoleId: string | null;
  activeViolations: ViolationRecord[];
  expiredViolations: ViolationRecord[];
};

export type ViolationCategory = {
  id: string;
  name: string;
  description: string;
  ruleUrl: string | null;
};

export type ViolationRecord = {
  id: string;
  type: string;
  category: ViolationCategory | null;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
};

function getViolationRoleId(level: ViolationStatusLevel) {
  return VIOLATION_ROLE_IDS[level] || null;
}

// ─── Status level resolver ───────────────────────────────────────────────────

export function resolveStatusFromActiveCount(activeCount: number): {
  level: ViolationStatusLevel;
  label: string;
} {
  if (activeCount === 0) return { level: 0, label: "Tudo certo!" };
  if (activeCount === 1) return { level: 1, label: "Limitado" };
  if (activeCount === 2) return { level: 2, label: "Muito limitado" };
  if (activeCount === 3) return { level: 3, label: "Em risco" };
  return { level: 4, label: "Suspenso" };
}

// ─── Fetch violations for a user ─────────────────────────────────────────────

export async function getViolationStatusForUser(internalUserId: number): Promise<ViolationStatus> {
  const supabase = getSupabaseAdminClientOrThrow();
  const now = Date.now();

  try {
    // 1. Fetch violation definitions first (or in parallel)
    const { data: defsData } = await supabase
      .from("violation_definitions")
      .select("*");
    
    const definitionsMap = new Map<string, ViolationCategory>();
    for (const def of defsData || []) {
      definitionsMap.set(def.id, {
        id: def.id,
        name: def.name,
        description: def.description,
        ruleUrl: def.rule_url
      });
    }

    // 2. Fetch user violations
    // We select category_id to link with definitions
    const { data: rows, error } = await supabase
      .from("account_violations")
      .select("id, type, category_id, reason, expires_at, created_at")
      .eq("user_id", internalUserId)
      .order("created_at", { ascending: false });

    if (error) {
      // If column is missing, it might be a schema sync issue. Fallback to basic fetch.
      if (error.code === "PGRST204" || error.message.includes("category_id")) {
        console.error("[violations] Detected schema mismatch, falling back...");
        return await fallbackGetViolationStatus(internalUserId);
      }
      throw error;
    }

    const activeViolations: ViolationRecord[] = [];
    const expiredViolations: ViolationRecord[] = [];

    for (const v of rows || []) {
      const isExpired = v.expires_at != null && new Date(v.expires_at).getTime() <= now;
      const record: ViolationRecord = {
        id: v.id,
        type: v.type,
        category: definitionsMap.get(v.category_id) || null,
        reason: v.reason,
        createdAt: v.created_at,
        expiresAt: v.expires_at,
        expired: isExpired,
      };

      if (isExpired) {
        expiredViolations.push(record);
      } else {
        activeViolations.push(record);
      }
    }

    const { level, label } = resolveStatusFromActiveCount(activeViolations.length);

    return {
      level,
      label,
      discordRoleId: level > 0 ? getViolationRoleId(level) : null,
      activeViolations,
      expiredViolations,
    };
  } catch (error: unknown) {
    console.error("[violations] Error fetching status:", error);
    // Return empty status instead of crashing the site
    return {
      level: 0,
      label: "Tudo certo!",
      discordRoleId: null,
      activeViolations: [],
      expiredViolations: [],
    };
  }
}

/**
 * Fallback function to handle schema transition gracefully.
 */
async function fallbackGetViolationStatus(internalUserId: number): Promise<ViolationStatus> {
  const supabase = getSupabaseAdminClientOrThrow();
  const { data: rows } = await supabase
    .from("account_violations")
    .select("id, type, reason, expires_at, created_at")
    .eq("user_id", internalUserId);

  const activeViolations: ViolationRecord[] = (rows || []).map(v => ({
    id: v.id,
    type: v.type,
    category: null,
    reason: v.reason,
    createdAt: v.created_at,
    expiresAt: v.expires_at,
    expired: false,
  }));

  return {
    level: activeViolations.length > 0 ? 1 : 0,
    label: activeViolations.length > 0 ? "Limitado" : "Tudo certo!",
    discordRoleId: null,
    activeViolations,
    expiredViolations: [],
  };
}

// ─── Discord role enforcement (bot token) ────────────────────────────────────

function resolveBotToken() {
  return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || null;
}

async function setDiscordRole(discordUserId: string, roleId: string) {
  const botToken = resolveBotToken();
  if (!botToken || !OFFICIAL_GUILD_ID || !roleId) return;

  await fetch(
    `https://discord.com/api/v10/guilds/${OFFICIAL_GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${botToken}`,
        "X-Audit-Log-Reason": "Flowdesk - Enforcement de violação de conta",
      },
      cache: "no-store",
    },
  );
}

async function removeDiscordRole(discordUserId: string, roleId: string) {
  const botToken = resolveBotToken();
  if (!botToken || !OFFICIAL_GUILD_ID || !roleId) return;

  await fetch(
    `https://discord.com/api/v10/guilds/${OFFICIAL_GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${botToken}`,
        "X-Audit-Log-Reason": "Flowdesk - Remoção de cargo de violação",
      },
      cache: "no-store",
    },
  );
}

/**
 * Syncs Discord roles to match the user's current violation status.
 * Removes all old violation roles, then applies the correct one.
 */
export async function syncDiscordViolationRoles(
  discordUserId: string,
  targetLevel: ViolationStatusLevel,
): Promise<void> {
  const botToken = resolveBotToken();
  if (!botToken || !OFFICIAL_GUILD_ID) {
    console.warn("[violations] Official guild or bot token not configured, skipping Discord role sync.");
    return;
  }

  // Remove all old violation roles in parallel
  await Promise.allSettled(
    ALL_VIOLATION_ROLE_IDS.map((roleId) => removeDiscordRole(discordUserId, roleId)),
  );

  // Apply the new role if suspended/penalized
  if (targetLevel > 0) {
    const newRoleId = getViolationRoleId(targetLevel);
    if (newRoleId) {
      await setDiscordRole(discordUserId, newRoleId);
    }
  }
}

// ─── Enforcement checks usable by API route guards ───────────────────────────

/**
 * Returns true if the user is suspended (level 4+) and should be denied access.
 */
export async function isUserSuspended(internalUserId: number): Promise<boolean> {
  const status = await getViolationStatusForUser(internalUserId);
  return status.level >= 4;
}
