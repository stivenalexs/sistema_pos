import { NextResponse } from "next/server";

import { startPayment } from "@/modules/payments";
import { isUuid } from "@/shared/actions/action-types";
import { readIdempotencyKey } from "@/shared/actions/server/accept-action";
import { createSupabaseServerClient } from "@/shared/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

// Starts the Wompi payment of the customer's own order (D-040). The amount and
// the integrity signature are computed on the server; the body is ignored.
export async function POST(request: Request, ctx: RouteContext<"/api/orders/[id]/payments">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    return NextResponse.json({ error: "missing_idempotency_key" }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await startPayment({
      orderId: id,
      idempotencyKey,
      siteOrigin: new URL(request.url).origin,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409, headers: NO_STORE });
    }
    return NextResponse.json(
      { trackingId: result.trackingId, checkoutUrl: result.checkoutUrl },
      { status: 202, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("payment_order_not_found")) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }
    throw error;
  }
}
