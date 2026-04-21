import { createClient } from "@supabase/supabase-js";

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const supabaseUrl = configuredSupabaseUrl || "https://example.invalid";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";

if (!configuredSupabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[supabaseBrowser] NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY ausente. Recursos do Supabase no navegador podem ficar indisponiveis.",
  );
}

export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey || "missing", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
