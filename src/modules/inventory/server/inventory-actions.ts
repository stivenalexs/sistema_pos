"use server";

import { refresh } from "next/cache";

import { createSupabaseServerClient } from "@/shared/supabase/server";
import { IDEMPOTENCY_FIELD, type IdempotentFormState } from "@/shared/ui/idempotent-form-state";

import {
  inventoryErrorMessage,
  isUuid,
  MAX_COUNT_UNITS,
  MAX_MOVEMENT_UNITS,
  MAX_SETTING_UNITS,
  parseWholeNumber,
} from "../domain/inventory";

// Inventory movements from the admin panel (D-056): synchronous (a short
// transaction), with the form's idempotency key. The database checks the
// role, the rules and the key; these actions only parse and translate.

type FormValues = Record<string, string>;

function valuesOf(formData: FormData, names: string[]): FormValues {
  const values: FormValues = {};
  for (const name of names) {
    const value = formData.get(name);
    values[name] = typeof value === "string" ? value : "";
  }
  return values;
}

function answer(
  previous: IdempotentFormState,
  status: "ok" | "error",
  message: string,
  values?: FormValues,
): IdempotentFormState {
  return { status, message, values, answer: (previous.answer ?? 0) + 1 };
}

const RELOAD = "Recarga la página e inténtalo de nuevo.";

function unitsText(units: number): string {
  return `${units.toLocaleString("es-CO")} ${units === 1 ? "unidad" : "unidades"}`;
}

export async function recordEntryAction(previous: IdempotentFormState, formData: FormData): Promise<IdempotentFormState> {
  const values = valuesOf(formData, ["productId", "units", "reference", "note"]);
  const key = formData.get(IDEMPOTENCY_FIELD);
  if (!isUuid(key)) return { ...previous, status: "error", message: RELOAD, values };
  const units = parseWholeNumber(values.units, 1, MAX_MOVEMENT_UNITS);
  const reference = values.reference!.trim();
  if (!isUuid(values.productId)) return answer(previous, "error", "Elige un producto.", values);
  if (units === null) return answer(previous, "error", inventoryErrorMessage("inventory_invalid_units"), values);
  if (reference.length < 3 || reference.length > 120) {
    return answer(previous, "error", inventoryErrorMessage("inventory_missing_reference"), values);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_stock_entry", {
    p_product_id: values.productId!,
    p_units: units,
    p_reference: reference,
    p_idempotency_key: key,
    p_reason: values.note!.trim() || undefined,
  });
  if (error) return answer(previous, "error", inventoryErrorMessage(error.message), values);
  refresh();
  return answer(previous, "ok", `Entrada registrada: ${unitsText(units)}.`);
}

export async function recordCountAction(previous: IdempotentFormState, formData: FormData): Promise<IdempotentFormState> {
  const values = valuesOf(formData, ["productId", "counted", "reason"]);
  const key = formData.get(IDEMPOTENCY_FIELD);
  if (!isUuid(key)) return { ...previous, status: "error", message: RELOAD, values };
  const counted = parseWholeNumber(values.counted, 0, MAX_COUNT_UNITS);
  const reason = values.reason!.trim();
  if (!isUuid(values.productId)) return answer(previous, "error", "Elige un producto.", values);
  if (counted === null) return answer(previous, "error", inventoryErrorMessage("inventory_invalid_units"), values);
  if (reason.length < 3 || reason.length > 300) {
    return answer(previous, "error", inventoryErrorMessage("inventory_missing_reason"), values);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("record_count", {
    p_product_id: values.productId!,
    p_counted_units: counted,
    p_reason: reason,
    p_idempotency_key: key,
  });
  if (error) return answer(previous, "error", inventoryErrorMessage(error.message), values);
  refresh();
  return answer(
    previous,
    "ok",
    data ? "Conteo registrado: se ajustaron las existencias." : "El conteo coincide con las existencias; no hubo ajuste.",
  );
}

export async function recordWasteAction(previous: IdempotentFormState, formData: FormData): Promise<IdempotentFormState> {
  const values = valuesOf(formData, ["productId", "units", "reason"]);
  const key = formData.get(IDEMPOTENCY_FIELD);
  if (!isUuid(key)) return { ...previous, status: "error", message: RELOAD, values };
  const units = parseWholeNumber(values.units, 1, MAX_MOVEMENT_UNITS);
  const reason = values.reason!.trim();
  if (!isUuid(values.productId)) return answer(previous, "error", "Elige un producto.", values);
  if (units === null) return answer(previous, "error", inventoryErrorMessage("inventory_invalid_units"), values);
  if (reason.length < 3 || reason.length > 300) {
    return answer(previous, "error", inventoryErrorMessage("inventory_missing_reason"), values);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_waste", {
    p_product_id: values.productId!,
    p_units: units,
    p_reason: reason,
    p_idempotency_key: key,
  });
  if (error) return answer(previous, "error", inventoryErrorMessage(error.message), values);
  refresh();
  return answer(previous, "ok", `Merma registrada: ${unitsText(units)}.`);
}

// Threshold and web safety stock (no movement, so no idempotency key: the
// same values twice change nothing).
export async function setStockSettingsAction(
  previous: IdempotentFormState,
  formData: FormData,
): Promise<IdempotentFormState> {
  const values = valuesOf(formData, ["productId", "lowStockThreshold", "webSafetyStock"]);
  const threshold = parseWholeNumber(values.lowStockThreshold, 0, MAX_SETTING_UNITS);
  const safety = parseWholeNumber(values.webSafetyStock, 0, MAX_SETTING_UNITS);
  if (!isUuid(values.productId)) return answer(previous, "error", "Elige un producto.", values);
  if (threshold === null || safety === null) {
    return answer(previous, "error", inventoryErrorMessage("inventory_invalid_settings"), values);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_stock_settings", {
    p_product_id: values.productId!,
    p_low_stock_threshold: threshold,
    p_web_safety_stock: safety,
  });
  if (error) return answer(previous, "error", inventoryErrorMessage(error.message), values);
  refresh();
  const changed = (data as { changed?: boolean } | null)?.changed;
  return answer(previous, "ok", changed ? "Valores guardados." : "No había cambios.", values);
}
