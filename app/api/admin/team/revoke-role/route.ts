import { revokeAdminRoleAssignment } from "@/lib/admin/manage";
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
    await revokeAdminRoleAssignment({
      actorUserId: access.profile.session.user.id,
      assignmentId: expectUuid(body.assignmentId, "assignmentId"),
      reason: expectOptionalString(body.reason, "reason", 280),
    });

    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error, "Erro ao revogar atribuicao administrativa.");
  }
}
