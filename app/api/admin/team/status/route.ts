import { updateAdminStaffStatus } from "@/lib/admin/manage";
import {
  adminError,
  adminJson,
  expectEnumValue,
  expectOptionalString,
  expectUuid,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";

const STAFF_STATUSES = ["active", "pending", "disabled", "suspended"] as const;

export async function POST(request: Request) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const body = await readJsonObject(request);
    const nextStatus = expectEnumValue(body.status, "status", STAFF_STATUSES);
    const requiredPermission =
      nextStatus === "disabled" || nextStatus === "suspended"
        ? "team.disable"
        : "team.update";
    const access = await requireAdminApiPermission(requiredPermission);
    if (!access.ok) {
      return access.response;
    }

    await updateAdminStaffStatus({
      actorUserId: access.profile.session.user.id,
      staffProfileId: expectUuid(body.staffProfileId, "staffProfileId"),
      status: nextStatus,
      reason: expectOptionalString(body.reason, "reason", 280),
    });

    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error, "Erro ao atualizar status do perfil administrativo.");
  }
}
