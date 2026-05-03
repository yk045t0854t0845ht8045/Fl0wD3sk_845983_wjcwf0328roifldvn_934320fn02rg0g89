import {
  adminError,
  adminJson,
  expectOptionalString,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";
import { revokeDevCertificate } from "@/lib/test-variables/service";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ certificateId: string }>;
  },
) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const access = await requireAdminApiPermission("test_variables.revoke_flwip");
    if (!access.ok) {
      return access.response;
    }

    const { certificateId } = await context.params;
    const body = await readJsonObject(request);

    await revokeDevCertificate({
      actorUserId: access.profile.session.user.id,
      certificateId,
      reason: expectOptionalString(body.reason, "reason", 400),
    });

    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error, "Erro ao revogar o certificado FLWIP.");
  }
}
