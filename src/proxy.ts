import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import {
  AGE_GATE_COOKIE,
  AGE_GATE_PATH,
  hasPassedAgeGate,
  isAgeGateExempt,
  safeNextPath,
} from "@/modules/compliance";
import { SIGNED_OUT_ONLY_PATHS, signedInDestination } from "@/modules/customers";
import { getPublicEnv } from "@/shared/env/public-env";

// Runs before every page (Next 16 "proxy", formerly "middleware"):
// 1. refreshes the Supabase session cookies;
// 2. sends visitors who have not passed the 18+ notice to /age-check (D-035);
// 3. keeps signed-in people out of /login and /signup (D-065).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Validates the token and refreshes it when needed. Do not remove.
  const { data: claimsData } = await supabase.auth.getClaims();

  const { pathname, search } = request.nextUrl;

  // A session that is still valid cannot open the sign-in or sign-up pages.
  // getUser() asks Auth that the account still exists (a token outlives a
  // deleted user), but only on these two pages, not on every request.
  if (claimsData?.claims && (SIGNED_OUT_ONLY_PATHS as readonly string[]).includes(pathname)) {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const target = request.nextUrl.clone();
      const next = request.nextUrl.searchParams.get("next");
      const destination = new URL(
        signedInDestination(userData.user.app_metadata?.staff_role, next ? safeNextPath(next) : null),
        request.nextUrl.origin,
      );
      target.pathname = destination.pathname;
      target.search = destination.search;
      const redirect = NextResponse.redirect(target);
      for (const cookie of response.cookies.getAll()) {
        redirect.cookies.set(cookie);
      }
      return redirect;
    }
  }
  if (
    !isAgeGateExempt(pathname) &&
    !hasPassedAgeGate(request.cookies.get(AGE_GATE_COOKIE)?.value)
  ) {
    const gate = request.nextUrl.clone();
    gate.pathname = AGE_GATE_PATH;
    gate.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(gate);
    // Keep any refreshed session cookies.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}

export const config = {
  // Everything except static files and images.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
