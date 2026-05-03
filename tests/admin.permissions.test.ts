import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_PERMISSION_DEFINITIONS,
  ALL_ADMIN_PERMISSION_CODES,
  getAdminPermissionDefinition,
} from "../lib/admin/permissions.ts";

test("admin permission catalog contains required codes without duplicates", () => {
  const codes = ADMIN_PERMISSION_DEFINITIONS.map((permission) => permission.code);
  assert.equal(new Set(codes).size, codes.length);

  for (const requiredCode of [
    "admin.access",
    "team.transfer_singleton_role",
    "payments.read",
    "status.resolve_incident",
    "test_variables.issue_flwip",
    "test_variables.revoke_flwip",
    "audit.export",
    "settings.update",
  ] as const) {
    assert.ok(
      codes.includes(requiredCode),
      `expected permission ${requiredCode} to exist in the catalog`,
    );
  }

  assert.ok(ALL_ADMIN_PERMISSION_CODES.includes("test_variables.read_sensitive"));
});

test("critical FLWIP permissions are flagged under the correct module", () => {
  const issueFlwip = getAdminPermissionDefinition("test_variables.issue_flwip");
  const approveIp = getAdminPermissionDefinition("test_variables.approve_ip");
  const revokeFlwip = getAdminPermissionDefinition("test_variables.revoke_flwip");

  assert.ok(issueFlwip);
  assert.ok(approveIp);
  assert.ok(revokeFlwip);

  assert.equal(issueFlwip?.module, "test_variables");
  assert.equal(approveIp?.module, "test_variables");
  assert.equal(revokeFlwip?.module, "test_variables");

  assert.equal(issueFlwip?.riskLevel, "critical");
  assert.equal(approveIp?.riskLevel, "critical");
  assert.equal(revokeFlwip?.riskLevel, "critical");
});
