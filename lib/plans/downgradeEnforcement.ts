import {
  DEFAULT_PLAN_BILLING_PERIOD_CODE,
  isPlanBillingPeriodCode,
  isPlanCode,
  type PlanBillingPeriodCode,
  type PlanCode,
  resolvePlanPricing,
} from "@/lib/plans/catalog";
import type { UserPlanScheduledChangeRecord } from "@/lib/plans/change";
import type { UserPlanStateRecord } from "@/lib/plans/state";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { normalizeUtcTimestampIso, parseUtcTimestampMs } from "@/lib/time/utcTimestamp";

export type UserPlanDowngradeEnforcementStatus =
  | "selection_required"
  | "awaiting_payment"
  | "resolved"
  | "cancelled";

type UserPlanDowngradeEnforcementDbRecord = {
  id: number;
  user_id: number;
  scheduled_change_id: number | null;
  target_plan_code: PlanCode;
  target_billing_period_code: PlanBillingPeriodCode;
  target_billing_cycle_days: number;
  target_max_licensed_servers: number;
  status: UserPlanDowngradeEnforcementStatus;
  effective_at: string;
  selected_guild_ids: unknown;
  resolved_payment_order_id: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type PlanGuildActivationRecord = {
  id: number;
  user_id: number;
  guild_id: string;
  activated_at: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  deactivated_reason: string | null;
  deactivated_at: string | null;
  reactivated_at: string | null;
};

type UserPlanStateStatusSnapshot = {
  status: UserPlanStateRecord["status"];
  expires_at: string | null;
};

const DOWNGRADE_ENFORCEMENT_SELECT_COLUMNS =
  "id, user_id, scheduled_change_id, target_plan_code, target_billing_period_code, target_billing_cycle_days, target_max_licensed_servers, status, effective_at, selected_guild_ids, resolved_payment_order_id, metadata, created_at, updated_at";

const PLAN_GUILD_ACTIVATION_SELECT_COLUMNS =
  "id, user_id, guild_id, activated_at, created_at, updated_at, is_active, deactivated_reason, deactivated_at, reactivated_at";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIsoOrNull(value: string | null | undefined) {
  return normalizeUtcTimestampIso(value);
}

function normalizeGuildId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^\d{10,25}$/.test(normalized) ? normalized : null;
}

function normalizeSelectedGuildIds(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const uniqueGuildIds = new Set<string>();

  for (const candidate of value) {
    const guildId = normalizeGuildId(candidate);
    if (guildId) uniqueGuildIds.add(guildId);
  }

  return [...uniqueGuildIds];
}

function normalizeEnforcementRecord(
  record: UserPlanDowngradeEnforcementDbRecord | null | undefined,
) {
  if (!record) return null;
  return {
    ...record,
    effective_at: normalizeIsoOrNull(record.effective_at) || record.effective_at,
    selected_guild_ids: normalizeSelectedGuildIds(record.selected_guild_ids),
    metadata: isRecord(record.metadata) ? record.metadata : {},
    created_at: normalizeIsoOrNull(record.created_at) || record.created_at,
    updated_at: normalizeIsoOrNull(record.updated_at) || record.updated_at,
  };
}

function isCurrentlyActivePlanState(
  userPlanState: Pick<UserPlanStateStatusSnapshot, "status" | "expires_at"> | null,
  nowMs = Date.now(),
) {
  if (!userPlanState) return false;
  if (userPlanState.status !== "active" && userPlanState.status !== "trial") {
    return false;
  }

  const expiresAtMs = userPlanState.expires_at
    ? parseUtcTimestampMs(userPlanState.expires_at)
    : Number.NaN;
  return !Number.isFinite(expiresAtMs) || nowMs <= expiresAtMs;
}

function resolveTargetMaxLicensedServers(input: {
  targetPlanCode: PlanCode;
  targetBillingPeriodCode: PlanBillingPeriodCode;
}) {
  const pricing = resolvePlanPricing(
    input.targetPlanCode,
    input.targetBillingPeriodCode,
  );
  return Math.max(1, pricing.entitlements.maxLicensedServers || 1);
}

async function getUserPlanStateStatusSnapshot(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_plan_state")
    .select("status, expires_at")
    .eq("user_id", userId)
    .maybeSingle<UserPlanStateStatusSnapshot>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar status do plano da conta: ${result.error.message}`,
    );
  }

  return result.data || null;
}

async function getPlanGuildActivationRowsForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_plan_guilds")
    .select(PLAN_GUILD_ACTIVATION_SELECT_COLUMNS)
    .eq("user_id", userId)
    .order("activated_at", { ascending: false })
    .returns<PlanGuildActivationRecord[]>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar servidores vinculados ao plano: ${result.error.message}`,
    );
  }

  return result.data || [];
}

async function deactivateAllPlanGuildsForUser(userId: number, reason: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = new Date().toISOString();
  const result = await supabase
    .from("auth_user_plan_guilds")
    .update({
      is_active: false,
      deactivated_reason: reason,
      deactivated_at: nowIso,
      reactivated_at: null,
    })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (result.error) {
    throw new Error(
      `Erro ao desativar servidores para regularizacao de downgrade: ${result.error.message}`,
    );
  }
}

export async function getActiveDowngradeEnforcementForUser(userId: number) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_plan_downgrade_enforcements")
    .select(DOWNGRADE_ENFORCEMENT_SELECT_COLUMNS)
    .eq("user_id", userId)
    .in("status", ["selection_required", "awaiting_payment"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<UserPlanDowngradeEnforcementDbRecord>();

  if (result.error) {
    throw new Error(
      `Erro ao carregar regularizacao pendente de downgrade: ${result.error.message}`,
    );
  }

  return normalizeEnforcementRecord(result.data || null);
}

async function insertDowngradeEnforcementFromScheduledChange(input: {
  userId: number;
  scheduledChange: UserPlanScheduledChangeRecord;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const targetBillingPeriodCode = isPlanBillingPeriodCode(
    input.scheduledChange.target_billing_period_code,
  )
    ? input.scheduledChange.target_billing_period_code
    : DEFAULT_PLAN_BILLING_PERIOD_CODE;
  const targetMaxLicensedServers = resolveTargetMaxLicensedServers({
    targetPlanCode: input.scheduledChange.target_plan_code,
    targetBillingPeriodCode,
  });

  const insertResult = await supabase
    .from("auth_user_plan_downgrade_enforcements")
    .insert({
      user_id: input.userId,
      scheduled_change_id: input.scheduledChange.id,
      target_plan_code: input.scheduledChange.target_plan_code,
      target_billing_period_code: targetBillingPeriodCode,
      target_billing_cycle_days: Math.max(
        1,
        input.scheduledChange.target_billing_cycle_days,
      ),
      target_max_licensed_servers: targetMaxLicensedServers,
      status: "selection_required",
      effective_at:
        normalizeIsoOrNull(input.scheduledChange.effective_at) ||
        input.scheduledChange.effective_at,
      selected_guild_ids: [],
      metadata: {
        source: "scheduled_change",
        scheduledChangeId: input.scheduledChange.id,
      },
    })
    .select(DOWNGRADE_ENFORCEMENT_SELECT_COLUMNS)
    .single<UserPlanDowngradeEnforcementDbRecord>();

  if (insertResult.error || !insertResult.data) {
    throw new Error(
      insertResult.error?.message ||
        "Falha ao criar regularizacao pendente do downgrade.",
    );
  }

  return normalizeEnforcementRecord(insertResult.data);
}

export async function ensureDowngradeEnforcementForUser(input: {
  userId: number;
  userPlanState?: Pick<UserPlanStateStatusSnapshot, "status" | "expires_at"> | null;
  scheduledChange?: UserPlanScheduledChangeRecord | null;
}) {
  const nowMs = Date.now();
  const existing = await getActiveDowngradeEnforcementForUser(input.userId);

  if (existing) {
    await deactivateAllPlanGuildsForUser(
      input.userId,
      "downgrade_payment_pending",
    );
    return existing;
  }

  const scheduledChange = input.scheduledChange || null;
  if (!scheduledChange || scheduledChange.status !== "scheduled") {
    return null;
  }

  const effectiveAtMs = parseUtcTimestampMs(scheduledChange.effective_at);
  if (!Number.isFinite(effectiveAtMs) || effectiveAtMs > nowMs) {
    return null;
  }

  const userPlanState =
    input.userPlanState !== undefined
      ? input.userPlanState
      : await getUserPlanStateStatusSnapshot(input.userId);
  if (isCurrentlyActivePlanState(userPlanState, nowMs)) {
    return null;
  }

  const enforcement = await insertDowngradeEnforcementFromScheduledChange({
    userId: input.userId,
    scheduledChange,
  });
  await deactivateAllPlanGuildsForUser(input.userId, "downgrade_payment_pending");
  return enforcement;
}

export async function saveDowngradeEnforcementSelection(input: {
  userId: number;
  selectedGuildIds: string[];
}) {
  const enforcement = await getActiveDowngradeEnforcementForUser(input.userId);
  if (!enforcement) {
    throw new Error(
      "Nenhuma regularizacao pendente foi encontrada para esta conta.",
    );
  }

  const selectedGuildIds = normalizeSelectedGuildIds(input.selectedGuildIds);
  if (!selectedGuildIds.length) {
    throw new Error("Selecione pelo menos um servidor para continuar.");
  }

  const maxSelectable = Math.max(1, enforcement.target_max_licensed_servers || 1);
  if (selectedGuildIds.length > maxSelectable) {
    throw new Error(
      `Voce deve selecionar no maximo ${maxSelectable} servidor(es).`,
    );
  }

  const guildRows = await getPlanGuildActivationRowsForUser(input.userId);
  const availableGuildIds = new Set(guildRows.map((row) => row.guild_id));

  for (const guildId of selectedGuildIds) {
    if (!availableGuildIds.has(guildId)) {
      throw new Error(
        "A selecao enviada contem servidor(es) que nao pertencem ao seu plano atual.",
      );
    }
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const metadata = isRecord(enforcement.metadata) ? enforcement.metadata : {};
  const updateResult = await supabase
    .from("auth_user_plan_downgrade_enforcements")
    .update({
      status: "awaiting_payment",
      selected_guild_ids: selectedGuildIds,
      metadata: {
        ...metadata,
        selectionConfirmedAt: new Date().toISOString(),
        selectedGuildCount: selectedGuildIds.length,
      },
    })
    .eq("id", enforcement.id)
    .select(DOWNGRADE_ENFORCEMENT_SELECT_COLUMNS)
    .single<UserPlanDowngradeEnforcementDbRecord>();

  if (updateResult.error || !updateResult.data) {
    throw new Error(
      updateResult.error?.message ||
        "Falha ao salvar a selecao de servidores do downgrade.",
    );
  }

  await deactivateAllPlanGuildsForUser(input.userId, "downgrade_payment_pending");
  return normalizeEnforcementRecord(updateResult.data);
}

export async function finalizeDowngradeEnforcementAfterApprovedOrder(input: {
  userId: number;
  paymentOrderId: number;
  paidPlanCode: PlanCode;
  paidMaxLicensedServers: number;
}) {
  const enforcement = await getActiveDowngradeEnforcementForUser(input.userId);
  if (!enforcement) {
    return null;
  }

  const guildRows = await getPlanGuildActivationRowsForUser(input.userId);
  const availableGuildIds = guildRows.map((row) => row.guild_id);
  const selectedGuildIds = normalizeSelectedGuildIds(
    enforcement.selected_guild_ids,
  ).filter((guildId) => availableGuildIds.includes(guildId));
  const maxLicensedServers = Math.max(
    1,
    Number.isFinite(input.paidMaxLicensedServers)
      ? input.paidMaxLicensedServers
      : enforcement.target_max_licensed_servers,
  );
  const fallbackSelection = availableGuildIds.slice(0, maxLicensedServers);
  const finalActiveGuildIds = (
    selectedGuildIds.length ? selectedGuildIds : fallbackSelection
  ).slice(0, maxLicensedServers);

  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = new Date().toISOString();
  const deactivateResult = await supabase
    .from("auth_user_plan_guilds")
    .update({
      is_active: false,
      deactivated_reason: "downgrade_limit_exceeded",
      deactivated_at: nowIso,
      reactivated_at: null,
    })
    .eq("user_id", input.userId);

  if (deactivateResult.error) {
    throw new Error(
      `Erro ao aplicar limite do novo plano nos servidores da conta: ${deactivateResult.error.message}`,
    );
  }

  if (finalActiveGuildIds.length > 0) {
    const activateResult = await supabase
      .from("auth_user_plan_guilds")
      .update({
        is_active: true,
        deactivated_reason: null,
        deactivated_at: null,
        reactivated_at: nowIso,
      })
      .eq("user_id", input.userId)
      .in("guild_id", finalActiveGuildIds);

    if (activateResult.error) {
      throw new Error(
        `Erro ao reativar servidores permitidos no novo plano: ${activateResult.error.message}`,
      );
    }
  }

  const metadata = isRecord(enforcement.metadata) ? enforcement.metadata : {};
  const resolveResult = await supabase
    .from("auth_user_plan_downgrade_enforcements")
    .update({
      status: "resolved",
      resolved_payment_order_id: input.paymentOrderId,
      metadata: {
        ...metadata,
        resolvedAt: nowIso,
        resolvedPlanCode: input.paidPlanCode,
        keptGuildIds: finalActiveGuildIds,
      },
    })
    .eq("id", enforcement.id)
    .select(DOWNGRADE_ENFORCEMENT_SELECT_COLUMNS)
    .single<UserPlanDowngradeEnforcementDbRecord>();

  if (resolveResult.error || !resolveResult.data) {
    throw new Error(
      resolveResult.error?.message ||
        "Falha ao concluir a regularizacao de downgrade apos o pagamento.",
    );
  }

  return normalizeEnforcementRecord(resolveResult.data);
}

export async function isPlanGuildActiveForUser(input: {
  userId: number;
  guildId: string;
}) {
  const normalizedGuildId = normalizeGuildId(input.guildId);
  if (!normalizedGuildId) return false;

  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("auth_user_plan_guilds")
    .select("is_active")
    .eq("user_id", input.userId)
    .eq("guild_id", normalizedGuildId)
    .limit(1)
    .maybeSingle<{ is_active: boolean }>();

  if (result.error) {
    throw new Error(
      `Erro ao validar status ativo do servidor no plano: ${result.error.message}`,
    );
  }

  return result.data?.is_active === true;
}

export async function getDowngradeEnforcementSummaryForUser(userId: number) {
  const enforcement = await getActiveDowngradeEnforcementForUser(userId);
  if (!enforcement) return null;

  const normalizedTargetPlanCode = isPlanCode(enforcement.target_plan_code)
    ? enforcement.target_plan_code
    : ("pro" as const);
  const normalizedTargetBillingPeriodCode = isPlanBillingPeriodCode(
    enforcement.target_billing_period_code,
  )
    ? enforcement.target_billing_period_code
    : DEFAULT_PLAN_BILLING_PERIOD_CODE;

  return {
    id: enforcement.id,
    status: enforcement.status,
    effectiveAt: enforcement.effective_at,
    targetPlanCode: normalizedTargetPlanCode,
    targetBillingPeriodCode: normalizedTargetBillingPeriodCode,
    targetBillingCycleDays: Math.max(1, enforcement.target_billing_cycle_days || 1),
    targetMaxLicensedServers: Math.max(
      1,
      enforcement.target_max_licensed_servers || 1,
    ),
    selectedGuildIds: normalizeSelectedGuildIds(enforcement.selected_guild_ids),
    scheduledChangeId: enforcement.scheduled_change_id,
  };
}
