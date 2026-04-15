import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { openProviderClient } from "@/lib/openprovider/client";
import type { StatusCheckResult, SystemStatus } from "./types";
import { getWorstSystemStatus } from "./types";

export type ApiStatusResponse = StatusCheckResult;

export type ScheduledTasksStatusResponse = StatusCheckResult & {
  stats: {
    pendingTasks: number;
    overdueTasks: number;
    processingTasks: number;
    completedToday: number;
  };
};

export type FlowAiStatusResponse = {
  ok: boolean;
  checkedAt: string;
  overall: {
    status: SystemStatus;
    latencyMs: number | null;
    message: string | null;
  };
  upstream: {
    openai: {
      status: SystemStatus;
      latencyMs: number | null;
      message: string | null;
      baseUrl: string;
    };
  };
  integrations: {
    domainSuggestions: {
      status: SystemStatus;
      message: string | null;
      latencyMs: number | null;
    };
    ticketAi: {
      status: SystemStatus;
      message: string | null;
      latencyMs: number | null;
    };
    discordMessageAi: {
      status: SystemStatus;
      message: string | null;
      latencyMs: number | null;
    };
  };
};

export type DomainsStatusResponse = StatusCheckResult & {
  circuitBreaker: {
    state: "closed" | "open" | "half-open";
    failures: number;
    lastFailureTime: number;
  };
};

export type DiscordBotStatusResponse = StatusCheckResult & {
  ready: boolean;
  wsStatus: number | null;
  guildCount: number | null;
  uptimeMs: number | null;
  url: string | null;
};

const OPENAI_MAX_ATTEMPTS = 2;
const OPENAI_BASE_TIMEOUT_MS = 8500;
const OPENAI_DEFAULT_URL = "https://api.openai.com/v1";

type StatusStabilityMemory = {
  lastRawStatus: SystemStatus;
  failureStreak: number;
};

const statusStabilityMemory = new Map<string, StatusStabilityMemory>();

function softenStatus(status: SystemStatus) {
  if (status === "major_outage") return "partial_outage" as const;
  if (status === "partial_outage") return "degraded_performance" as const;
  return status;
}

function isImmediateEscalation(
  status: SystemStatus,
  message: string | null,
  latencyMs: number | null,
) {
  if (status !== "major_outage") {
    return false;
  }

  if (typeof latencyMs === "number" && latencyMs >= 15_000) {
    return true;
  }

  return /invalid|credenc|nao configurada|forbidden|unauthorized|401|403|tabela .*nao encontrada/i.test(
    message || "",
  );
}

function stabilizeSystemStatus(
  sourceKey: string,
  status: SystemStatus,
  message: string | null,
  latencyMs: number | null,
) {
  if (status === "operational") {
    statusStabilityMemory.set(sourceKey, {
      lastRawStatus: status,
      failureStreak: 0,
    });
    return status;
  }

  const previous = statusStabilityMemory.get(sourceKey);
  const failureStreak =
    previous?.lastRawStatus === status ? previous.failureStreak + 1 : 1;

  statusStabilityMemory.set(sourceKey, {
    lastRawStatus: status,
    failureStreak,
  });

  if (status === "degraded_performance" || isImmediateEscalation(status, message, latencyMs)) {
    return status;
  }

  if (failureStreak < 2) {
    return softenStatus(status);
  }

  return status;
}

export function stabilizeStatusCheckResult<
  T extends { status: SystemStatus; message: string | null; latencyMs: number | null },
>(sourceKey: string, payload: T): T {
  return {
    ...payload,
    status: stabilizeSystemStatus(
      sourceKey,
      payload.status,
      payload.message,
      payload.latencyMs,
    ),
  };
}

export function stabilizeFlowAiStatusResponse(payload: FlowAiStatusResponse) {
  const overall = stabilizeStatusCheckResult("flowai", {
    status: payload.overall.status,
    message: payload.overall.message,
    latencyMs: payload.overall.latencyMs,
  });

  return {
    ...payload,
    overall: {
      ...payload.overall,
      ...overall,
    },
  };
}

function mapStatusFromHttp(status: number) {
  if (status >= 200 && status < 300) return "operational" as const;
  if (status === 429) return "degraded_performance" as const;
  if (status === 401 || status === 403) return "major_outage" as const;
  if (status >= 500 && status < 600) return "partial_outage" as const;
  return "partial_outage" as const;
}

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

function getOpenAiBaseUrl() {
  return (process.env.OPENAI_BASE_URL?.trim() || OPENAI_DEFAULT_URL).replace(
    /\/$/,
    "",
  );
}

function emptyTaskStats() {
  return {
    pendingTasks: 0,
    overdueTasks: 0,
    processingTasks: 0,
    completedToday: 0,
  };
}

function resolveDiscordBotHealthUrl() {
  const explicitUrl =
    process.env.DISCORD_BOT_STATUS_URL?.trim() ||
    process.env.DISCORD_BOT_HEALTH_URL?.trim() ||
    process.env.BOT_HEALTH_URL?.trim() ||
    "";

  if (explicitUrl) {
    return explicitUrl;
  }

  const port = process.env.BOT_HEALTH_PORT?.trim() || "3210";
  const host = process.env.BOT_HEALTH_HOST?.trim() || "127.0.0.1";
  return `http://${host}:${port}/health`;
}

function resolveDiscordBotHealthToken() {
  return (
    process.env.DISCORD_BOT_HEALTH_TOKEN?.trim() ||
    process.env.BOT_HEALTH_TOKEN?.trim() ||
    ""
  );
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenAi(path: string, options: RequestInit, timeoutMs: number) {
  const baseUrl = getOpenAiBaseUrl();
  const url = `${baseUrl}${path}`;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) {
        return res;
      }

      lastError = new Error(`OpenAI ${res.status} ${res.statusText}`);
      await delay(attempt * 400);
    } catch (error) {
      lastError = error;

      if (
        error instanceof Error &&
        !(error instanceof DOMException && error.name === "AbortError") &&
        !/network|failed/i.test(error.message)
      ) {
        throw error;
      }

      await delay(attempt * 400);
    }
  }

  throw lastError;
}

async function checkOpenAiUpstream(): Promise<FlowAiStatusResponse["upstream"]["openai"]> {
  const apiKey = getOpenAiApiKey();
  const baseUrl = getOpenAiBaseUrl();

  if (!apiKey) {
    return {
      status: "major_outage",
      latencyMs: null,
      message: "OPENAI_API_KEY nao configurada no servidor.",
      baseUrl,
    };
  }

  const startedAt = Date.now();

  try {
    const res = await fetchOpenAi(
      "/models",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
      8000,
    );

    const latencyMs = Date.now() - startedAt;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = text.trim().slice(0, 200) || `HTTP ${res.status}`;

      return {
        status: mapStatusFromHttp(res.status),
        latencyMs,
        message:
          res.status === 401 || res.status === 403
            ? "Credenciais da OpenAI invalidas."
            : `Falha ao consultar a OpenAI: ${detail}`,
        baseUrl,
      };
    }

    return {
      status: "operational",
      latencyMs,
      message: null,
      baseUrl,
    };
  } catch (error) {
    return {
      status: "partial_outage",
      latencyMs: Date.now() - startedAt,
      message:
        error instanceof Error
          ? `Falha de conexao com a OpenAI: ${error.message}`
          : "Falha de conexao com a OpenAI.",
      baseUrl,
    };
  }
}

function pickOpenAiModels() {
  const explicitModel = process.env.OPENAI_MODEL?.trim();
  const fallbacks =
    process.env.OPENAI_MODEL_FALLBACKS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) || [];

  return [explicitModel, ...fallbacks, "gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"].filter(
    Boolean,
  );
}

async function checkOpenAiCompletion(
  kind: "domains" | "tickets" | "discord",
): Promise<FlowAiStatusResponse["upstream"]["openai"]> {
  const apiKey = getOpenAiApiKey();
  const baseUrl = getOpenAiBaseUrl();

  if (!apiKey) {
    return {
      status: "major_outage",
      latencyMs: null,
      message: "OPENAI_API_KEY nao configurada no servidor.",
      baseUrl,
    };
  }

  const prompts: Record<typeof kind, string> = {
    domains:
      "Gere 1 nome curto de dominio para uma empresa ficticia chamada Flowdesk. Responda em ate 2 palavras.",
    tickets: "Resuma em 8 palavras: Cliente sem acesso ao painel do Discord.",
    discord:
      "Gere uma mensagem curta e educada, em uma frase, para responder uma duvida no Discord.",
  };

  const models = pickOpenAiModels();
  let lastStatus: SystemStatus = "major_outage";
  let lastLatency: number | null = null;
  let lastMessage: string | null = null;

  for (const model of models) {
    const startedAt = Date.now();

    try {
      const res = await fetchOpenAi(
        "/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "Responda de forma objetiva." },
              { role: "user", content: prompts[kind] },
            ],
            max_tokens: 16,
            temperature: 0,
          }),
        },
        OPENAI_BASE_TIMEOUT_MS,
      );

      const latencyMs = Date.now() - startedAt;
      lastLatency = latencyMs;
      lastStatus = mapStatusFromHttp(res.status);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastMessage = text.trim().slice(0, 220) || `HTTP ${res.status}`;

        if ([400, 404, 422].includes(res.status)) {
          continue;
        }

        break;
      }

      await res.json().catch(() => null);

      return {
        status: "operational",
        latencyMs,
        message: null,
        baseUrl,
      };
    } catch (error) {
      lastLatency = Date.now() - startedAt;
      lastStatus = "partial_outage";
      lastMessage =
        error instanceof DOMException && error.name === "AbortError"
          ? "Timeout ao consultar completions da OpenAI."
          : error instanceof Error
            ? error.message
            : "Falha desconhecida ao consultar completions da OpenAI.";
    }
  }

  return {
    status: lastStatus,
    latencyMs: lastLatency,
    message: lastMessage,
    baseUrl,
  };
}

export async function checkFlowAiStatus(): Promise<FlowAiStatusResponse> {
  const checkedAt = new Date().toISOString();

  const [openai, domains, tickets, discord] = await Promise.all([
    checkOpenAiUpstream(),
    checkOpenAiCompletion("domains"),
    checkOpenAiCompletion("tickets"),
    checkOpenAiCompletion("discord"),
  ]);

  const overallStatus = getWorstSystemStatus([
    openai.status,
    domains.status,
    tickets.status,
    discord.status,
  ]);

  const overallLatencyCandidates = [
    openai.latencyMs,
    domains.latencyMs,
    tickets.latencyMs,
    discord.latencyMs,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    ok: true,
    checkedAt,
    overall: {
      status: overallStatus,
      latencyMs: overallLatencyCandidates.length
        ? Math.max(...overallLatencyCandidates)
        : null,
      message:
        overallStatus === "operational"
          ? null
          : openai.message ||
            domains.message ||
            tickets.message ||
            discord.message ||
            "Instabilidade detectada no Flow AI.",
    },
    upstream: {
      openai,
    },
    integrations: {
      domainSuggestions: {
        status: domains.status,
        latencyMs: domains.latencyMs,
        message:
          domains.status === "operational"
            ? null
            : domains.message || "Sugestao de dominios com IA instavel.",
      },
      ticketAi: {
        status: tickets.status,
        latencyMs: tickets.latencyMs,
        message:
          tickets.status === "operational"
            ? null
            : tickets.message || "IA de tickets instavel.",
      },
      discordMessageAi: {
        status: discord.status,
        latencyMs: discord.latencyMs,
        message:
          discord.status === "operational"
            ? null
            : discord.message || "IA de respostas no Discord instavel.",
      },
    },
  };
}

export async function checkApiStatus(): Promise<ApiStatusResponse> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const supabase = getSupabaseAdminClientOrThrow();

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts += 1;

    try {
      const { error, count } = await supabase
        .from("system_components")
        .select("id", { count: "exact", head: true });

      const latencyMs = Date.now() - startedAt;

      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") {
          return {
            ok: false,
            checkedAt,
            latencyMs,
            status: "major_outage",
            message: "Tabela system_components nao encontrada no banco.",
            source: "api",
          };
        }

        if (["08003", "08006", "57P03"].includes(error.code || "")) {
          if (attempts < maxAttempts) {
            await delay(700);
            continue;
          }

          return {
            ok: false,
            checkedAt,
            latencyMs,
            status: "major_outage",
            message: "Falha de conexao com o banco de dados da API.",
            source: "api",
          };
        }

        if (attempts < maxAttempts) {
          await delay(700);
          continue;
        }

        return {
          ok: false,
          checkedAt,
          latencyMs,
          status: "degraded_performance",
          message: `Erro no banco da API: ${error.message.slice(0, 150)}`,
          source: "api",
        };
      }

      let status: SystemStatus = "operational";
      let message: string | null = null;

      if (latencyMs > 10000) {
        status = "major_outage";
        message = `Latencia critica da API: ${latencyMs}ms.`;
      } else if (latencyMs > 5000) {
        status = "partial_outage";
        message = `Latencia elevada da API: ${latencyMs}ms.`;
      } else if (latencyMs > 2000) {
        status = "degraded_performance";
        message = `Performance degradada da API: ${latencyMs}ms.`;
      }

      if (count === null || count === undefined) {
        status = getWorstSystemStatus([status, "degraded_performance"]);
        message = message
          ? `${message} Contagem de componentes indisponivel.`
          : "Contagem de componentes indisponivel.";
      }

      return {
        ok: true,
        checkedAt,
        latencyMs,
        status,
        message,
        source: "api",
      };
    } catch (error) {
      if (attempts < maxAttempts) {
        await delay(700);
        continue;
      }

      return {
        ok: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        status: "major_outage",
        message:
          error instanceof Error
            ? `Falha critica na API: ${error.message.slice(0, 150)}`
            : "Falha critica na API.",
        source: "api",
      };
    }
  }

  return {
    ok: false,
    checkedAt,
    latencyMs: Date.now() - startedAt,
    status: "major_outage",
    message: "Falha critica ao verificar a API.",
    source: "api",
  };
}

export async function checkScheduledTasksStatus(): Promise<ScheduledTasksStatusResponse> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const supabase = getSupabaseAdminClientOrThrow();

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts += 1;

    try {
      const [scheduledTasksCheck, plansCheck] = await Promise.allSettled([
        supabase.from("scheduled_tasks").select("id", { count: "exact", head: true }),
        supabase.from("user_plans").select("id", { count: "exact", head: true }),
      ]);

      const hasScheduledTasksTable =
        scheduledTasksCheck.status === "fulfilled" && !scheduledTasksCheck.value.error;
      const hasPlansTable =
        plansCheck.status === "fulfilled" && !plansCheck.value.error;

      if (!hasScheduledTasksTable && !hasPlansTable) {
        return {
          ok: true,
          checkedAt,
          latencyMs: Date.now() - startedAt,
          status: "operational",
          message: "Sistema de tarefas agendadas ainda nao foi habilitado.",
          stats: emptyTaskStats(),
          source: "scheduled_tasks",
        };
      }

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const stats = emptyTaskStats();
      let queryErrors = 0;

      if (hasScheduledTasksTable) {
        const [pendingResult, overdueResult, processingResult, completedResult] =
          await Promise.allSettled([
            supabase
              .from("scheduled_tasks")
              .select("id", { count: "exact", head: true })
              .eq("status", "pending")
              .gt("scheduled_at", now.toISOString()),
            supabase
              .from("scheduled_tasks")
              .select("id", { count: "exact", head: true })
              .eq("status", "pending")
              .lt("scheduled_at", now.toISOString()),
            supabase
              .from("scheduled_tasks")
              .select("id", { count: "exact", head: true })
              .eq("status", "processing"),
            supabase
              .from("scheduled_tasks")
              .select("id", { count: "exact", head: true })
              .eq("status", "completed")
              .gte("completed_at", today.toISOString()),
          ]);

        const results = [
          { result: pendingResult, key: "pendingTasks" as const },
          { result: overdueResult, key: "overdueTasks" as const },
          { result: processingResult, key: "processingTasks" as const },
          { result: completedResult, key: "completedToday" as const },
        ];

        for (const entry of results) {
          if (entry.result.status === "fulfilled") {
            const { count, error } = entry.result.value;
            if (!error && typeof count === "number") {
              stats[entry.key] = count;
            } else {
              queryErrors += 1;
            }
          } else {
            queryErrors += 1;
          }
        }
      }

      let expiredPlans = 0;
      let planQueryErrors = 0;

      if (hasPlansTable) {
        try {
          const { count, error } = await supabase
            .from("user_plans")
            .select("id", { count: "exact", head: true })
            .eq("status", "active")
            .not("expires_at", "is", null)
            .lt("expires_at", now.toISOString());

          if (error) {
            planQueryErrors += 1;
          } else if (typeof count === "number") {
            expiredPlans = count;
          }
        } catch {
          planQueryErrors += 1;
        }
      }

      const latencyMs = Date.now() - startedAt;
      let status: SystemStatus = "operational";
      let message: string | null = null;

      if (stats.overdueTasks > 25) {
        status = "major_outage";
        message = `${stats.overdueTasks} tarefas em atraso critico.`;
      } else if (stats.overdueTasks > 0) {
        status = "partial_outage";
        message = `${stats.overdueTasks} tarefas estao atrasadas.`;
      } else if (stats.processingTasks > 20) {
        status = "partial_outage";
        message = `${stats.processingTasks} tarefas em processamento simultaneo.`;
      } else if (stats.processingTasks > 10 || expiredPlans > 0) {
        status = "degraded_performance";
        message =
          stats.processingTasks > 10
            ? `${stats.processingTasks} tarefas em processamento simultaneo.`
            : `${expiredPlans} planos expirados aguardam tratamento.`;
      } else if (queryErrors > 0 || planQueryErrors > 0) {
        status = "degraded_performance";
        message = "Monitoramento parcial das tarefas agendadas.";
      } else if (latencyMs > 5000) {
        status = "partial_outage";
        message = `Latencia critica no monitor de tarefas: ${latencyMs}ms.`;
      } else if (latencyMs > 3000) {
        status = "degraded_performance";
        message = `Resposta lenta do monitor de tarefas: ${latencyMs}ms.`;
      }

      return {
        ok: true,
        checkedAt,
        latencyMs,
        status,
        message,
        stats,
        source: "scheduled_tasks",
      };
    } catch (error) {
      if (attempts < maxAttempts) {
        await delay(700);
        continue;
      }

      return {
        ok: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        status: "major_outage",
        message:
          error instanceof Error
            ? `Falha critica no sistema de tarefas: ${error.message.slice(0, 150)}`
            : "Falha critica no sistema de tarefas.",
        stats: emptyTaskStats(),
        source: "scheduled_tasks",
      };
    }
  }

  return {
    ok: false,
    checkedAt,
    latencyMs: Date.now() - startedAt,
    status: "major_outage",
    message: "Falha critica ao validar tarefas agendadas.",
    stats: emptyTaskStats(),
    source: "scheduled_tasks",
  };
}

export async function checkDomainsStatus(): Promise<DomainsStatusResponse> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);

  try {
    const circuitBreaker = openProviderClient.getCircuitBreakerStatus();

    await Promise.race([
      openProviderClient.post(
        "domains/check",
        {
          domains: [
            { name: "example", extension: "com" },
            { name: "flowdeskstatus", extension: "net" },
          ],
          with_price: false,
        },
        {
          maxRetries: 0,
          requestId,
        },
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout no health check de dominios.")), 5000),
      ),
    ]);

    const latencyMs = Date.now() - startedAt;
    let status: SystemStatus = "operational";
    let message: string | null = null;

    if (latencyMs > 5000) {
      status = "partial_outage";
      message = `Latencia critica na Openprovider: ${latencyMs}ms.`;
    } else if (latencyMs > 2500) {
      status = "degraded_performance";
      message = `Resposta lenta da Openprovider: ${latencyMs}ms.`;
    }

    return {
      ok: true,
      checkedAt,
      latencyMs,
      status,
      message,
      source: "domains",
      circuitBreaker,
    };
  } catch (error) {
    const circuitBreaker = openProviderClient.getCircuitBreakerStatus();
    const latencyMs = Date.now() - startedAt;

    return {
      ok: false,
      checkedAt,
      latencyMs,
      status: circuitBreaker.state === "open" ? "major_outage" : "partial_outage",
      message:
        error instanceof Error
          ? `Falha no provedor de dominios: ${error.message}`
          : "Falha no provedor de dominios.",
      source: "domains",
      circuitBreaker,
    };
  }
}

export async function checkDiscordBotStatus(): Promise<DiscordBotStatusResponse> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const url = resolveDiscordBotHealthUrl();
  const token = resolveDiscordBotHealthToken();

  try {
    const headers = new Headers();
    if (token) {
      headers.set("x-bot-health-token", token);
    }

    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers,
      },
      5000,
    );

    const latencyMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null);
    const ready = Boolean(payload?.ready);
    const wsStatus = typeof payload?.wsStatus === "number" ? payload.wsStatus : null;
    const guildCount = typeof payload?.guildCount === "number" ? payload.guildCount : null;
    const uptimeMs = typeof payload?.uptimeMs === "number" ? payload.uptimeMs : null;

    if (!response.ok) {
      return {
        ok: false,
        checkedAt,
        latencyMs,
        status: response.status === 401 || response.status === 403 ? "major_outage" : "partial_outage",
        message:
          response.status === 401 || response.status === 403
            ? "Endpoint de saude do Discord Bot negou acesso."
            : `Discord Bot nao respondeu corretamente ao health check HTTP (${response.status}).`,
        source: "discord",
        ready,
        wsStatus,
        guildCount,
        uptimeMs,
        url,
      };
    }

    let status: SystemStatus = "operational";
    let message: string | null = null;

    if (!ready || wsStatus !== 0) {
      status = "major_outage";
      message = "Discord Bot esta offline ou ainda nao concluiu a conexao com o gateway.";
    } else if (latencyMs > 5000) {
      status = "partial_outage";
      message = `Resposta critica do Discord Bot: ${latencyMs}ms.`;
    } else if (latencyMs > 2500) {
      status = "degraded_performance";
      message = `Resposta lenta do Discord Bot: ${latencyMs}ms.`;
    }

    return {
      ok: status === "operational",
      checkedAt,
      latencyMs,
      status,
      message,
      source: "discord",
      ready,
      wsStatus,
      guildCount,
      uptimeMs,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      status: "major_outage",
      message:
        error instanceof Error
          ? `Discord Bot indisponivel no health check HTTP: ${error.message}`
          : "Discord Bot indisponivel no health check HTTP.",
      source: "discord",
      ready: false,
      wsStatus: null,
      guildCount: null,
      uptimeMs: null,
      url,
    };
  }
}
