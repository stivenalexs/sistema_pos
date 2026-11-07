// Spanish labels for order states (UI text in Spanish, code in English).

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

const BOGOTA_DATE_TIME = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  dateStyle: "medium",
  timeStyle: "short",
});

/** Formats a UTC timestamp in Colombian time. */
export function formatBogotaDateTime(iso: string): string {
  return BOGOTA_DATE_TIME.format(new Date(iso)).replace(/ /g, " ");
}
