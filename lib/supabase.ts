import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";
import type { Database } from "./database.types";

let browserClient: ReturnType<typeof createClient<Database>> | null = null;

/** Client-side Supabase client using the public anon key. Safe to use in the browser. */
export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createClient<Database>(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    );
  }
  return browserClient;
}

/**
 * Server-only Supabase client using the service role key. Bypasses row-level
 * security, so it must never be imported into client components.
 */
export function getSupabaseServiceClient() {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
}
