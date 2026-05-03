import "server-only";

import {
  getSystemStatus,
  inferComponentSourceKey,
  type ComponentStatus,
  type Incident,
  type StatusTeamNote,
  type SystemStatus,
} from "@/lib/status/service";
import type { TestVariableEnvironment } from "@/lib/test-variables/service";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type NullableUserRelation =
  | {
      display_name?: string | null;
      email?: string | null;
    }
  | Array<{
      display_name?: string | null;
      email?: string | null;
    }>
  | null;

type AuthUserRow = {
  id: number;
  display_name: string | null;
  email: string | null;
  discord_user_id: string | null;
  created_at: string;
  updated_at: string | null;
};

type StaffProfileRow = {
  auth_user_id: number;
  status: string;
};

type UserPlanStateRow = {
  user_id: number;
  status: string | null;
  activated_at: string | null;
  expires_at: string | null;
  last_payment_order_id: number | null;
};

type PaymentOrderCountRow = {
  user_id: number;
  status: string;
  created_at: string;
};

type PaymentMethodRow = {
  user_id: number;
  method_id: string;
  brand: string | null;
  last_four: string | null;
  is_active: boolean;
  verification_status: string | null;
  updated_at: string | null;
  created_at: string;
};

type TicketRow = {
  id: number;
  protocol: string;
  status: string;
  guild_id: string | null;
  user_id: string | null;
  opened_at: string;
  closed_at: string | null;
  opened_reason: string | null;
  closed_by: string | null;
};

type PaymentOrderRow = {
  id: number;
  order_number: number;
  user_id: number;
  guild_id: string | null;
  payment_method: string;
  status: string;
  amount: string | number;
  currency: string;
  plan_name: string | null;
  provider_status: string | null;
  paid_at: string | null;
  created_at: string;
  user: NullableUserRelation;
};

function getPostgrestErrorMessage(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};

  return typeof record.message === "string" ? record.message.toLowerCase() : "";
}

function getPostgrestErrorCode(error: unknown) {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};

  return typeof record.code === "string" ? record.code : "";
}

function isMissingRelationOrColumn(error: unknown, relationOrColumn: string) {
  const code = getPostgrestErrorCode(error);
  const message =
    getPostgrestErrorMessage(error);
  const target = relationOrColumn.toLowerCase();

  return (
    code === "42P01" ||
    code === "42703" ||
    message.includes(target) ||
    message.includes("could not find") ||
    message.includes("does not exist")
  );
}

function isMissingAnyRelationOrColumn(error: unknown, relationOrColumns: string[]) {
  return relationOrColumns.some((relationOrColumn) =>
    isMissingRelationOrColumn(error, relationOrColumn),
  );
}

type LicensedServerRow = {
  guild_id: string;
  user_id: number;
  activated_at: string | null;
  created_at: string;
  is_active: boolean;
};

type SecurityEventRow = {
  id: number | string;
  user_id: number | null;
  action: string;
  outcome: string;
  request_path: string | null;
  ip_fingerprint: string | null;
  created_at: string;
  user: NullableUserRelation;
};

type DevIpAllowlistRow = {
  id: string;
  auth_user_id: number;
  project_id: string | null;
  environment: TestVariableEnvironment;
  status: "active" | "revoked" | "expired";
  approved_at: string;
  expires_at: string | null;
};

type FlowAiJobRow = {
  id: string;
  auth_user_id: number | null;
  task_key: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  available_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type FlowAiRequestRow = {
  id: number | string;
  auth_user_id: number | null;
  task_key: string;
  response_status: number;
  latency_ms: number | null;
  provider: string | null;
  model: string | null;
  created_at: string;
};

export type AdminUserAccount = {
  id: number;
  displayName: string;
  email: string | null;
  discordUserId: string | null;
  createdAt: string;
  updatedAt: string | null;
  isStaff: boolean;
  staffStatus: string | null;
  planStatus: string | null;
  planActivatedAt: string | null;
  planExpiresAt: string | null;
  lastPaymentOrderId: number | null;
  paymentCount: number;
  latestPaymentStatus: string | null;
  openTicketCount: number;
};

export type AdminPaymentOrderSummary = {
  id: number;
  orderNumber: number;
  userId: number;
  guildId: string | null;
  customerLabel: string;
  paymentMethod: string;
  status: string;
  providerStatus: string | null;
  amount: number;
  currency: string;
  planName: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type AdminBillingStateSummary = {
  userId: number;
  customerLabel: string;
  planStatus: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  lastPaymentOrderId: number | null;
  storedPaymentMethods: number;
  activePaymentMethods: number;
  latestPaymentMethodLabel: string | null;
};

export type AdminLicensedServerSummary = {
  guildId: string;
  userId: number;
  ownerLabel: string;
  isActive: boolean;
  activatedAt: string | null;
  linkedAt: string;
};

export type AdminSupportTicketSummary = {
  id: number;
  protocol: string;
  requesterId: string | null;
  status: string;
  guildId: string | null;
  openedAt: string;
  closedAt: string | null;
  openedReason: string | null;
  closedBy: string | null;
};

export type AdminSecurityEventSummary = {
  id: number | string;
  userId: number | null;
  userLabel: string;
  action: string;
  outcome: string;
  requestPath: string | null;
  ipFingerprint: string | null;
  createdAt: string;
};

export type AdminIpAllowlistSummary = {
  id: string;
  authUserId: number;
  projectId: string | null;
  environment: TestVariableEnvironment;
  status: "active" | "revoked" | "expired";
  approvedAt: string;
  expiresAt: string | null;
};

export type AdminFlowAiJobSummary = {
  id: string;
  authUserId: number | null;
  userLabel: string;
  taskKey: string;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminFlowAiRequestSummary = {
  id: number | string;
  authUserId: number | null;
  userLabel: string;
  taskKey: string;
  responseStatus: number;
  latencyMs: number | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
};

export type AdminStatusSlice = {
  overallStatus: SystemStatus;
  teamNote: StatusTeamNote | null;
  components: ComponentStatus[];
  incidents: Incident[];
};

function unwrapUserRelation(user: NullableUserRelation) {
  if (Array.isArray(user)) {
    return user[0] || null;
  }

  return user;
}

function buildUserLabel(input: {
  displayName?: string | null;
  email?: string | null;
  fallback: string;
}) {
  return (
    input.displayName?.trim() ||
    input.email?.trim() ||
    input.fallback
  );
}

function toNumericAmount(value: string | number) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getUserLabelsByIds(userIds: number[]) {
  const normalizedUserIds = Array.from(
    new Set(userIds.filter((userId) => Number.isFinite(userId))),
  );
  const labelsByUserId = new Map<number, string>();

  if (!normalizedUserIds.length) {
    return labelsByUserId;
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const usersResult = await supabase
    .from("auth_users")
    .select("id, display_name, email")
    .in("id", normalizedUserIds)
    .returns<Array<{ id: number; display_name: string | null; email: string | null }>>();

  if (usersResult.error) {
    throw new Error(`Falha ao carregar rotulos de usuario: ${usersResult.error.message}`);
  }

  for (const user of usersResult.data || []) {
    labelsByUserId.set(
      user.id,
      buildUserLabel({
        displayName: user.display_name,
        email: user.email,
        fallback: `Usuario #${user.id}`,
      }),
    );
  }

  return labelsByUserId;
}

function filterIncidentsBySourceKeys(
  incidents: Incident[],
  sourceKeys: string[],
) {
  const expectedSourceKeys = new Set(sourceKeys);

  return incidents.filter((incident) => {
    const affectedComponents = incident.affected_components || [];
    return affectedComponents.some((componentName) =>
      expectedSourceKeys.has(inferComponentSourceKey(componentName) || ""),
    );
  });
}

export async function listAdminUserAccounts(limit = 60): Promise<AdminUserAccount[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const usersResult = await supabase
    .from("auth_users")
    .select("id, display_name, email, discord_user_id, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<AuthUserRow[]>();

  if (usersResult.error) {
    throw new Error(`Falha ao carregar contas de usuario: ${usersResult.error.message}`);
  }

  const users = usersResult.data || [];
  const userIds = users.map((user) => user.id);
  const discordUserIds = Array.from(
    new Set(
      users
        .map((user) => user.discord_user_id)
        .filter((discordUserId): discordUserId is string => Boolean(discordUserId)),
    ),
  );

  const [
    staffProfilesResult,
    planStatesResult,
    paymentOrdersResult,
    ticketsResult,
  ] = await Promise.all([
    supabase
      .from("admin_staff_profiles")
      .select("auth_user_id, status")
      .in("auth_user_id", userIds)
      .returns<StaffProfileRow[]>(),
    supabase
      .from("auth_user_plan_state")
      .select("user_id, status, activated_at, expires_at, last_payment_order_id")
      .in("user_id", userIds)
      .returns<UserPlanStateRow[]>(),
    supabase
      .from("payment_orders")
      .select("user_id, status, created_at")
      .in("user_id", userIds)
      .order("created_at", { ascending: false })
      .returns<PaymentOrderCountRow[]>(),
    discordUserIds.length
      ? supabase
          .from("tickets")
          .select("user_id, status")
          .in("user_id", discordUserIds)
          .returns<Array<{ user_id: string | null; status: string }>>()
      : Promise.resolve({
          data: [] as Array<{ user_id: string | null; status: string }>,
          error: null,
        }),
  ]);

  if (staffProfilesResult.error) {
    throw new Error(`Falha ao carregar perfis internos: ${staffProfilesResult.error.message}`);
  }

  if (planStatesResult.error) {
    throw new Error(`Falha ao carregar estado de planos: ${planStatesResult.error.message}`);
  }

  if (paymentOrdersResult.error) {
    throw new Error(`Falha ao carregar historico de pagamentos: ${paymentOrdersResult.error.message}`);
  }

  const ticketRowsForUsers =
    ticketsResult.error && isMissingRelationOrColumn(ticketsResult.error, "tickets")
      ? []
      : ticketsResult.data || [];

  if (
    ticketsResult.error &&
    !isMissingRelationOrColumn(ticketsResult.error, "tickets")
  ) {
    throw new Error(`Falha ao carregar tickets por usuario: ${ticketsResult.error.message}`);
  }

  const staffByUserId = new Map(
    (staffProfilesResult.data || []).map((staffProfile) => [
      staffProfile.auth_user_id,
      staffProfile,
    ]),
  );
  const planStateByUserId = new Map(
    (planStatesResult.data || []).map((planState) => [planState.user_id, planState]),
  );
  const paymentCountByUserId = new Map<number, number>();
  const latestPaymentStatusByUserId = new Map<number, string>();
  const ticketCountByDiscordUserId = new Map<string, number>();

  for (const paymentOrder of paymentOrdersResult.data || []) {
    paymentCountByUserId.set(
      paymentOrder.user_id,
      (paymentCountByUserId.get(paymentOrder.user_id) || 0) + 1,
    );

    if (!latestPaymentStatusByUserId.has(paymentOrder.user_id)) {
      latestPaymentStatusByUserId.set(paymentOrder.user_id, paymentOrder.status);
    }
  }

  for (const ticket of ticketRowsForUsers) {
    if (!ticket.user_id) {
      continue;
    }

    if (ticket.status === "closed" || ticket.status === "resolved") {
      continue;
    }

    ticketCountByDiscordUserId.set(
      ticket.user_id,
      (ticketCountByDiscordUserId.get(ticket.user_id) || 0) + 1,
    );
  }

  return users.map((user) => {
    const staffProfile = staffByUserId.get(user.id) || null;
    const planState = planStateByUserId.get(user.id) || null;

    return {
      id: user.id,
      displayName: buildUserLabel({
        displayName: user.display_name,
        email: user.email,
        fallback: `Usuario #${user.id}`,
      }),
      email: user.email,
      discordUserId: user.discord_user_id,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      isStaff: Boolean(staffProfile),
      staffStatus: staffProfile?.status || null,
      planStatus: planState?.status || null,
      planActivatedAt: planState?.activated_at || null,
      planExpiresAt: planState?.expires_at || null,
      lastPaymentOrderId: planState?.last_payment_order_id || null,
      paymentCount: paymentCountByUserId.get(user.id) || 0,
      latestPaymentStatus: latestPaymentStatusByUserId.get(user.id) || null,
      openTicketCount: user.discord_user_id
        ? ticketCountByDiscordUserId.get(user.discord_user_id) || 0
        : 0,
    } satisfies AdminUserAccount;
  });
}

export async function listAdminPaymentOrders(
  limit = 80,
): Promise<AdminPaymentOrderSummary[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const paymentsResult = await supabase
    .from("payment_orders")
    .select(
      "id, order_number, user_id, guild_id, payment_method, status, amount, currency, plan_name, provider_status, paid_at, created_at, user:auth_users(display_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<PaymentOrderRow[]>();

  if (paymentsResult.error) {
    throw new Error(`Falha ao carregar ordens de pagamento: ${paymentsResult.error.message}`);
  }

  return (paymentsResult.data || []).map((payment) => {
    const user = unwrapUserRelation(payment.user);
    return {
      id: payment.id,
      orderNumber: payment.order_number,
      userId: payment.user_id,
      guildId: payment.guild_id,
      customerLabel: buildUserLabel({
        displayName: user?.display_name,
        email: user?.email,
        fallback: `Usuario #${payment.user_id}`,
      }),
      paymentMethod: payment.payment_method,
      status: payment.status,
      providerStatus: payment.provider_status,
      amount: toNumericAmount(payment.amount),
      currency: payment.currency || "BRL",
      planName: payment.plan_name,
      paidAt: payment.paid_at,
      createdAt: payment.created_at,
    } satisfies AdminPaymentOrderSummary;
  });
}

export async function listAdminBillingStates(
  limit = 60,
): Promise<AdminBillingStateSummary[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const planStatesResult = await supabase
    .from("auth_user_plan_state")
    .select("user_id, status, activated_at, expires_at, last_payment_order_id")
    .order("expires_at", { ascending: false, nullsFirst: false })
    .limit(limit)
    .returns<UserPlanStateRow[]>();

  if (planStatesResult.error) {
    throw new Error(`Falha ao carregar estados de billing: ${planStatesResult.error.message}`);
  }

  const planStates = planStatesResult.data || [];
  const userIds = planStates.map((planState) => planState.user_id);

  const [userLabelsById, methodsResult] = await Promise.all([
    getUserLabelsByIds(userIds),
    userIds.length
      ? supabase
          .from("auth_user_payment_methods")
          .select(
            "user_id, method_id, brand, last_four, is_active, verification_status, updated_at, created_at",
          )
          .in("user_id", userIds)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .returns<PaymentMethodRow[]>()
      : Promise.resolve({
          data: [] as PaymentMethodRow[],
          error: null,
        }),
  ]);

  if (methodsResult.error) {
    throw new Error(`Falha ao carregar metodos de pagamento: ${methodsResult.error.message}`);
  }

  const methodsByUserId = new Map<number, PaymentMethodRow[]>();
  for (const method of methodsResult.data || []) {
    const current = methodsByUserId.get(method.user_id) || [];
    current.push(method);
    methodsByUserId.set(method.user_id, current);
  }

  return planStates.map((planState) => {
    const methods = methodsByUserId.get(planState.user_id) || [];
    const activeMethods = methods.filter((method) => method.is_active);
    const latestMethod = methods[0] || null;

    return {
      userId: planState.user_id,
      customerLabel:
        userLabelsById.get(planState.user_id) || `Usuario #${planState.user_id}`,
      planStatus: planState.status,
      activatedAt: planState.activated_at,
      expiresAt: planState.expires_at,
      lastPaymentOrderId: planState.last_payment_order_id,
      storedPaymentMethods: methods.length,
      activePaymentMethods: activeMethods.length,
      latestPaymentMethodLabel: latestMethod
        ? `${latestMethod.brand || "metodo"} · •••• ${latestMethod.last_four || "----"}`
        : null,
    } satisfies AdminBillingStateSummary;
  });
}

export async function listAdminLicensedServers(
  limit = 80,
): Promise<AdminLicensedServerSummary[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const serversResult = await supabase
    .from("auth_user_plan_guilds")
    .select("guild_id, user_id, activated_at, created_at, is_active")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<LicensedServerRow[]>();

  if (serversResult.error) {
    throw new Error(`Falha ao carregar licencas de servidores: ${serversResult.error.message}`);
  }

  const userLabelsById = await getUserLabelsByIds(
    (serversResult.data || []).map((server) => server.user_id),
  );

  return (serversResult.data || []).map((server) => ({
    guildId: server.guild_id,
    userId: server.user_id,
    ownerLabel: userLabelsById.get(server.user_id) || `Usuario #${server.user_id}`,
    isActive: Boolean(server.is_active),
    activatedAt: server.activated_at,
    linkedAt: server.created_at,
  }));
}

export async function listAdminSupportTickets(
  limit = 80,
): Promise<AdminSupportTicketSummary[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 80, 1), 250);
  let ticketsResult = await supabase
    .from("tickets")
    .select(
      "id, protocol, status, guild_id, user_id, opened_at, closed_at, opened_reason, closed_by",
    )
    .order("opened_at", { ascending: false })
    .limit(safeLimit)
    .returns<TicketRow[]>();

  if (
    ticketsResult.error &&
    isMissingRelationOrColumn(ticketsResult.error, "opened_reason")
  ) {
    ticketsResult = await supabase
      .from("tickets")
      .select("id, protocol, status, guild_id, user_id, opened_at, closed_at, closed_by")
      .order("opened_at", { ascending: false })
      .limit(safeLimit)
      .returns<TicketRow[]>();

    if (!ticketsResult.error) {
      ticketsResult.data = (ticketsResult.data || []).map((ticket) => ({
        ...ticket,
        opened_reason: "",
      }));
    }
  }

  if (
    ticketsResult.error &&
    isMissingAnyRelationOrColumn(ticketsResult.error, [
      "tickets",
      "protocol",
      "guild_id",
      "user_id",
      "opened_at",
      "closed_at",
      "closed_by",
    ])
  ) {
    return [];
  }

  if (ticketsResult.error) {
    throw new Error(`Falha ao carregar tickets de suporte: ${ticketsResult.error.message}`);
  }

  return (ticketsResult.data || []).map((ticket) => ({
    id: ticket.id,
    protocol: ticket.protocol,
    requesterId: ticket.user_id,
    status: ticket.status,
    guildId: ticket.guild_id,
    openedAt: ticket.opened_at,
    closedAt: ticket.closed_at,
    openedReason: ticket.opened_reason,
    closedBy: ticket.closed_by,
  }));
}

export async function listAdminSecurityEvents(
  limit = 80,
): Promise<AdminSecurityEventSummary[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const eventsResult = await supabase
    .from("auth_security_events")
    .select(
      "id, user_id, action, outcome, request_path, ip_fingerprint, created_at, user:auth_users(display_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<SecurityEventRow[]>();

  if (eventsResult.error) {
    throw new Error(`Falha ao carregar eventos de seguranca: ${eventsResult.error.message}`);
  }

  return (eventsResult.data || []).map((event) => {
    const user = unwrapUserRelation(event.user);
    return {
      id: event.id,
      userId: event.user_id,
      userLabel: buildUserLabel({
        displayName: user?.display_name,
        email: user?.email,
        fallback: event.user_id ? `Usuario #${event.user_id}` : "Anonimo",
      }),
      action: event.action,
      outcome: event.outcome,
      requestPath: event.request_path,
      ipFingerprint: event.ip_fingerprint,
      createdAt: event.created_at,
    } satisfies AdminSecurityEventSummary;
  });
}

export async function listAdminIpAllowlist(
  limit = 80,
): Promise<AdminIpAllowlistSummary[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const allowlistResult = await supabase
    .from("dev_ip_allowlist")
    .select("id, auth_user_id, project_id, environment, status, approved_at, expires_at")
    .order("approved_at", { ascending: false })
    .limit(limit)
    .returns<DevIpAllowlistRow[]>();

  if (allowlistResult.error) {
    throw new Error(`Falha ao carregar IPs credenciados: ${allowlistResult.error.message}`);
  }

  return (allowlistResult.data || []).map((entry) => ({
    id: entry.id,
    authUserId: entry.auth_user_id,
    projectId: entry.project_id,
    environment: entry.environment,
    status: entry.status,
    approvedAt: entry.approved_at,
    expiresAt: entry.expires_at,
  }));
}

export async function listAdminFlowAiJobs(
  limit = 60,
): Promise<AdminFlowAiJobSummary[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const jobsResult = await supabase
    .from("flowai_job_queue")
    .select(
      "id, auth_user_id, task_key, status, priority, attempts, max_attempts, available_at, completed_at, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<FlowAiJobRow[]>();

  if (jobsResult.error) {
    throw new Error(`Falha ao carregar fila FlowAI: ${jobsResult.error.message}`);
  }

  const userLabelsById = await getUserLabelsByIds(
    (jobsResult.data || [])
      .map((job) => job.auth_user_id)
      .filter((userId): userId is number => typeof userId === "number"),
  );

  return (jobsResult.data || []).map((job) => ({
    id: job.id,
    authUserId: job.auth_user_id,
    userLabel: job.auth_user_id
      ? userLabelsById.get(job.auth_user_id) || `Usuario #${job.auth_user_id}`
      : "Sistema",
    taskKey: job.task_key,
    status: job.status,
    priority: job.priority,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    availableAt: job.available_at,
    completedAt: job.completed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  }));
}

export async function listAdminFlowAiRequests(
  limit = 60,
): Promise<AdminFlowAiRequestSummary[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const requestsResult = await supabase
    .from("flowai_api_request_events")
    .select(
      "id, auth_user_id, task_key, response_status, latency_ms, provider, model, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<FlowAiRequestRow[]>();

  if (requestsResult.error) {
    throw new Error(`Falha ao carregar eventos FlowAI: ${requestsResult.error.message}`);
  }

  const userLabelsById = await getUserLabelsByIds(
    (requestsResult.data || [])
      .map((request) => request.auth_user_id)
      .filter((userId): userId is number => typeof userId === "number"),
  );

  return (requestsResult.data || []).map((request) => ({
    id: request.id,
    authUserId: request.auth_user_id,
    userLabel: request.auth_user_id
      ? userLabelsById.get(request.auth_user_id) || `Usuario #${request.auth_user_id}`
      : "Sistema",
    taskKey: request.task_key,
    responseStatus: request.response_status,
    latencyMs: request.latency_ms,
    provider: request.provider,
    model: request.model,
    createdAt: request.created_at,
  }));
}

export async function getAdminStatusSlice(
  sourceKeys?: string[],
): Promise<AdminStatusSlice> {
  const systemStatus = await getSystemStatus();

  if (!sourceKeys?.length) {
    return {
      overallStatus: systemStatus.overallStatus,
      teamNote: systemStatus.teamNote || null,
      components: systemStatus.components,
      incidents: systemStatus.incidents,
    };
  }

  const allowedSourceKeys = new Set(sourceKeys);
  const components = systemStatus.components.filter((component) =>
    allowedSourceKeys.has(component.source_key || inferComponentSourceKey(component.name) || ""),
  );
  const incidents = filterIncidentsBySourceKeys(systemStatus.incidents, sourceKeys);

  return {
    overallStatus: systemStatus.overallStatus,
    teamNote: systemStatus.teamNote || null,
    components,
    incidents,
  };
}
