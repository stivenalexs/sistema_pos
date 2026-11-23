import { NextResponse } from "next/server";

import { parseOrderRequest, placeOrder } from "@/modules/orders";
import { readIdempotencyKey } from "@/shared/actions/server/accept-action";
import { createSupabaseServerClient } from "@/shared/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

// Places a web order from the customer's cart (D-039). Thin handler: it
// checks the session and the idempotency key, and delegates to the atomic
// place_order() function. Answers 202 with the tracking_id (= actions.id).
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) {
    return NextResponse.json({ error: "order_requires_customer" }, { status: 401, headers: NO_STORE });
  }

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    return NextResponse.json({ error: "missing_idempotency_key" }, { status: 400, headers: NO_STORE });
  }

  // The module reads the body: pickup or delivery, the address and the cédula,
  // never prices (agents.md §5.1).
  const choice = parseOrderRequest(await request.json().catch(() => null));
  if (!choice) {
    return NextResponse.json({ error: "invalid_fulfillment" }, { status: 400, headers: NO_STORE });
  }

  const result = await placeOrder(idempotencyKey, choice);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: 409, headers: NO_STORE });
  }

  return NextResponse.json(
    { trackingId: result.trackingId, orderId: result.orderId },
    { status: 202, headers: NO_STORE },
  );
}
