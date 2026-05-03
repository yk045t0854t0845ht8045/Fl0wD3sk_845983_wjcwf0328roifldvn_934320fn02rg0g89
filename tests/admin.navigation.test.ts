import assert from "node:assert/strict";
import test from "node:test";

type NavigationModule = {
  ADMIN_NAV_SECTIONS: Array<{
    items: Array<{
      href: string;
      status: "active" | "planned";
    }>;
  }>;
};

async function importNavigationModule() {
  const importedModule = (await import("../lib/admin/navigation.ts")) as {
    default?: NavigationModule;
  };

  return (importedModule.default ?? importedModule) as NavigationModule;
}

test("admin navigation exposes the implemented operational routes as active", async () => {
  const navigationModule = await importNavigationModule();
  const items = navigationModule.ADMIN_NAV_SECTIONS.flatMap((section) => section.items);
  const hrefs = new Set(items.map((item) => item.href));

  for (const href of [
    "/admin",
    "/admin/team",
    "/admin/roles",
    "/admin/permissions",
    "/admin/audit",
    "/admin/users",
    "/admin/servers",
    "/admin/domains",
    "/admin/hosting",
    "/admin/payments",
    "/admin/billing",
    "/admin/support",
    "/admin/status",
    "/admin/security",
    "/admin/flowai",
    "/admin/test-variables",
    "/admin/settings",
  ]) {
    assert.ok(hrefs.has(href), `expected admin navigation to expose ${href}`);
  }

  const plannedItems = items.filter((item) => item.status === "planned");
  assert.equal(plannedItems.length, 0);
});
