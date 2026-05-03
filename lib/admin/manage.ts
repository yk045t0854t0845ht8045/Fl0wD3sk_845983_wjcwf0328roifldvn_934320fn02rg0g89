import "server-only";

import {
  getAdminPermissionDefinition,
  isAdminPermissionCode,
} from "@/lib/admin/permissions";
import { logAdminAction } from "@/lib/admin/audit";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type StaffStatus = "active" | "pending" | "disabled" | "suspended";

type RoleRecord = {
  id: string;
  code: string;
  name: string;
  is_singleton: boolean;
};

type StaffProfileRecord = {
  id: string;
  auth_user_id: number;
  display_name: string;
  status: StaffStatus;
};

type ActiveRoleAssignmentRecord = {
  id: string;
  staff_profile_id: string;
  role_id: string;
};

async function getRoleRecord(roleId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("admin_roles")
    .select("id, code, name, is_singleton")
    .eq("id", roleId)
    .maybeSingle<RoleRecord>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (!result.data) {
    throw new Error("Cargo administrativo nao encontrado.");
  }

  return result.data;
}

async function getStaffProfileRecord(staffProfileId: string) {
  const supabase = getSupabaseAdminClientOrThrow();
  const result = await supabase
    .from("admin_staff_profiles")
    .select("id, auth_user_id, display_name, status")
    .eq("id", staffProfileId)
    .maybeSingle<StaffProfileRecord>();

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (!result.data) {
    throw new Error("Perfil administrativo nao encontrado.");
  }

  return result.data;
}

export async function assignAdminRole(input: {
  actorUserId: number;
  staffProfileId: string;
  roleId: string;
  reason?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const [role, staffProfile] = await Promise.all([
    getRoleRecord(input.roleId),
    getStaffProfileRecord(input.staffProfileId),
  ]);

  if (staffProfile.status === "disabled" || staffProfile.status === "suspended") {
    throw new Error("Nao e possivel atribuir cargo a um perfil administrativo desativado.");
  }

  const existingAssignmentResult = await supabase
    .from("admin_staff_role_assignments")
    .select("id")
    .eq("staff_profile_id", input.staffProfileId)
    .eq("role_id", input.roleId)
    .is("revoked_at", null)
    .maybeSingle<{ id: string }>();

  if (existingAssignmentResult.error) {
    throw new Error(existingAssignmentResult.error.message);
  }

  if (existingAssignmentResult.data?.id) {
    return {
      assignmentId: existingAssignmentResult.data.id,
      reused: true,
    };
  }

  if (role.is_singleton) {
    const occupiedResult = await supabase
      .from("admin_staff_role_assignments")
      .select("id, staff_profile_id")
      .eq("role_id", input.roleId)
      .is("revoked_at", null)
      .maybeSingle<ActiveRoleAssignmentRecord>();

    if (occupiedResult.error) {
      throw new Error(occupiedResult.error.message);
    }

    if (
      occupiedResult.data?.id &&
      occupiedResult.data.staff_profile_id !== input.staffProfileId
    ) {
      throw new Error("Este cargo singleton ja possui um ocupante ativo. Utilize a transferencia segura.");
    }
  }

  const insertResult = await supabase
    .from("admin_staff_role_assignments")
    .insert({
      staff_profile_id: input.staffProfileId,
      role_id: input.roleId,
      assigned_by: input.actorUserId,
      reason: input.reason || null,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertResult.error || !insertResult.data) {
    throw new Error(
      insertResult.error?.message ||
        "Nao foi possivel atribuir o cargo administrativo.",
    );
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.team.role_assigned",
    targetType: "admin_staff_profile",
    targetId: input.staffProfileId,
    metadata: {
      roleId: input.roleId,
      roleCode: role.code,
      roleName: role.name,
      reason: input.reason || null,
    },
    riskLevel: role.is_singleton ? "critical" : "high",
  });

  return {
    assignmentId: insertResult.data.id,
    reused: false,
  };
}

export async function revokeAdminRoleAssignment(input: {
  actorUserId: number;
  assignmentId: string;
  reason?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const assignmentResult = await supabase
    .from("admin_staff_role_assignments")
    .select("id, staff_profile_id, role_id")
    .eq("id", input.assignmentId)
    .is("revoked_at", null)
    .maybeSingle<ActiveRoleAssignmentRecord>();

  if (assignmentResult.error) {
    throw new Error(assignmentResult.error.message);
  }

  if (!assignmentResult.data) {
    throw new Error("Atribuicao administrativa nao encontrada ou ja revogada.");
  }

  const role = await getRoleRecord(assignmentResult.data.role_id);
  const updateResult = await supabase
    .from("admin_staff_role_assignments")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: input.actorUserId,
      reason: input.reason || null,
    })
    .eq("id", input.assignmentId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.team.role_revoked",
    targetType: "admin_staff_profile",
    targetId: assignmentResult.data.staff_profile_id,
    metadata: {
      assignmentId: input.assignmentId,
      roleId: assignmentResult.data.role_id,
      roleCode: role.code,
      roleName: role.name,
      reason: input.reason || null,
    },
    riskLevel: role.is_singleton ? "critical" : "high",
  });
}

export async function updateAdminStaffStatus(input: {
  actorUserId: number;
  staffProfileId: string;
  status: StaffStatus;
  reason?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const staffProfile = await getStaffProfileRecord(input.staffProfileId);
  const nextDisabledAt =
    input.status === "disabled" || input.status === "suspended"
      ? new Date().toISOString()
      : null;

  const updateResult = await supabase
    .from("admin_staff_profiles")
    .update({
      status: input.status,
      disabled_at: nextDisabledAt,
    })
    .eq("id", input.staffProfileId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.team.status_updated",
    targetType: "admin_staff_profile",
    targetId: input.staffProfileId,
    metadata: {
      previousStatus: staffProfile.status,
      nextStatus: input.status,
      reason: input.reason || null,
    },
    riskLevel:
      input.status === "disabled" || input.status === "suspended"
        ? "high"
        : "medium",
  });
}

export async function updateAdminRoleDescription(input: {
  actorUserId: number;
  roleId: string;
  description: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const role = await getRoleRecord(input.roleId);

  const updateResult = await supabase
    .from("admin_roles")
    .update({
      description: input.description,
    })
    .eq("id", input.roleId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.roles.description_updated",
    targetType: "admin_role",
    targetId: input.roleId,
    metadata: {
      roleCode: role.code,
      roleName: role.name,
      description: input.description,
    },
    riskLevel: "medium",
  });
}

export async function updateAdminRolePermissions(input: {
  actorUserId: number;
  roleId: string;
  permissionCodes: string[];
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const role = await getRoleRecord(input.roleId);
  const normalizedPermissionCodes = Array.from(
    new Set(
      input.permissionCodes
        .map((permissionCode) => permissionCode.trim())
        .filter((permissionCode) => isAdminPermissionCode(permissionCode)),
    ),
  );

  if (normalizedPermissionCodes.length !== input.permissionCodes.length) {
    throw new Error("Uma ou mais permissoes informadas nao pertencem ao catalogo administrativo.");
  }

  const permissionsResult = await supabase
    .from("admin_permissions")
    .select("id, code")
    .in("code", normalizedPermissionCodes)
    .returns<Array<{ id: string; code: string }>>();

  if (permissionsResult.error) {
    throw new Error(permissionsResult.error.message);
  }

  if ((permissionsResult.data || []).length !== normalizedPermissionCodes.length) {
    throw new Error("Nao foi possivel resolver todas as permissoes informadas.");
  }

  const permissionIdByCode = new Map(
    (permissionsResult.data || []).map((permission) => [permission.code, permission.id]),
  );
  const currentRelationsResult = await supabase
    .from("admin_role_permissions")
    .select("id, permission_id")
    .eq("role_id", input.roleId)
    .returns<Array<{ id: string; permission_id: string }>>();

  if (currentRelationsResult.error) {
    throw new Error(currentRelationsResult.error.message);
  }

  const currentPermissionIds = new Set(
    (currentRelationsResult.data || []).map((relation) => relation.permission_id),
  );
  const nextPermissionIds = new Set(
    normalizedPermissionCodes.map((permissionCode) => permissionIdByCode.get(permissionCode) || ""),
  );

  const relationIdsToDelete = (currentRelationsResult.data || [])
    .filter((relation) => !nextPermissionIds.has(relation.permission_id))
    .map((relation) => relation.id);

  if (relationIdsToDelete.length) {
    const deleteResult = await supabase
      .from("admin_role_permissions")
      .delete()
      .in("id", relationIdsToDelete);

    if (deleteResult.error) {
      throw new Error(deleteResult.error.message);
    }
  }

  const missingRelations = normalizedPermissionCodes
    .map((permissionCode) => ({
      permissionCode,
      permissionId: permissionIdByCode.get(permissionCode) || "",
    }))
    .filter((relation) => relation.permissionId && !currentPermissionIds.has(relation.permissionId))
    .map((relation) => ({
      role_id: input.roleId,
      permission_id: relation.permissionId,
    }));

  if (missingRelations.length) {
    const insertResult = await supabase
      .from("admin_role_permissions")
      .insert(missingRelations);

    if (insertResult.error) {
      throw new Error(insertResult.error.message);
    }
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.roles.permissions_updated",
    targetType: "admin_role",
    targetId: input.roleId,
    metadata: {
      roleCode: role.code,
      roleName: role.name,
      permissionCodes: normalizedPermissionCodes,
      criticalPermissions: normalizedPermissionCodes.filter(
        (permissionCode) => getAdminPermissionDefinition(permissionCode)?.riskLevel === "critical",
      ),
    },
    riskLevel: "critical",
  });
}

export async function transferSingletonAdminRole(input: {
  actorUserId: number;
  roleId: string;
  toStaffProfileId: string;
  reason?: string | null;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const [role, targetProfile] = await Promise.all([
    getRoleRecord(input.roleId),
    getStaffProfileRecord(input.toStaffProfileId),
  ]);

  if (!role.is_singleton) {
    throw new Error("A transferencia segura so pode ser usada em cargos singleton.");
  }

  if (targetProfile.status !== "active" && targetProfile.status !== "pending") {
    throw new Error("O perfil de destino precisa estar ativo ou pendente para receber o cargo singleton.");
  }

  const currentAssignmentResult = await supabase
    .from("admin_staff_role_assignments")
    .select("id, staff_profile_id, role_id")
    .eq("role_id", input.roleId)
    .is("revoked_at", null)
    .maybeSingle<ActiveRoleAssignmentRecord>();

  if (currentAssignmentResult.error) {
    throw new Error(currentAssignmentResult.error.message);
  }

  if (currentAssignmentResult.data?.staff_profile_id === input.toStaffProfileId) {
    return {
      assignmentId: currentAssignmentResult.data.id,
      transferred: false,
    };
  }

  const existingTargetAssignment = await supabase
    .from("admin_staff_role_assignments")
    .select("id")
    .eq("staff_profile_id", input.toStaffProfileId)
    .eq("role_id", input.roleId)
    .is("revoked_at", null)
    .maybeSingle<{ id: string }>();

  if (existingTargetAssignment.error) {
    throw new Error(existingTargetAssignment.error.message);
  }

  if (existingTargetAssignment.data?.id) {
    return {
      assignmentId: existingTargetAssignment.data.id,
      transferred: false,
    };
  }

  if (currentAssignmentResult.data?.id) {
    const revokeResult = await supabase
      .from("admin_staff_role_assignments")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: input.actorUserId,
        reason: input.reason || "singleton_transfer",
      })
      .eq("id", currentAssignmentResult.data.id);

    if (revokeResult.error) {
      throw new Error(revokeResult.error.message);
    }
  }

  const insertResult = await supabase
    .from("admin_staff_role_assignments")
    .insert({
      staff_profile_id: input.toStaffProfileId,
      role_id: input.roleId,
      assigned_by: input.actorUserId,
      reason: input.reason || "singleton_transfer",
    })
    .select("id")
    .single<{ id: string }>();

  if (insertResult.error || !insertResult.data) {
    throw new Error(
      insertResult.error?.message ||
        "Nao foi possivel concluir a transferencia do cargo singleton.",
    );
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.team.singleton_role_transferred",
    targetType: "admin_role",
    targetId: input.roleId,
    metadata: {
      roleCode: role.code,
      roleName: role.name,
      toStaffProfileId: input.toStaffProfileId,
      previousAssignmentId: currentAssignmentResult.data?.id || null,
      reason: input.reason || null,
    },
    riskLevel: "critical",
  });

  return {
    assignmentId: insertResult.data.id,
    transferred: true,
  };
}

export async function updateAdminPermissionDescription(input: {
  actorUserId: number;
  permissionId: string;
  description: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const permissionResult = await supabase
    .from("admin_permissions")
    .select("id, code, risk_level")
    .eq("id", input.permissionId)
    .maybeSingle<{ id: string; code: string; risk_level: "low" | "medium" | "high" | "critical" }>();

  if (permissionResult.error) {
    throw new Error(permissionResult.error.message);
  }

  if (!permissionResult.data) {
    throw new Error("Permissao administrativa nao encontrada.");
  }

  const updateResult = await supabase
    .from("admin_permissions")
    .update({
      description: input.description,
    })
    .eq("id", input.permissionId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  await logAdminAction({
    actorUserId: input.actorUserId,
    action: "admin.permissions.description_updated",
    targetType: "admin_permission",
    targetId: input.permissionId,
    metadata: {
      permissionCode: permissionResult.data.code,
      description: input.description,
    },
    riskLevel: permissionResult.data.risk_level,
  });
}
