import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/shared/env/public-env";

import type { Database } from "./database.types";

// Supabase client for Server Components, Server Actions and Route Handlers.
// It acts as the signed-in user (session from the request cookies), so RLS
// applies. Use this one by default.
export async function createSupabaseServerClient() {
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The session refresh that
          // needs this runs in proxy.ts (added with authentication, step 8).
        }
      },
    },
  });
}
