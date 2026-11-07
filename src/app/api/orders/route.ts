import { NextResponse } from "next/server";

import { placeOrder } from "@/modules/orders";
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

  // Only pickup until delivery arrives (plan step 14). Prices are never read
  // from the request body.
  const result = await placeOrder(idempotencyKey);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409, headers: NO_STORE });
  }

  return NextResponse.json(
    { trackingId: result.trackingId, orderId: result.orderId },
    { status: 202, headers: NO_STORE },
  );
}
