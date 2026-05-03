import "server-only";

import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type CountResponse = {
  count: number | null;
  error: { message: string } | null;
};

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

type NullableRoleRelation =
  | {
      id?: string;
      code?: string;
      name?: string;
      department?: string;
      is_singleton?: boolean;
      hierarchy_level?: number;
    }
  | Array<{
      id?: string;
      code?: string;
      name?: string;
      department?: string;
      is_singleton?: boolean;
      hierarchy_level?: number;
    }>
  | null;

type NullableStaffRelation =
  | {
      display_name?: string | null;
      email?: string | null;
      status?: string | null;
    }
  | Array<{
      display_name?: string | null;
      email?: string | null;
      status?: string | null;
    }>
  | null;

type RecentPaymentRow = {
  id: number;
  order_number: number;
  user_id: number;
  status: string;
  amount: string | number;
  currency: string;
  plan_name: string | null;
  created_at: string;
  user: NullableUserRelation;
};

type RecentAuditRow = {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  risk_level: "low" | "medium" | "high" | "critical";
  created_at: string;
  actor_user_id: number | null;
  actor: NullableUserRelation;
};

type OpenIncidentRow = {
  id: string;
  title: string;
  impact: "critical" | "warning" | "info";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  updated_at: string;
};

type TeamAssignmentRow = {
  id: string;
  assigned_at: string;
  revoked_at: string | null;
  admin_roles: NullableRoleRelation;
};

type TeamMemberRow = {
  id: string;
  auth_user_id: number;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  department: string | null;
  status: "active" | "pending" | "disabled" | "suspended";
  created_at: string;
  updated_at: string;
  admin_staff_role_assignments: TeamAssignmentRow[] | null;
};

type RoleRow = {
  id: string;
  code: string;
  name: string;
  department: string;
  description: string | null;
  is_singleton: boolean;
  hierarchy_level: number;
  created_at: string;
  updated_at: string;
};

type RoleAssignmentSummaryRow = {
  role_id: string;
  staff_profile_id: string;
  assigned_at: string;
  staff_profile: NullableStaffRelation;
};

type PermissionRow = {
  id: string;
  code: string;
  description: string;
  module_key: string;
  risk_level: "low" | "medium" | "high" | "critical";
};

type PermissionRoleRow = {
  permission_id: string;
  role_id: string;
  role: NullableRoleRelation;
};

type RolePermissionRow = {
  role_id: string;
  permission_id: string;
};

export type AdminOverviewMetric = {
  id: string;
  label: string;
  value: number;
  detail: string;
};

export type AdminOverviewPayment = {
  id: number;
  orderNumber: number;
  customerLabel: string;
  status: string;
  amount: number;
  currency: string;
  planName: string | null;
  createdAt: string;
};

export type AdminOverviewAlert = {
  id: string;
  title: string;
  impact: "critical" | "warning" | "info";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  updatedAt: string;
};

export type AdminOverviewAuditEntry = {
  id: string;
  actorLabel: string;
  action: string;
  targetLabel: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  createdAt: string;
};

export type AdminOverviewData = {
  metrics: AdminOverviewMetric[];
  recentPayments: AdminOverviewPayment[];
  openAlerts: AdminOverviewAlert[];
  recentAuditEntries: AdminOverviewAuditEntry[];
};

export type AdminTeamMember = {
  id: string;
  authUserId: number;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  department: string | null;
  status: "active" | "pending" | "disabled" | "suspended";
  primaryRole: string | null;
  roleNames: string[];
  activeRoles: Array<{
    assignmentId: string;
    roleId: string;
    roleName: string;
  }>;
  permissionCount: number;
  lastRoleAssignedAt: string | null;
  updatedAt: string;
};

export type AdminRoleSummary = {
  id: string;
  code: string;
  name: string;
  department: string;
  description: string | null;
  isSingleton: boolean;
  hierarchyLevel: number;
  permissionCount: number;
  permissionCodes: string[];
  activeAssignmentCount: number;
  currentHolders: string[];
  updatedAt: string;
};

export type AdminPermissionSummary = {
  id: string;
  code: string;
  description: string;
  moduleKey: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  roleCount: number;
  roleNames: string[];
};

export type AdminAuditLogRecord = {
  id: string;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string | null;
  riskLevel: "low" | "medium" | "high" | "critical";
  createdAt: string;
  metadataPreview: string;
};

function resolveCount(result: CountResponse, table: string) {
  if (result.error) {
    throw new Error(`Falha ao carregar ${table}: ${result.error.message}`);
  }

  return result.count || 0;
}

function unwrapUserRelation(user: NullableUserRelation) {
  if (Array.isArray(user)) {
    return user[0] || null;
  }

  return user;
}

function unwrapRoleRelation(role: NullableRoleRelation) {
  if (Array.isArray(role)) {
    return role[0] || null;
  }

  return role;
}

function unwrapStaffRelation(staffProfile: NullableStaffRelation) {
  if (Array.isArray(staffProfile)) {
    return staffProfile[0] || null;
  }

  return staffProfile;
}

function toNumericAmount(value: string | number) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildMetadataPreview(value: Record<string, unknown> | null | undefined) {
  if (!value) {
    return "Sem metadata adicional";
  }

  const entries = Object.entries(value).slice(0, 3);
  if (!entries.length) {
    return "Sem metadata adicional";
  }

  return entries
    .map(([key, entryValue]) => `${key}: ${String(entryValue)}`)
    .join(" · ");
}

async function buildRolePermissionMap() {
  const supabase = getSupabaseAdminClientOrThrow();
  const [rolePermissionsResult, permissionsResult] = await Promise.all([
    supabase
      .from("admin_role_permissions")
      .select("role_id, permission_id")
      .returns<RolePermissionRow[]>(),
    supabase
      .from("admin_permissions")
      .select("id, code")
      .returns<Array<{ id: string; code: string }>>(),
  ]);

  if (rolePermissionsResult.error) {
    throw new Error(`Falha ao carregar relacao role-permission: ${rolePermissionsResult.error.message}`);
  }

  if (permissionsResult.error) {
    throw new Error(`Falha ao carregar permissoes: ${permissionsResult.error.message}`);
  }

  const permissionCodeById = new Map(
    (permissionsResult.data || []).map((permission) => [permission.id, permission.code]),
  );
  const permissionsByRoleId = new Map<string, string[]>();

  for (const relation of rolePermissionsResult.data || []) {
    const permissionCode = permissionCodeById.get(relation.permission_id);
    if (!permissionCode) {
      continue;
    }

    const current = permissionsByRoleId.get(relation.role_id) || [];
    current.push(permissionCode);
    permissionsByRoleId.set(relation.role_id, current);
  }

  return permissionsByRoleId;
}

export async function getAdminOverviewData(): Promise<AdminOverviewData> {
  const supabase = getSupabaseAdminClientOrThrow();
  const nowIso = new Date().toISOString();

  const [
    usersCountResult,
    staffCountResult,
    activeServersCountResult,
    openIncidentsCountResult,
    pendingTicketsCountResult,
    pendingIpRequestsCountResult,
    pendingAccessApprovalsCountResult,
    activeCertificatesCountResult,
    recentPaymentsResult,
    recentAuditResult,
    openIncidentsResult,
  ] = await Promise.all([
    supabase.from("auth_users").select("*", { count: "exact", head: true }),
    supabase
      .from("admin_staff_profiles")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase.from("auth_user_plan_guilds").select("*", { count: "exact", head: true }),
    supabase
      .from("system_incidents")
      .select("*", { count: "exact", head: true })
      .neq("status", "resolved"),
    supabase
      .from("tickets")
      .select("*", { count: "exact", head: true })
      .not("status", "in", "(closed,resolved)"),
    supabase
      .from("dev_ip_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("admin_action_approvals")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("dev_certificates")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .gt("expires_at", nowIso),
    supabase
      .from("payment_orders")
      .select(
        "id, order_number, user_id, status, amount, currency, plan_name, created_at, user:auth_users(display_name, email)",
      )
      .order("created_at", { ascending: false })
      .limit(6)
      .returns<RecentPaymentRow[]>(),
    supabase
      .from("admin_audit_logs")
      .select(
        "id, action, target_type, target_id, metadata, risk_level, created_at, actor_user_id, actor:auth_users(display_name, email)",
      )
      .order("created_at", { ascending: false })
      .limit(8)
      .returns<RecentAuditRow[]>(),
    supabase
      .from("system_incidents")
      .select("id, title, impact, status, updated_at")
      .neq("status", "resolved")
      .order("updated_at", { ascending: false })
      .limit(4)
      .returns<OpenIncidentRow[]>(),
  ]);

  if (recentPaymentsResult.error) {
    throw new Error(`Falha ao carregar pagamentos recentes: ${recentPaymentsResult.error.message}`);
  }

  if (recentAuditResult.error) {
    throw new Error(`Falha ao carregar auditoria administrativa: ${recentAuditResult.error.message}`);
  }

  if (openIncidentsResult.error) {
    throw new Error(`Falha ao carregar incidentes abertos: ${openIncidentsResult.error.message}`);
  }

  const metrics: AdminOverviewMetric[] = [
    {
      id: "customers",
      label: "Clientes cadastrados",
      value: resolveCount(usersCountResult, "auth_users"),
      detail: "Base total de contas registradas no auth principal.",
    },
    {
      id: "staff",
      label: "Membros internos",
      value: resolveCount(staffCountResult, "admin_staff_profiles"),
      detail: "Perfis administrativos ativos na operacao institucional.",
    },
    {
      id: "servers",
      label: "Servidores ativos",
      value: resolveCount(activeServersCountResult, "auth_user_plan_guilds"),
      detail: "Guildas vinculadas a licencas ativas no ecossistema atual.",
    },
    {
      id: "incidents",
      label: "Incidentes abertos",
      value: resolveCount(openIncidentsCountResult, "system_incidents"),
      detail: "Ocorrencias publicas ainda em investigacao, identificacao ou monitoramento.",
    },
    {
      id: "tickets",
      label: "Tickets pendentes",
      value: resolveCount(pendingTicketsCountResult, "tickets"),
      detail: "Chamados que seguem abertos no suporte oficial.",
    },
    {
      id: "ip_requests",
      label: "Solicitacoes de IP",
      value: resolveCount(pendingIpRequestsCountResult, "dev_ip_requests"),
      detail: "Pedidos aguardando credenciamento para ambiente de desenvolvimento.",
    },
    {
      id: "access_requests",
      label: "Aprovacoes pendentes",
      value: resolveCount(pendingAccessApprovalsCountResult, "admin_action_approvals"),
      detail: "Acoes administrativas aguardando revisao antes de seguir.",
    },
    {
      id: "certificates",
      label: "FLWIP ativos",
      value: resolveCount(activeCertificatesCountResult, "dev_certificates"),
      detail: "Certificados ainda validos para consumo autorizado de variaveis de teste.",
    },
  ];

  const recentPayments = (recentPaymentsResult.data || []).map((payment) => {
    const user = unwrapUserRelation(payment.user);
    return {
      id: payment.id,
      orderNumber: payment.order_number,
      customerLabel:
        user?.display_name?.trim() ||
        user?.email?.trim() ||
        `Usuario #${payment.user_id}`,
      status: payment.status,
      amount: toNumericAmount(payment.amount),
      currency: payment.currency || "BRL",
      planName: payment.plan_name,
      createdAt: payment.created_at,
    } satisfies AdminOverviewPayment;
  });

  const recentAuditEntries = (recentAuditResult.data || []).map((entry) => {
    const actor = unwrapUserRelation(entry.actor);
    return {
      id: entry.id,
      actorLabel:
        actor?.display_name?.trim() ||
        actor?.email?.trim() ||
        (entry.actor_user_id ? `Staff #${entry.actor_user_id}` : "Sistema"),
      action: entry.action,
      targetLabel: entry.target_id
        ? `${entry.target_type} · ${entry.target_id}`
        : entry.target_type,
      riskLevel: entry.risk_level,
      createdAt: entry.created_at,
    } satisfies AdminOverviewAuditEntry;
  });

  const openAlerts = (openIncidentsResult.data || []).map((incident) => ({
    id: incident.id,
    title: incident.title,
    impact: incident.impact,
    status: incident.status,
    updatedAt: incident.updated_at,
  }));

  return {
    metrics,
    recentPayments,
    openAlerts,
    recentAuditEntries,
  };
}

export async function listAdminTeamMembers(): Promise<AdminTeamMember[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const [teamMembersResult, permissionsByRoleId, auditLogsResult] = await Promise.all([
    supabase
      .from("admin_staff_profiles")
      .select(
        "id, auth_user_id, display_name, email, avatar_url, department, status, created_at, updated_at, admin_staff_role_assignments(id, assigned_at, revoked_at, admin_roles(id, code, name, department, is_singleton, hierarchy_level))",
      )
      .order("display_name", { ascending: true })
      .returns<TeamMemberRow[]>(),
    buildRolePermissionMap(),
    supabase
      .from("admin_audit_logs")
      .select("actor_user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(300)
      .returns<Array<{ actor_user_id: number | null; created_at: string }>>(),
  ]);

  if (teamMembersResult.error) {
    throw new Error(`Falha ao carregar staff administrativo: ${teamMembersResult.error.message}`);
  }

  if (auditLogsResult.error) {
    throw new Error(`Falha ao carregar atividade administrativa recente: ${auditLogsResult.error.message}`);
  }

  const lastAuditByUserId = new Map<number, string>();
  for (const auditEntry of auditLogsResult.data || []) {
    if (
      auditEntry.actor_user_id &&
      !lastAuditByUserId.has(auditEntry.actor_user_id)
    ) {
      lastAuditByUserId.set(auditEntry.actor_user_id, auditEntry.created_at);
    }
  }

  return (teamMembersResult.data || [])
    .map((member) => {
      const activeAssignments = (member.admin_staff_role_assignments || [])
        .filter((assignment) => !assignment.revoked_at)
        .map((assignment) => ({
          ...assignment,
          role: unwrapRoleRelation(assignment.admin_roles),
        }))
        .filter(
          (
            assignment,
          ): assignment is TeamAssignmentRow & {
            role: NonNullable<ReturnType<typeof unwrapRoleRelation>>;
          } => Boolean(assignment.role),
        )
        .sort(
          (left, right) =>
            (right.role.hierarchy_level || 0) - (left.role.hierarchy_level || 0),
        );

      const roleIds = activeAssignments
        .map((assignment) => assignment.role.id)
        .filter((value): value is string => typeof value === "string");
      const effectivePermissions = Array.from(
        new Set(
          roleIds.flatMap((roleId) => permissionsByRoleId.get(roleId) || []),
        ),
      );
      const primaryRole = activeAssignments[0]?.role?.name || null;
      const lastRoleAssignedAt = activeAssignments[0]?.assigned_at || null;
      const lastAuditAt = lastAuditByUserId.get(member.auth_user_id) || null;

      return {
        id: member.id,
        authUserId: member.auth_user_id,
        displayName: member.display_name,
        email: member.email,
        avatarUrl: member.avatar_url,
        department:
          member.department || activeAssignments[0]?.role?.department || null,
        status: member.status,
        primaryRole,
        roleNames: activeAssignments
          .map((assignment) => assignment.role.name || "")
          .filter(Boolean),
        activeRoles: activeAssignments
          .map((assignment) => ({
            assignmentId: assignment.id,
            roleId: assignment.role.id || "",
            roleName: assignment.role.name || "",
          }))
          .filter((assignment) => assignment.roleId && assignment.roleName),
        permissionCount: effectivePermissions.length,
        lastRoleAssignedAt: lastAuditAt || lastRoleAssignedAt,
        updatedAt: member.updated_at,
      } satisfies AdminTeamMember;
    })
    .sort((left, right) => {
      if (left.status === right.status) {
        return left.displayName.localeCompare(right.displayName, "pt-BR");
      }

      if (left.status === "active") return -1;
      if (right.status === "active") return 1;
      return left.status.localeCompare(right.status, "pt-BR");
    });
}

export async function listAdminRoles(): Promise<AdminRoleSummary[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const [rolesResult, activeAssignmentsResult, permissionsByRoleId] = await Promise.all([
    supabase
      .from("admin_roles")
      .select(
        "id, code, name, department, description, is_singleton, hierarchy_level, created_at, updated_at",
      )
      .order("hierarchy_level", { ascending: false })
      .returns<RoleRow[]>(),
    supabase
      .from("admin_staff_role_assignments")
      .select(
        "role_id, staff_profile_id, assigned_at, staff_profile:admin_staff_profiles(display_name, email, status)",
      )
      .is("revoked_at", null)
      .returns<RoleAssignmentSummaryRow[]>(),
    buildRolePermissionMap(),
  ]);

  if (rolesResult.error) {
    throw new Error(`Falha ao carregar cargos administrativos: ${rolesResult.error.message}`);
  }

  if (activeAssignmentsResult.error) {
    throw new Error(`Falha ao carregar atribuicoes ativas: ${activeAssignmentsResult.error.message}`);
  }

  const assignmentsByRoleId = new Map<string, RoleAssignmentSummaryRow[]>();
  for (const assignment of activeAssignmentsResult.data || []) {
    const current = assignmentsByRoleId.get(assignment.role_id) || [];
    current.push(assignment);
    assignmentsByRoleId.set(assignment.role_id, current);
  }

  return (rolesResult.data || []).map((role) => {
    const assignments = assignmentsByRoleId.get(role.id) || [];
    const currentHolders = assignments
      .map((assignment) => unwrapStaffRelation(assignment.staff_profile))
      .filter(Boolean)
      .map(
        (holder) =>
          holder?.display_name?.trim() ||
          holder?.email?.trim() ||
          "Staff sem identificacao",
      );

    return {
      id: role.id,
      code: role.code,
      name: role.name,
      department: role.department,
      description: role.description,
      isSingleton: role.is_singleton,
      hierarchyLevel: role.hierarchy_level,
      permissionCount: (permissionsByRoleId.get(role.id) || []).length,
      permissionCodes: Array.from(new Set(permissionsByRoleId.get(role.id) || [])).sort(
        (left, right) => left.localeCompare(right, "pt-BR"),
      ),
      activeAssignmentCount: assignments.length,
      currentHolders,
      updatedAt: role.updated_at,
    } satisfies AdminRoleSummary;
  });
}

export async function listAdminPermissions(): Promise<AdminPermissionSummary[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const [permissionsResult, relationsResult] = await Promise.all([
    supabase
      .from("admin_permissions")
      .select("id, code, description, module_key, risk_level")
      .order("module_key", { ascending: true })
      .order("code", { ascending: true })
      .returns<PermissionRow[]>(),
    supabase
      .from("admin_role_permissions")
      .select("permission_id, role_id, role:admin_roles(id, code, name)")
      .returns<PermissionRoleRow[]>(),
  ]);

  if (permissionsResult.error) {
    throw new Error(`Falha ao carregar permissoes administrativas: ${permissionsResult.error.message}`);
  }

  if (relationsResult.error) {
    throw new Error(`Falha ao carregar relacoes de permissao: ${relationsResult.error.message}`);
  }

  const relationsByPermissionId = new Map<string, PermissionRoleRow[]>();
  for (const relation of relationsResult.data || []) {
    const current = relationsByPermissionId.get(relation.permission_id) || [];
    current.push(relation);
    relationsByPermissionId.set(relation.permission_id, current);
  }

  return (permissionsResult.data || []).map((permission) => {
    const relations = relationsByPermissionId.get(permission.id) || [];
    const roleNames = relations
      .map((relation) => unwrapRoleRelation(relation.role))
      .filter(Boolean)
      .map((role) => role?.name || role?.code || "")
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "pt-BR"));

    return {
      id: permission.id,
      code: permission.code,
      description: permission.description,
      moduleKey: permission.module_key,
      riskLevel: permission.risk_level,
      roleCount: roleNames.length,
      roleNames,
    } satisfies AdminPermissionSummary;
  });
}

export async function listAdminAuditLogs(limit = 80): Promise<AdminAuditLogRecord[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const auditLogsResult = await supabase
    .from("admin_audit_logs")
    .select(
      "id, action, target_type, target_id, metadata, risk_level, created_at, actor:auth_users(display_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Array<Omit<RecentAuditRow, "actor_user_id">>>();

  if (auditLogsResult.error) {
    throw new Error(`Falha ao carregar logs administrativos: ${auditLogsResult.error.message}`);
  }

  return (auditLogsResult.data || []).map((entry) => {
    const actor = unwrapUserRelation(entry.actor);
    return {
      id: entry.id,
      actorLabel:
        actor?.display_name?.trim() ||
        actor?.email?.trim() ||
        "Sistema",
      action: entry.action,
      targetType: entry.target_type,
      targetId: entry.target_id,
      riskLevel: entry.risk_level,
      createdAt: entry.created_at,
      metadataPreview: buildMetadataPreview(entry.metadata),
    } satisfies AdminAuditLogRecord;
  });
}
