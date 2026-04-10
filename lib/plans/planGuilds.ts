import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import type { PlanCode } from "@/lib/plans/catalog";
import type { UserPlanStateRecord } from "@/lib/plans/state";
import {
  EXPIRED_GRACE_MS,
  getLockedGuildLicenseByGuildId,
  resolveLatestLicenseCoverageFromApprovedOrders,
} from "@/lib/payments/licenseStatus";

export type PlanGuildRecord = {
  user_id: number;
  guild_id: string;
  activated_at: string;
  created_at: string;
};

export type PlanGuildLicenseStatus = "paid" | "expired" | "off" | "not_paid";

type PlanCoverage = {
  status: PlanGuildLicenseStatus;
  expiresAt: string | null;
  graceExpiresAt: string | null;
};

type LegacyApprovedGuildOrderRecord = {
  guild_id: string;
  user_id: number;
  paid_at: string | null;
  created_at: string;
  plan_code: string | null;
  plan_billing_cycle_days: number | null;
};

function parseIsoToMs(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

function resolveCoverageFromPlanState(
  planState: UserPlanStateRecord | null,
  nowMs = Date.now(),
): PlanCoverage {
  if (!planState || planState.status === "inactive") {
    return { status: "not_paid", expiresAt: null, graceExpiresAt: null };
  }

  const expiresAtMs = parseIsoToMs(planState.expires_at);
  if (!Number.isFinite(expiresAtMs)) {
    // Falha de dados: trate como pago para nao derrubar fluxo, mas ainda assim
    // nao criamos bloqueio infinito porque a expiracao e desconhecida.
    return { status: "paid", expiresAt: planState.expires_at, graceExpiresAt: null };
  }

  if (nowMs <= expiresAtMs) {
    return {
      status: "paid",
      expiresAt: new Date(expiresAtMs).toISOString(),
      graceExpiresAt: new Date(expiresAtMs + EXPIRED_GRACE_MS).toISOString(),
    };
  }

  if (nowMs <= expiresAtMs + EXPIRED_GRACE_MS) {
    return {
      status: "expired",
      expiresAt: new Date(expiresAtMs).toISOString(),
      graceExpiresAt: new Date(expiresAtMs + EXPIRED_GRACE_MS).toISOString(),
    };
  }

  return {
    status: "off",
    expiresAt: new Date(expiresAtMs).toISOString(),
    graceExpiresAt: new Date(expiresAtMs + EXPIRED_GRACE_MS).toISOString(),
  };
}

export function isPlanCoverageUsable(status: PlanGuildLicenseStatus) {
  return status === "paid" || status === "expired";
}

async function getLegacyLicensedGuildsForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("payment_orders")
    .select(
      "guild_id, user_id, paid_at, created_at, plan_code, plan_billing_cycle_days",
    )
    .eq("user_id", userId)
    .eq("status", "approved")
    .not("guild_id", "is", null)
    .returns<LegacyApprovedGuildOrderRecord[]>();

  if (result.error) {
    throw new Error(`Erro ao carregar licencas antigas do usuario: ${result.error.message}`);
  }

  const ordersByGuild = new Map<string, LegacyApprovedGuildOrderRecord[]>();
  for (const order of result.data || []) {
    const guildId = order.guild_id?.trim();
    if (!guildId) continue;
    const currentOrders = ordersByGuild.get(guildId) || [];
    currentOrders.push(order);
    ordersByGuild.set(guildId, currentOrders);
  }

  const legacyGuilds = new Map<string, PlanGuildRecord>();
  for (const [guildId, orders] of ordersByGuild.entries()) {
    const latestCoverage = resolveLatestLicenseCoverageFromApprovedOrders(orders);
    if (!latestCoverage || !isPlanCoverageUsable(latestCoverage.status)) {
      continue;
    }

    legacyGuilds.set(guildId, {
      user_id: userId,
      guild_id: guildId,
      activated_at: latestCoverage.licenseStartsAt,
      created_at: latestCoverage.order.created_at,
    });
  }

  return legacyGuilds;
}

export async function getPlanGuildsForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const [result, legacyGuilds] = await Promise.all([
    supabase
      .from("auth_user_plan_guilds")
      .select("user_id, guild_id, activated_at, created_at")
      .eq("user_id", userId)
      .order("activated_at", { ascending: false })
      .returns<PlanGuildRecord[]>(),
    getLegacyLicensedGuildsForUser(userId),
  ]);

  if (result.error) {
    throw new Error(`Erro ao carregar servidores licenciados: ${result.error.message}`);
  }

  const mergedGuilds = new Map<string, PlanGuildRecord>();
  for (const record of result.data || []) {
    mergedGuilds.set(record.guild_id, record);
  }
  for (const [guildId, record] of legacyGuilds.entries()) {
    if (!mergedGuilds.has(guildId)) {
      mergedGuilds.set(guildId, record);
    }
  }

  return [...mergedGuilds.values()].sort((left, right) => {
    return parseIsoToMs(right.activated_at) - parseIsoToMs(left.activated_at);
  });
}

export async function countPlanGuildsForUser(userId: number) {
  const guilds = await getPlanGuildsForUser(userId);
  return guilds.length;
}

export async function getPlanGuildOwnerUserId(guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_plan_guilds")
    .select("user_id, activated_at, created_at")
    .eq("guild_id", guildId)
    .maybeSingle<{ user_id: number; activated_at: string; created_at: string }>();

  if (result.error) {
    throw new Error(`Erro ao consultar licenca do servidor: ${result.error.message}`);
  }

  if (result.data) {
    return {
        userId: result.data.user_id,
        activatedAt: result.data.activated_at,
        createdAt: result.data.created_at,
      };
  }

  const lockedLicense = await getLockedGuildLicenseByGuildId(guildId);
  return lockedLicense
    ? {
        userId: lockedLicense.userId,
        activatedAt: lockedLicense.licenseStartsAt,
        createdAt: lockedLicense.createdAt,
      }
    : null;
}

export async function isGuildLicensedForUser(userId: number, guildId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_plan_guilds")
    .select("id")
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .limit(1)
    .maybeSingle<{ id: number }>();

  if (result.error) {
    throw new Error(`Erro ao validar licenca do servidor: ${result.error.message}`);
  }

  if (result.data?.id) {
    return true;
  }

  const lockedLicense = await getLockedGuildLicenseByGuildId(guildId);
  return lockedLicense?.userId === userId;
}

export async function licenseGuildForUser(input: {
  userId: number;
  guildId: string;
  maxLicensedServers: number;
  currentPlanCode: PlanCode | null;
  currentPlanState: UserPlanStateRecord | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();

  const existingOwner = await getPlanGuildOwnerUserId(input.guildId);
  if (existingOwner && existingOwner.userId !== input.userId) {
    const ownerPlanStateResult = await supabase
      .from("auth_user_plan_state")
      .select(
        "user_id, plan_code, plan_name, status, amount, compare_amount, currency, billing_cycle_days, max_licensed_servers, max_active_tickets, max_automations, max_monthly_actions, last_payment_order_id, last_payment_guild_id, activated_at, expires_at, metadata, created_at, updated_at",
      )
      .eq("user_id", existingOwner.userId)
      .maybeSingle<UserPlanStateRecord>();

    if (ownerPlanStateResult.error) {
      throw new Error(
        `Erro ao validar licenca atual do servidor: ${ownerPlanStateResult.error.message}`,
      );
    }

    const ownerCoverage = resolveCoverageFromPlanState(ownerPlanStateResult.data || null);
    if (isPlanCoverageUsable(ownerCoverage.status)) {
      return {
        ok: false as const,
        reason: "owned_by_other" as const,
        ownerUserId: existingOwner.userId,
        ownerStatus: ownerCoverage.status,
        ownerExpiresAt: ownerCoverage.expiresAt,
        ownerGraceExpiresAt: ownerCoverage.graceExpiresAt,
      };
    }

    // Licenca antiga esta "off": libera troca de dono.
    await supabase.from("auth_user_plan_guilds").delete().eq("guild_id", input.guildId);
  }

  const alreadyLicensed = await isGuildLicensedForUser(input.userId, input.guildId);
  if (alreadyLicensed) {
    const currentCoverage = resolveCoverageFromPlanState(input.currentPlanState);
    return {
      ok: true as const,
      alreadyLicensed: true,
      status: currentCoverage.status,
      expiresAt: currentCoverage.expiresAt,
      graceExpiresAt: currentCoverage.graceExpiresAt,
    };
  }

  const currentCount = await countPlanGuildsForUser(input.userId);
  if (currentCount >= Math.max(1, input.maxLicensedServers)) {
    return {
      ok: false as const,
      reason: "limit_reached" as const,
      currentCount,
      maxLicensedServers: Math.max(1, input.maxLicensedServers),
      currentPlanCode: input.currentPlanCode,
    };
  }

  const insertResult = await supabase
    .from("auth_user_plan_guilds")
    .insert({
      user_id: input.userId,
      guild_id: input.guildId,
    })
    .select("user_id, guild_id, activated_at, created_at")
    .single<PlanGuildRecord>();

  if (insertResult.error || !insertResult.data) {
    const message = insertResult.error?.message || "Falha ao licenciar servidor.";
    return { ok: false as const, reason: "insert_failed" as const, message };
  }

  const coverage = resolveCoverageFromPlanState(input.currentPlanState);
  return {
    ok: true as const,
    alreadyLicensed: false,
    status: coverage.status,
    expiresAt: coverage.expiresAt,
    graceExpiresAt: coverage.graceExpiresAt,
  };
}

export function resolveGuildLicenseFromUserPlanState(input: {
  userPlanState: UserPlanStateRecord | null;
  guildLicensed: boolean;
}) {
  if (!input.guildLicensed) {
    return {
      status: "not_paid" as const,
      expiresAt: null,
      graceExpiresAt: null,
    };
  }

  return resolveCoverageFromPlanState(input.userPlanState);
}
