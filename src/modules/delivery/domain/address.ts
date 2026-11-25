// Delivery addresses and quotes, without I/O (D-005, D-045). The database
// checks the same rules again: this layer only gives clear messages early.

import { text } from "./form-text";

export type DeliveryQuoteError =
  | "address_not_found"
  | "zone_not_available"
  | "store_location_missing"
  | "out_of_range"
  | "no_fee_rule"
  | "cart_empty"
  | "quote_failed";

export const DELIVERY_QUOTE_ERROR_MESSAGES: Record<DeliveryQuoteError, string> = {
  address_not_found: "No encontramos esa dirección. Elige otra o agrégala de nuevo.",
  zone_not_available: "Por ahora no hacemos domicilios a ese municipio.",
  store_location_missing: "El domicilio no está disponible en este momento.",
  out_of_range: "Esa dirección está fuera de nuestra zona de domicilios.",
  no_fee_rule: "El domicilio no está disponible en este momento.",
  cart_empty: "Tu carrito está vacío.",
  quote_failed: "Revisa las líneas marcadas en tu carrito.",
};

export const ADDRESS_ERROR_MESSAGES: Record<string, string> = {
  address_requires_customer: "Inicia sesión con tu cuenta de cliente para guardar direcciones.",
  address_invalid_field: "Revisa el nombre y la dirección.",
  address_invalid_location: "Marca en el mapa el punto de entrega.",
  address_zone_not_available: "Por ahora no hacemos domicilios a ese municipio.",
  address_out_of_range: "El punto marcado está fuera de nuestra zona de domicilios.",
  address_too_many: "Puedes guardar hasta 10 direcciones. Borra una para agregar otra.",
};

export type AddressInput = {
  label: string;
  addressLine: string;
  details: string | null;
  zoneId: string;
  lat: number;
  lng: number;
};

export type FieldErrors = Partial<Record<keyof AddressInput, string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function coordinate(value: unknown, min: number, max: number): number | null {
  const raw = text(value);
  if (!/^-?\d{1,3}(\.\d{1,12})?$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

/** Validates the address form (FormData values). */
export function parseAddressInput(raw: {
  label: unknown;
  addressLine: unknown;
  details: unknown;
  zoneId: unknown;
  lat: unknown;
  lng: unknown;
}): { ok: true; value: AddressInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const label = text(raw.label);
  const addressLine = text(raw.addressLine);
  const details = text(raw.details);
  const zoneId = text(raw.zoneId);
  const lat = coordinate(raw.lat, -90, 90);
  const lng = coordinate(raw.lng, -180, 180);

  if (label.length < 1 || label.length > 60) errors.label = "Escribe un nombre corto, por ejemplo «Casa».";
  if (addressLine.length < 5 || addressLine.length > 200) errors.addressLine = "Escribe la dirección completa.";
  if (details.length > 200) errors.details = "Máximo 200 caracteres.";
  if (!UUID.test(zoneId)) errors.zoneId = "Elige el municipio.";
  if (lat === null || lng === null) errors.lat = "Marca en el mapa el punto de entrega.";

  if (Object.keys(errors).length > 0 || lat === null || lng === null) return { ok: false, errors };
  return { ok: true, value: { label, addressLine, details: details || null, zoneId, lat, lng } };
}

/** "850 m" or "3,2 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} km`;
}
