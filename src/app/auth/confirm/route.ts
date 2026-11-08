import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/shared/supabase/server";

// Target of the emails sent by Supabase Auth.
// - Sign-up confirmation (?code=...): Supabase confirms the email before
//   redirecting here; this only starts the session when the link is opened
//   in the same browser that signed up. Otherwise the user signs in normally.
// - Staff invitation (?token_hash=...&type=invite, D-054): verified here on
//   the server, then the person sets their password.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  // Redirect to the host the browser used: the session cookie is set for it.
  // (request.url can say "localhost" when the link opened 127.0.0.1.)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const to = (path: string) => NextResponse.redirect(new URL(path, `${proto}://${host}`));

  if (tokenHash && type === "invite") {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" });
    return to(error ? "/login?invitation=expired" : "/auth/set-password");
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return to("/");
  }

  return to("/login?confirmed=1");
}
