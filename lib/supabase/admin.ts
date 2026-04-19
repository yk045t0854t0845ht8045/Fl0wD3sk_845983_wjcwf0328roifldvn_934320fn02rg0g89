import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function resolveSupabaseEnv() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    supabaseUrl,
    serviceRoleKey,
  };
}

const DEFAULT_TIMEOUT_MS = 8000;
const READ_ONLY_MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 250;
const IDEMPOTENT_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRequestMethod(options: RequestInit) {
  const method = options.method?.trim().toUpperCase();
  return method || "GET";
}

function shouldRetrySupabaseRequest(options: RequestInit) {
  const method = resolveRequestMethod(options);
  if (IDEMPOTENT_HTTP_METHODS.has(method)) {
    return true;
  }

  const headers = new Headers(options.headers);
  const retrySafeHeader = headers.get("x-flowdesk-retry-safe")?.trim().toLowerCase();
  return retrySafeHeader === "1" || retrySafeHeader === "true";
}

function resolveRetryDelayMs(attempt: number) {
  const exponentialDelayMs = INITIAL_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
  const jitterMs = Math.floor(Math.random() * INITIAL_BACKOFF_MS);
  return exponentialDelayMs + jitterMs;
}

/**
 * Custom fetch wrapper to implement timeouts and automatic retries for Supabase requests.
 * Transient errors (502, 503, 504) and timeouts are retried with exponential backoff.
 */
async function fetchWithTimeout(
  url: string | URL | Request,
  options: RequestInit = {},
): Promise<Response> {
  const method = resolveRequestMethod(options);
  const canRetry = shouldRetrySupabaseRequest(options);
  const maxAttempts = canRetry ? READ_ONLY_MAX_RETRIES : 1;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      // Se for um erro transiente do servidor (Gateway Timeout, Bad Gateway, Service Unavailable), tenta novamente
      if (
        attempt < maxAttempts &&
        (response.status === 502 || response.status === 503 || response.status === 504)
      ) {
        const retryDelayMs = resolveRetryDelayMs(attempt);
        console.warn(
          `[Supabase] Erro transiente ${response.status} em ${method} na tentativa ${attempt}. Retentando em ${retryDelayMs}ms...`,
        );
        clearTimeout(timeoutId);
        await sleep(retryDelayMs);
        continue;
      }

      return response;
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError";
      
      if (attempt < maxAttempts && (isTimeout || error instanceof TypeError)) {
        // TypeError geralmente indica erro de rede/conexao abortada
        const retryDelayMs = resolveRetryDelayMs(attempt);
        console.warn(
          `[Supabase] ${isTimeout ? "Timeout" : "Erro de Rede"} em ${method} na tentativa ${attempt}. Retentando em ${
            retryDelayMs
          }ms...`,
        );
        clearTimeout(timeoutId);
        await sleep(retryDelayMs);
        continue;
      }

      if (isTimeout) {
        throw new Error(
          canRetry
            ? `Supabase ${method} request timed out after ${maxAttempts} attempts of ${DEFAULT_TIMEOUT_MS}ms`
            : `Supabase ${method} request timed out after ${DEFAULT_TIMEOUT_MS}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(`Falha ao processar requisicao Supabase ${method} apos ${maxAttempts} tentativa(s).`);
}

function buildClient(supabaseUrl: string, serviceRoleKey: string): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  });
}

/**
 * Singleton instance of the Supabase Admin client.
 * Note: If environment variables are missing, this might not work correctly,
 * but it won't throw until a query is attempted (or if Supabase client init fails).
 */
const { supabaseUrl, serviceRoleKey } = resolveSupabaseEnv();
export const supabaseAdmin = buildClient(supabaseUrl || "", serviceRoleKey || "");

/**
 * Returns the Supabase Admin client or throws if environment variables are missing.
 */
export function getSupabaseAdminClientOrThrow() {
  const { supabaseUrl, serviceRoleKey } = resolveSupabaseEnv();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidos no ambiente.",
    );
  }

  return supabaseAdmin;
}

/**
 * Creates a NEW Supabase Admin client instance.
 * @deprecated Use supabaseAdmin singleton instead unless you specifically need a new instance.
 */
export function createSupabaseAdminClient() {
  const { supabaseUrl, serviceRoleKey } = resolveSupabaseEnv();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return buildClient(supabaseUrl, serviceRoleKey);
}
