"use server";

import { refresh } from "next/cache";

import { createSupabaseServerClient } from "@/shared/supabase/server";

import { CONFIRM_PICKUP_MESSAGES, type ConfirmPickupError, normalizeIdDocument } from "../domain/pickup";

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

export type ConfirmPickupState = { status: "idle" | "ok" | "error"; message?: string };

/** "Recogí mi pedido" (D-059, D-067): the customer confirms with the document. */
export async function confirmPickupAction(
  _previous: ConfirmPickupState,
  formData: FormData,
): Promise<ConfirmPickupState> {
  const orderId = formData.get("orderId");
  const document = formData.get("document");
  if (typeof orderId !== "string" || typeof document !== "string") {
    return { status: "error", message: "Pedido no válido." };
  }
  if (!normalizeIdDocument(document)) {
    return { status: "error", message: CONFIRM_PICKUP_MESSAGES.invalid_document };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("confirm_pickup", { p_order_id: orderId, p_document: document });
  if (error) {
    return { status: "error", message: "No pudimos registrar la recogida. Intenta de nuevo." };
  }
  const result = data as { ok: boolean; error?: ConfirmPickupError; attempts_left?: number };
  if (!result.ok) {
    const message = (result.error && CONFIRM_PICKUP_MESSAGES[result.error]) ?? "No pudimos registrar la recogida.";
    const left =
      result.error === "document_mismatch" && typeof result.attempts_left === "number"
        ? result.attempts_left === 1
          ? " Te queda 1 intento."
          : ` Te quedan ${result.attempts_left} intentos.`
        : "";
    return { status: "error", message: message + left };
  }
  refresh();
  return { status: "ok", message: "Pedido recogido. ¡Gracias por tu compra!" };
}
