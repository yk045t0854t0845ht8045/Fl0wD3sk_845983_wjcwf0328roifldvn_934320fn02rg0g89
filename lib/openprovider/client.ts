import {
  AuthLoginResponseData,
  OpenProviderApiResponse,
  OpenProviderErrorPayload,
} from "./types";

type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

interface RequestOptions extends RequestInit {
  query?: Record<string, QueryValue>;
  requireAuth?: boolean;
  retryOnAuthFailure?: boolean;
  requestId?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: Number(process.env.OPENPROVIDER_MAX_RETRIES) || 2,
  baseDelayMs: Number(process.env.OPENPROVIDER_RETRY_BASE_DELAY_MS) || 600,
  maxDelayMs: 6000,
  backoffMultiplier: 1.8,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

// Token TTL: treat tokens as expired 5 min before actual expiry to avoid edge failures
const TOKEN_TTL_MS = 1000 * 60 * 55; // 55 minutes (OpenProvider tokens last ~60 min)
const TOKEN_PROACTIVE_REFRESH_MS = 1000 * 60 * 50; // start refreshing at 50 min

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  // ±20% jitter to avoid thundering herd
  return ms * (0.8 + Math.random() * 0.4);
}

function calculateRetryDelay(attempt: number, config: RetryConfig): number {
  const delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(jitter(delay), config.maxDelayMs);
}

function isRetryableError(error: unknown, config: RetryConfig): boolean {
  if (error instanceof OpenProviderRequestError) {
    if (error.maintenance) return false;
    if (error.status === 401 || error.status === 403) return false;
    // Client-side limit errors (e.g. "too many domains") must NOT be retried — they will ALWAYS fail
    if (/limit exceed|too many domain|send less domain/i.test(error.message)) return false;
    if (config.retryableStatuses.includes(error.status)) return true;
    if (error.status === 504 || /timeout/i.test(error.message)) return true;
  }
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}

function isAuthError(error: unknown): boolean {
  if (!(error instanceof OpenProviderRequestError)) return false;
  return (
    error.status === 401 ||
    error.code === 196 ||
    /Authentication\/Authorization Failed/i.test(error.message)
  );
}

// ─── Circuit Breaker ───────────────────────────────────────────────────────
// Softer thresholds: needs 8 failures (not 5) to open, recovers in 45s (not 60s)
class CircuitBreaker {
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private readonly failureThreshold: number = 8,
    private readonly recoveryTimeoutMs: number = 45_000,
    private readonly halfOpenSuccessThreshold: number = 1,
  ) {}

  isOpen(): boolean {
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

  onSuccess(): void {
    if (this.state === "half-open") {
      this.successes++;
      if (this.successes >= this.halfOpenSuccessThreshold) {
        this.failures = 0;
        this.state = "closed";
      }
    } else {
      this.failures = Math.max(0, this.failures - 1); // decay on success
    }
  }

  onFailure(isAuthFailure = false): void {
    // Auth failures don't count toward circuit breaker — they're config issues
    if (isAuthFailure) return;
    this.failures++;
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

// ─── Error class ─────────────────────────────────────────────────────────────
export class OpenProviderRequestError extends Error {
  status: number;
  code?: number;
  details?: unknown;
  maintenance: boolean;
  retryCount?: number;

  constructor(
    message: string,
    {
      status = 500,
      code,
      details,
      maintenance = false,
      retryCount,
    }: {
      status?: number;
      code?: number;
      details?: unknown;
      maintenance?: boolean;
      retryCount?: number;
    } = {},
  ) {
    super(message);
    this.name = "OpenProviderRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.maintenance = maintenance;
    this.retryCount = retryCount;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseJsonResponse<TData>(rawText: string): OpenProviderApiResponse<TData> {
  if (!rawText.trim()) return {};
  try {
    return JSON.parse(rawText) as OpenProviderApiResponse<TData>;
  } catch {
    return { desc: rawText.trim(), data: rawText.trim() as unknown as TData };
  }
}

function isMaintenancePayload(payload: OpenProviderApiResponse<unknown>) {
  if (payload.maintenance) return true;
  if (payload.code === 4005) return true;
  if (typeof payload.desc === "string" && /maintenance|manutenc/i.test(payload.desc)) return true;
  return false;
}

function buildUrl(baseUrl: string, endpoint: string, query?: Record<string, QueryValue>) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const normalizedEndpoint = endpoint.replace(/^\//, "");
  const url = new URL(`${normalizedBase}/${normalizedEndpoint}`);

  if (!query) return url.toString();

  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      url.searchParams.append(key, String(value));
    }
  }

  return url.toString();
}

// ─── OpenProvider Client ──────────────────────────────────────────────────────
export class OpenProviderClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly ip: string;
  private readonly timeoutMs: number;
  private readonly circuitBreaker: CircuitBreaker;

  private token = "";
  private tokenFetchedAt = 0;
  private loginPromise: Promise<string> | null = null;

  constructor() {
    this.baseUrl = process.env.OPENPROVIDER_BASE_URL || "https://api.openprovider.eu/v1beta";
    this.username = process.env.OPENPROVIDER_USERNAME?.trim() || "";
    this.password = process.env.OPENPROVIDER_PASSWORD || "";
    this.ip = process.env.OPENPROVIDER_IP?.trim() || "";
    this.timeoutMs = Number(process.env.OPENPROVIDER_TIMEOUT_MS) || 10_000;

    const failureThreshold = Number(process.env.OPENPROVIDER_CIRCUIT_BREAKER_FAILURE_THRESHOLD) || 8;
    const recoveryTimeoutMs = Number(process.env.OPENPROVIDER_CIRCUIT_BREAKER_RECOVERY_TIMEOUT_MS) || 45_000;
    this.circuitBreaker = new CircuitBreaker(failureThreshold, recoveryTimeoutMs);
  }

  private ensureConfigured() {
    const missing: string[] = [];
    if (!this.username) missing.push("OPENPROVIDER_USERNAME");
    if (!this.password) missing.push("OPENPROVIDER_PASSWORD");
    if (missing.length > 0) {
      throw new OpenProviderRequestError(
        `Configuracao incompleta da Openprovider. Defina: ${missing.join(", ")}`,
        { status: 500 },
      );
    }
  }

  private isTokenExpired(): boolean {
    if (!this.token || !this.tokenFetchedAt) return true;
    return Date.now() - this.tokenFetchedAt > TOKEN_TTL_MS;
  }

  private shouldProactivelyRefresh(): boolean {
    if (!this.token || !this.tokenFetchedAt) return false;
    return Date.now() - this.tokenFetchedAt > TOKEN_PROACTIVE_REFRESH_MS;
  }

  private invalidateToken() {
    this.token = "";
    this.tokenFetchedAt = 0;
    this.loginPromise = null;
  }

  private buildAuthHeaders(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  private async doRequest<TData>(
    endpoint: string,
    {
      query,
      requireAuth = true,
      retryOnAuthFailure = true,
      requestId = Math.random().toString(36).slice(2, 8),
      maxRetries = DEFAULT_RETRY_CONFIG.maxRetries,
      retryDelayMs = DEFAULT_RETRY_CONFIG.baseDelayMs,
      headers,
      ...options
    }: RequestOptions = {},
  ): Promise<OpenProviderApiResponse<TData>> {
    if (this.circuitBreaker.isOpen()) {
      throw new OpenProviderRequestError(
        "Sistema de dominios temporariamente pausado para recuperacao. Tente em alguns segundos.",
        { status: 503 },
      );
    }

    const retryConfig: RetryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries,
      baseDelayMs: retryDelayMs,
    };

    let lastError: unknown;
    let authRetried = false;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const mergedHeaders = new Headers(headers);
        const hasBody = options.body !== undefined && options.body !== null;

        if (hasBody && !mergedHeaders.has("Content-Type")) {
          mergedHeaders.set("Content-Type", "application/json");
        }

        if (requireAuth) {
          const token = await this.login(requestId);
          for (const [k, v] of Object.entries(this.buildAuthHeaders(token))) {
            mergedHeaders.set(k, v);
          }
        }

        const response = await fetch(buildUrl(this.baseUrl, endpoint, query), {
          ...options,
          headers: mergedHeaders,
          signal: controller.signal,
        });

        const rawText = await response.text();
        const payload = parseJsonResponse<TData>(rawText);

        if (isMaintenancePayload(payload)) {
          throw new OpenProviderRequestError(
            "A Openprovider informou manutencao temporaria na API.",
            { status: response.status || 503, code: payload.code, details: payload, maintenance: true, retryCount: attempt },
          );
        }

        if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
          const err = new OpenProviderRequestError(
            payload.desc || `A Openprovider respondeu com status ${response.status}.`,
            { status: response.status || 500, code: payload.code, details: payload, retryCount: attempt },
          );

          // If auth failure (401 or code 196) and we haven't retried auth yet, invalidate token and retry once
          const isActuallyAuthError = response.status === 401 || payload.code === 196;
          if (isActuallyAuthError && retryOnAuthFailure && !authRetried && requireAuth) {
            authRetried = true;
            this.invalidateToken();
            console.log(`[OpenProvider][${requestId}] Token expired or invalid (code 196), refreshing and retrying`);
            continue; // retry without counting as backoff attempt
          }

          throw err;
        }

        // Success
        this.circuitBreaker.onSuccess();
        if (attempt > 0) {
          console.log(`[OpenProvider][${requestId}] Succeeded after ${attempt} retries`);
        }

        // Proactively refresh token in background if it's getting old
        if (requireAuth && this.shouldProactivelyRefresh() && !this.loginPromise) {
          this.invalidateToken();
          this.login(requestId).catch(() => {}); // fire and forget
        }

        return payload;

      } catch (error) {
        lastError = error;

        const isAuth = isAuthError(error);
        this.circuitBreaker.onFailure(isAuth);

        if (attempt > 0) {
          console.warn(`[OpenProvider][${requestId}] Attempt ${attempt} failed:`, error instanceof Error ? error.message : String(error));
        }

        const shouldRetry = attempt < retryConfig.maxRetries && isRetryableError(error, retryConfig);

        if (!shouldRetry) {
          if (error instanceof OpenProviderRequestError) throw error;
          if (error instanceof DOMException && error.name === "AbortError") {
            throw new OpenProviderRequestError("Timeout ao consultar a Openprovider.", {
              status: 504, retryCount: attempt,
            });
          }
          throw new OpenProviderRequestError(
            (error as Error)?.message || "Falha inesperada ao consultar a Openprovider.",
            { retryCount: attempt },
          );
        }

        const delay = calculateRetryDelay(attempt, retryConfig);
        console.log(`[OpenProvider][${requestId}] Retrying in ${Math.round(delay)}ms (${attempt + 1}/${retryConfig.maxRetries})`);
        await sleep(delay);

      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (lastError instanceof OpenProviderRequestError) throw lastError;
    throw new OpenProviderRequestError("Falha apos todas as tentativas.", {
      retryCount: retryConfig.maxRetries,
    });
  }

  private async login(requestId: string): Promise<string> {
    this.ensureConfigured();

    if (this.token && !this.isTokenExpired()) {
      return this.token;
    }

    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = (async () => {
      const payload: Record<string, string> = {
        username: this.username,
        password: this.password,
      };

      if (this.ip) payload.ip = this.ip;

      console.log(`[OpenProvider][${requestId}] Authenticating`);

      const response = await this.doRequest<AuthLoginResponseData>("auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
        requireAuth: false,
        retryOnAuthFailure: false,
        maxRetries: 1,
        requestId,
      });

      const token = response.data?.token?.trim();
      if (!token) {
        throw new OpenProviderRequestError(
          "A Openprovider nao retornou token de autenticacao.",
          { status: 502, details: response },
        );
      }

      console.log(`[OpenProvider][${requestId}] Authentication succeeded`);
      this.token = token;
      this.tokenFetchedAt = Date.now();
      return token;
    })().finally(() => {
      this.loginPromise = null;
    });

    return this.loginPromise;
  }

  async get<TData>(endpoint: string, query?: Record<string, QueryValue>) {
    return this.doRequest<TData>(endpoint, { method: "GET", query });
  }

  async post<TData>(endpoint: string, body?: unknown, options: Omit<RequestOptions, "body" | "method"> = {}) {
    return this.doRequest<TData>(endpoint, {
      ...options,
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  getCircuitBreakerStatus() {
    return this.circuitBreaker.getState();
  }
}

export function getOpenProviderErrorMessage(error: unknown) {
  if (error instanceof OpenProviderRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "Erro desconhecido ao consultar a Openprovider.";
}

export function getOpenProviderErrorDetails(error: unknown): OpenProviderErrorPayload | null {
  if (error instanceof OpenProviderRequestError && error.details && typeof error.details === "object") {
    return error.details as OpenProviderErrorPayload;
  }
  return null;
}

export const openProviderClient = new OpenProviderClient();
