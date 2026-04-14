import { OpenProviderError } from "./types";

/**
 * OpenProvider REST Client
 * Handles authentication, timeouts, and error parsing.
 */
export class OpenProviderClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  private token: string = "";
  private timeoutMs: number;

  constructor() {
    this.baseUrl = process.env.OPENPROVIDER_BASE_URL || "https://api.openprovider.eu/v1beta";
    this.username = process.env.OPENPROVIDER_USERNAME || "";
    this.password = process.env.OPENPROVIDER_PASSWORD || "";
    this.timeoutMs = Number(process.env.OPENPROVIDER_TIMEOUT_MS) || 12000;
  }

  /**
   * Performs authentication to obtain a Bearer Token.
   */
  private async login(requestId: string): Promise<string> {
    console.log(`[OpenProvider][${requestId}] Logging in...`);
    const url = `${this.baseUrl.replace(/\/$/, "")}/auth/login`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.username,
          password: this.password,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.desc || "Falha na autenticação com a OpenProvider");
      }

      this.token = payload.data?.token;
      console.log(`[OpenProvider][${requestId}] Login successful.`);
      return this.token;
    } catch (err: any) {
      console.error(`[OpenProvider][${requestId}] Login failed:`, err.message, err.cause || "");
      throw err;
    }
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const requestId = Math.random().toString(36).substring(7);
    
    // Ensure we have a token
    if (!this.token) {
      await this.login(requestId);
    }

    const url = `${this.baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
    console.log(`[OpenProvider][${requestId}] Request: ${options.method || 'GET'} ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`,
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json().catch(() => ({}));

      // Detect Maintenance State
      if (data.maintenance === true) {
        console.warn(`[OpenProvider][${requestId}] SYSTEM MAINTENANCE detected.`);
        throw new Error("O provedor de domínios está em manutenção programada.");
      }

      // Handle specific Auth errors (Token expired)
      const currentHeaders = (options.headers || {}) as Record<string, string>;
      if (response.status === 401 && !currentHeaders["X-Retry"]) {
        console.log(`[OpenProvider][${requestId}] Token expired. Retrying login...`);
        this.token = "";
        return this.request(endpoint, { 
          ...options, 
          headers: { ...currentHeaders, "X-Retry": "true" } 
        });
      }

      if (!response.ok) {
        const error = data as OpenProviderError;
        console.error(`[OpenProvider][${requestId}] Error ${response.status}:`, error.desc);

        if (error.code === 81) {
          console.warn(`[OpenProvider][${requestId}] Code 81: Check URL/Method.`);
        }

        throw new Error(error.desc || "Erro desconhecido na API");
      }

      return data as T;
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error(`[OpenProvider][${requestId}] Request failed:`, err.message, err.cause || "");
      throw err;
    }
  }

  async post<T>(endpoint: string, body: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

export const openProviderClient = new OpenProviderClient();
