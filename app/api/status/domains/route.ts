import { NextResponse } from "next/server";
import {
  checkDomainsStatus,
  stabilizeStatusCheckResult,
} from "../../../../lib/status/monitors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = stabilizeStatusCheckResult("domains", await checkDomainsStatus());
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Domains status check failed:", error);

    return NextResponse.json(
      {
        ok: false,
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        status: "major_outage",
        message: "Falha critica ao verificar o provedor de dominios.",
        source: "domains",
        circuitBreaker: {
          state: "open",
          failures: 0,
          lastFailureTime: 0,
        },
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
