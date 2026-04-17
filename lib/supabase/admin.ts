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
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 200;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Custom fetch wrapper to implement timeouts and automatic retries for Supabase requests.
 * Transient errors (502, 503, 504) and timeouts are retried with exponential backoff.
 */
async function fetchWithTimeout(
  url: string | URL | Request,
  options: RequestInit = {},
): Promise<Response> {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
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
        attempt < MAX_RETRIES &&
        (response.status === 502 || response.status === 503 || response.status === 504)
      ) {
        console.warn(`[Supabase] Erro transiente ${response.status} na tentativa ${attempt}. Retentando...`);
        clearTimeout(timeoutId);
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
        continue;
      }

      return response;
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError";
      
      if (attempt < MAX_RETRIES && (isTimeout || error instanceof TypeError)) {
        // TypeError geralmente indica erro de rede/conexao abortada
        console.warn(
          `[Supabase] ${isTimeout ? "Timeout" : "Erro de Rede"} na tentativa ${attempt}. Retentando em ${
            INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1)
          }ms...`,
        );
        clearTimeout(timeoutId);
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
        continue;
      }

      if (isTimeout) {
        throw new Error(`Supabase request timed out after ${MAX_RETRIES} attempts of ${DEFAULT_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(`Falha ao processar requisicao Supabase apos ${MAX_RETRIES} tentativas.`);
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
