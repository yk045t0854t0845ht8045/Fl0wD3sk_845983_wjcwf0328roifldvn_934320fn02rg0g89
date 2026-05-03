import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  ADMIN_PERMISSION_DEFINITIONS,
  type AdminPermissionCode,
} from "@/lib/admin/permissions";
import { ADMIN_ROLE_DEFINITIONS } from "@/lib/admin/roles";

type PermissionRow = {
  id: string;
  code: string;
};

type RoleRow = {
  id: string;
  code: string;
};

const ADMIN_CATALOG_SYNC_TTL_MS = 5 * 60_000;
let adminCatalogSyncPromise: Promise<void> | null = null;
let adminCatalogLastSyncedAt = 0;

async function insertMissingAdminPermissions() {
  const supabase = getSupabaseAdminClientOrThrow();
  const existingPermissionsResult = await supabase
    .from("admin_permissions")
    .select("code")
    .returns<Array<{ code: string }>>();

  if (existingPermissionsResult.error) {
    throw new Error(existingPermissionsResult.error.message);
  }

  const existingCodes = new Set(
    (existingPermissionsResult.data || []).map((row) => row.code),
  );

  const missingPermissions = ADMIN_PERMISSION_DEFINITIONS.filter(
    (permission) => !existingCodes.has(permission.code),
  ).map((permission) => ({
    code: permission.code,
    description: permission.description,
    risk_level: permission.riskLevel,
    module_key: permission.module,
    is_system: true,
  }));

  if (!missingPermissions.length) {
    return;
  }

  const insertResult = await supabase
    .from("admin_permissions")
    .insert(missingPermissions);

  if (insertResult.error) {
    throw new Error(insertResult.error.message);
  }
}

async function insertMissingAdminRoles() {
  const supabase = getSupabaseAdminClientOrThrow();
  const existingRolesResult = await supabase
    .from("admin_roles")
    .select("code")
    .returns<Array<{ code: string }>>();

  if (existingRolesResult.error) {
    throw new Error(existingRolesResult.error.message);
  }

  const existingCodes = new Set((existingRolesResult.data || []).map((row) => row.code));

  const missingRoles = ADMIN_ROLE_DEFINITIONS.filter(
    (role) => !existingCodes.has(role.code),
  ).map((role) => ({
    code: role.code,
    name: role.name,
    department: role.department,
    description: role.description,
    is_singleton: role.isSingleton,
    hierarchy_level: role.hierarchyLevel,
    is_system: true,
  }));

  if (!missingRoles.length) {
    return;
  }

  const insertResult = await supabase
    .from("admin_roles")
    .insert(missingRoles);

  if (insertResult.error) {
    throw new Error(insertResult.error.message);
  }
}

async function insertMissingRolePermissions() {
  const supabase = getSupabaseAdminClientOrThrow();
  const [permissionsResult, rolesResult, rolePermissionsResult] = await Promise.all([
    supabase
      .from("admin_permissions")
      .select("id, code")
      .returns<PermissionRow[]>(),
    supabase
      .from("admin_roles")
      .select("id, code")
      .returns<RoleRow[]>(),
    supabase
      .from("admin_role_permissions")
      .select("role_id, permission_id")
      .returns<Array<{ role_id: string; permission_id: string }>>(),
  ]);

  if (permissionsResult.error) {
    throw new Error(permissionsResult.error.message);
  }
  if (rolesResult.error) {
    throw new Error(rolesResult.error.message);
  }
  if (rolePermissionsResult.error) {
    throw new Error(rolePermissionsResult.error.message);
  }

  const permissionIdByCode = new Map(
    (permissionsResult.data || []).map((permission) => [permission.code, permission.id]),
  );
  const roleIdByCode = new Map((rolesResult.data || []).map((role) => [role.code, role.id]));
  const existingKeys = new Set(
    (rolePermissionsResult.data || []).map(
      (record) => `${record.role_id}:${record.permission_id}`,
    ),
  );

  const missingRelations = ADMIN_ROLE_DEFINITIONS.flatMap((role) => {
    const roleId = roleIdByCode.get(role.code);
    if (!roleId) {
      return [];
    }

    return role.initialPermissions.flatMap((permissionCode) => {
      const permissionId = permissionIdByCode.get(permissionCode);
      if (!permissionId) {
        return [];
      }

      const relationKey = `${roleId}:${permissionId}`;
      if (existingKeys.has(relationKey)) {
        return [];
      }

      return [
        {
          role_id: roleId,
          permission_id: permissionId,
        },
      ];
    });
  });

  if (!missingRelations.length) {
    return;
  }

  const insertResult = await supabase
    .from("admin_role_permissions")
    .insert(missingRelations);

  if (insertResult.error) {
    throw new Error(insertResult.error.message);
  }
}

export async function syncAdminCatalog() {
  if (
    adminCatalogLastSyncedAt > 0 &&
    Date.now() - adminCatalogLastSyncedAt < ADMIN_CATALOG_SYNC_TTL_MS
  ) {
    return;
  }

  if (!adminCatalogSyncPromise) {
    adminCatalogSyncPromise = (async () => {
      await insertMissingAdminPermissions();
      await insertMissingAdminRoles();
      await insertMissingRolePermissions();
      adminCatalogLastSyncedAt = Date.now();
    })().finally(() => {
      adminCatalogSyncPromise = null;
    });
  }

  await adminCatalogSyncPromise;
}

export async function resolveAdminPermissionCodesForRoleIds(roleIds: string[]) {
  if (!roleIds.length) {
    return [] as AdminPermissionCode[];
  }

  const supabase = getSupabaseAdminClientOrThrow();
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

  if (!permissionIds.length) {
    return [] as AdminPermissionCode[];
  }

  const permissionsResult = await supabase
    .from("admin_permissions")
    .select("id, code")
    .in("id", permissionIds)
    .returns<Array<{ id: string; code: string }>>();

  if (permissionsResult.error) {
    throw new Error(permissionsResult.error.message);
  }

  return Array.from(
    new Set((permissionsResult.data || []).map((permission) => permission.code)),
  ) as AdminPermissionCode[];
}
