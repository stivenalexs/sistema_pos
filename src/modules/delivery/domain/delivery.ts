// Delivery rules without I/O (D-005, D-007, D-045). The database checks the
// same rules again: this layer only gives clear messages early.

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

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

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

// ---------------------------------------------------------------------------
// Proof of delivery (D-007)
// ---------------------------------------------------------------------------

export const FAILURE_REASONS = [
  "recipient_underage",
  "no_id_document",
  "recipient_absent",
  "refused",
  "other",
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  recipient_underage: "Quien recibe es menor de edad o no lo pudo acreditar",
  no_id_document: "No presentó la cédula",
  recipient_absent: "No había nadie para recibir",
  refused: "No quiso recibir el pedido",
  other: "Otro motivo",
};

export const PROOF_ERROR_MESSAGES: Record<string, string> = {
  order_not_out_for_delivery: "Este pedido ya no está en camino.",
  delivery_forbidden: "Este pedido no está asignado a ti.",
  age_not_confirmed: "Confirma que quien recibe es mayor de edad. Si no lo es, registra un intento fallido.",
  invalid_recipient_name: "Escribe el nombre de quien recibe.",
  invalid_document_number: "La cédula debe tener entre 5 y 12 dígitos, sin puntos.",
  signature_missing: "Falta la firma de quien recibe.",
  invalid_failure_reason: "Elige el motivo del intento fallido.",
  invalid_notes: "Las notas tienen máximo 500 caracteres.",
};

export type ProofInput =
  | {
      outcome: "delivered";
      recipientName: string;
      documentNumber: string;
      ageConfirmed: true;
      notes: string | null;
    }
  | { outcome: "failed"; failureReason: FailureReason; notes: string | null };

/** Validates the courier form. Returns the first error code, like the database. */
export function parseProofInput(raw: {
  outcome: unknown;
  recipientName: unknown;
  documentNumber: unknown;
  ageConfirmed: unknown;
  failureReason: unknown;
  notes: unknown;
}): { ok: true; value: ProofInput } | { ok: false; error: string } {
  const notes = text(raw.notes);
  if (notes.length > 500) return { ok: false, error: "invalid_notes" };

  if (raw.outcome === "failed") {
    const reason = text(raw.failureReason);
    if (!(FAILURE_REASONS as readonly string[]).includes(reason)) {
      return { ok: false, error: "invalid_failure_reason" };
    }
    return { ok: true, value: { outcome: "failed", failureReason: reason as FailureReason, notes: notes || null } };
  }
  if (raw.outcome !== "delivered") return { ok: false, error: "invalid_outcome" };

  if (raw.ageConfirmed !== true && raw.ageConfirmed !== "true") return { ok: false, error: "age_not_confirmed" };
  const recipientName = text(raw.recipientName);
  if (recipientName.length < 3 || recipientName.length > 120) return { ok: false, error: "invalid_recipient_name" };
  // People often type the cédula with dots ("1.020.304.050").
  const documentNumber = text(raw.documentNumber).replace(/[.\s]/g, "");
  if (!/^\d{5,12}$/.test(documentNumber)) return { ok: false, error: "invalid_document_number" };

  return {
    ok: true,
    value: { outcome: "delivered", recipientName, documentNumber, ageConfirmed: true, notes: notes || null },
  };
}

export const MAX_SIGNATURE_BYTES = 200 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A non-empty PNG of at most 200 KB (the bucket enforces the same). */
export function isValidSignaturePng(bytes: Uint8Array): boolean {
  if (bytes.length <= PNG_MAGIC.length || bytes.length > MAX_SIGNATURE_BYTES) return false;
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** Object name in the delivery-signatures bucket: one per intent. */
export function signaturePath(orderId: string, idempotencyKey: string): string {
  return `${orderId}/${idempotencyKey}.png`;
}

/** "850 m" or "3,2 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} km`;
}

// ---------------------------------------------------------------------------
// Assignment from the admin panel (D-057)
// ---------------------------------------------------------------------------

/**
 * One value per option of the assignment select, so a courier never goes
 * with another provider: "own:<provider>:<courier>" or "third:<provider>".
 */
export function encodeAssignment(providerId: string, courierId: string | null): string {
  return courierId ? `own:${providerId}:${courierId}` : `third:${providerId}`;
}

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const OWN_ASSIGNMENT = new RegExp(`^own:(${UUID_PART}):(${UUID_PART})$`, "i");
const THIRD_ASSIGNMENT = new RegExp(`^third:(${UUID_PART})$`, "i");

export function parseAssignment(value: unknown): { providerId: string; courierId: string | null } | null {
  if (typeof value !== "string") return null;
  const own = OWN_ASSIGNMENT.exec(value);
  if (own) return { providerId: own[1]!, courierId: own[2]! };
  const third = THIRD_ASSIGNMENT.exec(value);
  return third ? { providerId: third[1]!, courierId: null } : null;
}

export const ASSIGNMENT_ERROR_MESSAGES: Record<string, string> = {
  delivery_forbidden: "Solo un administrador puede asignar domicilios.",
  delivery_order_not_assignable:
    "Ese pedido ya no se puede asignar (no está pagado, ya se entregó o está marcado para reembolso).",
  delivery_unknown_provider: "Ese proveedor no existe o está inactivo.",
  delivery_invalid_courier: "Ese mensajero no está activo o no pertenece al proveedor.",
};
