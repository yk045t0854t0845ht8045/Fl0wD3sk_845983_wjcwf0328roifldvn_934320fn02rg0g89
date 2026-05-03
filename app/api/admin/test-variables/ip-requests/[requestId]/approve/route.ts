import {
  adminError,
  adminJson,
  expectOptionalString,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";
import { approveDevIpRequest } from "@/lib/test-variables/service";

function readBoolean(value: unknown, fieldName: string) {
  if (typeof value !== "boolean") {
    throw new Error(`Campo invalido: ${fieldName}`);
  }

  return value;
}

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

    if (!access.profile.permissions.includes("test_variables.issue_flwip")) {
      return adminJson(
        {
          ok: false,
          message:
            "Permissao obrigatoria ausente: test_variables.issue_flwip",
        },
        403,
      );
    }

    const { requestId } = await context.params;
    const body = await readJsonObject(request);
    const expiresAt = expectOptionalString(body.expiresAt, "expiresAt", 40);
    if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) {
      throw new Error("Campo invalido: expiresAt");
    }

    const result = await approveDevIpRequest({
      actorUserId: access.profile.session.user.id,
      requestId,
      expiresAt,
      allowSensitive: readBoolean(body.allowSensitive, "allowSensitive"),
      allowCritical: readBoolean(body.allowCritical, "allowCritical"),
      reason: expectOptionalString(body.reason, "reason", 400),
    });

    return adminJson({ ok: true, ...result });
  } catch (error) {
    return adminError(error, "Erro ao aprovar a solicitacao de IP.");
  }
}
