import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function resolveSupabaseEnv() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    supabaseUrl,
    serviceRoleKey,
  };
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Custom fetch wrapper to implement timeouts for Supabase requests.
 */
async function fetchWithTimeout(
  url: string | URL | Request,
  options: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Supabase request timed out after ${DEFAULT_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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
