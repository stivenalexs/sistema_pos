import { NextResponse } from "next/server";

import { createSupabaseActionQueue } from "@/shared/actions/server/supabase-queue";
import { runActionsWorker } from "@/shared/actions/server/worker";
import { isAuthorizedWorkerRequest } from "@/shared/actions/server/worker-auth";
import { getWorkerSecret } from "@/shared/env/server-env";

import { actionHandlers } from "./handlers";

// Called by pg_cron through pg_net every 10 seconds (D-034). Not for browsers.
export async function POST(request: Request) {
  if (!isAuthorizedWorkerRequest(request.headers.get("authorization"), getWorkerSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const report = await runActionsWorker(createSupabaseActionQueue(), actionHandlers);
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
