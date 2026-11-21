"use server";

import { refresh } from "next/cache";

import { createSupabaseServerClient } from "@/shared/supabase/server";

import {
  CONFIRM_PICKUP_MESSAGES,
  type ConfirmPickupError,
  normalizeIdDocument,
  RETURN_CHOICE_MESSAGES,
  SET_PICKUP_DOCUMENT_MESSAGES,
} from "../domain/pickup";

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

export type ReturnChoiceState = { status: "idle" | "ok" | "error"; message?: string };

/** After a failed delivery: pickup, a new delivery tomorrow or a refund (D-059, D-068). */
export async function chooseReturnOptionAction(
  _previous: ReturnChoiceState,
  formData: FormData,
): Promise<ReturnChoiceState> {
  const orderId = formData.get("orderId");
  const option = formData.get("option");
  const document = formData.get("document");
  if (typeof orderId !== "string" || typeof option !== "string") {
    return { status: "error", message: RETURN_CHOICE_MESSAGES.invalid_option };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("choose_delivery_return_option", {
    p_order_id: orderId,
    p_option: option,
    ...(typeof document === "string" && document.trim() !== "" ? { p_pickup_document: document } : {}),
  });
  if (error) return { status: "error", message: "No pudimos guardar tu elección. Intenta de nuevo." };
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) {
    return { status: "error", message: (result.error && RETURN_CHOICE_MESSAGES[result.error]) ?? "No pudimos guardar tu elección." };
  }
  refresh();
  return { status: "ok", message: "Listo, guardamos tu elección." };
}

export type SetPickupDocumentState = { status: "idle" | "ok" | "error"; message?: string };

/** A pickup order without a cédula yet: the customer gives it once (D-068). */
export async function setPickupDocumentAction(
  _previous: SetPickupDocumentState,
  formData: FormData,
): Promise<SetPickupDocumentState> {
  const orderId = formData.get("orderId");
  const document = formData.get("document");
  if (typeof orderId !== "string" || typeof document !== "string" || !normalizeIdDocument(document)) {
    return { status: "error", message: SET_PICKUP_DOCUMENT_MESSAGES.invalid_pickup_document };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_pickup_document", { p_order_id: orderId, p_document: document });
  if (error) return { status: "error", message: "No pudimos guardar la cédula. Intenta de nuevo." };
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) {
    return { status: "error", message: (result.error && SET_PICKUP_DOCUMENT_MESSAGES[result.error]) ?? "No pudimos guardar la cédula." };
  }
  refresh();
  return { status: "ok", message: "Cédula registrada." };
}
