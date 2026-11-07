import { NextResponse } from "next/server";

import { reconcilePayments } from "@/modules/payments";
import { isAuthorizedWorkerRequest } from "@/shared/actions/server/worker-auth";
import { getWorkerSecret } from "@/shared/env/server-env";

// Called by pg_cron every 10 minutes (D-040). Not for browsers.
export async function POST(request: Request) {
  if (!isAuthorizedWorkerRequest(request.headers.get("authorization"), getWorkerSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = await reconcilePayments();
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
