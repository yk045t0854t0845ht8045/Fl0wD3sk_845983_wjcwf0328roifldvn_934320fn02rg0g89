import { createClient } from "@supabase/supabase-js";

// Use public environment variables (provided by user)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sqkhmyhnoyfotifengxv.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseAnonKey) {
  console.warn("[supabaseBrowser] NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Real-time updates will be disabled.");
}

export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey || "missing", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
