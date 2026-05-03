import { updateAdminRoleDescription } from "@/lib/admin/manage";
import {
  adminError,
  adminJson,
  expectOptionalString,
  expectUuid,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const access = await requireAdminApiPermission("roles.update");
    if (!access.ok) {
      return access.response;
    }

    const body = await readJsonObject(request);
    const { roleId } = await params;

    await updateAdminRoleDescription({
      actorUserId: access.profile.session.user.id,
      roleId: expectUuid(roleId, "roleId"),
      description: expectOptionalString(body.description, "description", 600),
    });

    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error, "Erro ao atualizar descricao do cargo.");
  }
}
