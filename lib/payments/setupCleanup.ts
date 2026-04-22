import {
  normalizeConfigStep,
  sanitizeConfigDraft,
  type ConfigDraft,
} from "@/lib/auth/configContext";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { parseUtcTimestampMs } from "@/lib/time/utcTimestamp";

export const UNPAID_SETUP_TIMEOUT_MINUTES = 30;
export const UNPAID_SETUP_TIMEOUT_MS = UNPAID_SETUP_TIMEOUT_MINUTES * 60 * 1000;
export const UNPAID_SETUP_TIMEOUT_PROVIDER_STATUS_DETAIL =
  "unpaid_setup_timeout_cleanup";
export const UNPAID_SETUP_TIMEOUT_REFUND_STATUS_DETAIL =
  "auto_refund_after_unpaid_setup_timeout";

const UNPAID_SETUP_ELIGIBLE_STATUSES = [
  "pending",
  "failed",
  "rejected",
  "cancelled",
  "expired",
] as const;

type UnpaidSetupEligibleStatus =
  (typeof UNPAID_SETUP_ELIGIBLE_STATUSES)[number];

type CleanupCandidateOrderRecord = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id: string;
  status: UnpaidSetupEligibleStatus;
  provider_payment_id: string | null;
  provider_status_detail: string | null;
  created_at: string;
  updated_at: string;
};

type ApprovedGuildRecord = {
  guild_id: string;
};

type ActiveSessionCleanupRecord = {
  id: string;
  active_guild_id: string | null;
  config_current_step: number | null;
  config_draft: unknown;
  config_context_updated_at: string | null;
};

type ExpiredPendingOrderRecord = {
  id: number;
  order_number: number;
  guild_id: string;
};

type GuildActivityRecord = {
  guild_id: string;
  updated_at: string;
};

type CleanupSummary = {
  cleanedGuildIds: string[];
  expiredPendingOrderIds: number[];
  removedGlobalGuildSettingsIds: string[];
  removedPlanGuildIds: string[];
  touchedSessionIds: string[];
};

type CleanupCacheEntry = {
  expiresAt: number;
  value: CleanupSummary;
};

const CLEANUP_RESULT_CACHE_TTL_MS = 60_000;
const cleanupResultCache = new Map<string, CleanupCacheEntry>();
const cleanupResultInflight = new Map<string, Promise<CleanupSummary>>();

function cloneCleanupSummary(summary: CleanupSummary): CleanupSummary {
  return {
    cleanedGuildIds: [...summary.cleanedGuildIds],
    expiredPendingOrderIds: [...summary.expiredPendingOrderIds],
    removedGlobalGuildSettingsIds: [...summary.removedGlobalGuildSettingsIds],
    removedPlanGuildIds: [...summary.removedPlanGuildIds],
    touchedSessionIds: [...summary.touchedSessionIds],
  };
}

function readCleanupCache(key: string) {
  const cached = cleanupResultCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cleanupResultCache.delete(key);
    return null;
  }
  return cloneCleanupSummary(cached.value);
}

function writeCleanupCache(key: string, value: CleanupSummary) {
  cleanupResultCache.set(key, {
    value: cloneCleanupSummary(value),
    expiresAt: Date.now() + CLEANUP_RESULT_CACHE_TTL_MS,
  });
}

function buildCleanupCacheKey(input: {
  userId: number;
  guildId?: string | null;
}) {
  return `${input.userId}:${input.guildId?.trim() || "*"}`;
}

function resolveTimedOutSetupCutoffIso(nowMs = Date.now()) {
  return new Date(nowMs - UNPAID_SETUP_TIMEOUT_MS).toISOString();
}

export function resolveUnpaidSetupExpiresAt(
  baseDate: number | string | Date = Date.now(),
) {
  const baseTimestamp =
    typeof baseDate === "number" ? baseDate : parseUtcTimestampMs(baseDate);

  return new Date(
    (Number.isFinite(baseTimestamp) ? baseTimestamp : Date.now()) +
      UNPAID_SETUP_TIMEOUT_MS,
  ).toISOString();
}

export function resolveUnpaidSetupEffectiveExpiresAt(input: {
  createdAt: string;
  providerExpiresAt?: string | null;
}) {
  const setupExpiresAt = resolveUnpaidSetupExpiresAt(input.createdAt);
  if (!input.providerExpiresAt) {
    return setupExpiresAt;
  }

  const providerExpiresAtMs = parseUtcTimestampMs(input.providerExpiresAt);
  const setupExpiresAtMs = parseUtcTimestampMs(setupExpiresAt);
  if (!Number.isFinite(providerExpiresAtMs)) {
    return setupExpiresAt;
  }

  return providerExpiresAtMs <= setupExpiresAtMs
    ? input.providerExpiresAt
    : setupExpiresAt;
}

export function isLockedByUnpaidSetupTimeout(order: {
  status: string;
  provider_status_detail?: string | null;
}) {
  return (
    order.status === "expired" &&
    order.provider_status_detail === UNPAID_SETUP_TIMEOUT_PROVIDER_STATUS_DETAIL
  );
}

function removeGuildsFromDraft(
  currentDraft: ConfigDraft,
  guildIdsToRemove: Set<string>,
) {
  const nextDraft: ConfigDraft = {
    stepTwoByGuild: { ...currentDraft.stepTwoByGuild },
    stepThreeByGuild: { ...currentDraft.stepThreeByGuild },
    stepFourByGuild: { ...currentDraft.stepFourByGuild },
  };

  let changed = false;

  for (const guildId of guildIdsToRemove) {
    if (Object.prototype.hasOwnProperty.call(nextDraft.stepTwoByGuild, guildId)) {
      delete nextDraft.stepTwoByGuild[guildId];
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(nextDraft.stepThreeByGuild, guildId)) {
      delete nextDraft.stepThreeByGuild[guildId];
      changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(nextDraft.stepFourByGuild, guildId)) {
      delete nextDraft.stepFourByGuild[guildId];
      changed = true;
    }
  }

  return {
    draft: changed ? nextDraft : currentDraft,
    changed,
  };
}

function registerLatestGuildActivity(
  activityByGuild: Map<string, number>,
  guildId: string,
  activityAt: string | null | undefined,
) {
  if (!guildId || !activityAt) {
    return;
  }

  const activityAtMs = parseUtcTimestampMs(activityAt);
  if (!Number.isFinite(activityAtMs)) {
    return;
  }

  const previous = activityByGuild.get(guildId);
  if (previous === undefined || activityAtMs > previous) {
    activityByGuild.set(guildId, activityAtMs);
  }
}

function collectGuildIdsFromSessionContext(session: ActiveSessionCleanupRecord) {
  const guildIds = new Set<string>();
  const draft = sanitizeConfigDraft(session.config_draft);

  for (const guildId of Object.keys(draft.stepTwoByGuild)) {
    guildIds.add(guildId);
  }

  for (const guildId of Object.keys(draft.stepThreeByGuild)) {
    guildIds.add(guildId);
  }

  for (const guildId of Object.keys(draft.stepFourByGuild)) {
    guildIds.add(guildId);
  }

  if (session.active_guild_id) {
    guildIds.add(session.active_guild_id);
  }

  return guildIds;
}

async function createPaymentOrderEventSafe(
  paymentOrderId: number,
  eventType: string,
  eventPayload: Record<string, unknown>,
) {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    await supabase.from("payment_order_events").insert({
      payment_order_id: paymentOrderId,
      event_type: eventType,
      event_payload: eventPayload,
    });
  } catch {
    // nao quebrar limpeza por telemetria
  }
}

async function runCleanupExpiredUnpaidServerSetups(input: {
  userId: number;
  guildId?: string | null;
  source?: string;
}): Promise<CleanupSummary> {
  const supabase = getSupabaseAdminClientOrThrow();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = resolveTimedOutSetupCutoffIso(nowMs);
  const source = input.source || "background_setup_cleanup";

  const activeSessionsQuery = supabase
    .from("auth_sessions")
    .select(
      "id, active_guild_id, config_current_step, config_draft, config_context_updated_at",
    )
    .eq("user_id", input.userId)
    .is("revoked_at", null)
    .gt("expires_at", nowIso);

  let latestUnpaidOrdersQuery = supabase
    .from("payment_orders")
    .select(
      "id, order_number, user_id, guild_id, status, provider_payment_id, provider_status_detail, created_at, updated_at",
    )
    .eq("user_id", input.userId)
    .in("status", [...UNPAID_SETUP_ELIGIBLE_STATUSES])
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(input.guildId ? 40 : 200);

  if (input.guildId) {
    latestUnpaidOrdersQuery = latestUnpaidOrdersQuery.eq("guild_id", input.guildId);
  }

  let ticketSettingsActivityQuery = supabase
    .from("guild_ticket_settings")
    .select("guild_id, updated_at")
    .eq("configured_by_user_id", input.userId);

  let staffSettingsActivityQuery = supabase
    .from("guild_ticket_staff_settings")
    .select("guild_id, updated_at")
    .eq("configured_by_user_id", input.userId);

  let antiLinkSettingsActivityQuery = supabase
    .from("guild_antilink_settings")
    .select("guild_id, updated_at")
    .eq("configured_by_user_id", input.userId);

  let autoRoleSettingsActivityQuery = supabase
    .from("guild_autorole_settings")
    .select("guild_id, updated_at")
    .eq("configured_by_user_id", input.userId);

  let planSettingsActivityQuery = supabase
    .from("guild_plan_settings")
    .select("guild_id, updated_at")
    .eq("user_id", input.userId);

  if (input.guildId) {
    ticketSettingsActivityQuery = ticketSettingsActivityQuery.eq(
      "guild_id",
      input.guildId,
    );
    staffSettingsActivityQuery = staffSettingsActivityQuery.eq(
      "guild_id",
      input.guildId,
    );
    antiLinkSettingsActivityQuery = antiLinkSettingsActivityQuery.eq(
      "guild_id",
      input.guildId,
    );
    autoRoleSettingsActivityQuery = autoRoleSettingsActivityQuery.eq(
      "guild_id",
      input.guildId,
    );
    planSettingsActivityQuery = planSettingsActivityQuery.eq("guild_id", input.guildId);
  }

  const [
    activeSessionsResult,
    latestUnpaidOrdersResult,
    ticketSettingsActivityResult,
    staffSettingsActivityResult,
    antiLinkSettingsActivityResult,
    autoRoleSettingsActivityResult,
    planSettingsActivityResult,
  ] = await Promise.all([
    activeSessionsQuery.returns<ActiveSessionCleanupRecord[]>(),
    latestUnpaidOrdersQuery.returns<CleanupCandidateOrderRecord[]>(),
    ticketSettingsActivityQuery.returns<GuildActivityRecord[]>(),
    staffSettingsActivityQuery.returns<GuildActivityRecord[]>(),
    antiLinkSettingsActivityQuery.returns<GuildActivityRecord[]>(),
    autoRoleSettingsActivityQuery.returns<GuildActivityRecord[]>(),
    planSettingsActivityQuery.returns<GuildActivityRecord[]>(),
  ]);

  if (activeSessionsResult.error) {
    throw new Error(
      `Erro ao carregar sessoes ativas para limpeza: ${activeSessionsResult.error.message}`,
    );
  }

  if (latestUnpaidOrdersResult.error) {
    throw new Error(
      `Erro ao carregar tentativas nao pagas para limpeza: ${latestUnpaidOrdersResult.error.message}`,
    );
  }

  if (ticketSettingsActivityResult.error) {
    throw new Error(
      `Erro ao carregar atividade das configuracoes de canais: ${ticketSettingsActivityResult.error.message}`,
    );
  }

  if (staffSettingsActivityResult.error) {
    throw new Error(
      `Erro ao carregar atividade das configuracoes de cargos: ${staffSettingsActivityResult.error.message}`,
    );
  }

  if (antiLinkSettingsActivityResult.error) {
    throw new Error(
      `Erro ao carregar atividade das configuracoes anti-link: ${antiLinkSettingsActivityResult.error.message}`,
    );
  }

  if (autoRoleSettingsActivityResult.error) {
    throw new Error(
      `Erro ao carregar atividade das configuracoes de autorole: ${autoRoleSettingsActivityResult.error.message}`,
    );
  }

  if (planSettingsActivityResult.error) {
    throw new Error(
      `Erro ao carregar atividade do plano do servidor: ${planSettingsActivityResult.error.message}`,
    );
  }

  const latestOrderByGuild = new Map<string, CleanupCandidateOrderRecord>();
  for (const order of latestUnpaidOrdersResult.data || []) {
    if (!latestOrderByGuild.has(order.guild_id)) {
      latestOrderByGuild.set(order.guild_id, order);
    }
  }

  const lastActivityByGuild = new Map<string, number>();
  for (const order of latestOrderByGuild.values()) {
    registerLatestGuildActivity(
      lastActivityByGuild,
      order.guild_id,
      order.updated_at || order.created_at,
    );
  }

  for (const item of ticketSettingsActivityResult.data || []) {
    registerLatestGuildActivity(lastActivityByGuild, item.guild_id, item.updated_at);
  }

  for (const item of staffSettingsActivityResult.data || []) {
    registerLatestGuildActivity(lastActivityByGuild, item.guild_id, item.updated_at);
  }

  for (const item of antiLinkSettingsActivityResult.data || []) {
    registerLatestGuildActivity(lastActivityByGuild, item.guild_id, item.updated_at);
  }

  for (const item of autoRoleSettingsActivityResult.data || []) {
    registerLatestGuildActivity(lastActivityByGuild, item.guild_id, item.updated_at);
  }

  for (const item of planSettingsActivityResult.data || []) {
    registerLatestGuildActivity(lastActivityByGuild, item.guild_id, item.updated_at);
  }

  for (const session of activeSessionsResult.data || []) {
    if (!session.config_context_updated_at) {
      continue;
    }

    for (const guildId of collectGuildIdsFromSessionContext(session)) {
      registerLatestGuildActivity(
        lastActivityByGuild,
        guildId,
        session.config_context_updated_at,
      );
    }
  }

  const timedOutGuildIds = Array.from(lastActivityByGuild.entries())
    .filter(([, activityAtMs]) => nowMs - activityAtMs >= UNPAID_SETUP_TIMEOUT_MS)
    .map(([guildId]) => guildId);

  if (!timedOutGuildIds.length) {
    return {
      cleanedGuildIds: [],
      expiredPendingOrderIds: [],
      removedGlobalGuildSettingsIds: [],
      removedPlanGuildIds: [],
      touchedSessionIds: [],
    };
  }

  const approvedOrdersByUserResult = await supabase
    .from("payment_orders")
    .select("guild_id")
    .eq("user_id", input.userId)
    .eq("status", "approved")
    .in("guild_id", timedOutGuildIds)
    .returns<ApprovedGuildRecord[]>();

  if (approvedOrdersByUserResult.error) {
    throw new Error(
      `Erro ao validar licencas pagas do usuario durante limpeza: ${approvedOrdersByUserResult.error.message}`,
    );
  }

  const paidGuildIdsByUser = new Set(
    (approvedOrdersByUserResult.data || []).map((item) => item.guild_id),
  );

  const cleanupGuildIds = timedOutGuildIds.filter(
    (guildId) => !paidGuildIdsByUser.has(guildId),
  );

  if (!cleanupGuildIds.length) {
    return {
      cleanedGuildIds: [],
      expiredPendingOrderIds: [],
      removedGlobalGuildSettingsIds: [],
      removedPlanGuildIds: [],
      touchedSessionIds: [],
    };
  }

  const expiredPendingOrdersResult = await supabase
    .from("payment_orders")
    .update({
      status: "expired",
      provider_status: "expired",
      provider_status_detail: UNPAID_SETUP_TIMEOUT_PROVIDER_STATUS_DETAIL,
      expires_at: nowIso,
      checkout_link_invalidated_at: nowIso,
    })
    .eq("user_id", input.userId)
    .in("guild_id", cleanupGuildIds)
    .eq("status", "pending")
    .lt("created_at", cutoffIso)
    .select("id, order_number, guild_id")
    .returns<ExpiredPendingOrderRecord[]>();

  if (expiredPendingOrdersResult.error) {
    throw new Error(
      `Erro ao expirar pedidos pendentes do onboarding: ${expiredPendingOrdersResult.error.message}`,
    );
  }

  await supabase
    .from("payment_orders")
    .update({
      checkout_link_invalidated_at: nowIso,
    })
    .eq("user_id", input.userId)
    .in("guild_id", cleanupGuildIds)
    .in("status", [...UNPAID_SETUP_ELIGIBLE_STATUSES])
    .lt("created_at", cutoffIso)
    .is("checkout_link_invalidated_at", null);

  await Promise.allSettled(
    (expiredPendingOrdersResult.data || []).map((order) =>
      createPaymentOrderEventSafe(order.id, "setup_cleanup_expired", {
        source,
        guildId: order.guild_id,
        orderNumber: order.order_number,
        timeoutMinutes: UNPAID_SETUP_TIMEOUT_MINUTES,
      }),
    ),
  );

  const guildsWithAnyApprovedOrderResult = await supabase
    .from("payment_orders")
    .select("guild_id")
    .eq("status", "approved")
    .in("guild_id", cleanupGuildIds)
    .returns<ApprovedGuildRecord[]>();

  if (guildsWithAnyApprovedOrderResult.error) {
    throw new Error(
      `Erro ao validar configuracoes globais durante limpeza: ${guildsWithAnyApprovedOrderResult.error.message}`,
    );
  }

  const guildsWithAnyApprovedOrder = new Set(
    (guildsWithAnyApprovedOrderResult.data || []).map((item) => item.guild_id),
  );
  const removableGlobalGuildIds = cleanupGuildIds.filter(
    (guildId) => !guildsWithAnyApprovedOrder.has(guildId),
  );

  if (removableGlobalGuildIds.length) {
    const [
      ticketSettingsDeleteResult,
      staffSettingsDeleteResult,
      antiLinkSettingsDeleteResult,
      autoRoleSettingsDeleteResult,
      autoRoleQueueDeleteResult,
    ] =
      await Promise.all([
        supabase
          .from("guild_ticket_settings")
          .delete()
          .eq("configured_by_user_id", input.userId)
          .lt("updated_at", cutoffIso)
          .in("guild_id", removableGlobalGuildIds),
        supabase
          .from("guild_ticket_staff_settings")
          .delete()
          .eq("configured_by_user_id", input.userId)
          .lt("updated_at", cutoffIso)
          .in("guild_id", removableGlobalGuildIds),
        supabase
          .from("guild_antilink_settings")
          .delete()
          .eq("configured_by_user_id", input.userId)
          .lt("updated_at", cutoffIso)
          .in("guild_id", removableGlobalGuildIds),
        supabase
          .from("guild_autorole_settings")
          .delete()
          .eq("configured_by_user_id", input.userId)
          .lt("updated_at", cutoffIso)
          .in("guild_id", removableGlobalGuildIds),
        supabase
          .from("guild_autorole_queue")
          .delete()
          .in("guild_id", removableGlobalGuildIds),
      ]);

    if (ticketSettingsDeleteResult.error) {
      throw new Error(
        `Erro ao remover configuracoes de canais do servidor: ${ticketSettingsDeleteResult.error.message}`,
      );
    }

    if (staffSettingsDeleteResult.error) {
      throw new Error(
        `Erro ao remover configuracoes de cargos do servidor: ${staffSettingsDeleteResult.error.message}`,
      );
    }

    if (antiLinkSettingsDeleteResult.error) {
      throw new Error(
        `Erro ao remover configuracoes anti-link do servidor: ${antiLinkSettingsDeleteResult.error.message}`,
      );
    }

    if (autoRoleSettingsDeleteResult.error) {
      throw new Error(
        `Erro ao remover configuracoes de autorole do servidor: ${autoRoleSettingsDeleteResult.error.message}`,
      );
    }

    if (autoRoleQueueDeleteResult.error) {
      throw new Error(
        `Erro ao remover fila de autorole do servidor: ${autoRoleQueueDeleteResult.error.message}`,
      );
    }
  }

  const planSettingsDeleteResult = await supabase
    .from("guild_plan_settings")
    .delete()
    .eq("user_id", input.userId)
    .lt("updated_at", cutoffIso)
    .in("guild_id", cleanupGuildIds);

  if (planSettingsDeleteResult.error) {
    throw new Error(
      `Erro ao remover configuracoes de plano do servidor: ${planSettingsDeleteResult.error.message}`,
    );
  }

  const cleanupGuildIdSet = new Set(cleanupGuildIds);
  const touchedSessionIds: string[] = [];

  for (const session of activeSessionsResult.data || []) {
    const currentDraft = sanitizeConfigDraft(session.config_draft);
    const nextDraftResult = removeGuildsFromDraft(currentDraft, cleanupGuildIdSet);
    const shouldResetActiveGuild =
      !!session.active_guild_id && cleanupGuildIdSet.has(session.active_guild_id);

    if (!nextDraftResult.changed && !shouldResetActiveGuild) {
      continue;
    }

    const updateResult = await supabase
      .from("auth_sessions")
      .update({
        active_guild_id: shouldResetActiveGuild ? null : session.active_guild_id,
        config_current_step: shouldResetActiveGuild
          ? 1
          : normalizeConfigStep(session.config_current_step) || 1,
        config_draft: nextDraftResult.draft,
        config_context_updated_at: nowIso,
      })
      .eq("id", session.id);

    if (updateResult.error) {
      throw new Error(
        `Erro ao limpar contexto de configuracao da sessao: ${updateResult.error.message}`,
      );
    }

    touchedSessionIds.push(session.id);
  }

  return {
    cleanedGuildIds: cleanupGuildIds,
    expiredPendingOrderIds: (expiredPendingOrdersResult.data || []).map(
      (order) => order.id,
    ),
    removedGlobalGuildSettingsIds: removableGlobalGuildIds,
    removedPlanGuildIds: cleanupGuildIds,
    touchedSessionIds,
  };
}

export async function cleanupExpiredUnpaidServerSetups(input: {
  userId: number;
  guildId?: string | null;
  source?: string;
}): Promise<CleanupSummary> {
  const cacheKey = buildCleanupCacheKey(input);
  const cached = readCleanupCache(cacheKey);
  if (cached) {
    return cached;
  }

  const inflight = cleanupResultInflight.get(cacheKey);
  if (inflight) {
    return cloneCleanupSummary(await inflight);
  }

  const loadPromise = runCleanupExpiredUnpaidServerSetups(input)
    .then((result) => {
      writeCleanupCache(cacheKey, result);
      return result;
    })
    .finally(() => {
      cleanupResultInflight.delete(cacheKey);
    });

  cleanupResultInflight.set(cacheKey, loadPromise);
  return cloneCleanupSummary(await loadPromise);
}
