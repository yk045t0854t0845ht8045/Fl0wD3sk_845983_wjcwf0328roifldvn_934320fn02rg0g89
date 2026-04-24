import { NextResponse } from "next/server";
import { openProviderClient } from "@/lib/openprovider/client";
import { getJsonSecurityHeaders } from "@/lib/domains/requestGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = Math.random().toString(36).slice(2, 8);
  console.log(`[Domains Health][${requestId}] Health check requested`);

  try {
    // Check circuit breaker status
    const circuitBreakerStatus = openProviderClient.getCircuitBreakerStatus();

    // Perform a simple domain check to test connectivity
    const testDomains = [
      { name: "example", extension: "com" },
      { name: "test", extension: "org" },
    ];

    const startTime = Date.now();
    await Promise.race([
      // Test request with short timeout
      openProviderClient.post("domains/check", {
        domains: testDomains,
        with_price: false,
      }, {
        maxRetries: 0, // No retries for health check
        requestId,
      }),
      // Timeout after 5 seconds
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Health check timeout")), 5000)
      ),
    ]);
    const responseTime = Date.now() - startTime;

    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      responseTime,
      circuitBreaker: circuitBreakerStatus,
      apiConnectivity: "ok",
      version: process.env.npm_package_version || "unknown",
    };

    console.log(`[Domains Health][${requestId}] Health check passed in ${responseTime}ms`);

    return NextResponse.json(health, {
      headers: getJsonSecurityHeaders(requestId),
    });

  } catch (error) {
    const circuitBreakerStatus = openProviderClient.getCircuitBreakerStatus();

    const health = {
      status: circuitBreakerStatus.state === 'open' ? "unhealthy" : "degraded",
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
      circuitBreaker: circuitBreakerStatus,
      apiConnectivity: "failed",
      version: process.env.npm_package_version || "unknown",
    };

    console.error(`[Domains Health][${requestId}] Health check failed:`, error);

    return NextResponse.json(health, {
      status: 503,
      headers: getJsonSecurityHeaders(requestId),
    });
  }
}
