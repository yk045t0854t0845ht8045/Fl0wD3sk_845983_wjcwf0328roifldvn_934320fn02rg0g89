import { NextResponse } from "next/server";
import {
  checkApiStatus,
  stabilizeStatusCheckResult,
} from "../../../../lib/status/monitors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = stabilizeStatusCheckResult("api", await checkApiStatus());
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 500,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("API status check failed:", error);

    return NextResponse.json(
      {
        ok: false,
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        status: "major_outage",
        message: "Falha critica ao verificar a API.",
        source: "api",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
