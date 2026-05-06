import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalUrlFromInternalPath,
  buildCanonicalWorkspaceUrl,
  detectCanonicalHostFromHostname,
  detectWorkspaceAreaFromRequestHost,
  getWorkspaceAreaInternalPath,
} from "../lib/routing/subdomains.ts";

function createRequestLike(url: string) {
  const parsedUrl = new URL(url);
  const headers = new Headers();
  headers.set("host", parsedUrl.host);
  headers.set("x-forwarded-proto", parsedUrl.protocol.replace(/:$/, ""));

  return {
    headers,
    url,
  };
}

test("admin production subdomain resolves to the admin workspace", () => {
  const request = createRequestLike("https://admin.flwdesk.com/support?tab=open");

  assert.equal(detectCanonicalHostFromHostname("admin.flwdesk.com"), "admin");
  assert.equal(detectWorkspaceAreaFromRequestHost(request), "admin");
  assert.equal(getWorkspaceAreaInternalPath("admin", "/support"), "/admin/support");
  assert.equal(
    buildCanonicalWorkspaceUrl(request, "admin", "/support", "?tab=open"),
    "https://admin.flwdesk.com/support?tab=open",
  );
});

test("admin local subdomain resolves to the admin workspace", () => {
  const request = createRequestLike("http://admin.localhost:3000/support");

  assert.equal(detectCanonicalHostFromHostname("admin.localhost"), "admin");
  assert.equal(detectWorkspaceAreaFromRequestHost(request), "admin");
  assert.equal(getWorkspaceAreaInternalPath("admin", "/support"), "/admin/support");
  assert.equal(
    buildCanonicalWorkspaceUrl(request, "admin", "/support"),
    "http://admin.localhost:3000/support",
  );
});

test("checkout next paths stay on the public host after account OAuth", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalPublicHost = process.env.APP_PUBLIC_HOST;
  process.env.NEXT_PUBLIC_APP_URL = "https://account.flwdesk.com";
  delete process.env.APP_PUBLIC_HOST;

  try {
    const request = createRequestLike(
      "https://account.flwdesk.com/api/auth/discord/callback",
    );

    assert.equal(
      buildCanonicalUrlFromInternalPath(
        request,
        "/checkout/discord/l5nggubbCBhD0MSIfJi2XJOjp85jjPG9tBX502vGm4E",
      ),
      "https://www.flwdesk.com/checkout/discord/l5nggubbCBhD0MSIfJi2XJOjp85jjPG9tBX502vGm4E",
    );
  } finally {
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }

    if (originalPublicHost === undefined) {
      delete process.env.APP_PUBLIC_HOST;
    } else {
      process.env.APP_PUBLIC_HOST = originalPublicHost;
    }
  }
});
