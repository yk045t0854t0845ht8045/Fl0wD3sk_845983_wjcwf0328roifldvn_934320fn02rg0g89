import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import { runFlowAiText } from "@/lib/flowai/service";
import {
  fetchHostingGitHubRepositoryFile,
  readHostingGitHubToken,
} from "@/lib/hosting/github";
import {
  getHostingProjectForUser,
  normalizeVpsCode,
  readString,
} from "@/lib/hosting/vpsRuntime";
import { applyNoStoreHeaders } from "@/lib/security/http";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type RouteProps = {
  params: Promise<{ code: string }>;
};

const FLOW_CHAT_DAILY_TOKEN_LIMIT = 20_000;
const FLOW_CHAT_DAILY_REQUEST_LIMIT = 35;
const FLOW_CHAT_CONTEXT_MESSAGE_LIMIT = 10;
const FLOW_CHAT_FILE_PATH_PROMPT_LIMIT = 120;

function trimText(value: unknown, maxLength: number) {
  return readString(value)?.slice(0, maxLength) || "";
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnightIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function buildQuotaPayload(row?: { tokens_used?: number | null; request_count?: number | null; blocked_until?: string | null } | null) {
  const used = Math.max(0, Number(row?.tokens_used || 0));
  const requestCount = Math.max(0, Number(row?.request_count || 0));
  const resetAt = nextUtcMidnightIso();
  const rowBlockedUntil = row?.blocked_until || null;
  const blockedUntil = used >= FLOW_CHAT_DAILY_TOKEN_LIMIT || requestCount >= FLOW_CHAT_DAILY_REQUEST_LIMIT
    ? rowBlockedUntil || resetAt
    : rowBlockedUntil && Date.parse(rowBlockedUntil) > Date.now()
      ? rowBlockedUntil
      : null;
  return {
    used,
    limit: FLOW_CHAT_DAILY_TOKEN_LIMIT,
    requestCount,
    requestLimit: FLOW_CHAT_DAILY_REQUEST_LIMIT,
    remaining: Math.max(0, FLOW_CHAT_DAILY_TOKEN_LIMIT - used),
    resetAt,
    blockedUntil,
    blocked: Boolean(blockedUntil),
  };
}

async function readFlowQuota(userId: number) {
  try {
    const { data } = await getSupabaseAdminClientOrThrow()
      .from("hosting_vps_flow_ai_daily_usage")
      .select("tokens_used, request_count, blocked_until")
      .eq("user_id", userId)
      .eq("usage_date", todayUtc())
      .maybeSingle<{ tokens_used: number; request_count: number; blocked_until: string | null }>();
    return buildQuotaPayload(data);
  } catch {
    return buildQuotaPayload(null);
  }
}

async function reserveFlowQuota(input: { userId: number; estimatedTokens: number }) {
  const quota = await readFlowQuota(input.userId);
  if (quota.blocked || quota.remaining <= 0 || quota.requestCount >= quota.requestLimit) return { ok: false, quota };
  const reserveTokens = Math.min(Math.max(input.estimatedTokens, 1), quota.remaining);
  const nextUsed = quota.used + reserveTokens;
  const nextRequestCount = quota.requestCount + 1;
  const blockedUntil = nextUsed >= FLOW_CHAT_DAILY_TOKEN_LIMIT || nextRequestCount >= FLOW_CHAT_DAILY_REQUEST_LIMIT
    ? quota.resetAt
    : null;
  try {
    await getSupabaseAdminClientOrThrow()
      .from("hosting_vps_flow_ai_daily_usage")
      .upsert({
        user_id: input.userId,
        usage_date: todayUtc(),
        tokens_used: nextUsed,
        request_count: nextRequestCount,
        blocked_until: blockedUntil,
      }, { onConflict: "user_id,usage_date" });
  } catch {
    // If quota table has not been applied yet, keep the chat usable.
  }
  return {
    ok: true,
    quota: buildQuotaPayload({ tokens_used: nextUsed, request_count: nextRequestCount, blocked_until: blockedUntil }),
    reservedTokens: reserveTokens,
  };
}

async function finalizeFlowQuota(input: { userId: number; reservedTokens: number; actualTokens: number }) {
  const delta = Math.max(0, input.actualTokens - input.reservedTokens);
  if (!delta) return readFlowQuota(input.userId);
  const quota = await readFlowQuota(input.userId);
  const nextUsed = Math.min(FLOW_CHAT_DAILY_TOKEN_LIMIT, quota.used + delta);
  const blockedUntil = nextUsed >= FLOW_CHAT_DAILY_TOKEN_LIMIT ? quota.resetAt : quota.blockedUntil;
  try {
    await getSupabaseAdminClientOrThrow()
      .from("hosting_vps_flow_ai_daily_usage")
      .upsert({
        user_id: input.userId,
        usage_date: todayUtc(),
        tokens_used: nextUsed,
        request_count: quota.requestCount,
        blocked_until: blockedUntil,
      }, { onConflict: "user_id,usage_date" });
  } catch {
    // Best-effort while migration is pending.
  }
  return buildQuotaPayload({ tokens_used: nextUsed, request_count: quota.requestCount, blocked_until: blockedUntil });
}

function normalizeForSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function findMentionedFilePath(message: string, paths: string[]) {
  const normalizedMessage = normalizeForSearch(message);
  const filePaths = paths.filter((path) => path && /\.[A-Za-z0-9]+$/.test(path));
  const exact = filePaths.find((path) => normalizedMessage.includes(normalizeForSearch(path)));
  if (exact) return exact;
  const best = filePaths
    .map((path) => {
      const name = path.split("/").pop() || path;
      const normalizedName = normalizeForSearch(name);
      let score = 0;
      if (normalizedMessage.includes(normalizedName)) score += 100;
      for (const piece of normalizedName.split(/[-_.\s]+/).filter(Boolean)) {
        if (piece.length >= 3 && normalizedMessage.includes(piece)) score += 8;
      }
      return { path, score };
    })
    .sort((a, b) => b.score - a.score)[0];
  return best?.score ? best.path : null;
}

function fallbackResponse(input: {
  mentionedPath: string;
}) {
  return [
    "Estou em modo de orientacao: reviso, explico e sugiro codigo para voce copiar, sem alterar arquivos automaticamente.",
    input.mentionedPath
      ? `Arquivo citado: ${input.mentionedPath}. Posso revisar, explicar e montar blocos de codigo prontos para copiar.`
      : "Cite o nome/caminho do arquivo no chat para eu localizar e analisar com mais contexto.",
    "A resposta foi gerada pelo fallback seguro porque o provedor de IA nao respondeu agora.",
  ].join("\n\n");
}

async function loadProject(code: string) {
  const session = await getCurrentAuthSessionFromCookie();
  const vpsCode = normalizeVpsCode(code);
  if (!session || !vpsCode) return null;
  const project = await getHostingProjectForUser({ userId: session.user.id, vpsCode });
  return project ? { session, project } : null;
}

function buildChatTitle(message: string) {
  const cleaned = message.replace(/\s+/g, " ").trim();
  return (cleaned || "Novo chat").slice(0, 80);
}

async function ensureFlowChat(input: {
  chatId?: number | null;
  projectId: number;
  userId: number;
  message: string;
}) {
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    if (input.chatId) {
      const { data } = await supabase
        .from("hosting_vps_flow_chats")
        .select("id")
        .eq("id", input.chatId)
        .eq("hosting_project_id", input.projectId)
        .eq("user_id", input.userId)
        .maybeSingle<{ id: number }>();
      if (data?.id) return data.id;
    }

    const { data } = await supabase
      .from("hosting_vps_flow_chats")
      .insert({
        hosting_project_id: input.projectId,
        user_id: input.userId,
        title: buildChatTitle(input.message),
        model: "gpt-4o-mini",
      })
      .select("id")
      .single<{ id: number }>();
    return data?.id || null;
  } catch {
    return null;
  }
}

async function saveFlowMessage(input: {
  chatId: number | null;
  projectId: number;
  userId: number;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (!input.chatId) return;
  try {
    const supabase = getSupabaseAdminClientOrThrow();
    await supabase.from("hosting_vps_flow_chat_messages").insert({
      chat_id: input.chatId,
      hosting_project_id: input.projectId,
      user_id: input.userId,
      role: input.role,
      content: input.content,
      model: input.model || null,
      metadata: input.metadata || {},
    });
    await supabase
      .from("hosting_vps_flow_chats")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", input.chatId)
      .eq("hosting_project_id", input.projectId)
      .eq("user_id", input.userId);
  } catch {
    // History is best-effort so chat remains usable before SQL is applied.
  }
}

async function loadRecentMessages(input: {
  chatId?: number | null;
  projectId: number;
  userId: number;
}) {
  if (!input.chatId) return [];
  try {
    const { data } = await getSupabaseAdminClientOrThrow()
      .from("hosting_vps_flow_chat_messages")
      .select("role, content, model, created_at")
      .eq("chat_id", input.chatId)
      .eq("hosting_project_id", input.projectId)
      .eq("user_id", input.userId)
      .order("created_at", { ascending: false })
      .limit(FLOW_CHAT_CONTEXT_MESSAGE_LIMIT);
    return (data || []).reverse() as Array<{
      role: "user" | "assistant";
      content: string;
      model?: string | null;
      created_at?: string | null;
    }>;
  } catch {
    return [];
  }
}

export async function GET(_request: NextRequest, { params }: RouteProps) {
  try {
    const { code } = await params;
    const loaded = await loadProject(code);
    if (!loaded) {
      return applyNoStoreHeaders(NextResponse.json({ ok: false, message: "Nao autorizado." }, { status: 401 }));
    }
    const quota = await readFlowQuota(loaded.session.user.id);

    const chatId = Number(_request.nextUrl.searchParams.get("chatId") || "");
    const supabase = getSupabaseAdminClientOrThrow();
    const { data: chats } = await supabase
      .from("hosting_vps_flow_chats")
      .select("id, title, model, created_at, updated_at")
      .eq("hosting_project_id", loaded.project.id)
      .eq("user_id", loaded.session.user.id)
      .order("updated_at", { ascending: false })
      .limit(30);

    let messages: Array<Record<string, unknown>> = [];
    if (Number.isFinite(chatId) && chatId > 0) {
      const { data } = await supabase
        .from("hosting_vps_flow_chat_messages")
        .select("id, role, content, model, created_at")
        .eq("chat_id", chatId)
        .eq("hosting_project_id", loaded.project.id)
        .eq("user_id", loaded.session.user.id)
        .order("created_at", { ascending: true })
        .limit(80);
      messages = data || [];
    }

    return applyNoStoreHeaders(NextResponse.json({ ok: true, chats: chats || [], messages, quota }));
  } catch {
    return applyNoStoreHeaders(NextResponse.json({ ok: true, chats: [], messages: [], quota: buildQuotaPayload(null) }));
  }
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  try {
    const { code } = await params;
    const loaded = await loadProject(code);
    if (!loaded) {
      return applyNoStoreHeaders(NextResponse.json({ ok: false, message: "Nao autorizado." }, { status: 401 }));
    }
    const { session, project } = loaded;

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const message = trimText(body.message, 6000);
    if (!message) {
      return applyNoStoreHeaders(NextResponse.json({ ok: false, message: "Mensagem vazia." }, { status: 400 }));
    }

    const chatIdFromBody = typeof body.chatId === "number" && Number.isFinite(body.chatId)
      ? body.chatId
      : typeof body.chatId === "string" && /^\d+$/.test(body.chatId)
        ? Number(body.chatId)
        : null;
    const repository = trimText(body.repository, 260) || `${project.github_owner}/${project.github_repo}`;
    const branch = trimText(body.branch, 120) || project.github_branch || "main";
    const runtime = trimText(body.runtime, 120) || project.windows_runtime || "windows";
    const fileTreePaths = Array.isArray(body.fileTreePaths)
      ? body.fileTreePaths
        .map((item) => trimText(item, 500))
        .filter(Boolean)
        .slice(0, 2000)
      : [];
    const mentionedPath = findMentionedFilePath(message, fileTreePaths);
    const promptFilePaths = mentionedPath
      ? [mentionedPath]
      : fileTreePaths.slice(0, FLOW_CHAT_FILE_PATH_PROMPT_LIMIT);
    let mentionedFileContent = "";
    if (mentionedPath) {
      try {
        const token = await readHostingGitHubToken(session.user.id);
        if (token) {
          const file = await fetchHostingGitHubRepositoryFile({
            token,
            owner: project.github_owner,
            repo: project.github_repo,
            branch,
            path: mentionedPath,
          });
          mentionedFileContent = trimText(file?.content, 18_000);
        }
      } catch {
        mentionedFileContent = "";
      }
    }
    const attachments = Array.isArray(body.attachments)
      ? body.attachments
        .map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .slice(0, 6)
        .map((item) => `${trimText(item.name, 160) || "imagem"} (${trimText(item.type, 80) || "image"})`)
      : [];
    const chatId = await ensureFlowChat({
      chatId: chatIdFromBody,
      projectId: project.id,
      userId: session.user.id,
      message,
    });
    const recentMessages = await loadRecentMessages({
      chatId,
      projectId: project.id,
      userId: session.user.id,
    });
    await saveFlowMessage({
      chatId,
      projectId: project.id,
      userId: session.user.id,
      role: "user",
      content: message,
      metadata: {
        mentionedPath,
        attachments,
      },
    });

    const promptUserContent = [
      `Repositorio: ${repository}`,
      `Branch: ${branch}`,
      `Runtime: ${runtime}`,
      "Modo: assistente de leitura e sugestao. Sem alteracoes automaticas.",
      promptFilePaths.length
        ? `Arquivos ${mentionedPath ? "relevantes" : "conhecidos (amostra economica)"} do projeto:\n${promptFilePaths.join("\n")}`
        : "Lista de arquivos ainda nao carregada.",
      mentionedPath ? `Arquivo citado/localizado pelo pedido: ${mentionedPath}` : "",
      attachments.length ? `Imagens anexadas pelo usuario: ${attachments.join(", ")}` : "",
      mentionedFileContent ? `Conteudo do arquivo citado (${mentionedPath}):\n\`\`\`\n${mentionedFileContent}\n\`\`\`` : "",
      `Pedido do usuario:\n${message}`,
    ].filter(Boolean).join("\n\n");
    const estimatedPromptTokens = estimateTokens([
      message,
      promptUserContent,
      recentMessages.map((item) => item.content).join("\n"),
    ].join("\n\n")) + 900;
    const quotaReservation = await reserveFlowQuota({
      userId: session.user.id,
      estimatedTokens: estimatedPromptTokens,
    });
    if (!quotaReservation.ok) {
      return applyNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            code: "FLOW_AI_DAILY_LIMIT",
            message: "Voce atingiu o limite diario do Flow para esta VPS.",
            quota: quotaReservation.quota,
          },
          { status: 429 },
        ),
      );
    }

    try {
      const result = await runFlowAiText({
        taskKey: "generic",
        userId: String(session.user.id),
        preferredModel: "gpt-4o-mini",
        temperature: 0.22,
        maxTokens: Math.max(400, Math.min(1600, (quotaReservation.quota.remaining || 1600) - 200)),
        timeoutMs: 18_000,
        messages: [
          {
            role: "system",
            content: [
              "Voce e o Flow, assistente de codigo dentro do painel VPS da Flowdesk.",
              "Responda em portugues do Brasil, com foco tecnico, direto e profissional.",
              "Va direto ao ponto. Se o usuario pedir para melhorar algo, entregue a melhoria/codigo primeiro e explique pouco depois.",
              "Use apenas o contexto recebido. Nao invente arquivos, segredos, logs ou execucoes.",
              "Voce NAO altera arquivos, NAO deleta, NAO salva e NAO executa comandos. Apenas orienta o usuario e fornece trechos para copiar.",
              "Quando o usuario pedir para gerar, melhorar, corrigir, criar ou refatorar codigo, voce DEVE entregar uma proposta concreta com codigo em blocos fenced markdown. Nao responda apenas pedindo mais detalhes se ja houver contexto suficiente.",
              "Pedidos como 'gera ai', 'me da o codigo', 'faz melhorado', 'corrige isso' ou similares exigem resposta com codigo pronto, explicacao curta e onde aplicar.",
              "Ao sugerir codigo, use blocos fenced markdown com a linguagem correta, por exemplo ```tsx. Inclua tambem caminho do arquivo quando fizer sentido.",
              "Nunca coloque codigo longo solto em texto normal; todo codigo com mais de uma linha deve ficar dentro de ```linguagem para o front-end renderizar como card copiavel.",
              "Nao use automaticamente o arquivo aberto/clicado no editor como contexto. Considere apenas arquivos que o usuario citar no chat ou conteudos enviados explicitamente na mensagem.",
              "Se o usuario citar um arquivo pelo nome, use a lista de arquivos para localizar o caminho mais provavel. Se tiver conteudo localizado, gere a alteracao com base nele.",
              "Se nao houver conteudo do arquivo mas houver nome/caminho, gere um exemplo aplicavel e diga onde copiar. Evite responder pedindo mais detalhes antes de oferecer uma primeira solucao.",
              "Leia somente o historico recente recebido para manter contexto e continuidade.",
              "Nunca revele secrets, tokens, variaveis sensiveis ou conteudos que aparentem credenciais.",
            ].join(" "),
          },
          ...recentMessages.map((item) => ({
            role: item.role,
            content: item.content,
          })),
          {
            role: "user",
            content: promptUserContent,
          },
        ],
      });
      const answer = result.content.trim();
      const quota = await finalizeFlowQuota({
        userId: session.user.id,
        reservedTokens: quotaReservation.reservedTokens || estimatedPromptTokens,
        actualTokens: estimateTokens(promptUserContent) + estimateTokens(answer) + estimateTokens(recentMessages.map((item) => item.content).join("\n")),
      });
      await saveFlowMessage({
        chatId,
        projectId: project.id,
        userId: session.user.id,
        role: "assistant",
        content: answer,
        model: "gpt-4o-mini",
        metadata: {
          generated: true,
          mentionedPath,
        },
      });

      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          message: answer,
          model: "gpt-4o-mini",
          generated: true,
          chatId,
          quota,
        }),
      );
    } catch {
      const answer = fallbackResponse({ mentionedPath: mentionedPath || "" });
      const quota = await finalizeFlowQuota({
        userId: session.user.id,
        reservedTokens: quotaReservation.reservedTokens || estimatedPromptTokens,
        actualTokens: Math.max(estimateTokens(message) + estimateTokens(answer), 1),
      });
      await saveFlowMessage({
        chatId,
        projectId: project.id,
        userId: session.user.id,
        role: "assistant",
        content: answer,
        model: "local-fallback",
        metadata: { generated: false },
      });
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          message: answer,
          model: "local-fallback",
          generated: false,
          chatId,
          quota,
        }),
      );
    }
  } catch {
    return applyNoStoreHeaders(
      NextResponse.json(
        { ok: false, message: "Falha ao conversar com o Flow." },
        { status: 500 },
      ),
    );
  }
}
