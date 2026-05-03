import "server-only";

import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { resolveDeveloperAccessToken } from "@/lib/test-variables/auth";
import { resolveDeveloperIdentityForAuthUser } from "@/lib/test-variables/service";

export type DeveloperRequestContext = {
  authUserId: number;
  authTokenId: string | null;
  displayName: string;
  email: string | null;
  permissions: string[];
  authMethod: "session" | "token";
};

function hasDeveloperEnvironmentPermission(permissions: string[]) {
  return (
    permissions.includes("test_variables.request_access") ||
    permissions.includes("test_variables.read") ||
    permissions.includes("admin.access")
  );
}

export function extractDeveloperBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    return token || null;
  }

  const customHeader = request.headers.get("x-flowdesk-dev-token")?.trim();
  return customHeader || null;
}

export async function resolveDeveloperRequestContext(request: Request) {
  const accessToken = extractDeveloperBearerToken(request);
  if (accessToken) {
    const developerToken = await resolveDeveloperAccessToken(accessToken);
    if (!developerToken || !hasDeveloperEnvironmentPermission(developerToken.permissions)) {
      return null;
    }

    return {
      authUserId: developerToken.authUserId,
      authTokenId: developerToken.tokenId,
      displayName: developerToken.displayName,
      email: developerToken.email,
      permissions: developerToken.permissions,
      authMethod: "token",
    } satisfies DeveloperRequestContext;
  }

  const session = await getCurrentAuthSessionFromCookie();
  if (!session) {
    return null;
  }

  const developerIdentity = await resolveDeveloperIdentityForAuthUser(
    session.user.id,
  );
  if (!developerIdentity || !hasDeveloperEnvironmentPermission(developerIdentity.permissions)) {
    return null;
  }

  return {
    authUserId: session.user.id,
    authTokenId: null,
    displayName: session.user.display_name,
    email: session.user.email,
    permissions: developerIdentity.permissions,
    authMethod: "session",
  } satisfies DeveloperRequestContext;
}
