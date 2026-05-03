import "server-only";

import crypto from "node:crypto";
import { headers } from "next/headers";
import {
  decryptFlowSecureValue,
  encryptFlowSecureValue,
  hashFlowSecureValue,
  redactSensitiveRecord,
} from "@/lib/security/flowSecure";
import { resolveAdminPermissionCodesForRoleIds } from "@/lib/admin/catalog";
import { logAdminAction } from "@/lib/admin/audit";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export const TEST_VARIABLE_ENVIRONMENTS = ["test", "staging", "sandbox"] as const;
export type TestVariableEnvironment = (typeof TEST_VARIABLE_ENVIRONMENTS)[number];
export const TEST_VARIABLE_SENSITIVITY_LEVELS = [
  "public",
  "internal",
  "sensitive",
  "critical",
] as const;
export type TestVariableSensitivityLevel =
  (typeof TEST_VARIABLE_SENSITIVITY_LEVELS)[number];

type StaffIdentity = {
  authUserId: number;
  staffProfileId: string;
  permissions: string[];
};

type ProjectRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  allowed_environments: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type GroupRow = {
  id: string;
  project_id: string;
  environment: TestVariableEnvironment;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type VariableRow = {
  id: string;
  group_id: string;
  key: string;
  encrypted_value: string;
  sensitivity_level: TestVariableSensitivityLevel;
  description: string | null;
  is_active: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  rotated_at: string | null;
};

type DevIpRequestRow = {
  id: string;
  auth_user_id: number;
  project_id: string | null;
  environment: TestVariableEnvironment;
  requested_ip_hash: string;
  encrypted_ip: string;
  device_name: string;
  reason: string;
  notes: string | null;
  requested_scope: Record<string, unknown> | null;
  requested_expires_at: string | null;
  status: "pending" | "approved" | "rejected" | "review";
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_reason: string | null;
  created_at: string;
  updated_at: string;
};

type GrantRow = {
  id: string;
  auth_user_id: number;
  project_id: string;
  environment: TestVariableEnvironment;
  scope: Record<string, unknown> | null;
  status: "active" | "revoked" | "expired" | "pending";
  allow_sensitive: boolean;
  allow_critical: boolean;
  created_by: number | null;
  expires_at: string | null;
  revoked_at: string | null;
};

type CertificateRow = {
  id: string;
  auth_user_id: number;
  certificate_token_hash: string;
  fingerprint: string;
  project_id: string;
  environment: TestVariableEnvironment;
  ip_hash: string;
  scope: Record<string, unknown> | null;
  status: "active" | "expired" | "revoked" | "pending";
  issued_by: number | null;
  issued_at: string;
  expires_at: string;
  revoked_by: number | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  last_used_at: string | null;
  last_used_ip_hash: string | null;
};

export type AdminTestVariableRecord = {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  groupId: string;
  groupName: string;
  environment: TestVariableEnvironment;
  key: string;
  maskedValue: string;
  sensitivityLevel: TestVariableSensitivityLevel;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
  rotatedAt: string | null;
};

export type AdminIpRequestRecord = {
  id: string;
  authUserId: number;
  projectId: string | null;
  environment: TestVariableEnvironment;
  deviceName: string;
  reason: string;
  requestedIpMasked: string;
  status: "pending" | "approved" | "rejected" | "review";
  createdAt: string;
  requestedExpiresAt: string | null;
};

export type AdminCertificateRecord = {
  id: string;
  authUserId: number;
  projectId: string;
  environment: TestVariableEnvironment;
  fingerprint: string;
  status: "active" | "expired" | "revoked" | "pending";
  expiresAt: string;
  issuedAt: string;
  lastUsedAt: string | null;
};

export type AdminReadLogRecord = {
  id: string;
  actorUserId: number | null;
  projectId: string | null;
  environment: TestVariableEnvironment | null;
  result: "allowed" | "blocked" | "partial";
  blockReason: string | null;
  requestedKeys: string[];
  deliveredKeys: string[];
  createdAt: string;
};

export type DevEnvironmentSnapshot = {
  currentIp: string | null;
  currentIpHash: string | null;
  ipStatus: "approved" | "pending" | "not_requested" | "rejected" | "blocked";
  grants: Array<{
    id: string;
    projectId: string;
    environment: TestVariableEnvironment;
    allowSensitive: boolean;
    allowCritical: boolean;
    expiresAt: string | null;
  }>;
  ipRequests: AdminIpRequestRecord[];
  certificates: AdminCertificateRecord[];
};

export type TestVariableProjectSummary = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  allowedEnvironments: TestVariableEnvironment[];
  isActive: boolean;
  groupCount: number;
  variableCount: number;
  updatedAt: string;
};

export type TestVariableGroupSummary = {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  environment: TestVariableEnvironment;
  name: string;
  description: string | null;
  variableCount: number;
  updatedAt: string;
};

function readHeaderValue(
  headerStore: Awaited<ReturnType<typeof headers>>,
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

function detectRequestIpFromHeaders(
  headerStore: Awaited<ReturnType<typeof headers>>,
) {
  const forwardedFor = readHeaderValue(headerStore, ["x-forwarded-for"]);
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return readHeaderValue(headerStore, ["x-real-ip", "cf-connecting-ip"]);
}

function hashDeveloperIp(ipAddress: string | null) {
  return hashFlowSecureValue(ipAddress, {
    purpose: "sensitive_lookup",
    subcontext: "dev_ip_address",
    encoding: "hex",
  });
}

function encryptSecretValue(value: string, aad: string) {
  const encrypted = encryptFlowSecureValue(value, {
    purpose: "test_variable_secret",
    aad,
    subcontext: "test_variables",
  });

  if (!encrypted) {
    throw new Error("Nao foi possivel proteger o valor sensivel.");
  }

  return encrypted;
}

function decryptSecretValue(value: string, aad: string) {
  const decrypted = decryptFlowSecureValue(value, {
    purpose: "test_variable_secret",
    aad,
    subcontext: "test_variables",
  });

  if (!decrypted) {
    throw new Error("Nao foi possivel recuperar o valor sensivel.");
  }

  return decrypted;
}

function buildMaskedSecret(value: string) {
  if (!value) {
    return "••••••";
  }

  const visiblePrefix = value.slice(0, 3);
  const visibleSuffix = value.slice(-2);
  const maskedSize = Math.max(6, value.length - visiblePrefix.length - visibleSuffix.length);
  return `${visiblePrefix}${"•".repeat(maskedSize)}${visibleSuffix}`;
}

function buildVariableAad(input: {
  projectCode: string;
  environment: TestVariableEnvironment;
  key: string;
}) {
  return `${input.projectCode}:${input.environment}:${input.key}`;
}

async function resolveStaffIdentity(authUserId: number): Promise<StaffIdentity | null> {
  const supabase = getSupabaseAdminClientOrThrow();
  const staffProfileResult = await supabase
    .from("admin_staff_profiles")
    .select("id, auth_user_id, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle<{ id: string; auth_user_id: number; status: string }>();

  if (staffProfileResult.error) {
    throw new Error(staffProfileResult.error.message);
  }

  if (!staffProfileResult.data || staffProfileResult.data.status !== "active") {
    return null;
  }

  const activeAssignmentsResult = await supabase
    .from("admin_staff_role_assignments")
    .select("role_id")
    .eq("staff_profile_id", staffProfileResult.data.id)
    .is("revoked_at", null)
    .returns<Array<{ role_id: string }>>();

  if (activeAssignmentsResult.error) {
    throw new Error(activeAssignmentsResult.error.message);
  }

  const roleIds = Array.from(
    new Set((activeAssignmentsResult.data || []).map((assignment) => assignment.role_id)),
  );
  const permissions = await resolveAdminPermissionCodesForRoleIds(roleIds);

  return {
    authUserId,
    staffProfileId: staffProfileResult.data.id,
    permissions,
  };
}

function buildFingerprint(projectId: string, authUserId: number, environment: TestVariableEnvironment, ipHash: string) {
  const rawValue = `${projectId}:${authUserId}:${environment}:${ipHash}:${Date.now()}`;
  const hash = hashFlowSecureValue(rawValue, {
    purpose: "dev_certificate_token",
    subcontext: "fingerprint",
    encoding: "base64url",
  });

  return `flwip_${(hash || "pending").slice(0, 22)}`;
}

function buildCertificateToken() {
  return `flwip_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function listTestVariableProjects(): Promise<
  TestVariableProjectSummary[]
> {
  const supabase = getSupabaseAdminClientOrThrow();
  const [projectsResult, groupsResult, variablesResult] = await Promise.all([
    supabase
      .from("test_variable_projects")
      .select(
        "id, code, name, description, allowed_environments, is_active, updated_at",
      )
      .order("name", { ascending: true })
      .returns<
        Array<
          Pick<
            ProjectRow,
            | "id"
            | "code"
            | "name"
            | "description"
            | "allowed_environments"
            | "is_active"
            | "updated_at"
          >
        >
      >(),
    supabase
      .from("test_variable_groups")
      .select("id, project_id")
      .returns<Array<Pick<GroupRow, "id" | "project_id">>>(),
    supabase
      .from("test_variables")
      .select("id, group_id")
      .returns<Array<Pick<VariableRow, "id" | "group_id">>>(),
  ]);

  if (projectsResult.error) throw new Error(projectsResult.error.message);
  if (groupsResult.error) throw new Error(groupsResult.error.message);
  if (variablesResult.error) throw new Error(variablesResult.error.message);

  const groupCountByProjectId = new Map<string, number>();
  const projectIdByGroupId = new Map<string, string>();
  for (const group of groupsResult.data || []) {
    projectIdByGroupId.set(group.id, group.project_id);
    groupCountByProjectId.set(
      group.project_id,
      (groupCountByProjectId.get(group.project_id) || 0) + 1,
    );
  }

  const variableCountByProjectId = new Map<string, number>();
  for (const variable of variablesResult.data || []) {
    const projectId = projectIdByGroupId.get(variable.group_id);
    if (!projectId) {
      continue;
    }

    variableCountByProjectId.set(
      projectId,
      (variableCountByProjectId.get(projectId) || 0) + 1,
    );
  }

  return (projectsResult.data || []).map((project) => ({
    id: project.id,
    code: project.code,
    name: project.name,
    description: project.description,
    allowedEnvironments: (project.allowed_environments || []).filter((environment) =>
      TEST_VARIABLE_ENVIRONMENTS.includes(
        environment as TestVariableEnvironment,
      ),
    ) as TestVariableEnvironment[],
    isActive: project.is_active,
    groupCount: groupCountByProjectId.get(project.id) || 0,
    variableCount: variableCountByProjectId.get(project.id) || 0,
    updatedAt: project.updated_at,
  }));
}

export async function listTestVariableGroups(): Promise<
  TestVariableGroupSummary[]
> {
  const supabase = getSupabaseAdminClientOrThrow();
  const [projectsResult, groupsResult, variablesResult] = await Promise.all([
    supabase
      .from("test_variable_projects")
      .select("id, code, name")
      .returns<Array<Pick<ProjectRow, "id" | "code" | "name">>>(),
    supabase
      .from("test_variable_groups")
      .select("id, project_id, environment, name, description, updated_at")
      .order("environment", { ascending: true })
      .order("name", { ascending: true })
      .returns<
        Array<
          Pick<
            GroupRow,
            | "id"
            | "project_id"
            | "environment"
            | "name"
            | "description"
            | "updated_at"
          >
        >
      >(),
    supabase
      .from("test_variables")
      .select("id, group_id")
      .returns<Array<Pick<VariableRow, "id" | "group_id">>>(),
  ]);

  if (projectsResult.error) throw new Error(projectsResult.error.message);
  if (groupsResult.error) throw new Error(groupsResult.error.message);
  if (variablesResult.error) throw new Error(variablesResult.error.message);

  const projectById = new Map(
    (projectsResult.data || []).map((project) => [project.id, project]),
  );
  const variableCountByGroupId = new Map<string, number>();

  for (const variable of variablesResult.data || []) {
    variableCountByGroupId.set(
      variable.group_id,
      (variableCountByGroupId.get(variable.group_id) || 0) + 1,
    );
  }

  return (groupsResult.data || [])
    .map((group) => {
      const project = projectById.get(group.project_id);
      if (!project) {
        return null;
      }

      return {
        id: group.id,
        projectId: project.id,
        projectCode: project.code,
        projectName: project.name,
        environment: group.environment,
        name: group.name,
        description: group.description,
        variableCount: variableCountByGroupId.get(group.id) || 0,
        updatedAt: group.updated_at,
      } satisfies TestVariableGroupSummary;
    })
    .filter(
      (group): group is TestVariableGroupSummary => Boolean(group),
    );
}

export async function listAdminTestVariables(): Promise<AdminTestVariableRecord[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const [projectsResult, groupsResult, variablesResult] = await Promise.all([
    supabase
      .from("test_variable_projects")
      .select("id, code, name")
      .returns<Array<{ id: string; code: string; name: string }>>(),
    supabase
      .from("test_variable_groups")
      .select("id, project_id, environment, name")
      .returns<Array<{ id: string; project_id: string; environment: TestVariableEnvironment; name: string }>>(),
    supabase
      .from("test_variables")
      .select("id, group_id, key, encrypted_value, sensitivity_level, description, is_active, updated_at, rotated_at")
      .order("updated_at", { ascending: false })
      .returns<Array<Pick<VariableRow, "id" | "group_id" | "key" | "encrypted_value" | "sensitivity_level" | "description" | "is_active" | "updated_at" | "rotated_at">>>(),
  ]);

  if (projectsResult.error) throw new Error(projectsResult.error.message);
  if (groupsResult.error) throw new Error(groupsResult.error.message);
  if (variablesResult.error) throw new Error(variablesResult.error.message);

  const projectById = new Map(
    (projectsResult.data || []).map((project) => [project.id, project]),
  );
  const groupById = new Map(
    (groupsResult.data || []).map((group) => [group.id, group]),
  );

  return (variablesResult.data || [])
    .map((variable) => {
      const group = groupById.get(variable.group_id);
      const project = group ? projectById.get(group.project_id) : null;
      if (!group || !project) {
        return null;
      }

      const decryptedValue = decryptSecretValue(
        variable.encrypted_value,
        buildVariableAad({
          projectCode: project.code,
          environment: group.environment,
          key: variable.key,
        }),
      );

      return {
        id: variable.id,
        projectId: project.id,
        projectCode: project.code,
        projectName: project.name,
        groupId: group.id,
        groupName: group.name,
        environment: group.environment,
        key: variable.key,
        maskedValue: buildMaskedSecret(decryptedValue),
        sensitivityLevel: variable.sensitivity_level,
        description: variable.description,
        isActive: variable.is_active,
        updatedAt: variable.updated_at,
        rotatedAt: variable.rotated_at,
      } satisfies AdminTestVariableRecord;
    })
    .filter((record): record is AdminTestVariableRecord => Boolean(record));
}

export async function listPendingDevIpRequests(): Promise<AdminIpRequestRecord[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const requestsResult = await supabase
    .from("dev_ip_requests")
    .select("id, auth_user_id, project_id, environment, encrypted_ip, device_name, reason, status, requested_expires_at, created_at")
    .order("created_at", { ascending: false })
    .returns<Array<Pick<DevIpRequestRow, "id" | "auth_user_id" | "project_id" | "environment" | "encrypted_ip" | "device_name" | "reason" | "status" | "requested_expires_at" | "created_at">>>();

  if (requestsResult.error) {
    throw new Error(requestsResult.error.message);
  }

  return (requestsResult.data || []).map((request) => {
    const decryptedIp = decryptSecretValue(
      request.encrypted_ip,
      `dev_ip_request:${request.project_id || "none"}:${request.environment}`,
    );

    return {
      id: request.id,
      authUserId: request.auth_user_id,
      projectId: request.project_id,
      environment: request.environment,
      deviceName: request.device_name,
      reason: request.reason,
      requestedIpMasked: buildMaskedSecret(decryptedIp),
      status: request.status,
      createdAt: request.created_at,
      requestedExpiresAt: request.requested_expires_at,
    } satisfies AdminIpRequestRecord;
  });
}

export async function listDevCertificates(): Promise<AdminCertificateRecord[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const certificatesResult = await supabase
    .from("dev_certificates")
    .select("id, auth_user_id, project_id, environment, fingerprint, status, expires_at, issued_at, last_used_at")
    .order("issued_at", { ascending: false })
    .returns<Array<Pick<CertificateRow, "id" | "auth_user_id" | "project_id" | "environment" | "fingerprint" | "status" | "expires_at" | "issued_at" | "last_used_at">>>();

  if (certificatesResult.error) {
    throw new Error(certificatesResult.error.message);
  }

  return (certificatesResult.data || []).map((certificate) => ({
    id: certificate.id,
    authUserId: certificate.auth_user_id,
    projectId: certificate.project_id,
    environment: certificate.environment,
    fingerprint: certificate.fingerprint,
    status: certificate.status,
    expiresAt: certificate.expires_at,
    issuedAt: certificate.issued_at,
    lastUsedAt: certificate.last_used_at,
  }));
}

export async function listTestVariableReadLogs(limit = 100): Promise<AdminReadLogRecord[]> {
  const supabase = getSupabaseAdminClientOrThrow();
  const logsResult = await supabase
    .from("test_variable_read_logs")
    .select("id, actor_user_id, project_id, environment, result, block_reason, requested_keys, delivered_keys, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Array<{
      id: string;
      actor_user_id: number | null;
      project_id: string | null;
      environment: TestVariableEnvironment | null;
      result: "allowed" | "blocked" | "partial";
      block_reason: string | null;
      requested_keys: string[] | null;
      delivered_keys: string[] | null;
      created_at: string;
    }>>();

  if (logsResult.error) {
    throw new Error(logsResult.error.message);
  }

  return (logsResult.data || []).map((log) => ({
    id: log.id,
    actorUserId: log.actor_user_id,
    projectId: log.project_id,
    environment: log.environment,
    result: log.result,
    blockReason: log.block_reason,
    requestedKeys: log.requested_keys || [],
    deliveredKeys: log.delivered_keys || [],
    createdAt: log.created_at,
  }));
}

export async function createProject(input: {
  actorUserId: number;
  code: string;
  name: string;
  description?: string | null;
  allowedEnvironments?: TestVariableEnvironment[];
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const environments = input.allowedEnvironments?.length
    ? input.allowedEnvironments
    : [...TEST_VARIABLE_ENVIRONMENTS];

  const insertResult = await supabase
    .from("test_variable_projects")
    .insert({
      code: input.code.trim().toLowerCase(),
      name: input.name.trim(),
      description: input.description || null,
      allowed_environments: environments,
      is_active: true,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertResult.error || !insertResult.data) {
    throw new Error(insertResult.error?.message || "Nao foi possivel criar o projeto de variaveis.");
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.test_variables.project_created",
    targetType: "test_variable_project",
    targetId: insertResult.data.id,
    metadata: {
      code: input.code,
      name: input.name,
      allowedEnvironments: environments,
    },
    riskLevel: "high",
  });

  return insertResult.data.id;
}

export async function createGroup(input: {
  actorUserId: number;
  projectId: string;
  environment: TestVariableEnvironment;
  name: string;
  description?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const insertResult = await supabase
    .from("test_variable_groups")
    .insert({
      project_id: input.projectId,
      environment: input.environment,
      name: input.name.trim(),
      description: input.description || null,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertResult.error || !insertResult.data) {
    throw new Error(insertResult.error?.message || "Nao foi possivel criar o grupo de variaveis.");
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.test_variables.group_created",
    targetType: "test_variable_group",
    targetId: insertResult.data.id,
    metadata: {
      projectId: input.projectId,
      environment: input.environment,
      name: input.name,
    },
    riskLevel: "high",
  });

  return insertResult.data.id;
}

export async function createVariable(input: {
  actorUserId: number;
  groupId: string;
  key: string;
  value: string;
  sensitivityLevel: TestVariableSensitivityLevel;
  description?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const groupResult = await supabase
    .from("test_variable_groups")
    .select("id, project_id, environment")
    .eq("id", input.groupId)
    .maybeSingle<{ id: string; project_id: string; environment: TestVariableEnvironment }>();

  if (groupResult.error) throw new Error(groupResult.error.message);
  if (!groupResult.data) throw new Error("Grupo de variaveis nao encontrado.");

  const projectResult = await supabase
    .from("test_variable_projects")
    .select("id, code")
    .eq("id", groupResult.data.project_id)
    .maybeSingle<{ id: string; code: string }>();

  if (projectResult.error) throw new Error(projectResult.error.message);
  if (!projectResult.data) throw new Error("Projeto de variaveis nao encontrado.");

  const normalizedKey = input.key.trim();
  const encryptedValue = encryptSecretValue(
    input.value,
    buildVariableAad({
      projectCode: projectResult.data.code,
      environment: groupResult.data.environment,
      key: normalizedKey,
    }),
  );

  const insertResult = await supabase
    .from("test_variables")
    .insert({
      group_id: input.groupId,
      key: normalizedKey,
      encrypted_value: encryptedValue,
      sensitivity_level: input.sensitivityLevel,
      description: input.description || null,
      is_active: true,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertResult.error || !insertResult.data) {
    throw new Error(insertResult.error?.message || "Nao foi possivel criar a variavel de teste.");
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.test_variables.variable_created",
    targetType: "test_variable",
    targetId: insertResult.data.id,
    metadata: redactSensitiveRecord({
      key: normalizedKey,
      sensitivityLevel: input.sensitivityLevel,
      groupId: input.groupId,
      description: input.description || null,
    }),
    riskLevel: input.sensitivityLevel === "critical" ? "critical" : "high",
  });

  return insertResult.data.id;
}

export async function updateVariable(input: {
  actorUserId: number;
  variableId: string;
  description?: string | null;
  value?: string | null;
  sensitivityLevel?: TestVariableSensitivityLevel;
  isActive?: boolean;
  rotate?: boolean;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const variableResult = await supabase
    .from("test_variables")
    .select("id, group_id, key, encrypted_value, sensitivity_level")
    .eq("id", input.variableId)
    .maybeSingle<Pick<VariableRow, "id" | "group_id" | "key" | "encrypted_value" | "sensitivity_level">>();

  if (variableResult.error) throw new Error(variableResult.error.message);
  if (!variableResult.data) throw new Error("Variavel de teste nao encontrada.");

  const groupResult = await supabase
    .from("test_variable_groups")
    .select("project_id, environment")
    .eq("id", variableResult.data.group_id)
    .maybeSingle<{ project_id: string; environment: TestVariableEnvironment }>();
  if (groupResult.error) throw new Error(groupResult.error.message);
  if (!groupResult.data) throw new Error("Grupo de variaveis nao encontrado.");

  const projectResult = await supabase
    .from("test_variable_projects")
    .select("code")
    .eq("id", groupResult.data.project_id)
    .maybeSingle<{ code: string }>();
  if (projectResult.error) throw new Error(projectResult.error.message);
  if (!projectResult.data) throw new Error("Projeto de variaveis nao encontrado.");

  const updatePayload: Record<string, unknown> = {
    updated_by: input.actorUserId,
  };

  if (input.description !== undefined) {
    updatePayload.description = input.description;
  }
  if (input.sensitivityLevel !== undefined) {
    updatePayload.sensitivity_level = input.sensitivityLevel;
  }
  if (input.isActive !== undefined) {
    updatePayload.is_active = input.isActive;
  }
  if (typeof input.value === "string") {
    updatePayload.encrypted_value = encryptSecretValue(
      input.value,
      buildVariableAad({
        projectCode: projectResult.data.code,
        environment: groupResult.data.environment,
        key: variableResult.data.key,
      }),
    );
  }
  if (input.rotate) {
    updatePayload.rotated_at = new Date().toISOString();
  }

  const updateResult = await supabase
    .from("test_variables")
    .update(updatePayload)
    .eq("id", input.variableId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: input.rotate
      ? "admin.test_variables.variable_rotated"
      : "admin.test_variables.variable_updated",
    targetType: "test_variable",
    targetId: input.variableId,
    metadata: redactSensitiveRecord({
      description: input.description,
      sensitivityLevel: input.sensitivityLevel,
      isActive: input.isActive,
      rotate: input.rotate === true,
      valueUpdated: typeof input.value === "string",
    }),
    riskLevel:
      (input.sensitivityLevel || variableResult.data.sensitivity_level) === "critical"
        ? "critical"
        : "high",
  });
}

export async function deleteVariable(input: {
  actorUserId: number;
  variableId: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const deleteResult = await supabase
    .from("test_variables")
    .delete()
    .eq("id", input.variableId);

  if (deleteResult.error) {
    throw new Error(deleteResult.error.message);
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.test_variables.variable_deleted",
    targetType: "test_variable",
    targetId: input.variableId,
    riskLevel: "high",
  });
}

export async function getDevEnvironmentSnapshot(
  authUserId: number,
): Promise<DevEnvironmentSnapshot> {
  const supabase = getSupabaseAdminClientOrThrow();
  const headerStore = await headers();
  const currentIp = detectRequestIpFromHeaders(headerStore);
  const currentIpHash = hashDeveloperIp(currentIp);
  const nowIso = new Date().toISOString();

  const [grantsResult, requestsResult, certificatesResult, allowlistResult] = await Promise.all([
    supabase
      .from("test_variable_access_grants")
      .select("id, project_id, environment, allow_sensitive, allow_critical, expires_at, status, revoked_at")
      .eq("auth_user_id", authUserId)
      .returns<Array<Pick<GrantRow, "id" | "project_id" | "environment" | "allow_sensitive" | "allow_critical" | "expires_at" | "status" | "revoked_at">>>(),
    supabase
      .from("dev_ip_requests")
      .select("id, auth_user_id, project_id, environment, encrypted_ip, device_name, reason, status, requested_expires_at, created_at")
      .eq("auth_user_id", authUserId)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<Array<Pick<DevIpRequestRow, "id" | "auth_user_id" | "project_id" | "environment" | "encrypted_ip" | "device_name" | "reason" | "status" | "requested_expires_at" | "created_at">>>(),
    supabase
      .from("dev_certificates")
      .select("id, auth_user_id, project_id, environment, fingerprint, status, expires_at, issued_at, last_used_at")
      .eq("auth_user_id", authUserId)
      .order("issued_at", { ascending: false })
      .returns<Array<Pick<CertificateRow, "id" | "auth_user_id" | "project_id" | "environment" | "fingerprint" | "status" | "expires_at" | "issued_at" | "last_used_at">>>(),
    currentIpHash
      ? supabase
          .from("dev_ip_allowlist")
          .select("id")
          .eq("auth_user_id", authUserId)
          .eq("ip_hash", currentIpHash)
          .eq("status", "active")
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (grantsResult.error) throw new Error(grantsResult.error.message);
  if (requestsResult.error) throw new Error(requestsResult.error.message);
  if (certificatesResult.error) throw new Error(certificatesResult.error.message);
  if (allowlistResult.error) throw new Error(allowlistResult.error.message);

  const ipRequests = (requestsResult.data || []).map((request) => {
    const decryptedIp = decryptSecretValue(
      request.encrypted_ip,
      `dev_ip_request:${request.project_id || "none"}:${request.environment}`,
    );

    return {
      id: request.id,
      authUserId: request.auth_user_id,
      projectId: request.project_id,
      environment: request.environment,
      deviceName: request.device_name,
      reason: request.reason,
      requestedIpMasked: buildMaskedSecret(decryptedIp),
      status: request.status,
      createdAt: request.created_at,
      requestedExpiresAt: request.requested_expires_at,
    } satisfies AdminIpRequestRecord;
  });

  const certificates = (certificatesResult.data || []).map((certificate) => ({
    id: certificate.id,
    authUserId: certificate.auth_user_id,
    projectId: certificate.project_id,
    environment: certificate.environment,
    fingerprint: certificate.fingerprint,
    status: certificate.status,
    expiresAt: certificate.expires_at,
    issuedAt: certificate.issued_at,
    lastUsedAt: certificate.last_used_at,
  }));

  const grants = (grantsResult.data || [])
    .filter(
      (grant) =>
        grant.status === "active" &&
        !grant.revoked_at &&
        (!grant.expires_at || grant.expires_at > nowIso),
    )
    .map((grant) => ({
      id: grant.id,
      projectId: grant.project_id,
      environment: grant.environment,
      allowSensitive: grant.allow_sensitive,
      allowCritical: grant.allow_critical,
      expiresAt: grant.expires_at,
    }));

  const latestRequestStatus = ipRequests[0]?.status || null;
  const ipStatus = allowlistResult.data?.length
    ? "approved"
    : latestRequestStatus === "pending"
      ? "pending"
      : latestRequestStatus === "rejected"
        ? "rejected"
        : "not_requested";

  return {
    currentIp,
    currentIpHash,
    ipStatus,
    grants,
    ipRequests,
    certificates,
  };
}

export async function createDevIpRequest(input: {
  authUserId: number;
  projectId: string;
  environment: TestVariableEnvironment;
  deviceName: string;
  reason: string;
  notes?: string | null;
  requestedExpiresAt?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const headerStore = await headers();
  const detectedIp = detectRequestIpFromHeaders(headerStore);
  const ipHash = hashDeveloperIp(detectedIp);

  if (!detectedIp || !ipHash) {
    throw new Error("Nao foi possivel detectar o IP atual da requisicao.");
  }

  const encryptedIp = encryptSecretValue(
    detectedIp,
    `dev_ip_request:${input.projectId}:${input.environment}`,
  );

  const insertResult = await supabase
    .from("dev_ip_requests")
    .insert({
      auth_user_id: input.authUserId,
      project_id: input.projectId,
      environment: input.environment,
      requested_ip_hash: ipHash,
      encrypted_ip: encryptedIp,
      device_name: input.deviceName,
      reason: input.reason,
      notes: input.notes || null,
      requested_scope: {},
      requested_expires_at: input.requestedExpiresAt || null,
      status: "pending",
    })
    .select("id")
    .single<{ id: string }>();

  if (insertResult.error || !insertResult.data) {
    throw new Error(insertResult.error?.message || "Nao foi possivel registrar a solicitacao de IP.");
  }

  return insertResult.data.id;
}

export async function approveDevIpRequest(input: {
  actorUserId: number;
  requestId: string;
  expiresAt: string;
  allowSensitive: boolean;
  allowCritical: boolean;
  reason?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const requestResult = await supabase
    .from("dev_ip_requests")
    .select("*")
    .eq("id", input.requestId)
    .maybeSingle<DevIpRequestRow>();

  if (requestResult.error) throw new Error(requestResult.error.message);
  if (!requestResult.data) throw new Error("Solicitacao de IP nao encontrada.");

  const request = requestResult.data;
  const approvalExpiresAt = input.expiresAt;
  const ipHash = request.requested_ip_hash;
  const certificateToken = buildCertificateToken();
  const certificateTokenHash = hashFlowSecureValue(certificateToken, {
    purpose: "dev_certificate_token",
    subcontext: "certificate",
    encoding: "hex",
  });

  if (!certificateTokenHash) {
    throw new Error("Nao foi possivel gerar o certificado FLWIP.");
  }

  const fingerprint = buildFingerprint(
    request.project_id || "project",
    request.auth_user_id,
    request.environment,
    ipHash,
  );

  const [allowlistInsertResult, certificateInsertResult] = await Promise.all([
    supabase.from("dev_ip_allowlist").insert({
      auth_user_id: request.auth_user_id,
      project_id: request.project_id,
      environment: request.environment,
      ip_hash: request.requested_ip_hash,
      encrypted_ip: request.encrypted_ip,
      source_request_id: request.id,
      approved_by: input.actorUserId,
      approved_at: new Date().toISOString(),
      expires_at: approvalExpiresAt,
      status: "active",
    }),
    supabase
      .from("dev_certificates")
      .insert({
        auth_user_id: request.auth_user_id,
        certificate_token_hash: certificateTokenHash,
        fingerprint,
        project_id: request.project_id,
        environment: request.environment,
        ip_hash: request.requested_ip_hash,
        scope: request.requested_scope || {},
        status: "active",
        issued_by: input.actorUserId,
        issued_at: new Date().toISOString(),
        expires_at: approvalExpiresAt,
      })
      .select("id")
      .single<{ id: string }>(),
  ]);

  if (allowlistInsertResult.error) throw new Error(allowlistInsertResult.error.message);
  if (certificateInsertResult.error || !certificateInsertResult.data) {
    throw new Error(certificateInsertResult.error?.message || "Falha ao emitir certificado FLWIP.");
  }

  const grantUpsertResult = await supabase
    .from("test_variable_access_grants")
    .upsert(
      {
        auth_user_id: request.auth_user_id,
        project_id: request.project_id,
        environment: request.environment,
        scope: request.requested_scope || {},
        status: "active",
        allow_sensitive: input.allowSensitive,
        allow_critical: input.allowCritical,
        created_by: input.actorUserId,
        expires_at: approvalExpiresAt,
        revoked_by: null,
        revoked_at: null,
        notes: input.reason || null,
      },
      {
        onConflict: "auth_user_id,project_id,environment",
        ignoreDuplicates: false,
      },
    );

  if (grantUpsertResult.error) {
    throw new Error(grantUpsertResult.error.message);
  }

  const updateRequestResult = await supabase
    .from("dev_ip_requests")
    .update({
      status: "approved",
      reviewed_by: input.actorUserId,
      reviewed_at: new Date().toISOString(),
      review_reason: input.reason || null,
    })
    .eq("id", input.requestId);

  if (updateRequestResult.error) {
    throw new Error(updateRequestResult.error.message);
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.test_variables.ip_request_approved",
    targetType: "dev_ip_request",
    targetId: input.requestId,
    metadata: {
      projectId: request.project_id,
      environment: request.environment,
      allowSensitive: input.allowSensitive,
      allowCritical: input.allowCritical,
      certificateId: certificateInsertResult.data.id,
      fingerprint,
      reason: input.reason || null,
    },
    riskLevel: "critical",
  });

  return {
    certificateId: certificateInsertResult.data.id,
    fingerprint,
    tokenPreview: buildMaskedSecret(certificateToken),
  };
}

export async function rejectDevIpRequest(input: {
  actorUserId: number;
  requestId: string;
  reason?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const updateResult = await supabase
    .from("dev_ip_requests")
    .update({
      status: "rejected",
      reviewed_by: input.actorUserId,
      reviewed_at: new Date().toISOString(),
      review_reason: input.reason || null,
    })
    .eq("id", input.requestId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.test_variables.ip_request_rejected",
    targetType: "dev_ip_request",
    targetId: input.requestId,
    metadata: {
      reason: input.reason || null,
    },
    riskLevel: "high",
  });
}

export async function revokeDevCertificate(input: {
  actorUserId: number;
  certificateId: string;
  reason?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const updateResult = await supabase
    .from("dev_certificates")
    .update({
      status: "revoked",
      revoked_by: input.actorUserId,
      revoked_at: new Date().toISOString(),
      revocation_reason: input.reason || null,
    })
    .eq("id", input.certificateId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.test_variables.certificate_revoked",
    targetType: "dev_certificate",
    targetId: input.certificateId,
    metadata: {
      reason: input.reason || null,
    },
    riskLevel: "critical",
  });
}

export async function resolveDeveloperIdentityForAuthUser(authUserId: number) {
  return resolveStaffIdentity(authUserId);
}

export async function pullAuthorizedTestVariables(input: {
  authUserId: number;
  authTokenId?: string | null;
  projectCode: string;
  environment: TestVariableEnvironment;
  requestedKeys?: string[];
}) {
  const staffIdentity = await resolveStaffIdentity(input.authUserId);
  if (!staffIdentity) {
    throw new Error("Usuario interno nao autorizado para consumir Test Variables.");
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const headerStore = await headers();
  const currentIp = detectRequestIpFromHeaders(headerStore);
  const currentIpHash = hashDeveloperIp(currentIp);
  const nowIso = new Date().toISOString();

  if (!currentIpHash) {
    throw new Error("Nao foi possivel validar o IP atual da requisicao.");
  }

  const projectResult = await supabase
    .from("test_variable_projects")
    .select("id, code")
    .eq("code", input.projectCode)
    .eq("is_active", true)
    .maybeSingle<{ id: string; code: string }>();
  if (projectResult.error) throw new Error(projectResult.error.message);
  if (!projectResult.data) throw new Error("Projeto de test variables nao encontrado.");

  const [grantResult, certificateResult, allowlistResult, groupsResult] = await Promise.all([
    supabase
      .from("test_variable_access_grants")
      .select("id, allow_sensitive, allow_critical, status, expires_at")
      .eq("auth_user_id", input.authUserId)
      .eq("project_id", projectResult.data.id)
      .eq("environment", input.environment)
      .eq("status", "active")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .maybeSingle<{
        id: string;
        allow_sensitive: boolean;
        allow_critical: boolean;
        status: "active";
        expires_at: string | null;
      }>(),
    supabase
      .from("dev_certificates")
      .select("id, status, expires_at")
      .eq("auth_user_id", input.authUserId)
      .eq("project_id", projectResult.data.id)
      .eq("environment", input.environment)
      .eq("ip_hash", currentIpHash)
      .eq("status", "active")
      .gt("expires_at", nowIso)
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; status: "active"; expires_at: string }>(),
    supabase
      .from("dev_ip_allowlist")
      .select("id")
      .eq("auth_user_id", input.authUserId)
      .eq("project_id", projectResult.data.id)
      .eq("environment", input.environment)
      .eq("ip_hash", currentIpHash)
      .eq("status", "active")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .limit(1),
    supabase
      .from("test_variable_groups")
      .select("id, project_id, environment, name")
      .eq("project_id", projectResult.data.id)
      .eq("environment", input.environment)
      .returns<Array<Pick<GroupRow, "id" | "project_id" | "environment" | "name">>>(),
  ]);

  if (grantResult.error) throw new Error(grantResult.error.message);
  if (certificateResult.error) throw new Error(certificateResult.error.message);
  if (allowlistResult.error) throw new Error(allowlistResult.error.message);
  if (groupsResult.error) throw new Error(groupsResult.error.message);

  if (!grantResult.data) {
    await supabase.from("test_variable_read_logs").insert({
      actor_user_id: input.authUserId,
      auth_token_id: input.authTokenId || null,
      project_id: projectResult.data.id,
      environment: input.environment,
      ip_hash: currentIpHash,
      requested_keys: input.requestedKeys || [],
      delivered_keys: [],
      result: "blocked",
      block_reason: "missing_grant",
    });
    throw new Error("O usuario nao possui grant ativo para este projeto/ambiente.");
  }

  if (!allowlistResult.data?.length) {
    await supabase.from("test_variable_read_logs").insert({
      actor_user_id: input.authUserId,
      auth_token_id: input.authTokenId || null,
      project_id: projectResult.data.id,
      environment: input.environment,
      ip_hash: currentIpHash,
      requested_keys: input.requestedKeys || [],
      delivered_keys: [],
      result: "blocked",
      block_reason: "ip_not_approved",
    });
    throw new Error("O IP atual nao esta credenciado para este projeto/ambiente.");
  }

  if (!certificateResult.data?.id) {
    await supabase.from("test_variable_read_logs").insert({
      actor_user_id: input.authUserId,
      auth_token_id: input.authTokenId || null,
      project_id: projectResult.data.id,
      environment: input.environment,
      ip_hash: currentIpHash,
      requested_keys: input.requestedKeys || [],
      delivered_keys: [],
      result: "blocked",
      block_reason: "missing_certificate",
    });
    throw new Error("Nao existe certificado FLWIP ativo para este contexto.");
  }

  const groupIds = (groupsResult.data || []).map((group) => group.id);
  if (!groupIds.length) {
    return {
      values: {},
      deliveredKeys: [] as string[],
    };
  }

  const variablesResult = await supabase
    .from("test_variables")
    .select("id, group_id, key, encrypted_value, sensitivity_level, is_active")
    .in("group_id", groupIds)
    .eq("is_active", true)
    .returns<Array<Pick<VariableRow, "id" | "group_id" | "key" | "encrypted_value" | "sensitivity_level" | "is_active">>>();

  if (variablesResult.error) {
    throw new Error(variablesResult.error.message);
  }

  const groupById = new Map((groupsResult.data || []).map((group) => [group.id, group]));
  const requestedKeySet = input.requestedKeys?.length
    ? new Set(input.requestedKeys)
    : null;
  const values: Record<string, string> = {};
  const deliveredKeys: string[] = [];

  for (const variable of variablesResult.data || []) {
    if (requestedKeySet && !requestedKeySet.has(variable.key)) {
      continue;
    }

    if (variable.sensitivity_level === "critical") {
      continue;
    }

    if (
      variable.sensitivity_level === "sensitive" &&
      (!grantResult.data.allow_sensitive ||
        !staffIdentity.permissions.includes("test_variables.read_sensitive"))
    ) {
      continue;
    }

    const group = groupById.get(variable.group_id);
    if (!group) {
      continue;
    }

    values[variable.key] = decryptSecretValue(
      variable.encrypted_value,
      buildVariableAad({
        projectCode: projectResult.data.code,
        environment: group.environment,
        key: variable.key,
      }),
    );
    deliveredKeys.push(variable.key);
  }

  await Promise.all([
    supabase.from("test_variable_read_logs").insert({
      actor_user_id: input.authUserId,
      auth_token_id: input.authTokenId || null,
      certificate_id: certificateResult.data.id,
      project_id: projectResult.data.id,
      environment: input.environment,
      ip_hash: currentIpHash,
      requested_keys: input.requestedKeys || [],
      delivered_keys: deliveredKeys,
      result: deliveredKeys.length ? "allowed" : "partial",
      block_reason: deliveredKeys.length ? null : "no_keys_allowed",
    }),
    supabase
      .from("dev_certificates")
      .update({
        last_used_at: nowIso,
        last_used_ip_hash: currentIpHash,
      })
      .eq("id", certificateResult.data.id),
  ]);

  return {
    values,
    deliveredKeys,
  };
}
