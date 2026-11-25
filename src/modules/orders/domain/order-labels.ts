// Spanish labels for order states (UI text in Spanish, code in English).

import { formatBogotaDateTime } from "@/shared/dates";

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  awaiting_payment: "Pendiente de pago",
  paid: "Pagado",
  preparing: "En preparación",
  out_for_delivery: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

export const FULFILLMENT_LABELS: Record<string, string> = {
  pickup: "Recoger en la tienda",
  delivery: "Domicilio",
};

/** Formats a UTC timestamp in Colombian time (shared, D-075). */
export { formatBogotaDateTime };
