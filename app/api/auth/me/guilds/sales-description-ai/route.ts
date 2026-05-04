import { NextResponse } from "next/server";
import {
  assertUserAdminInGuildOrNull,
  isGuildId,
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

const DESCRIPTION_MAX_LENGTH = 1800;

function getTrimmedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeKind(value: unknown) {
  return value === "category" ? "category" : "product";
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
    const rawBody =
      (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const guildId = getTrimmedText(rawBody.guildId, 25);
    const kind = normalizeKind(rawBody.kind);
    const title = getTrimmedText(rawBody.title, 120);
    const currentDescription = getTrimmedText(
      rawBody.currentDescription,
      DESCRIPTION_MAX_LENGTH,
    );

    if (!isGuildId(guildId)) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Guild ID invalido." },
          { status: 400 },
        ),
      );
    }

    if (title.length < 2) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, message: "Informe um titulo antes de usar IA." },
          { status: 400 },
        ),
      );
    }

    const access = await ensureGuildAccess(guildId, "server_manage_tickets_overview");
    if (!access.ok) return applyNoStoreHeaders(access.response);

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
