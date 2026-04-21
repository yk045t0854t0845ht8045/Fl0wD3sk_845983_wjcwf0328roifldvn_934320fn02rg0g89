import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  handleFlowSecurePolishRequest,
  isFlowSecureImagePolishError,
} from "@/lib/security/imagePolish";
import { applyStandardSecurityHeaders } from "@/lib/security/http";

export const runtime = "nodejs";

function buildErrorResponse(
  message: string,
  requestId: string,
  status = 400,
  method: "GET" | "HEAD" = "GET",
) {
  const payload = {
    ok: false,
    code: "flowsecure_image_polish_error",
    message,
  };
  const response =
    method === "HEAD"
      ? new NextResponse(null, { status })
      : NextResponse.json(
    {
      ...payload,
    },
    { status },
  );

  applyStandardSecurityHeaders(response, {
    requestId,
    noIndex: true,
  });
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const requestId =
    request.headers.get("x-request-id")?.trim() || crypto.randomUUID();

  try {
    return await handleFlowSecurePolishRequest({
      url: request.nextUrl,
      headers: request.headers,
      requestId,
      method: "GET",
    });
  } catch (error) {
    const status = isFlowSecureImagePolishError(error) ? error.status : 400;
    return buildErrorResponse(
      error instanceof Error ? error.message : "Falha ao otimizar a imagem.",
      requestId,
      status,
      "GET",
    );
  }
}

export async function HEAD(request: NextRequest) {
  const requestId =
    request.headers.get("x-request-id")?.trim() || crypto.randomUUID();

  try {
    return await handleFlowSecurePolishRequest({
      url: request.nextUrl,
      headers: request.headers,
      requestId,
      method: "HEAD",
    });
  } catch (error) {
    const status = isFlowSecureImagePolishError(error) ? error.status : 400;
    return buildErrorResponse(
      error instanceof Error ? error.message : "Falha ao verificar a imagem.",
      requestId,
      status,
      "HEAD",
    );
  }
}
