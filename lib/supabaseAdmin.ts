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

export function createSupabaseAdminClient() {
  const { supabaseUrl, serviceRoleKey } = resolveSupabaseEnv();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return buildClient(supabaseUrl, serviceRoleKey);
}

export function getSupabaseAdminClientOrThrow() {
  const { supabaseUrl, serviceRoleKey } = resolveSupabaseEnv();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidos no ambiente.",
    );
  }

  return buildClient(supabaseUrl, serviceRoleKey);
}
