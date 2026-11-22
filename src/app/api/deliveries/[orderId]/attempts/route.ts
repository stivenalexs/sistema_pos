import { NextResponse } from "next/server";

import { acceptDeliveryAttempt, MAX_SIGNATURE_BYTES } from "@/modules/delivery";
import { isUuid } from "@/shared/actions/action-types";
import { readIdempotencyKey } from "@/shared/actions/server/accept-action";
import { parseFormBody, readBodyWithLimit } from "@/shared/http/read-body";

const NO_STORE = { "Cache-Control": "no-store" };
// Form fields plus the signature PNG.
const MAX_BODY_BYTES = MAX_SIGNATURE_BYTES + 16 * 1024;

// Delivery attempt by the assigned courier or an admin (D-007, D-045).
// Thin handler: checks the request and delegates; the module validates the
// session, the assignment and the form, uploads the signature and enqueues
// the attempt. Answers 202 with the tracking_id.
export async function POST(request: Request, ctx: RouteContext<"/api/deliveries/[orderId]/attempts">) {
  const { orderId } = await ctx.params;
  if (!isUuid(orderId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    return NextResponse.json({ error: "missing_idempotency_key" }, { status: 400, headers: NO_STORE });
  }

  // The body is read only after the module checked the session (D-074), as
  // a stream that stops at the limit (Content-Length can be missing or false).
  const result = await acceptDeliveryAttempt({
    orderId,
    idempotencyKey,
    readForm: async () => {
      const body = await readBodyWithLimit(request, MAX_BODY_BYTES);
      if (!body.ok) {
        return body.error === "payload_too_large"
          ? { ok: false, status: 413, error: "payload_too_large" }
          : { ok: false, status: 400, error: "invalid_form" };
      }
      const form = await parseFormBody(body.bytes, request.headers.get("content-type"));
      return form ? { ok: true, form } : { ok: false, status: 400, error: "invalid_form" };
    },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  }
  return NextResponse.json({ trackingId: result.trackingId }, { status: 202, headers: NO_STORE });
}
