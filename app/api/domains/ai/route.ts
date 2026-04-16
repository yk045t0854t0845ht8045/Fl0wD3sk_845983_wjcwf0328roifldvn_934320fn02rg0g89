import { NextResponse } from "next/server";
import { generateDomainAiSuggestions } from "@/lib/domains/ai";
import {
  getJsonSecurityHeaders,
  normalizeAiPromptInput,
} from "@/lib/domains/requestGuard";
import { enforceFlowAiRateLimit } from "@/lib/flowai/infra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getClientIdentifier(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const candidate = forwardedFor.split(",")[0]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("user-agent")?.trim() ||
    "anonymous"
  );
}

function mapAiError(error: unknown) {
  if (error instanceof Error) {
    if (/OPENAI_API_KEY/i.test(error.message)) {
      return {
        status: 500,
        message: "A IA de dominios ainda nao foi configurada no servidor.",
      };
    }

    if (/429|rate limit/i.test(error.message)) {
      return {
        status: 429,
        message: "A IA de dominios esta ocupada agora. Tente novamente em instantes.",
      };
    }

    return {
      status: 500,
      message: error.message,
    };
  }

  return {
    status: 500,
    message: "Falha ao gerar sugestoes de dominio com IA.",
  };
}

export async function POST(req: Request) {
  const requestId = Math.random().toString(36).slice(2, 8);

  try {
    const rateLimit = await enforceFlowAiRateLimit({
      key: `domains-ai:${getClientIdentifier(req)}`,
      max: 12,
      windowMs: 1000 * 60,
    });

    if (!rateLimit.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: "A IA de dominios esta recebendo muitas requisicoes. Tente novamente em instantes.",
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
    const prompt = normalizeAiPromptInput(body?.prompt);
    const userId = String(body?.userId || "domain-ai").slice(0, 64);

    if (!prompt.trim()) {
      return NextResponse.json(
        { ok: false, message: "Informe o nome da empresa ou uma descricao do negocio." },
        { status: 400, headers: getJsonSecurityHeaders(requestId) },
      );
    }

    const response = await generateDomainAiSuggestions(prompt, userId);
    return NextResponse.json({
      ok: true,
      ...response,
    }, { headers: getJsonSecurityHeaders(requestId) });
  } catch (error) {
    const mapped = mapAiError(error);
    return NextResponse.json(
      {
        ok: false,
        message: mapped.message,
      },
      { status: mapped.status, headers: getJsonSecurityHeaders(requestId) },
    );
  }
}
