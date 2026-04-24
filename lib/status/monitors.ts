import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { openProviderClient } from "@/lib/openprovider/client";
import type { FlowAiHealthResponse } from "@/lib/flowai/service";
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

export type FlowAiStatusResponse = FlowAiHealthResponse;

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

export type SquareCloudStatusResponse = StatusCheckResult;
export type DiscordCdnStatusResponse = StatusCheckResult;

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
  T extends { status: SystemStatus; message: string | null; latencyMs: number | null; ok?: boolean; checkedAt?: string | null; [key: string]: unknown },
>(sourceKey: string, payload: T): T {
  const stabilizedStatus = stabilizeSystemStatus(
    sourceKey,
    payload.status,
    payload.message,
    payload.latencyMs,
  );

  return {
    ...payload,
    status: stabilizedStatus,
    ...(typeof payload.ok === "boolean"
      ? { ok: stabilizedStatus === "operational" || stabilizedStatus === "degraded_performance" }
      : {}),
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

export function emptyTaskStats() {
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

export async function checkFlowAiStatus(): Promise<FlowAiStatusResponse> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();

  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || OPENAI_DEFAULT_URL).replace(/\/$/, "");

  if (!apiKey) {
    // Dev sem chave: retorna degraded (não gera incidente crítico)
    return {
      ok: true,
      checkedAt,
      overall: {
        status: "degraded_performance",
        latencyMs: null,
        message: "OPENAI_API_KEY não configurada — FlowAI em modo limitado.",
      },
      upstream: {
        openai: { status: "degraded_performance", latencyMs: null, message: "Chave ausente.", baseUrl },
        providers: {},
      },
      integrations: {
        domainSuggestions: { status: "degraded_performance", latencyMs: null, message: null },
        ticketAi: { status: "degraded_performance", latencyMs: null, message: null },
        discordMessageAi: { status: "degraded_performance", latencyMs: null, message: null },
      },
    };
  }

  // Checagem LEVE: apenas lista modelos (sem chamadas de IA reais)
  // Isso evita os 7 calls anteriores que causavam falsos alarmes
  try {
    const res = await fetchWithTimeout(
      `${baseUrl}/models`,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
      7000,
    );
    const latencyMs = Date.now() - startedAt;

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        checkedAt,
        overall: { status: "major_outage", latencyMs, message: "Credenciais da OpenAI inválidas." },
        upstream: { openai: { status: "major_outage", latencyMs, message: `HTTP ${res.status}`, baseUrl }, providers: {} },
        integrations: {
          domainSuggestions: { status: "major_outage", latencyMs: null, message: null },
          ticketAi: { status: "major_outage", latencyMs: null, message: null },
          discordMessageAi: { status: "major_outage", latencyMs: null, message: null },
        },
      };
    }

    if (!res.ok) {
      return {
        ok: true,
        checkedAt,
        overall: { status: "degraded_performance", latencyMs, message: `OpenAI respondeu HTTP ${res.status} — instabilidade temporária.` },
        upstream: { openai: { status: "degraded_performance", latencyMs, message: `HTTP ${res.status}`, baseUrl }, providers: {} },
        integrations: {
          domainSuggestions: { status: "degraded_performance", latencyMs: null, message: null },
          ticketAi: { status: "degraded_performance", latencyMs: null, message: null },
          discordMessageAi: { status: "degraded_performance", latencyMs: null, message: null },
        },
      };
    }

    const overallStatus: SystemStatus =
      latencyMs > 6000 ? "partial_outage" :
      latencyMs > 3000 ? "degraded_performance" :
      "operational";

    return {
      ok: true,
      checkedAt,
      overall: {
        status: overallStatus,
        latencyMs,
        message: overallStatus === "operational" ? null : `Latência elevada OpenAI: ${latencyMs}ms.`,
      },
      upstream: { openai: { status: overallStatus, latencyMs, message: null, baseUrl }, providers: {} },
      integrations: {
        domainSuggestions: { status: overallStatus, latencyMs, message: null },
        ticketAi: { status: overallStatus, latencyMs, message: null },
        discordMessageAi: { status: overallStatus, latencyMs, message: null },
      },
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    // Timeout ou rede: degraded, não major_outage
    return {
      ok: true,
      checkedAt,
      overall: {
        status: "degraded_performance",
        latencyMs,
        message: isTimeout
          ? "Timeout ao verificar OpenAI — instabilidade transitória."
          : error instanceof Error ? error.message.slice(0, 150) : "FlowAI probe falhou.",
      },
      upstream: { openai: { status: "degraded_performance", latencyMs, message: null, baseUrl }, providers: {} },
      integrations: {
        domainSuggestions: { status: "degraded_performance", latencyMs: null, message: null },
        ticketAi: { status: "degraded_performance", latencyMs: null, message: null },
        discordMessageAi: { status: "degraded_performance", latencyMs: null, message: null },
      },
    };
  }
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
        setTimeout(() => reject(new Error("Timeout no health check de dominios.")), 8000),
      ),
    ]);

    const latencyMs = Date.now() - startedAt;
    let status: SystemStatus = "operational";
    let message: string | null = null;

    if (latencyMs > 8000) {
      status = "partial_outage";
      message = `Latencia critica na Openprovider: ${latencyMs}ms.`;
    } else if (latencyMs > 4500) {
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

  let lastError: Error | null = null;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts += 1;

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

      if (!payload) {
        throw new Error("Resposta nao-JSON recebida da URL de saude do bot.");
      }

      const ready = Boolean(payload?.ready);
      const wsStatus = typeof payload?.wsStatus === "number" ? payload.wsStatus : null;
      const guildCount = typeof payload?.guildCount === "number" ? payload.guildCount : null;
      const uptimeMs = typeof payload?.uptimeMs === "number" ? payload.uptimeMs : null;
      const apiStatus = typeof payload?.status === "string" ? payload.status : null; // capture status if health return maps it

      if (!response.ok) {
        if (response.status >= 500 && attempts < maxAttempts) {
           await delay(800 * attempts);
           continue;
        }

        const mappedStatus = response.status === 401 || response.status === 403 ? "major_outage" : "partial_outage";

        return {
          ok: false,
          checkedAt,
          latencyMs,
          status: mappedStatus,
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

      let status: SystemStatus = apiStatus || "operational";
      let message: string | null = null;

      if (!ready || wsStatus !== 0) {
        if (wsStatus === 1 || wsStatus === 2 || wsStatus === 8) {
          status = "degraded_performance";
          message = "Discord Bot esta conectando/reconectando ao gateway.";
        } else {
          status = "major_outage";
          message = "Discord Bot esta offline ou ainda nao concluiu a conexao com o gateway.";
        }
      } else if (latencyMs > 5000) {
        status = "partial_outage";
        message = `Resposta critica do Discord Bot: ${latencyMs}ms.`;
      } else if (latencyMs > 2500) {
        status = "degraded_performance";
        message = `Resposta lenta do Discord Bot: ${latencyMs}ms.`;
      }

      return {
        ok: status === "operational" || status === "degraded_performance",
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
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempts < maxAttempts) {
        await delay(800 * attempts);
        continue;
      }
    }
  }

  // Fallback: se o monitor HTTP do bot estiver inacessivel (comum no SquareCloud),
  // tentamos validar o token diretamente com a API do Discord para evitar um "major_outage" falso.
  if (token || process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN) {
    const rawToken = token || process.env.DISCORD_BOT_TOKEN?.trim() || process.env.DISCORD_TOKEN?.trim();
    if (rawToken) {
      try {
        const fallbackStart = Date.now();
        const discordRes = await fetchWithTimeout(
          "https://discord.com/api/v10/users/@me",
          {
            method: "GET",
            headers: { Authorization: `Bot ${rawToken}` },
          },
          5000,
        );

        if (discordRes.ok) {
          return {
            ok: true,
            checkedAt,
            latencyMs: Date.now() - fallbackStart,
            status: "degraded_performance",
            message: "Monitor HTTP do Bot inacessível, mas a API do Discord responde atestando que o Token esta operante.",
            source: "discord",
            ready: true, // we assume it's running if the token works and health api failed
            wsStatus: null,
            guildCount: null,
            uptimeMs: null,
            url,
          };
        }
      } catch {
        // ignora falha do fallback e retorna o erro original
      }
    }
  }

  return {
    ok: false,
    checkedAt,
    latencyMs: Date.now() - startedAt,
    status: "major_outage",
    message: `Discord Bot indisponivel no health check HTTP: ${lastError?.message || "Timeout"}`,
    source: "discord",
    ready: false,
    wsStatus: null,
    guildCount: null,
    uptimeMs: null,
    url,
  };
}

export async function checkSquareCloudStatus(): Promise<SquareCloudStatusResponse> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    const res = await fetchWithTimeout(
      "https://status.squarecloud.app/",
      { method: "GET" },
      8000
    );

    const latencyMs = Date.now() - startedAt;

    if (!res.ok) {
      return {
        ok: false,
        checkedAt,
        latencyMs,
        status: "partial_outage",
        message: `Square Cloud Status Page retornou HTTP ${res.status}`,
        source: "squarecloud"
      };
    }

    const html = await res.text();
    // Better Stack status pages use "All services are online" as the positive signal
    const isActuallyOnline = html.includes("All services are online") || html.includes("All systems operational");
    
    // We only report an outage if the positive signal is missing AND we find negative ones
    const hasOutage = !isActuallyOnline && /major outage|critical failure|partial outage|degraded performance/i.test(html);

    return {
      ok: true,
      checkedAt,
      latencyMs,
      status: hasOutage ? "partial_outage" : "operational",
      message: hasOutage ? "Square Cloud reportando instabilidade oficial." : "Sistemas Square Cloud operantes.",
      source: "squarecloud"
    };
  } catch {
    return {
      ok: false,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      status: "degraded_performance",
      message: "Falha ao validar status da Square Cloud.",
      source: "squarecloud"
    };
  }
}

export async function checkDiscordCdnStatus(): Promise<DiscordCdnStatusResponse> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  // We test a static Discord asset (a logo)
  const testUrl = "https://cdn.discordapp.com/icons/290132685348143105/a_86c2305318db40a97b91d2c6c498902d.png?size=16";

  try {
    const res = await fetch(testUrl, {
      method: "HEAD",
      cache: "no-store",
    });

    const latencyMs = Date.now() - startedAt;

    if (!res.ok && res.status !== 404) {
      return {
        ok: false,
        checkedAt,
        latencyMs,
        status: "partial_outage",
        message: "Discord CDN reportando instabilidade de entrega.",
        source: "discord_cdn"
      };
    }

    return {
      ok: true,
      checkedAt,
      latencyMs,
      status: latencyMs > 2500 ? "degraded_performance" : "operational",
      message: "Discord CDN operando normalmente.",
      source: "discord_cdn"
    };
  } catch {
    return {
      ok: false,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      status: "partial_outage",
      message: "Falha na resolucao de DNS ou conexao com Discord CDN.",
      source: "discord_cdn"
    };
  }
}
