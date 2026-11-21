// Store pickup confirmed by the customer (D-059, D-067). Pure rules, shared by
// the browser (early feedback) and the server. The database checks again.

export { normalizeIdDocument } from "@/shared/id-document";

export type ConfirmPickupError =
  | "order_not_found"
  | "not_pickup_order"
  | "pickup_not_available"
  | "pickup_locked"
  | "invalid_document"
  | "pickup_document_missing"
  | "document_mismatch";

export const CONFIRM_PICKUP_MESSAGES: Record<ConfirmPickupError, string> = {
  order_not_found: "No encontramos este pedido.",
  not_pickup_order: "Este pedido no es para recoger en la tienda.",
  pickup_not_available: "Este pedido no se puede marcar como recogido.",
  pickup_locked:
    "Se superó el número de intentos. Pide ayuda en la tienda: el personal revisará tu pedido.",
  invalid_document: "Escribe el número del documento, de 5 a 12 dígitos.",
  pickup_document_missing:
    "Este pedido no tiene un documento registrado. Pide ayuda en la tienda.",
  document_mismatch: "El documento no coincide con el registrado en el pedido.",
};

export type ReturnOption = "pickup" | "reschedule" | "refund";

export const RETURN_OPTION_LABELS: Record<ReturnOption, string> = {
  pickup: "Lo recojo en la tienda",
  reschedule: "Envíenlo de nuevo mañana (sin pagar otra vez el domicilio)",
  refund: "Quiero el reembolso de los productos (el domicilio no se devuelve)",
};

export const RETURN_CHOICE_MESSAGES: Record<string, string> = {
  order_not_found: "No encontramos este pedido.",
  not_awaiting_choice: "Este pedido ya no espera tu decisión.",
  choice_already_made: "Ya elegiste una opción para este pedido.",
  choice_expired: "Pasaron los 3 días para elegir: el pedido queda para recoger en la tienda.",
  invalid_option: "Elige una de las opciones.",
  pickup_document_required: "Escribe la cédula de quien recogerá el pedido.",
  invalid_pickup_document: "La cédula debe tener de 5 a 12 dígitos.",
};

export const SET_PICKUP_DOCUMENT_MESSAGES: Record<string, string> = {
  order_not_found: "No encontramos este pedido.",
  pickup_not_available: "Este pedido no se puede recoger ahora.",
  document_already_set: "Este pedido ya tiene una cédula registrada.",
  not_needed: "Tu cuenta confirma la recogida con el NIT de tu empresa.",
  invalid_pickup_document: "La cédula debe tener de 5 a 12 dígitos.",
};

/** Whether the customer can press "Recogí mi pedido" (the database decides again). */
export function canConfirmPickup(order: {
  fulfillment: string;
  status: string;
  needsRefund: boolean;
}): boolean {
  return order.fulfillment === "pickup" && (order.status === "paid" || order.status === "preparing") && !order.needsRefund;
}
