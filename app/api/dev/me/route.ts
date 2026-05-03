import { NextResponse } from "next/server";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  getDevEnvironmentSnapshot,
  listTestVariableProjects,
} from "@/lib/test-variables/service";
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

    const [snapshot, projects] = await Promise.all([
      getDevEnvironmentSnapshot(developer.authUserId),
      listTestVariableProjects(),
    ]);

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        user: {
          id: developer.authUserId,
          displayName: developer.displayName,
          email: developer.email,
          permissions: developer.permissions,
          authMethod: developer.authMethod,
        },
        projects: projects.filter((project) => project.isActive),
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
            "Nao foi possivel carregar o ambiente dev.",
          ),
        },
        { status: 500 },
      ),
    );
  }
}
