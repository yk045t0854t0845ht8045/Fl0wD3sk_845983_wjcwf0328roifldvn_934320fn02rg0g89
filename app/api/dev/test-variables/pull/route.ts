import { NextResponse } from "next/server";
import { flowSecureDto, parseFlowSecureDto } from "@/lib/security/flowSecure";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  pullAuthorizedTestVariables,
  TEST_VARIABLE_ENVIRONMENTS,
} from "@/lib/test-variables/service";
import { resolveDeveloperRequestContext } from "@/lib/test-variables/request";

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
        projectCode: flowSecureDto.string({
          minLength: 2,
          maxLength: 80,
          pattern: /^[a-z0-9][a-z0-9._-]*$/i,
          disallowAngleBrackets: true,
        }),
        environment: flowSecureDto.enum(TEST_VARIABLE_ENVIRONMENTS),
        requestedKeys: flowSecureDto.optional(
          flowSecureDto.array(
            flowSecureDto.string({
              minLength: 1,
              maxLength: 120,
              pattern: /^[A-Z0-9_]+$/i,
              disallowAngleBrackets: true,
            }),
            { maxLength: 300 },
          ),
        ),
      },
      { rejectUnknown: true },
    );

    const result = await pullAuthorizedTestVariables({
      authUserId: developer.authUserId,
      authTokenId: developer.authTokenId,
      projectCode: body.projectCode.toLowerCase(),
      environment: body.environment,
      requestedKeys: body.requestedKeys || undefined,
    });

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        projectCode: body.projectCode.toLowerCase(),
        environment: body.environment,
        deliveredKeys: result.deliveredKeys,
        values: result.values,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Nao foi possivel entregar as Test Variables autorizadas.",
          ),
        },
        { status: 403 },
      ),
    );
  }
}
