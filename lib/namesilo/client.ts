type QueryValue = string | number | boolean | null | undefined;

type NameSiloRawPayload = {
  request?: Record<string, unknown>;
  reply?: Record<string, unknown>;
  namesilo?: {
    request?: Record<string, unknown>;
    reply?: Record<string, unknown>;
  };
};

type RequestOptions = {
  requestId?: string;
  maxRetries?: number;
  timeoutMs?: number;
};

class CircuitBreaker {
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private readonly failureThreshold = 8,
    private readonly recoveryTimeoutMs = 45_000,
    private readonly halfOpenSuccessThreshold = 1,
  ) {}

  isOpen() {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeoutMs) {
        this.state = "half-open";
        this.successes = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  onSuccess() {
    if (this.state === "half-open") {
      this.successes += 1;
      if (this.successes >= this.halfOpenSuccessThreshold) {
        this.failures = 0;
        this.state = "closed";
      }
      return;
    }

    this.failures = Math.max(0, this.failures - 1);
  }

  onFailure() {
    this.failures += 1;
    this.lastFailureTime = Date.now();
    if (this.state === "half-open" || this.failures >= this.failureThreshold) {
      this.state = "open";
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

export class NameSiloRequestError extends Error {
  status: number;
  code?: number;
  details?: unknown;
  retryCount?: number;

  constructor(
    message: string,
    {
      status = 500,
      code,
      details,
      retryCount,
    }: {
      status?: number;
      code?: number;
      details?: unknown;
      retryCount?: number;
    } = {},
  ) {
    super(message);
    this.name = "NameSiloRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryCount = retryCount;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number) {
  return ms * (0.8 + Math.random() * 0.4);
}

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/$/, "");
}

function getReply(payload: NameSiloRawPayload): Record<string, unknown> {
  return (
    (payload.reply as Record<string, unknown> | undefined) ||
    (payload.namesilo?.reply as Record<string, unknown> | undefined) ||
    {}
  );
}

function getReplyCode(payload: NameSiloRawPayload): number {
  const reply = getReply(payload);
  const code = Number(reply.code);
  return Number.isFinite(code) ? code : NaN;
}

function getReplyDetail(payload: NameSiloRawPayload): string {
  const reply = getReply(payload);
  return String(reply.detail || reply.message || "Unknown provider error");
}

function buildUrl(
  baseUrl: string,
  operation: string,
  apiKey: string,
  params?: Record<string, QueryValue>,
) {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/${operation}`);
  url.searchParams.set("version", "1");
  url.searchParams.set("type", "json");
  url.searchParams.set("key", apiKey);

  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function parseJson(raw: string): NameSiloRawPayload {
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as NameSiloRawPayload;
  } catch {
    return { reply: { detail: raw.trim() } };
  }
}

function parseBoolLike(value: unknown) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "yes" || normalized === "true" || normalized === "on";
}

export class NameSiloClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly circuitBreaker: CircuitBreaker;

  constructor() {
    this.baseUrl = process.env.NAMESILO_BASE_URL || "https://www.namesilo.com/api";
    this.apiKey = (process.env.NAMESILO_API_KEY || "").trim();
    this.timeoutMs = Number(process.env.NAMESILO_TIMEOUT_MS) || 12_000;
    this.maxRetries = Number(process.env.NAMESILO_MAX_RETRIES) || 2;
    this.circuitBreaker = new CircuitBreaker(
      Number(process.env.NAMESILO_CIRCUIT_BREAKER_FAILURE_THRESHOLD) || 8,
      Number(process.env.NAMESILO_CIRCUIT_BREAKER_RECOVERY_TIMEOUT_MS) || 45_000,
    );
  }

  private ensureConfigured() {
    if (!this.apiKey) {
      throw new NameSiloRequestError(
        "Configuracao incompleta da NameSilo. Defina NAMESILO_API_KEY.",
        { status: 500 },
      );
    }
  }

  async request(
    operation: string,
    params?: Record<string, QueryValue>,
    options: RequestOptions = {},
  ): Promise<{ payload: NameSiloRawPayload; reply: Record<string, unknown>; code: number }> {
    this.ensureConfigured();

    if (this.circuitBreaker.isOpen()) {
      throw new NameSiloRequestError(
        "Sistema de dominios temporariamente pausado para recuperacao. Tente novamente em alguns segundos.",
        { status: 503 },
      );
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const requestId = options.requestId || Math.random().toString(36).slice(2, 8);
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(buildUrl(this.baseUrl, operation, this.apiKey, params), {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
        });

        const raw = await response.text();
        const payload = parseJson(raw);
        const code = getReplyCode(payload);
        const detail = getReplyDetail(payload);

        if (!response.ok) {
          throw new NameSiloRequestError(
            detail || `A NameSilo respondeu com HTTP ${response.status}.`,
            { status: response.status, code: Number.isFinite(code) ? code : undefined, details: payload, retryCount: attempt },
          );
        }

        // 300+ = sucesso no padrão NameSilo; 25x também pode indicar sucesso idempotente.
        if (Number.isFinite(code) && code >= 300 && code < 400) {
          this.circuitBreaker.onSuccess();
          return { payload, reply: getReply(payload), code };
        }

        if (code === 250 || code === 251 || code === 252 || code === 253) {
          this.circuitBreaker.onSuccess();
          return { payload, reply: getReply(payload), code };
        }

        throw new NameSiloRequestError(detail, {
          status: code === 110 ? 401 : 502,
          code: Number.isFinite(code) ? code : undefined,
          details: payload,
          retryCount: attempt,
        });
      } catch (error) {
        lastError = error;
        this.circuitBreaker.onFailure();

        const isAbort = error instanceof DOMException && error.name === "AbortError";
        const shouldRetry =
          attempt < maxRetries &&
          (isAbort ||
            !(error instanceof NameSiloRequestError) ||
            error.status >= 500 ||
            error.status === 429 ||
            error.status === 408);

        if (!shouldRetry) {
          if (error instanceof NameSiloRequestError) throw error;
          if (isAbort) {
            throw new NameSiloRequestError("Timeout ao consultar a NameSilo.", {
              status: 504,
              retryCount: attempt,
            });
          }
          throw new NameSiloRequestError(
            error instanceof Error ? error.message : "Falha inesperada na NameSilo.",
            { retryCount: attempt },
          );
        }

        const delayMs = Math.min(6000, jitter(700 * Math.pow(1.7, attempt)));
        console.warn(`[NameSilo][${requestId}] Attempt ${attempt + 1} failed. Retrying in ${Math.round(delayMs)}ms.`);
        await sleep(delayMs);
      } finally {
        clearTimeout(timeout);
      }
    }

    if (lastError instanceof NameSiloRequestError) {
      throw lastError;
    }

    throw new NameSiloRequestError("Falha ao consultar a NameSilo apos todas as tentativas.");
  }

  getCircuitBreakerStatus() {
    return this.circuitBreaker.getState();
  }
}

export function getNameSiloErrorMessage(error: unknown) {
  if (error instanceof NameSiloRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "Erro desconhecido ao consultar a NameSilo.";
}

export function getNameSiloReply(error: unknown) {
  if (error instanceof NameSiloRequestError && error.details && typeof error.details === "object") {
    const payload = error.details as NameSiloRawPayload;
    return getReply(payload);
  }
  return null;
}

export function parseYesNo(value: unknown) {
  return parseBoolLike(value);
}

export const nameSiloClient = new NameSiloClient();
