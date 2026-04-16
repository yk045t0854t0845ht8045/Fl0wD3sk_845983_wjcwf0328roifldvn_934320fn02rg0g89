import { NextResponse } from "next/server";
import {
  getOpenProviderErrorMessage,
  OpenProviderRequestError,
} from "@/lib/openprovider/client";
import {
  checkLocalRateLimit,
  getJsonSecurityHeaders,
  normalizeDomainSearchInput,
} from "@/lib/domains/requestGuard";
import { streamSearchDomains } from "@/lib/openprovider/domains";
import { getUSDToBRLRate } from "@/lib/currency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapDomainError(error: unknown) {
  const fallback = {
    status: 500,
    message: "Falha interna ao consultar dominios.",
  };

  if (!(error instanceof OpenProviderRequestError)) {
    if (error instanceof Error && /timeout/i.test(error.message)) {
      return {
        status: 504,
        message: "A Openprovider demorou demais para responder. Tente novamente em instantes.",
      };
    }
    return fallback;
  }

  if (error.maintenance) {
    return {
      status: 503,
      message: "Nosso sistema de dominios está em manutenção no momento. Tente novamente mais tarde.",
    };
  }

  if (error.status === 429) {
    return {
      status: 429,
      message: "Muitas consultas simultaneas. Aguarde alguns segundos e tente novamente.",
    };
  }

  const msg = getOpenProviderErrorMessage(error);
  if (/Authentication\/Authorization Failed/i.test(msg)) {
    return {
      status: 502,
      message: "Falha na autenticacao com o provedor de dominios.",
    };
  }

  return {
    status: error.status || 500,
    message: msg,
  };
}

export async function POST(req: Request) {
  const requestId = Math.random().toString(36).slice(2, 8);
  console.log(`[Domains API][${requestId}] Request received (Stream mode)`);

  try {
    const rateLimit = checkLocalRateLimit(req, "domains-check", {
      max: 60,
      windowMs: 1000 * 60,
    });

    if (!rateLimit.ok) {
      return NextResponse.json(
        { ok: false, message: "Muitas consultas em pouco tempo. Aguarde alguns segundos." },
        {
          status: 429,
          headers: {
            ...getJsonSecurityHeaders(requestId),
            "Retry-After": String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))),
          },
        },
      );
    }

    const body = await req.json().catch(() => ({}));
    const domain = normalizeDomainSearchInput(body?.domain);

    if (!domain.trim() || domain.length < 2) {
      return NextResponse.json(
        { ok: false, message: "Informe um dominio de pelo menos 2 caracteres." },
        { status: 400, headers: getJsonSecurityHeaders(requestId) },
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const exchangeRate = await getUSDToBRLRate();
          
          await streamSearchDomains(domain, (chunk) => {
            const payload = JSON.stringify({
              ...chunk,
              exchangeRate,
              requestId,
              ok: true
            });
            controller.enqueue(encoder.encode(payload + "\n"));
          });

          controller.close();
        } catch (error) {
          console.error(`[Domains API][${requestId}] Stream error:`, error);
          const mapped = mapDomainError(error);
          controller.enqueue(encoder.encode(JSON.stringify({
            ok: false,
            message: mapped.message,
            isError: true
          }) + "\n"));
          controller.close();
        }
      },
      cancel() {
        console.log(`[Domains API][${requestId}] Stream aborted by client`);
      }
    });

    return new Response(stream, {
      headers: {
        ...getJsonSecurityHeaders(requestId),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });

  } catch (error) {
    const mapped = mapDomainError(error);
    return NextResponse.json(
      { ok: false, message: mapped.message },
      { status: mapped.status, headers: getJsonSecurityHeaders(requestId) },
    );
  }
}
