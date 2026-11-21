import "server-only";

import { createSupabaseServerClient } from "@/shared/supabase/server";

// Web orders (D-039). Everything runs with the customer's session: RLS shows
// only their own orders, and place_order() prices the cart with their
// permissions before creating the order atomically.

export type PlaceOrderResult =
  | { ok: true; created: boolean; trackingId: string; orderId: string }
  | {
      ok: false;
      error: PlaceOrderError | "idempotency_key_conflict";
      reason?: string;
    };

type PlaceOrderError =
  | "cart_empty"
  | "quote_failed"
  | "insufficient_stock"
  | "delivery_unavailable"
  | "sales_blocked"
  | "pickup_document_required"
  | "invalid_pickup_document";

/** pickupDocument: cédula of whoever picks the order up (customers without a NIT, D-067). */
export type Fulfillment =
  | { fulfillment: "pickup"; pickupDocument?: string }
  | { fulfillment: "delivery"; addressId: string };

export async function placeOrder(idempotencyKey: string, choice: Fulfillment = { fulfillment: "pickup" }): Promise<PlaceOrderResult> {
  const supabase = await createSupabaseServerClient();
  // The delivery fee is computed by the database from the address id; the
  // browser never sends amounts (agents.md §5.1).
  const { data, error } = await supabase.rpc("place_order", {
    p_idempotency_key: idempotencyKey,
    p_fulfillment: choice.fulfillment,
    ...(choice.fulfillment === "delivery" ? { p_address_id: choice.addressId } : {}),
    ...(choice.fulfillment === "pickup" && choice.pickupDocument ? { p_pickup_document: choice.pickupDocument } : {}),
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
    error?: PlaceOrderError;
    reason?: string;
  };
  if (result.ok && result.tracking_id && result.order_id) {
    return {
      ok: true,
      created: result.created ?? false,
      trackingId: result.tracking_id,
      orderId: result.order_id,
    };
  }
  return {
    ok: false,
    error: result.error ?? "quote_failed",
    ...(result.reason ? { reason: result.reason } : {}),
  };
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
  /** Payment received but it cannot be fulfilled: the store refunds it. */
  needsRefund: boolean;
  delivery: {
    addressLine: string;
    details: string | null;
    municipality: string;
    distanceM: number | null;
  } | null;
  deliveredAt: string | null;
  /** Pickup (D-067): last 3 digits of the cédula given at order time, if any. */
  pickupDocumentLast3: string | null;
  /** Too many wrong documents: the store resolves it. */
  pickupLocked: boolean;
  /** Pickup without a cédula yet: the customer must give it (D-068). */
  pickupNeedsDocument: boolean;
  /** Failed delivery back at the store (D-068). */
  returnKind: "customer" | "force_majeure" | "underage" | null;
  returnChoice: "pickup" | "reschedule" | "refund" | null;
  returnChoiceDeadline: string | null;
  returnChoiceDefaulted: boolean;
  /** Day (Colombia, YYYY-MM-DD) of a rescheduled delivery. */
  scheduledDeliveryOn: string | null;
  /** Amount to return when it is not the whole order (products only). */
  refundAmountCop: number | null;
  /** Municipality of the sale, for sales blocks (D-051). */
  saleZoneId: string | null;
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
      "id, status, fulfillment, sale_unit, subtotal_cop, delivery_fee_cop, total_cop, payment_deadline, cancel_after, created_at, needs_refund, sale_zone_id, delivery_address, delivery_distance_m, delivered_at, delivery_return_kind, return_choice, return_choice_deadline, return_choice_defaulted, scheduled_delivery_on, refund_amount_cop, order_items (product_name, sku, quantity, unit_price_cop, line_total_cop)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!data) return null;

  // Pickup (D-067): the cédula digits and the lock live outside orders, which
  // staff read in full; the customer gets only their own.
  type PickupStatus = { document_last3: string | null; locked: boolean; needs_document?: boolean };
  const pickup: PickupStatus | null =
    data.fulfillment === "pickup"
      ? (((await supabase.rpc("get_pickup_status", { p_order_id: data.id })).data as PickupStatus | null) ?? null)
      : null;

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
    needsRefund: data.needs_refund,
    delivery: deliverySnapshot(data.delivery_address, data.delivery_distance_m),
    deliveredAt: data.delivered_at,
    pickupDocumentLast3: pickup?.document_last3 ?? null,
    pickupLocked: pickup?.locked ?? false,
    pickupNeedsDocument: pickup?.needs_document ?? false,
    returnKind: (data.delivery_return_kind as OrderDetail["returnKind"]) ?? null,
    returnChoice: (data.return_choice as OrderDetail["returnChoice"]) ?? null,
    returnChoiceDeadline: data.return_choice_deadline,
    returnChoiceDefaulted: data.return_choice_defaulted,
    scheduledDeliveryOn: data.scheduled_delivery_on,
    refundAmountCop: data.refund_amount_cop,
    saleZoneId: data.sale_zone_id,
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

function deliverySnapshot(raw: unknown, distanceM: number | null): OrderDetail["delivery"] {
  const value = raw as { address_line?: unknown; details?: unknown; municipality?: unknown } | null;
  if (!value || typeof value.address_line !== "string" || typeof value.municipality !== "string") return null;
  return {
    addressLine: value.address_line,
    details: typeof value.details === "string" ? value.details : null,
    municipality: value.municipality,
    distanceM,
  };
}
