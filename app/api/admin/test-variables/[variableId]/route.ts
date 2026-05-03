import {
  adminError,
  adminJson,
  expectOptionalString,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";
import {
  deleteVariable,
  TEST_VARIABLE_SENSITIVITY_LEVELS,
  updateVariable,
} from "@/lib/test-variables/service";

function readOptionalBoolean(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Campo invalido: ${fieldName}`);
  }

  return value;
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ variableId: string }>;
  },
) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const access = await requireAdminApiPermission("test_variables.update");
    if (!access.ok) {
      return access.response;
    }

    const { variableId } = await context.params;
    const body = await readJsonObject(request);
    const sensitivityLevelRaw =
      typeof body.sensitivityLevel === "string"
        ? body.sensitivityLevel.trim()
        : undefined;

    if (
      sensitivityLevelRaw &&
      !TEST_VARIABLE_SENSITIVITY_LEVELS.includes(sensitivityLevelRaw as never)
    ) {
      throw new Error("Nivel de sensibilidade invalido.");
    }

    await updateVariable({
      actorUserId: access.profile.session.user.id,
      variableId,
      description:
        body.description === undefined
          ? undefined
          : expectOptionalString(body.description, "description", 400),
      value:
        body.value === undefined
          ? undefined
          : expectOptionalString(body.value, "value", 6_000),
      sensitivityLevel:
        sensitivityLevelRaw as
          | (typeof TEST_VARIABLE_SENSITIVITY_LEVELS)[number]
          | undefined,
      isActive: readOptionalBoolean(body.isActive, "isActive"),
      rotate: readOptionalBoolean(body.rotate, "rotate"),
    });

    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error, "Erro ao atualizar a Test Variable.");
  }
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ variableId: string }>;
  },
) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const access = await requireAdminApiPermission("test_variables.delete");
    if (!access.ok) {
      return access.response;
    }

    const { variableId } = await context.params;
    await deleteVariable({
      actorUserId: access.profile.session.user.id,
      variableId,
    });

    return adminJson({ ok: true });
  } catch (error) {
    return adminError(error, "Erro ao excluir a Test Variable.");
  }
}
