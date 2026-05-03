import {
  adminError,
  adminJson,
  expectOptionalString,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";
import { rejectDevIpRequest } from "@/lib/test-variables/service";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ requestId: string }>;
  },
) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const access = await requireAdminApiPermission("test_variables.approve_ip");
    if (!access.ok) {
      return access.response;
    }

    const { requestId } = await context.params;
    const body = await readJsonObject(request);

    await rejectDevIpRequest({
      actorUserId: access.profile.session.user.id,
      requestId,
      reason: expectOptionalString(body.reason, "reason", 400),
    });

    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error, "Erro ao rejeitar a solicitacao de IP.");
  }
}
