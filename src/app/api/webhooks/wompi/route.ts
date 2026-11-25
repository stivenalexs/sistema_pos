import { NextResponse } from "next/server";

import { handleWompiWebhook } from "@/modules/payments";
import { readBodyWithLimit } from "@/shared/http/read-body";

// Wompi events (D-040). Public endpoint: trust comes only from the signature.
// Verify, store once, enqueue, answer 200 fast. Any other status makes Wompi
// retry (30 min, 3 h, 24 h).

// A real event is a few KB. Anything larger is rejected before parsing.
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  // Read as a stream that stops at the limit: Content-Length can be missing
  // (chunked) or false, and request.text() would read everything first.
  const body = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return NextResponse.json({ ok: false }, { status: body.error === "payload_too_large" ? 413 : 400 });
  }
  const rawBody = new TextDecoder().decode(body.bytes);

  const result = await handleWompiWebhook(rawBody, request.headers.get("x-event-checksum"));
  // The body is ignored by Wompi; never echo the event or any secret.
  return NextResponse.json({ ok: result.status === 200 }, { status: result.status });
}
