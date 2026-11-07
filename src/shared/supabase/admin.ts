import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/shared/env/public-env";
import { getServerEnv } from "@/shared/env/server-env";

import type { Database } from "./database.types";

// Supabase client with the SECRET key. It BYPASSES RLS.
// Only for workers, webhooks and other trusted server jobs that have no user
// session (agents.md section 6). Never use it to answer a user request
// directly; prefer createSupabaseServerClient. Single exception: acceptAction()
// enqueues with it after the endpoint has verified the user (D-034).
export function createSupabaseAdminClient() {
  const { supabaseUrl } = getPublicEnv();
  const { supabaseSecretKey } = getServerEnv();
  return createClient<Database>(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
