import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function resolveSupabaseEnv() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    supabaseUrl,
    serviceRoleKey,
  };
}

function buildClient(supabaseUrl: string, serviceRoleKey: string): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
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
