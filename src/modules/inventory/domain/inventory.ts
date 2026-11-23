// Pure inventory rules for the admin panel (D-038, D-056). No I/O.

import { readRaisedError, rpcFailureMessage } from "@/shared/supabase/rpc-result";

export type MovementType =
  | "purchase_in"
  | "web_sale"
  | "pos_sale"
  | "adjustment"
  | "waste"
  | "return_in"
  | "reservation"
  | "reservation_release";

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  purchase_in: "Entrada",
  web_sale: "Venta web",
  pos_sale: "Venta POS",
  adjustment: "Ajuste por conteo",
  waste: "Merma",
  return_in: "Devolución",
  reservation: "Reserva web",
  reservation_release: "Fin de reserva",
};

/** Largest quantity accepted in one movement (the database checks it too). */
export const MAX_MOVEMENT_UNITS = 100_000;
export const MAX_COUNT_UNITS = 1_000_000;
export const MAX_SETTING_UNITS = 100_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Whole number between min and max written by a person, or null. */
export function parseWholeNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" || !/^\d{1,7}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= min && n <= max ? n : null;
}

const RELOAD = "Recarga la página e inténtalo de nuevo.";

export const INVENTORY_MESSAGES: Record<string, string> = {
  inventory_forbidden: "Solo administración o bodega pueden hacer esto.",
  inventory_missing_idempotency_key: RELOAD,
  inventory_idempotency_key_conflict: RELOAD,
  // UNIQUE constraint: two simultaneous submissions with the same key.
  inventory_movements_idempotency_key_key: RELOAD,
  inventory_invalid_units: "Escribe una cantidad válida de unidades.",
  inventory_missing_reference: "Escribe el documento de la entrada (factura o remisión, hasta 120 caracteres).",
  inventory_missing_reason: "Escribe el motivo (entre 3 y 300 caracteres).",
  inventory_invalid_reason: "Escribe el motivo (entre 3 y 300 caracteres).",
  inventory_unknown_product: "Ese producto no existe.",
  inventory_count_below_reserved:
    "El conteo es menor que lo reservado para pedidos web pendientes. Revisa esos pedidos antes de ajustar.",
  inventory_insufficient_stock: "No hay tantas unidades disponibles (existencias menos reservado).",
  inventory_invalid_settings: `Los valores deben ser números enteros entre 0 y ${MAX_SETTING_UNITS.toLocaleString("es-CO")}.`,
};

/** Spanish message for a database error, matched by its code in the text. */
export function inventoryErrorMessage(errorText: string): string {
  // readRaisedError tries the longest codes first, so
  // "inventory_missing_reason" never matches a shorter prefix.
  const failure = readRaisedError({ message: errorText }, INVENTORY_MESSAGES)!;
  return rpcFailureMessage(failure, INVENTORY_MESSAGES, "No se pudo registrar. Inténtalo de nuevo.");
}

/** "12 u. (1 caja de 12)" style hint of a quantity in base units. */
export function unitsWithBoxes(units: number, unitsPerBox: number): string {
  const base = `${units.toLocaleString("es-CO")} u.`;
  if (unitsPerBox <= 1 || Math.abs(units) < unitsPerBox) return base;
  const boxes = Math.trunc(Math.abs(units) / unitsPerBox);
  const rest = Math.abs(units) % unitsPerBox;
  const boxText = `${boxes} ${boxes === 1 ? "caja" : "cajas"} de ${unitsPerBox}`;
  return `${base} (${boxText}${rest ? ` + ${rest}` : ""})`;
}
