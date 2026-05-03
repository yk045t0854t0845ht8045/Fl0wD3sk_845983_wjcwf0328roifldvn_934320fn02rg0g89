import { updateAdminPermissionDescription } from "@/lib/admin/manage";
import {
  adminError,
  adminJson,
  expectNonEmptyString,
  expectUuid,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ permissionId: string }> },
) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const access = await requireAdminApiPermission("permissions.update");
    if (!access.ok) {
      return access.response;
    }

    const body = await readJsonObject(request);
    const { permissionId } = await params;

    await updateAdminPermissionDescription({
      actorUserId: access.profile.session.user.id,
      permissionId: expectUuid(permissionId, "permissionId"),
      description: expectNonEmptyString(body.description, "description", 600),
    });

    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error, "Erro ao atualizar descricao da permissao.");
  }
}
