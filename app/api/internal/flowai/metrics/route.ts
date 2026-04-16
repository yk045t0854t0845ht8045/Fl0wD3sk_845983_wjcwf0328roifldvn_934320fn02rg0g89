import { NextResponse } from "next/server";
import { hasFlowAiInternalTokenAuth } from "@/lib/flowai/internalAuth";
import { buildFlowAiPrometheusMetrics } from "@/lib/flowai/prometheus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasFlowAiInternalTokenAuth(request)) {
    return new NextResponse("unauthorized\n", { status: 401 });
  }

  try {
    const body = await buildFlowAiPrometheusMetrics();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new NextResponse(
      `${error instanceof Error ? error.message : "metrics_error"}\n`,
      {
        status: 500,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
