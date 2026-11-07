import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/shared/supabase/server";

// Target of the confirmation email link. Supabase confirms the email before
// redirecting here; this only starts the session when the link is opened in
// the same browser that signed up. Otherwise the user signs in normally.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL("/", url.origin));
    }
  }

  return NextResponse.redirect(new URL("/login?confirmed=1", url.origin));
}
