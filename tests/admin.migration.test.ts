import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("admin SQL migration provisions the required governance and FLWIP tables", async () => {
  const migrationPath = path.join(
    process.cwd(),
    "sql",
    "admin",
    "001_admin_panel.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  for (const tableName of [
    "admin_staff_profiles",
    "admin_roles",
    "admin_permissions",
    "admin_role_permissions",
    "admin_staff_role_assignments",
    "admin_audit_logs",
    "dev_ip_requests",
    "dev_ip_allowlist",
    "dev_certificates",
    "test_variable_projects",
    "test_variable_groups",
    "test_variables",
    "test_variable_access_grants",
    "test_variable_read_logs",
  ]) {
    assert.match(
      sql,
      new RegExp(`create table if not exists public\\.${tableName}`, "i"),
      `expected migration to create ${tableName}`,
    );
  }

  assert.match(
    sql,
    /check \(environment in \('test', 'staging', 'sandbox'\)\)/i,
  );
  assert.match(sql, /sensitivity_level text not null/i);
  assert.match(sql, /encrypted_value text not null/i);
});

test("developer login token migration adds the encrypted delivery column", async () => {
  const migrationPath = path.join(
    process.cwd(),
    "sql",
    "admin",
    "003_dev_auth_login_tokens.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");
  assert.match(sql, /completed_token_encrypted text/i);
});
