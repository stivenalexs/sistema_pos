import "server-only";

import { createSupabaseServerClient } from "@/shared/supabase/server";

// Web orders (D-039). Everything runs with the customer's session: RLS shows
// only their own orders, and place_order() prices the cart with their
// permissions before creating the order atomically.

export type PlaceOrderResult =
  | { ok: true; created: boolean; trackingId: string; orderId: string }
  | { ok: false; error: "cart_empty" | "quote_failed" | "insufficient_stock" | "idempotency_key_conflict" };

export async function placeOrder(idempotencyKey: string): Promise<PlaceOrderResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("place_order", {
    p_idempotency_key: idempotencyKey,
    p_fulfillment: "pickup",
  });
  if (error) {
    if (error.message.includes("idempotency_key_conflict")) {
      return { ok: false, error: "idempotency_key_conflict" };
    }
    throw new Error(`place_order failed: ${error.message}`);
  }

  const result = data as {
    ok: boolean;
    created?: boolean;
    tracking_id?: string;
    order_id?: string;
    error?: "cart_empty" | "quote_failed" | "insufficient_stock";
  };
  if (result.ok && result.tracking_id && result.order_id) {
    return {
      ok: true,
      created: result.created ?? false,
      trackingId: result.tracking_id,
      orderId: result.order_id,
    };
  }
  return { ok: false, error: result.error ?? "quote_failed" };
}

export type OrderDetail = {
  id: string;
  status: string;
  fulfillment: string;
  saleUnit: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  paymentDeadline: string | null;
  cancelAfter: string | null;
  createdAt: string;
  items: {
    productName: string;
    sku: string;
    quantity: number;
    unitPriceCop: number;
    lineTotalCop: number;
  }[];
};

/** One of the signed-in customer's orders, or null if it is not theirs. */
export async function getOrder(orderId: string): Promise<OrderDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("orders")
    .select(
      "id, status, fulfillment, sale_unit, subtotal_cop, delivery_fee_cop, total_cop, payment_deadline, cancel_after, created_at, order_items (product_name, sku, quantity, unit_price_cop, line_total_cop)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!data) return null;

  return {
    id: data.id,
    status: data.status,
    fulfillment: data.fulfillment,
    saleUnit: data.sale_unit,
    subtotalCop: data.subtotal_cop,
    deliveryFeeCop: data.delivery_fee_cop,
    totalCop: data.total_cop,
    paymentDeadline: data.payment_deadline,
    cancelAfter: data.cancel_after,
    createdAt: data.created_at,
    items: data.order_items
      .map((item) => ({
        productName: item.product_name,
        sku: item.sku,
        quantity: item.quantity,
        unitPriceCop: item.unit_price_cop,
        lineTotalCop: item.line_total_cop,
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName, "es")),
  };
}
