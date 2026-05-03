import assert from "node:assert/strict";
import test from "node:test";
import { ALL_ADMIN_PERMISSION_CODES } from "../lib/admin/permissions.ts";

type RolesModule = {
  ADMIN_ROLE_DEFINITIONS: Array<{
    code: string;
    isSingleton: boolean;
    initialPermissions: string[];
  }>;
};

async function importRolesModule() {
  const importedModule = (await import("../lib/admin/roles.ts")) as {
    default?: RolesModule;
  };

  return (importedModule.default ?? importedModule) as RolesModule;
}

test("singleton leadership roles are unique and explicitly defined", async () => {
  const rolesModule = await importRolesModule();
  const roleCodes = rolesModule.ADMIN_ROLE_DEFINITIONS.map((role) => role.code);
  assert.equal(new Set(roleCodes).size, roleCodes.length);

  const singletonCodes = rolesModule.ADMIN_ROLE_DEFINITIONS
    .filter((role) => role.isSingleton)
    .map((role) => role.code)
    .sort();

  assert.deepEqual(singletonCodes, ["ceo", "cfo", "coo", "cto"]);
});

test("ceo receives the full catalog while lower roles stay constrained", async () => {
  const rolesModule = await importRolesModule();
  const ceo = rolesModule.ADMIN_ROLE_DEFINITIONS.find((role) => role.code === "ceo");
  const juniorDeveloper = rolesModule.ADMIN_ROLE_DEFINITIONS.find(
    (role) => role.code === "developer_junior",
  );
  const securitySpecialist = rolesModule.ADMIN_ROLE_DEFINITIONS.find(
    (role) => role.code === "security_specialist",
  );

  assert.ok(ceo);
  assert.ok(juniorDeveloper);
  assert.ok(securitySpecialist);

  assert.deepEqual(
    new Set(ceo?.initialPermissions || []),
    new Set(ALL_ADMIN_PERMISSION_CODES),
  );

  assert.ok(
    juniorDeveloper?.initialPermissions.includes("test_variables.request_access"),
  );
  assert.ok(
    !juniorDeveloper?.initialPermissions.includes("test_variables.read_sensitive"),
  );
  assert.ok(
    securitySpecialist?.initialPermissions.includes("test_variables.read_sensitive"),
  );
});
