import { assignAdminRole } from "@/lib/admin/manage";
import {
  adminError,
  adminJson,
  expectOptionalString,
  expectUuid,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";

export async function POST(request: Request) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const access = await requireAdminApiPermission("team.assign_role");
    if (!access.ok) {
      return access.response;
    }

    const body = await readJsonObject(request);
    const result = await assignAdminRole({
      actorUserId: access.profile.session.user.id,
      staffProfileId: expectUuid(body.staffProfileId, "staffProfileId"),
      roleId: expectUuid(body.roleId, "roleId"),
      reason: expectOptionalString(body.reason, "reason", 280),
    });

    return adminJson({ ok: true, ...result });
  } catch (error) {
    return adminError(error, "Erro ao atribuir cargo administrativo.");
  }
}
