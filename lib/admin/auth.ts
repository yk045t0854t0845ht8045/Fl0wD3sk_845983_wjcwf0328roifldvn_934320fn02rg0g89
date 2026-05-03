import "server-only";

import type { CurrentAuthSession } from "@/lib/auth/session";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { syncAdminCatalog } from "@/lib/admin/catalog";
import { logAdminActionSafe, touchAdminSession } from "@/lib/admin/audit";
import { getAdminRoleDefinition } from "@/lib/admin/roles";
import {
  getAdminPermissionDefinition,
  isAdminPermissionCode,
} from "@/lib/admin/permissions";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type AdminStaffStatus = "active" | "pending" | "disabled" | "suspended";

export type AdminStaffProfile = {
  id: string;
  authUserId: number;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  department: string | null;
  status: AdminStaffStatus;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
};

export type AdminActiveRole = {
  assignmentId: string;
  roleId: string;
  code: string;
  name: string;
  department: string;
  isSingleton: boolean;
  hierarchyLevel: number;
  assignedAt: string;
};

export type CurrentAdminProfile = {
  session: CurrentAuthSession;
  staffProfile: AdminStaffProfile;
  roles: AdminActiveRole[];
  permissions: string[];
};

type StaffProfileRow = {
  id: string;
  auth_user_id: number;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  department: string | null;
  status: AdminStaffStatus;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
};

type RoleAssignmentRow = {
  id: string;
  role_id: string;
  assigned_at: string;
  admin_roles:
    | {
        id: string;
        code: string;
        name: string;
        department: string;
        is_singleton: boolean;
        hierarchy_level: number;
      }
    | null;
};

const BOOTSTRAP_ADMIN_EMAIL_ENV = "FLOWDESK_BOOTSTRAP_ADMIN_EMAIL";

function normalizeStaffProfile(row: StaffProfileRow): AdminStaffProfile {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    department: row.department,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at,
  };
}

async function ensureBootstrapAdminForSession(session: CurrentAuthSession) {
  const bootstrapEmail = process.env[BOOTSTRAP_ADMIN_EMAIL_ENV]?.trim().toLowerCase() || "";
  const sessionEmail = session.user.email_normalized?.trim().toLowerCase() || "";

  if (!bootstrapEmail || !sessionEmail || bootstrapEmail !== sessionEmail) {
    return;
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const ceoRoleDefinition = getAdminRoleDefinition("ceo");
  if (!ceoRoleDefinition) {
    return;
  }

  const ceoRoleResult = await supabase
    .from("admin_roles")
    .select("id")
    .eq("code", ceoRoleDefinition.code)
    .maybeSingle<{ id: string }>();

  if (ceoRoleResult.error || !ceoRoleResult.data?.id) {
    if (ceoRoleResult.error) {
      throw new Error(ceoRoleResult.error.message);
    }
    return;
  }

  const existingSingletonResult = await supabase
    .from("admin_staff_role_assignments")
    .select("id")
    .eq("role_id", ceoRoleResult.data.id)
    .is("revoked_at", null)
    .maybeSingle<{ id: string }>();

  if (existingSingletonResult.error) {
    throw new Error(existingSingletonResult.error.message);
  }

  if (existingSingletonResult.data?.id) {
    return;
  }

  const existingProfileResult = await supabase
    .from("admin_staff_profiles")
    .select("id")
    .eq("auth_user_id", session.user.id)
    .maybeSingle<{ id: string }>();

  if (existingProfileResult.error) {
    throw new Error(existingProfileResult.error.message);
  }

  let staffProfileId = existingProfileResult.data?.id || null;

  if (!staffProfileId) {
    const insertProfileResult = await supabase
      .from("admin_staff_profiles")
      .insert({
        auth_user_id: session.user.id,
        display_name: session.user.display_name,
        email: session.user.email_normalized || session.user.email || null,
        avatar_url: session.user.avatar || null,
        department: ceoRoleDefinition.department,
        status: "active",
      })
      .select("id")
      .single<{ id: string }>();

    if (insertProfileResult.error || !insertProfileResult.data) {
      throw new Error(
        insertProfileResult.error?.message || "Nao foi possivel criar o bootstrap do primeiro CEO.",
      );
    }

    staffProfileId = insertProfileResult.data.id;
  } else {
    const updateProfileResult = await supabase
      .from("admin_staff_profiles")
      .update({
        display_name: session.user.display_name,
        email: session.user.email_normalized || session.user.email || null,
        avatar_url: session.user.avatar || null,
        department: ceoRoleDefinition.department,
        status: "active",
        disabled_at: null,
      })
      .eq("id", staffProfileId);

    if (updateProfileResult.error) {
      throw new Error(updateProfileResult.error.message);
    }
  }

  const existingAssignmentResult = await supabase
    .from("admin_staff_role_assignments")
    .select("id")
    .eq("staff_profile_id", staffProfileId)
    .eq("role_id", ceoRoleResult.data.id)
    .is("revoked_at", null)
    .maybeSingle<{ id: string }>();

  if (existingAssignmentResult.error) {
    throw new Error(existingAssignmentResult.error.message);
  }

  if (!existingAssignmentResult.data?.id) {
    const insertAssignmentResult = await supabase
      .from("admin_staff_role_assignments")
      .insert({
        staff_profile_id: staffProfileId,
        role_id: ceoRoleResult.data.id,
        assigned_by: session.user.id,
        reason: "bootstrap_first_admin",
      });

    if (insertAssignmentResult.error) {
      throw new Error(insertAssignmentResult.error.message);
    }

    await logAdminActionSafe({
      actorUserId: session.user.id,
      action: "admin.bootstrap_first_ceo",
      targetType: "admin_staff_profile",
      targetId: staffProfileId,
      metadata: {
        roleCode: "ceo",
        bootstrapEmail,
      },
      riskLevel: "critical",
    });
  }
}

async function loadCurrentAdminProfile() {
  await syncAdminCatalog();
  const session = await getCurrentAuthSessionFromCookie();

  if (!session) {
    return null;
  }

  await ensureBootstrapAdminForSession(session);

  const supabase = getSupabaseAdminClientOrThrow();
  const staffProfileResult = await supabase
    .from("admin_staff_profiles")
    .select(
      "id, auth_user_id, display_name, email, avatar_url, department, status, created_at, updated_at, disabled_at",
    )
    .eq("auth_user_id", session.user.id)
    .maybeSingle<StaffProfileRow>();

  if (staffProfileResult.error) {
    throw new Error(staffProfileResult.error.message);
  }

  if (!staffProfileResult.data) {
    return null;
  }

  const staffProfile = normalizeStaffProfile(staffProfileResult.data);

  const assignmentsResult = await supabase
    .from("admin_staff_role_assignments")
    .select(
      "id, role_id, assigned_at, admin_roles(id, code, name, department, is_singleton, hierarchy_level)",
    )
    .eq("staff_profile_id", staffProfile.id)
    .is("revoked_at", null)
    .returns<RoleAssignmentRow[]>();

  if (assignmentsResult.error) {
    throw new Error(assignmentsResult.error.message);
  }

  const roles = (assignmentsResult.data || [])
    .filter((assignment) => assignment.admin_roles)
    .map((assignment) => ({
      assignmentId: assignment.id,
      roleId: assignment.role_id,
      code: assignment.admin_roles?.code || "unknown",
      name: assignment.admin_roles?.name || "Cargo",
      department: assignment.admin_roles?.department || "unknown",
      isSingleton: Boolean(assignment.admin_roles?.is_singleton),
      hierarchyLevel: assignment.admin_roles?.hierarchy_level || 0,
      assignedAt: assignment.assigned_at,
    }))
    .sort((left, right) => right.hierarchyLevel - left.hierarchyLevel);

  const roleIds = roles.map((role) => role.roleId);
  let permissions: string[] = [];

  if (roleIds.length) {
    const rolePermissionsResult = await supabase
      .from("admin_role_permissions")
      .select("permission_id")
      .in("role_id", roleIds)
      .returns<Array<{ permission_id: string }>>();

    if (rolePermissionsResult.error) {
      throw new Error(rolePermissionsResult.error.message);
    }

    const permissionIds = Array.from(
      new Set((rolePermissionsResult.data || []).map((record) => record.permission_id)),
    );

    if (permissionIds.length) {
      const permissionsResult = await supabase
        .from("admin_permissions")
        .select("code")
        .in("id", permissionIds)
        .returns<Array<{ code: string }>>();

      if (permissionsResult.error) {
        throw new Error(permissionsResult.error.message);
      }

      permissions = Array.from(
        new Set((permissionsResult.data || []).map((permission) => permission.code)),
      ).sort((left, right) => left.localeCompare(right, "pt-BR"));
    }
  }

  return {
    session,
    staffProfile,
    roles,
    permissions,
  } satisfies CurrentAdminProfile;
}

export async function getCurrentAdminProfile() {
  const profile = await loadCurrentAdminProfile();
  if (!profile) {
    return null;
  }

  if (profile.staffProfile.status !== "active") {
    return null;
  }

  return profile;
}

export async function getCurrentStaffProfile() {
  return getCurrentAdminProfile();
}

export async function can(permission: string) {
  const profile = await getCurrentAdminProfile();
  if (!profile) {
    return false;
  }

  return profile.permissions.includes(permission);
}

export async function requireStaffPermission(permission: string) {
  const profile = await getCurrentAdminProfile();
  if (!profile) {
    throw new Error("Acesso interno nao autorizado.");
  }

  if (!profile.permissions.includes(permission)) {
    throw new Error(`Permissao obrigatoria ausente: ${permission}`);
  }

  return profile;
}

export async function requireAdminAccess() {
  const profile = await getCurrentAdminProfile();
  if (!profile) {
    throw new Error("Acesso administrativo nao autorizado.");
  }

  if (!profile.permissions.includes("admin.access")) {
    throw new Error("Permissao administrativa insuficiente.");
  }

  await touchAdminSession({
    authSessionId: profile.session.id,
    authUserId: profile.session.user.id,
    staffProfileId: profile.staffProfile.id,
  });

  return profile;
}

export async function requirePermission(permission: string) {
  const profile = await requireAdminAccess();

  if (!profile.permissions.includes(permission)) {
    throw new Error(`Permissao obrigatoria ausente: ${permission}`);
  }

  return profile;
}

export async function assertCan(permission: string) {
  return requirePermission(permission);
}

export function describeCurrentAdminRole(profile: CurrentAdminProfile | null) {
  if (!profile?.roles.length) {
    return null;
  }

  const primaryRole = profile.roles[0];
  return getAdminRoleDefinition(primaryRole.code)?.name || primaryRole.name;
}

export function describePermission(permissionCode: string) {
  return getAdminPermissionDefinition(permissionCode)?.description || permissionCode;
}

export function assertKnownPermission(permissionCode: string) {
  if (!isAdminPermissionCode(permissionCode)) {
    throw new Error(`Permissao administrativa desconhecida: ${permissionCode}`);
  }

  return permissionCode;
}
