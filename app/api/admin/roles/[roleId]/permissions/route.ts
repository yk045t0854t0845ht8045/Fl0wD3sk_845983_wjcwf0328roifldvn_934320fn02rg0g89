import { updateAdminRolePermissions } from "@/lib/admin/manage";
import {
  adminError,
  adminJson,
  expectStringArray,
  expectUuid,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const access = await requireAdminApiPermission("roles.assign_permissions");
    if (!access.ok) {
      return access.response;
    }

    const body = await readJsonObject(request);
    const { roleId } = await params;

    await updateAdminRolePermissions({
      actorUserId: access.profile.session.user.id,
      roleId: expectUuid(roleId, "roleId"),
      permissionCodes: expectStringArray(body.permissionCodes, "permissionCodes", 200),
    });

    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error, "Erro ao atualizar permission set do cargo.");
  }
}
