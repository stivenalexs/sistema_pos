import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/shared/env/public-env";
import { getServerEnv } from "@/shared/env/server-env";

// Supabase client with the SECRET key. It BYPASSES RLS.
// Only for workers, webhooks and other trusted server jobs that have no user
// session (agents.md section 6). Never use it to answer a user request
// directly; prefer createSupabaseServerClient.
export function createSupabaseAdminClient() {
  const { supabaseUrl } = getPublicEnv();
  const { supabaseSecretKey } = getServerEnv();
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
