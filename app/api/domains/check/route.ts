import { NextResponse } from "next/server";
import {
  getOpenProviderErrorDetails,
  getOpenProviderErrorMessage,
  OpenProviderRequestError,
  openProviderClient,
} from "@/lib/openprovider/client";
import {
  checkLocalRateLimit,
  getJsonSecurityHeaders,
  normalizeDomainSearchInput,
} from "@/lib/domains/requestGuard";
import { searchDomains } from "@/lib/openprovider/domains";
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

  if (/Configuracao incompleta/i.test(error.message)) {
    return {
      status: 500,
      message: "As variaveis da Openprovider nao foram configuradas corretamente no servidor.",
    };
  }

  if (/Authentication\/Authorization Failed/i.test(error.message)) {
    return {
      status: 502,
      message:
        "A Openprovider recusou a autenticacao. Revise usuario, senha, permissao de API e whitelist de IP da conta.",
    };
  }

  if (error.status === 401) {
    return {
      status: 502,
      message: "A Openprovider recusou o token da requisicao. Revise a configuracao de autenticacao.",
    };
  }

  if (error.status === 429) {
    return {
      status: 429,
      message: "Muitas consultas simultaneas. Aguarde alguns segundos e tente novamente.",
    };
  }

  if (error.status === 503) {
    return {
      status: 503,
      message: "Servico temporariamente indisponivel. Tente novamente em alguns minutos.",
    };
  }

  if (error.status === 504 || /timeout/i.test(error.message)) {
    return {
      status: 504,
      message: "A Openprovider demorou demais para responder. Tente novamente em instantes.",
    };
  }

  return {
    status: error.status || 500,
    message: getOpenProviderErrorMessage(error),
  };
}

export async function POST(req: Request) {
  const requestId = Math.random().toString(36).slice(2, 8);
  console.log(`[Domains API][${requestId}] Request received`);

  try {
    const rateLimit = checkLocalRateLimit(req, "domains-check", {
      max: 50,
      windowMs: 1000 * 60,
    });

    if (!rateLimit.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: "Muitas consultas em pouco tempo. Aguarde alguns segundos e tente novamente.",
        },
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

    if (!domain.trim()) {
      return NextResponse.json(
        {
          ok: false,
          message: "Informe um dominio ou nome base para consulta.",
        },
        { status: 400, headers: getJsonSecurityHeaders(requestId) },
      );
    }

    if (domain.length < 2) {
      return NextResponse.json(
        {
          ok: false,
          message: "Use pelo menos 2 caracteres para consultar dominios.",
        },
        { status: 400, headers: getJsonSecurityHeaders(requestId) },
      );
    }

    const [response, exchangeRate] = await Promise.all([
      searchDomains(domain),
      getUSDToBRLRate()
    ]);

    console.log(
      `[Domains API][${requestId}] Checked ${response.baseName} across ${response.searchedTlds.join(", ")} | Rate: ${exchangeRate}`,
    );

    return NextResponse.json({
      ok: true,
      query: response.query,
      exactDomain: response.exactDomain,
      searchedTlds: response.searchedTlds,
      results: response.results,
      exchangeRate,
    }, { headers: getJsonSecurityHeaders(requestId) });
  } catch (error) {
    const mapped = mapDomainError(error);
    const details = getOpenProviderErrorDetails(error);
    const circuitBreakerStatus = openProviderClient.getCircuitBreakerStatus();

    console.error(`[Domains API][${requestId}] ${mapped.message}`, {
      error: details || error,
      circuitBreaker: circuitBreakerStatus,
      retryCount: error instanceof OpenProviderRequestError ? error.retryCount : undefined,
    });

    return NextResponse.json(
      {
        ok: false,
        message: mapped.message,
        provider: "openprovider",
        code: error instanceof OpenProviderRequestError ? error.code : undefined,
        retryCount: error instanceof OpenProviderRequestError ? error.retryCount : undefined,
        circuitBreakerState: circuitBreakerStatus.state,
      },
      { status: mapped.status, headers: getJsonSecurityHeaders(requestId) },
    );
  }
}
