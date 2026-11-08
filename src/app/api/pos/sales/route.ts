import { NextResponse } from "next/server";

import { createPosSale, getPosStaff, parsePosSaleInput } from "@/modules/pos";
import { readIdempotencyKey } from "@/shared/actions/server/accept-action";

const NO_STORE = { "Cache-Control": "no-store" };

// Registers a POS sale (D-053). Thin handler: checks the session, the key
// and the body shape, and delegates to create_pos_sale(), which prices the
// sale, takes the stock and enqueues the invoice atomically. Synchronous like
// placing a web order (D-039): the cashier needs the answer to hand over the
// bottles; the tracking_id is actions.id and the invoice goes to the queue.
export async function POST(request: Request) {
  const staff = await getPosStaff();
  if (!staff) {
    return NextResponse.json({ error: "pos_forbidden" }, { status: 403, headers: NO_STORE });
  }

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    return NextResponse.json({ error: "missing_idempotency_key" }, { status: 400, headers: NO_STORE });
  }

  const input = parsePosSaleInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "invalid_sale" }, { status: 400, headers: NO_STORE });
  }

  const result = await createPosSale(idempotencyKey, input);
  if (!result.ok) {
    const status = result.error === "pos_forbidden" ? 403 : 409;
    return NextResponse.json({ error: result.error, detail: result.detail }, { status, headers: NO_STORE });
  }
  return NextResponse.json(
    { trackingId: result.trackingId, orderId: result.orderId },
    { status: 202, headers: NO_STORE },
  );
}
