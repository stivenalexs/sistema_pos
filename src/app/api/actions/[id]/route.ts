import { NextResponse } from "next/server";

import { type ActionStatusResponse, isUuid } from "@/shared/actions/action-types";
import { createSupabaseServerClient } from "@/shared/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

// Status of an action for ActionButton polling. Uses the user's session, so
// RLS returns only the user's own actions (D-034).
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/actions/[id]">,
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const { data, error } = await supabase
    .from("actions")
    .select("id, status, result, next_attempt_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  const body: ActionStatusResponse = {
    trackingId: data.id,
    status: data.status,
    retrying: data.status === "queued" && data.next_attempt_at !== null,
    result: data.status === "succeeded" ? data.result : null,
  };
  return NextResponse.json(body, { headers: NO_STORE });
}
