import { NextResponse } from "next/server";
import { flowSecureDto, parseFlowSecureDto } from "@/lib/security/flowSecure";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  createDevIpRequest,
  TEST_VARIABLE_ENVIRONMENTS,
} from "@/lib/test-variables/service";
import { resolveDeveloperRequestContext } from "@/lib/test-variables/request";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const developer = await resolveDeveloperRequestContext(request);
    if (!developer) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Acesso dev nao autorizado." },
          { status: 401 },
        ),
      );
    }

    const payload = await request.json().catch(() => null);
    const body = parseFlowSecureDto(
      payload,
      {
        projectId: flowSecureDto.string({
          pattern: UUID_PATTERN,
          minLength: 36,
          maxLength: 36,
          disallowAngleBrackets: true,
        }),
        environment: flowSecureDto.enum(TEST_VARIABLE_ENVIRONMENTS),
        deviceName: flowSecureDto.string({
          minLength: 2,
          maxLength: 120,
          normalizeWhitespace: true,
        }),
        reason: flowSecureDto.string({
          minLength: 4,
          maxLength: 280,
          normalizeWhitespace: true,
        }),
        notes: flowSecureDto.optional(
          flowSecureDto.nullable(
            flowSecureDto.string({
              maxLength: 500,
              normalizeWhitespace: true,
              allowEmpty: true,
            }),
          ),
        ),
        requestedExpiresAt: flowSecureDto.optional(
          flowSecureDto.nullable(
            flowSecureDto.string({
              maxLength: 40,
              allowEmpty: false,
              disallowAngleBrackets: true,
            }),
          ),
        ),
      },
      { rejectUnknown: true },
    );

    if (
      body.requestedExpiresAt &&
      Number.isNaN(Date.parse(body.requestedExpiresAt))
    ) {
      throw new Error("Data de expiracao solicitada invalida.");
    }

    const requestId = await createDevIpRequest({
      authUserId: developer.authUserId,
      projectId: body.projectId,
      environment: body.environment,
      deviceName: body.deviceName,
      reason: body.reason,
      notes: body.notes || null,
      requestedExpiresAt: body.requestedExpiresAt || null,
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        requestId,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Nao foi possivel registrar a solicitacao de IP.",
          ),
        },
        { status: 400 },
      ),
    );
  }
}
