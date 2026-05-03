import { transferSingletonAdminRole } from "@/lib/admin/manage";
import {
  adminError,
  adminJson,
  expectOptionalString,
  expectUuid,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const access = await requireAdminApiPermission("team.transfer_singleton_role");
    if (!access.ok) {
      return access.response;
    }

    const body = await readJsonObject(request);
    const { roleId } = await params;

    const result = await transferSingletonAdminRole({
      actorUserId: access.profile.session.user.id,
      roleId: expectUuid(roleId, "roleId"),
      toStaffProfileId: expectUuid(body.toStaffProfileId, "toStaffProfileId"),
      reason: expectOptionalString(body.reason, "reason", 280),
    });

    return adminJson({ ok: true, ...result });
  } catch (error) {
    return adminError(error, "Erro ao transferir cargo singleton.");
  }
}
