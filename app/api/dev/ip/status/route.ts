import { NextResponse } from "next/server";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import { getDevEnvironmentSnapshot } from "@/lib/test-variables/service";
import { resolveDeveloperRequestContext } from "@/lib/test-variables/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

    const snapshot = await getDevEnvironmentSnapshot(developer.authUserId);
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        snapshot,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(
            error,
            "Nao foi possivel validar o IP atual.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
