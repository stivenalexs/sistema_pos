// Proof of delivery and failed attempts, without I/O (D-007, D-045, D-068).
// The database checks the same rules again.

import { text } from "./form-text";

// Grouped as the courier sees them (D-068): what each group triggers is
// decided by the database (private.delivery_failure_kind).
export const FAILURE_REASON_GROUPS = [
  {
    label: "Del cliente o del lugar (el cliente elige qué hacer)",
    reasons: ["recipient_absent", "inaccessible_location", "no_id_document", "refused", "other"],
  },
  { label: "Menor de edad (se reembolsan los productos)", reasons: ["recipient_underage"] },
  {
    label: "Fuerza mayor (se reprograma para mañana)",
    reasons: ["courier_accident", "vehicle_breakdown", "weather_or_disaster", "other_force_majeure"],
  },
] as const;

export const FAILURE_REASONS = [
  "recipient_underage",
  "no_id_document",
  "recipient_absent",
  "refused",
  "other",
  "inaccessible_location",
  "courier_accident",
  "vehicle_breakdown",
  "weather_or_disaster",
  "other_force_majeure",
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  recipient_underage: "Quien recibe es menor de edad o no lo pudo acreditar",
  no_id_document: "No presentó la cédula",
  recipient_absent: "No había nadie para recibir",
  refused: "No quiso recibir el pedido",
  other: "Otro motivo del cliente o del lugar",
  inaccessible_location: "No se pudo llegar a la dirección",
  courier_accident: "Accidente del mensajero",
  vehicle_breakdown: "Avería del vehículo",
  weather_or_disaster: "Clima o emergencia (inundación, temblor…)",
  other_force_majeure: "Otro imprevisto de fuerza mayor",
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
