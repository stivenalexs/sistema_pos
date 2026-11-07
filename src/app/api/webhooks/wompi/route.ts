import { NextResponse } from "next/server";

import { handleWompiWebhook } from "@/modules/payments";

// Wompi events (D-040). Public endpoint: trust comes only from the signature.
// Verify, store once, enqueue, answer 200 fast. Any other status makes Wompi
// retry (30 min, 3 h, 24 h).

// A real event is a few KB. Anything larger is rejected before parsing.
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  const result = await handleWompiWebhook(rawBody, request.headers.get("x-event-checksum"));
  // The body is ignored by Wompi; never echo the event or any secret.
  return NextResponse.json({ ok: result.status === 200 }, { status: result.status });
}
