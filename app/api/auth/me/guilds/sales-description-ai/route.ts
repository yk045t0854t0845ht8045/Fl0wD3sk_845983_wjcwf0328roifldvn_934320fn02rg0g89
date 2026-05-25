import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  resolveSessionAccessToken,
} from "@/lib/auth/discordGuildAccess";
import { runFlowAiText } from "@/lib/flowai/service";
import {
  getEffectiveDashboardPermissions,
  type TeamRolePermission,
} from "@/lib/teams/userTeams";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  FlowSecureDtoError,
  flowSecureDto,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";

const DESCRIPTION_MAX_LENGTH = 1800;
const AI_DESCRIPTION_RATE_LIMIT_WINDOW_MS = 2 * 60_000;
const AI_DESCRIPTION_RATE_LIMIT_MAX_SIMILAR_TITLES = 2;

type AiDescriptionRateLimitEntry = {
  title: string;
  createdAt: number;
};

type AiDescriptionRateLimitBucket = {
  blockedUntil: number;
  entries: AiDescriptionRateLimitEntry[];
};

type AiDescriptionRateLimitStore = Map<string, AiDescriptionRateLimitBucket>;

const rateLimitGlobal = globalThis as typeof globalThis & {
  __flowdeskSalesDescriptionAiRateLimit?: AiDescriptionRateLimitStore;
};

const aiDescriptionRateLimitStore =
  rateLimitGlobal.__flowdeskSalesDescriptionAiRateLimit ||
  new Map<string, AiDescriptionRateLimitBucket>();

rateLimitGlobal.__flowdeskSalesDescriptionAiRateLimit = aiDescriptionRateLimitStore;

function getTrimmedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeKind(value: unknown) {
  return value === "category" ? "category" : "product";
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function normalizeRateLimitText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTokenSet(value: string) {
  return new Set(
    normalizeRateLimitText(value)
      .split(" ")
      .filter((token) => token.length >= 2),
  );
}

function areTitlesSimilar(left: string, right: string) {
  const first = normalizeRateLimitText(left);
  const second = normalizeRateLimitText(right);
  if (!first || !second) return false;
  if (first === second) return true;
  if (
    Math.min(first.length, second.length) >= 6 &&
    (first.includes(second) || second.includes(first))
  ) {
    return true;
  }

  const firstTokens = getTokenSet(first);
  const secondTokens = getTokenSet(second);
  if (!firstTokens.size || !secondTokens.size) return false;

  let intersection = 0;
  for (const token of firstTokens) {
    if (secondTokens.has(token)) intersection += 1;
  }

  const union = new Set([...firstTokens, ...secondTokens]).size;
  return union > 0 && intersection / union >= 0.75;
}

function normalizeRateLimitScopeId(value: unknown, title: string) {
  const provided = getTrimmedText(value, 140)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, "");
  if (provided.length >= 2) return provided;

  const normalizedTitle = normalizeRateLimitText(title)
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return `draft:${normalizedTitle || "untitled"}`;
}

function enforceSalesDescriptionAiRateLimit(input: {
  request: Request;
  guildId: string;
  kind: "product" | "category";
  scopeId: string;
  title: string;
}) {
  const now = Date.now();
  const clientIp = getClientIp(input.request);
  const key = [
    clientIp,
    input.guildId,
    input.kind,
    input.scopeId,
  ].join(":");
  const bucket = aiDescriptionRateLimitStore.get(key) || {
    blockedUntil: 0,
    entries: [],
  };

  if (bucket.blockedUntil > now) {
    return {
      ok: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)),
    };
  }

  bucket.entries = bucket.entries.filter(
    (entry) => now - entry.createdAt < AI_DESCRIPTION_RATE_LIMIT_WINDOW_MS,
  );

  const similarAttempts = bucket.entries.filter((entry) =>
    areTitlesSimilar(entry.title, input.title),
  );

  if (similarAttempts.length >= AI_DESCRIPTION_RATE_LIMIT_MAX_SIMILAR_TITLES) {
    bucket.blockedUntil = now + AI_DESCRIPTION_RATE_LIMIT_WINDOW_MS;
    aiDescriptionRateLimitStore.set(key, bucket);
    return {
      ok: false as const,
      retryAfterSeconds: Math.ceil(AI_DESCRIPTION_RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  bucket.entries.push({
    title: normalizeRateLimitText(input.title),
    createdAt: now,
  });
  bucket.blockedUntil = 0;
  aiDescriptionRateLimitStore.set(key, bucket);

  return {
    ok: true as const,
    remaining: Math.max(
      0,
      AI_DESCRIPTION_RATE_LIMIT_MAX_SIMILAR_TITLES - similarAttempts.length - 1,
    ),
  };
}

function buildFallbackDescription(input: {
  kind: "product" | "category";
  title: string;
}) {
  if (input.kind === "category") {
    return [
      `## ${input.title}`,
      "**Visao geral:** esta categoria reune opcoes selecionadas para facilitar a escolha e manter a compra organizada.",
      "**Como funciona:** confira os produtos disponiveis, leia os detalhes de cada item e finalize o pedido pelo carrinho quando estiver pronto.",
      "**Observacoes:** prazos, regras de entrega e disponibilidade podem variar por produto; revise as informacoes antes de confirmar.",
    ].join("\n\n");
  }

  return [
    `## ${input.title}`,
    "**O que voce recebe:** descreva aqui o item, acesso, beneficio ou conteudo entregue ao cliente.",
    "**Entrega e uso:** informe requisitos, prazo estimado, cuidados importantes e regras para ativacao ou recebimento.",
    "**Antes de comprar:** revise os detalhes, disponibilidade e quantidade desejada antes de adicionar ao carrinho.",
  ].join("\n\n");
}

async function ensureGuildAccess(
  guildId: string,
  requiredPermission: TeamRolePermission,
) {
  const sessionData = await resolveSessionAccessToken();
  if (!sessionData?.authSession) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Nao autenticado." },
        { status: 401 },
      ),
    };
  }

  if (!sessionData.accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Token OAuth ausente na sessao." },
        { status: 401 },
      ),
    };
  }

  const { permissions: dashboardPerms, isTeamServer } =
    await getEffectiveDashboardPermissions({
      authUserId: sessionData.authSession.user.id,
      guildId,
    });

  const accessibleGuild = await assertUserAdminInGuildOrNull(
    {
      authSession: sessionData.authSession,
      accessToken: sessionData.accessToken,
    },
    guildId,
  );

  const hasFullAccess = dashboardPerms === "full";
  const hasSpecificPerm =
    dashboardPerms instanceof Set && dashboardPerms.has(requiredPermission);
  const canManage =
    hasFullAccess || hasSpecificPerm || (!isTeamServer && accessibleGuild);

  if (!canManage) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Voce nao possui permissao para gerar descricoes." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    context: {
      authUserId: sessionData.authSession.user.id,
    },
  };
}

export async function POST(request: Request) {
  const invalidMutationResponse = ensureSameOriginJsonMutationRequest(request);
  if (invalidMutationResponse) {
    return applyNoStoreHeaders(invalidMutationResponse);
  }

  try {
    let body: {
      guildId: string;
      kind?: "product" | "category" | undefined;
      title: string;
      scopeId?: string | undefined;
      currentDescription?: string | undefined;
    };
    try {
      body = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.discordSnowflake(),
          kind: flowSecureDto.optional(
            flowSecureDto.enum(["product", "category"] as const),
          ),
          title: flowSecureDto.string({
            minLength: 2,
            maxLength: 120,
            normalizeWhitespace: true,
          }),
          scopeId: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: 140,
              pattern: /^[A-Za-z0-9:_ -]+$/,
              normalizeWhitespace: true,
              disallowAngleBrackets: true,
            }),
          ),
          currentDescription: flowSecureDto.optional(
            flowSecureDto.string({
              maxLength: DESCRIPTION_MAX_LENGTH,
              allowEmpty: true,
              disallowAngleBrackets: false,
            }),
          ),
        },
        { rejectUnknown: true },
      );
    } catch (error) {
      if (!(error instanceof FlowSecureDtoError)) {
        throw error;
      }

      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: error.issues[0] || error.message },
          { status: 400 },
        ),
      );
    }

    const guildId = body.guildId;
    const kind = normalizeKind(body.kind);
    const title = body.title;
    const scopeId = normalizeRateLimitScopeId(body.scopeId, title);
    const currentDescription = getTrimmedText(
      body.currentDescription,
      DESCRIPTION_MAX_LENGTH,
    );

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

    const rateLimit = enforceSalesDescriptionAiRateLimit({
      request,
      guildId,
      kind,
      scopeId,
      title,
    });
    if (!rateLimit.ok) {
      const response = NextResponse.json(
        {
          ok: false,
          message:
            "Muitas tentativas para esse item. Tente novamente mais tarde.",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      return applyNoStoreHeaders(response);
    }

    try {
      const result = await runFlowAiText({
        taskKey: "generic",
        userId: String(access.context.authUserId),
        temperature: 0.45,
        maxTokens: 380,
        timeoutMs: 14_000,
        messages: [
          {
            role: "system",
            content:
              "Voce escreve descricoes comerciais em portugues do Brasil para lojas Discord. Use markdown simples compativel com Discord: #, ##, ###, **negrito**, _italico_, listas e tabelas curtas quando ajudarem. Tom profissional, claro e sem exagero.",
          },
          {
            role: "user",
            content: [
              `Tipo: ${kind === "category" ? "categoria" : "produto"}`,
              `Titulo: ${title}`,
              currentDescription
                ? `Descricao atual para melhorar: ${currentDescription}`
                : "Nao ha descricao atual.",
              "Gere uma descricao pronta para uso em padrao consistente. Use um titulo ##, 2 ou 3 blocos curtos com rotulos em negrito, e lista se ficar mais claro. Inclua beneficios, regras/entrega e chamada discreta. Nao invente preco, estoque ou garantia especifica.",
            ].join("\n"),
          },
        ],
      });

      const description = result.content.trim().slice(0, DESCRIPTION_MAX_LENGTH);
      if (description) {
        return applyNoStoreHeaders(
          NextResponse.json({
            ok: true,
            description,
            generated: true,
          }),
        );
      }
    } catch {
      // Fallback keeps the editor useful when FlowAI is not configured locally.
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        description: buildFallbackDescription({ kind, title }),
        generated: false,
      }),
    );
  } catch (error) {
    return applyNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          message: sanitizeErrorMessage(error, "Falha ao gerar descricao com IA."),
        },
        { status: 500 },
      ),
    );
  }
}
