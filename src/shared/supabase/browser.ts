import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/shared/env/public-env";

import type { Database } from "./database.types";

// Supabase client for Client Components. Uses the publishable key, so every
// query is subject to RLS as the signed-in user.
export function createSupabaseBrowserClient() {
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  return createBrowserClient<Database>(supabaseUrl, supabasePublishableKey);
}
