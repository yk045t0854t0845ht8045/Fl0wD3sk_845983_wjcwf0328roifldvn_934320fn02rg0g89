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
}

export class OpenProviderRequestError extends Error {
  status: number;
  code?: number;
  details?: unknown;
  maintenance: boolean;

  constructor(
    message: string,
    {
      status = 500,
      code,
      details,
      maintenance = false,
    }: {
      status?: number;
      code?: number;
      details?: unknown;
      maintenance?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "OpenProviderRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.maintenance = maintenance;
  }
}

function parseJsonResponse<TData>(rawText: string): OpenProviderApiResponse<TData> {
  if (!rawText.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawText) as OpenProviderApiResponse<TData>;
  } catch {
    return {
      desc: rawText.trim(),
      data: rawText.trim() as unknown as TData,
    };
  }
}

function buildUrl(baseUrl: string, endpoint: string, query?: Record<string, QueryValue>) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const normalizedEndpoint = endpoint.replace(/^\//, "");
  const url = new URL(`${normalizedBase}/${normalizedEndpoint}`);

  if (!query) {
    return url.toString();
  }

  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      continue;
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      url.searchParams.append(key, String(value));
    }
  }

  return url.toString();
}

export class OpenProviderClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly ip: string;
  private readonly timeoutMs: number;

  private token = "";
  private loginPromise: Promise<string> | null = null;

  constructor() {
    this.baseUrl = process.env.OPENPROVIDER_BASE_URL || "https://api.openprovider.eu/v1beta";
    this.username = process.env.OPENPROVIDER_USERNAME?.trim() || "";
    this.password = process.env.OPENPROVIDER_PASSWORD || "";
    this.ip = process.env.OPENPROVIDER_IP?.trim() || "";
    this.timeoutMs = Number(process.env.OPENPROVIDER_TIMEOUT_MS) || 12000;
  }

  private ensureConfigured() {
    const missing: string[] = [];

    if (!this.username) {
      missing.push("OPENPROVIDER_USERNAME");
    }

    if (!this.password) {
      missing.push("OPENPROVIDER_PASSWORD");
    }

    if (missing.length > 0) {
      throw new OpenProviderRequestError(
        `Configuracao incompleta da Openprovider. Defina: ${missing.join(", ")}`,
        { status: 500 },
      );
    }
  }

  private buildAuthHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  private isAuthenticationFailure(error: unknown) {
    if (!(error instanceof OpenProviderRequestError)) {
      return false;
    }

    if (error.status === 401) {
      return true;
    }

    return /Authentication\/Authorization Failed/i.test(error.message);
  }

  private async doRequest<TData>(
    endpoint: string,
    {
      query,
      requireAuth = true,
      retryOnAuthFailure = true,
      requestId = Math.random().toString(36).slice(2, 8),
      headers,
      ...options
    }: RequestOptions = {},
  ): Promise<OpenProviderApiResponse<TData>> {
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
        for (const [key, value] of Object.entries(this.buildAuthHeaders(token))) {
          mergedHeaders.set(key, value);
        }
      }

      const response = await fetch(buildUrl(this.baseUrl, endpoint, query), {
        ...options,
        headers: mergedHeaders,
        signal: controller.signal,
      });

      const rawText = await response.text();
      const payload = parseJsonResponse<TData>(rawText);

      if (payload.maintenance) {
        throw new OpenProviderRequestError(
          "A Openprovider informou manutencao temporaria na API.",
          {
            status: response.status || 503,
            code: payload.code,
            details: payload,
            maintenance: true,
          },
        );
      }

      if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
        throw new OpenProviderRequestError(
          payload.desc || `A Openprovider respondeu com status ${response.status}.`,
          {
            status: response.status || 500,
            code: payload.code,
            details: payload,
          },
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new OpenProviderRequestError("Timeout ao consultar a Openprovider.", {
          status: 504,
        });
      }

      if (retryOnAuthFailure && requireAuth && this.isAuthenticationFailure(error)) {
        this.token = "";
        await this.login(requestId);

        return this.doRequest<TData>(endpoint, {
          ...options,
          headers,
          query,
          requireAuth,
          retryOnAuthFailure: false,
          requestId,
        });
      }

      if (error instanceof OpenProviderRequestError) {
        throw error;
      }

      const unknownError = error as Error;
      throw new OpenProviderRequestError(
        unknownError?.message || "Falha inesperada ao consultar a Openprovider.",
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async login(requestId: string): Promise<string> {
    this.ensureConfigured();

    if (this.token) {
      return this.token;
    }

    if (!this.loginPromise) {
      this.loginPromise = (async () => {
        const payload: Record<string, string> = {
          username: this.username,
          password: this.password,
        };

        if (this.ip) {
          payload.ip = this.ip;
        }

        console.log(`[OpenProvider][${requestId}] Authenticating`);

        const response = await this.doRequest<AuthLoginResponseData>("auth/login", {
          method: "POST",
          body: JSON.stringify(payload),
          requireAuth: false,
          retryOnAuthFailure: false,
          requestId,
        });

        const token = response.data?.token?.trim();
        if (!token) {
          throw new OpenProviderRequestError(
            "A Openprovider nao retornou token de autenticacao.",
            {
              status: 502,
              details: response,
            },
          );
        }

        console.log(`[OpenProvider][${requestId}] Authentication succeeded`);
        this.token = token;
        return token;
      })().finally(() => {
        this.loginPromise = null;
      });
    }

    return this.loginPromise;
  }

  async get<TData>(endpoint: string, query?: Record<string, QueryValue>) {
    return this.doRequest<TData>(endpoint, {
      method: "GET",
      query,
    });
  }

  async post<TData>(endpoint: string, body?: unknown, options: Omit<RequestOptions, "body" | "method"> = {}) {
    return this.doRequest<TData>(endpoint, {
      ...options,
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

export function getOpenProviderErrorMessage(error: unknown) {
  if (error instanceof OpenProviderRequestError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Erro desconhecido ao consultar a Openprovider.";
}

export function getOpenProviderErrorDetails(error: unknown): OpenProviderErrorPayload | null {
  if (error instanceof OpenProviderRequestError && error.details && typeof error.details === "object") {
    return error.details as OpenProviderErrorPayload;
  }

  return null;
}

export const openProviderClient = new OpenProviderClient();
