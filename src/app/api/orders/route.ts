import { NextResponse } from "next/server";

import { type Fulfillment, placeOrder } from "@/modules/orders";
import { isUuid } from "@/shared/actions/action-types";
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

  // The body says only pickup or delivery and which address. Prices and the
  // delivery fee are never read from the request (agents.md §5.1).
  const body = (await request.json().catch(() => null)) as { fulfillment?: unknown; addressId?: unknown } | null;
  let choice: Fulfillment;
  if (!body || body.fulfillment === undefined || body.fulfillment === "pickup") {
    choice = { fulfillment: "pickup" };
  } else if (body.fulfillment === "delivery" && typeof body.addressId === "string" && isUuid(body.addressId)) {
    choice = { fulfillment: "delivery", addressId: body.addressId };
  } else {
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
