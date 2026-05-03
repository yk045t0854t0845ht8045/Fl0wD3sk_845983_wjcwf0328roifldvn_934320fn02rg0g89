import "server-only";

import { NextResponse } from "next/server";
import type { CurrentAdminProfile } from "@/lib/admin/auth";
import { getCurrentAdminProfile } from "@/lib/admin/auth";
import { touchAdminSession } from "@/lib/admin/audit";
import type { AdminPermissionCode } from "@/lib/admin/permissions";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";

export function adminJson(data: unknown, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(data, { status }));
}

export function adminError(
  error: unknown,
  fallbackMessage: string,
  status = 500,
) {
  return applyNoStoreHeaders(
    NextResponse.json(
      {
        ok: false,
        message: sanitizeErrorMessage(error, fallbackMessage),
      },
      { status },
    ),
  );
}

export function guardAdminJsonMutation(request: Request) {
  const originGuard = ensureSameOriginJsonMutationRequest(request);
  if (originGuard) {
    return applyNoStoreHeaders(originGuard);
  }

  return null;
}

export async function requireAdminApiPermission(
  permission: AdminPermissionCode,
): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; profile: CurrentAdminProfile }
> {
  const authSession = await getCurrentAuthSessionFromCookie();
  if (!authSession) {
    return {
      ok: false,
      response: adminJson(
        { ok: false, message: "Nao autenticado." },
        401,
      ),
    };
  }

  const profile = await getCurrentAdminProfile();
  if (!profile || !profile.permissions.includes("admin.access")) {
    return {
      ok: false,
      response: adminJson(
        { ok: false, message: "Acesso administrativo nao autorizado." },
        403,
      ),
    };
  }

  if (!profile.permissions.includes(permission)) {
    return {
      ok: false,
      response: adminJson(
        { ok: false, message: `Permissao obrigatoria ausente: ${permission}` },
        403,
      ),
    };
  }

  await touchAdminSession({
    authSessionId: profile.session.id,
    authUserId: profile.session.user.id,
    staffProfileId: profile.staffProfile.id,
  });

  return { ok: true, profile };
}

export async function readJsonObject(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Payload JSON invalido.");
  }

  return body as Record<string, unknown>;
}

export function expectUuid(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new Error(`Campo invalido: ${fieldName}`);
  }

  return value.trim();
}

export function expectNonEmptyString(
  value: unknown,
  fieldName: string,
  maxLength = 280,
) {
  if (typeof value !== "string") {
    throw new Error(`Campo invalido: ${fieldName}`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Campo invalido: ${fieldName}`);
  }

  return normalized;
}

export function expectOptionalString(
  value: unknown,
  fieldName: string,
  maxLength = 500,
) {
  if (value == null || value === "") {
    return null;
  }

  return expectNonEmptyString(value, fieldName, maxLength);
}

export function expectStringArray(
  value: unknown,
  fieldName: string,
  maxItems = 200,
) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`Campo invalido: ${fieldName}`);
  }

  return value.map((entry, index) =>
    expectNonEmptyString(entry, `${fieldName}[${index}]`, 120),
  );
}

export function expectEnumValue<TValue extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly TValue[],
) {
  if (typeof value !== "string") {
    throw new Error(`Campo invalido: ${fieldName}`);
  }

  const normalized = value.trim() as TValue;
  if (!allowedValues.includes(normalized)) {
    throw new Error(`Campo invalido: ${fieldName}`);
  }

  return normalized;
}
