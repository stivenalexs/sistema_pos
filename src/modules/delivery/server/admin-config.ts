"use server";

import { refresh } from "next/cache";

import { readRpcResult, rpcFailureMessage } from "@/shared/supabase/rpc-result";
import { createSupabaseServerClient } from "@/shared/supabase/server";
import type { ActionFormState } from "@/shared/ui/action-form-state";

import { parseFeeRuleInput, STORE_SETTINGS_ERROR_MESSAGES } from "../domain/store-config";

// Store settings, delivery zones and fee rules from the admin panel (D-045,
// D-058). The database checks the admin role (set_store_settings, RLS on
// zones and fee rules) and records every change in config_changes. None of
// these writes moves money or stock, and repeating one leaves the same
// state, so they need no idempotency key.

export type ConfigChange = {
  tableName: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  rowId: string;
  oldRow: Record<string, unknown> | null;
  newRow: Record<string, unknown> | null;
  createdAt: string;
  changedBy: string | null;
};

export type AdminZone = { id: string; municipality: string; daneCode: string; isActive: boolean; addresses: number };

export type FeeRule = {
  id: string;
  name: string;
  customerType: "retail" | "wholesale" | null;
  minBoxes: number | null;
  maxDistanceM: number | null;
  feeCop: number;
  isActive: boolean;
};

export type ConfigOverview = {
  store: { lat: number | null; lng: number | null; zoneId: string | null; maxDistanceM: number };
  zones: AdminZone[];
  feeRules: FeeRule[];
  changes: ConfigChange[];
};

export async function getConfigOverview(): Promise<ConfigOverview> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_config_overview");
  if (error) throw new Error(`admin_config_overview failed: ${error.message}`);
  const row = data as {
    store: { location: { lat: number; lng: number } | null; zone_id: string | null; max_distance_m: number };
    zones: { id: string; municipality: string; dane_code: string; is_active: boolean; addresses: number }[];
    fee_rules: {
      id: string;
      name: string;
      customer_type: FeeRule["customerType"];
      min_boxes: number | null;
      max_distance_m: number | null;
      fee_cop: number;
      is_active: boolean;
    }[];
    changes: {
      table_name: string;
      operation: ConfigChange["operation"];
      row_id: string;
      old_row: Record<string, unknown> | null;
      new_row: Record<string, unknown> | null;
      created_at: string;
      changed_by: string | null;
    }[];
  };
  return {
    store: {
      lat: row.store.location?.lat ?? null,
      lng: row.store.location?.lng ?? null,
      zoneId: row.store.zone_id,
      maxDistanceM: row.store.max_distance_m,
    },
    zones: row.zones.map((z) => ({
      id: z.id,
      municipality: z.municipality,
      daneCode: z.dane_code,
      isActive: z.is_active,
      addresses: z.addresses,
    })),
    feeRules: row.fee_rules.map((r) => ({
      id: r.id,
      name: r.name,
      customerType: r.customer_type,
      minBoxes: r.min_boxes,
      maxDistanceM: r.max_distance_m,
      feeCop: r.fee_cop,
      isActive: r.is_active,
    })),
    changes: row.changes.map((c) => ({
      tableName: c.table_name,
      operation: c.operation,
      rowId: c.row_id,
      oldRow: c.old_row,
      newRow: c.new_row,
      createdAt: c.created_at,
      changedBy: c.changed_by,
    })),
  };
}

function answer(
  previous: ActionFormState,
  status: "ok" | "error",
  message: string,
  values?: Record<string, string>,
): ActionFormState {
  return { status, message, values, answer: (previous.answer ?? 0) + 1 };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveStoreSettingsAction(
  previous: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const values = {
    lat: text(formData, "lat"),
    lng: text(formData, "lng"),
    zoneId: text(formData, "zoneId"),
    maxDistanceKm: text(formData, "maxDistanceKm"),
  };
  const lat = Number(values.lat);
  const lng = Number(values.lng);
  const km = Number(values.maxDistanceKm);
  if (!values.lat || !values.lng || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return answer(previous, "error", "Marca en el mapa dónde está la tienda.", values);
  }
  if (!/^\d{1,2}$/.test(values.maxDistanceKm) || km < 1 || km > 50) {
    return answer(previous, "error", STORE_SETTINGS_ERROR_MESSAGES.invalid_max_distance!, values);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_store_settings", {
    p_lat: lat,
    p_lng: lng,
    p_zone_id: values.zoneId,
    p_max_distance_m: km * 1000,
  });
  const result = readRpcResult<{ changed?: boolean }>({ data, error }, STORE_SETTINGS_ERROR_MESSAGES);
  if (!result.ok) {
    return answer(previous, "error", rpcFailureMessage(result, STORE_SETTINGS_ERROR_MESSAGES, "No se pudo guardar."), values);
  }
  refresh();
  return answer(previous, "ok", result.value.changed ? "Datos de la tienda guardados." : "No había cambios.");
}

export async function setZoneActiveAction(previous: ActionFormState, formData: FormData): Promise<ActionFormState> {
  const zoneId = text(formData, "zoneId");
  const active = text(formData, "active") === "true";
  const supabase = await createSupabaseServerClient();
  // RLS and a column privilege: only the administrator, only is_active.
  const { data, error } = await supabase.from("delivery_zones").update({ is_active: active }).eq("id", zoneId).select("id");
  if (error || !data?.length) return answer(previous, "error", "No se pudo cambiar el municipio.");
  refresh();
  return answer(previous, "ok", active ? "Domicilios activados." : "Domicilios desactivados.");
}

export async function saveFeeRuleAction(previous: ActionFormState, formData: FormData): Promise<ActionFormState> {
  const values = {
    name: text(formData, "name"),
    customerType: text(formData, "customerType"),
    minBoxes: text(formData, "minBoxes"),
    maxDistanceM: text(formData, "maxDistanceM"),
    feeCop: text(formData, "feeCop"),
  };
  const parsed = parseFeeRuleInput(values);
  if (!parsed.ok) return answer(previous, "error", parsed.message, values);

  const ruleId = text(formData, "ruleId");
  const row = {
    name: parsed.value.name,
    customer_type: parsed.value.customerType,
    min_boxes: parsed.value.minBoxes,
    max_distance_m: parsed.value.maxDistanceM,
    fee_cop: parsed.value.feeCop,
  };
  const supabase = await createSupabaseServerClient();
  const { data, error } = ruleId
    ? await supabase.from("delivery_fee_rules").update(row).eq("id", ruleId).select("id")
    : await supabase.from("delivery_fee_rules").insert(row).select("id");
  if (error || !data?.length) return answer(previous, "error", "No se pudo guardar la tarifa.", values);
  refresh();
  return answer(previous, "ok", ruleId ? "Tarifa actualizada." : "Tarifa creada.");
}

export async function setFeeRuleActiveAction(
  previous: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  const ruleId = text(formData, "ruleId");
  const active = text(formData, "active") === "true";
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_fee_rules")
    .update({ is_active: active })
    .eq("id", ruleId)
    .select("id");
  if (error || !data?.length) return answer(previous, "error", "No se pudo cambiar la tarifa.");
  refresh();
  return answer(previous, "ok", active ? "Tarifa activada." : "Tarifa desactivada.");
}
