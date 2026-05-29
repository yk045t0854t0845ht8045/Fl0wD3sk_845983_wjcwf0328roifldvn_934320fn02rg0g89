import { NextResponse } from "next/server";
import { nameSiloClient } from "@/lib/namesilo/client";
import { getJsonSecurityHeaders } from "@/lib/domains/requestGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = Math.random().toString(36).slice(2, 8);
  console.log(`[Domains Health][${requestId}] Health check requested`);

  try {
    const circuitBreakerStatus = nameSiloClient.getCircuitBreakerStatus();

    const startTime = Date.now();
    await Promise.race([
      nameSiloClient.request(
        "checkRegisterAvailability",
        { domains: "example.com,test.org" },
        {
          maxRetries: 0,
          timeoutMs: 5000,
          requestId,
        },
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Health check timeout")), 5000),
      ),
    ]);
    const responseTime = Date.now() - startTime;

    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      responseTime,
      circuitBreaker: circuitBreakerStatus,
      apiConnectivity: "ok",
      provider: "namesilo",
      version: process.env.npm_package_version || "unknown",
    };

    console.log(`[Domains Health][${requestId}] Health check passed in ${responseTime}ms`);

    return NextResponse.json(health, {
      headers: getJsonSecurityHeaders(requestId),
    });
  } catch (error) {
    const circuitBreakerStatus = nameSiloClient.getCircuitBreakerStatus();

    const health = {
      status: circuitBreakerStatus.state === "open" ? "unhealthy" : "degraded",
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
      circuitBreaker: circuitBreakerStatus,
      apiConnectivity: "failed",
      provider: "namesilo",
      version: process.env.npm_package_version || "unknown",
    };

    console.error(`[Domains Health][${requestId}] Health check failed:`, error);

    return NextResponse.json(health, {
      status: 503,
      headers: getJsonSecurityHeaders(requestId),
    });
  }
}
