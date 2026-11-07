"use server";

import { refresh } from "next/cache";

import { createSupabaseServerClient } from "@/shared/supabase/server";

export type CancelOrderState = { status: "idle" | "ok" | "error"; message?: string };

/** The customer cancels their own unpaid order; its reservation is released. */
export async function cancelOrderAction(
  _previous: CancelOrderState,
  formData: FormData,
): Promise<CancelOrderState> {
  const orderId = formData.get("orderId");
  if (typeof orderId !== "string") {
    return { status: "error", message: "Pedido no válido." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) {
    return {
      status: "error",
      message: error.message.includes("order_not_cancellable")
        ? "Este pedido ya no se puede cancelar."
        : "No pudimos cancelar el pedido. Intenta de nuevo.",
    };
  }
  // Re-render the current page with the new data (totals, status).
  refresh();
  return { status: "ok", message: "Pedido cancelado." };
}
