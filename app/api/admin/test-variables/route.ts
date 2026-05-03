import {
  adminError,
  adminJson,
  expectNonEmptyString,
  expectOptionalString,
  expectStringArray,
  expectUuid,
  guardAdminJsonMutation,
  readJsonObject,
  requireAdminApiPermission,
} from "@/lib/admin/api";
import {
  createGroup,
  createProject,
  createVariable,
  listAdminTestVariables,
  listTestVariableGroups,
  listTestVariableProjects,
  TEST_VARIABLE_ENVIRONMENTS,
  TEST_VARIABLE_SENSITIVITY_LEVELS,
} from "@/lib/test-variables/service";

export async function GET() {
  try {
    const access = await requireAdminApiPermission("test_variables.read");
    if (!access.ok) {
      return access.response;
    }

    const [projects, groups, variables] = await Promise.all([
      listTestVariableProjects(),
      listTestVariableGroups(),
      listAdminTestVariables(),
    ]);

    return adminJson({
      ok: true,
      projects,
      groups,
      variables,
    });
  } catch (error) {
    return adminError(error, "Erro ao carregar o modulo de Test Variables.");
  }
}

export async function POST(request: Request) {
  const originGuard = guardAdminJsonMutation(request);
  if (originGuard) {
    return originGuard;
  }

  try {
    const access = await requireAdminApiPermission("test_variables.create");
    if (!access.ok) {
      return access.response;
    }

    const body = await readJsonObject(request);
    const kind = expectNonEmptyString(body.kind, "kind", 20);

    if (kind === "project") {
      const allowedEnvironments = expectStringArray(
        body.allowedEnvironments,
        "allowedEnvironments",
        8,
      );

      const normalizedEnvironments = allowedEnvironments.map((environment) => {
        if (!TEST_VARIABLE_ENVIRONMENTS.includes(environment as never)) {
          throw new Error("Ambiente permitido invalido.");
        }
        return environment;
      });

      const projectId = await createProject({
        actorUserId: access.profile.session.user.id,
        code: expectNonEmptyString(body.code, "code", 80),
        name: expectNonEmptyString(body.name, "name", 120),
        description: expectOptionalString(body.description, "description", 400),
        allowedEnvironments:
          normalizedEnvironments as Array<
            (typeof TEST_VARIABLE_ENVIRONMENTS)[number]
          >,
      });

      return adminJson({ ok: true, projectId });
    }

    if (kind === "group") {
      const environment = expectNonEmptyString(body.environment, "environment", 20);
      if (!TEST_VARIABLE_ENVIRONMENTS.includes(environment as never)) {
        throw new Error("Ambiente do grupo invalido.");
      }

      const groupId = await createGroup({
        actorUserId: access.profile.session.user.id,
        projectId: expectUuid(body.projectId, "projectId"),
        environment: environment as (typeof TEST_VARIABLE_ENVIRONMENTS)[number],
        name: expectNonEmptyString(body.name, "name", 120),
        description: expectOptionalString(body.description, "description", 400),
      });

      return adminJson({ ok: true, groupId });
    }

    if (kind === "variable") {
      const sensitivityLevel = expectNonEmptyString(
        body.sensitivityLevel,
        "sensitivityLevel",
        20,
      );
      if (!TEST_VARIABLE_SENSITIVITY_LEVELS.includes(sensitivityLevel as never)) {
        throw new Error("Nivel de sensibilidade invalido.");
      }

      const variableId = await createVariable({
        actorUserId: access.profile.session.user.id,
        groupId: expectUuid(body.groupId, "groupId"),
        key: expectNonEmptyString(body.key, "key", 120),
        value: expectNonEmptyString(body.value, "value", 6_000),
        sensitivityLevel:
          sensitivityLevel as (typeof TEST_VARIABLE_SENSITIVITY_LEVELS)[number],
        description: expectOptionalString(body.description, "description", 400),
      });

      return adminJson({ ok: true, variableId });
    }

    throw new Error("Tipo de mutacao de Test Variables invalido.");
  } catch (error) {
    return adminError(error, "Erro ao criar registro de Test Variables.");
  }
}
