import "server-only";

import { createSupabaseServerClient } from "@/shared/supabase/server";

import type { DeliveryQuoteError } from "../domain/delivery";

// Zones, addresses and delivery fee (D-005, D-021, D-045). Everything runs
// with the customer's session; the fee is always computed by the database.

export type DeliveryZone = { id: string; municipality: string };

export type DeliveryAddress = {
  id: string;
  label: string;
  addressLine: string;
  details: string | null;
  municipality: string;
  zoneActive: boolean;
  lat: number;
  lng: number;
  distanceM: number | null;
};

export type DeliveryQuote =
  | { ok: true; feeCop: number; distanceM: number; ruleName: string }
  | { ok: false; error: DeliveryQuoteError };

export type StoreLocation = { lat: number; lng: number };

export async function getDeliveryZones(): Promise<DeliveryZone[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_zones")
    .select("id, municipality")
    .eq("is_active", true)
    .order("municipality");
  if (error) throw new Error(`delivery_zones failed: ${error.message}`);
  return data.map((zone) => ({ id: zone.id, municipality: zone.municipality }));
}

export async function getDeliveryAddresses(): Promise<DeliveryAddress[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_delivery_addresses");
  if (error) throw new Error(`get_delivery_addresses failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    addressLine: row.address_line,
    details: row.details,
    municipality: row.municipality,
    zoneActive: row.zone_active,
    lat: row.lat,
    lng: row.lng,
    distanceM: row.distance_m,
  }));
}

/** Fee to deliver the customer's current cart to one of their addresses. */
export async function quoteDelivery(addressId: string): Promise<DeliveryQuote> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("quote_delivery", { p_address_id: addressId });
  if (error) throw new Error(`quote_delivery failed: ${error.message}`);
  const result = data as {
    ok: boolean;
    fee_cop?: number;
    distance_m?: number;
    rule_name?: string;
    error?: DeliveryQuoteError;
  };
  if (result.ok && result.fee_cop != null && result.distance_m != null) {
    return { ok: true, feeCop: result.fee_cop, distanceM: result.distance_m, ruleName: result.rule_name ?? "" };
  }
  return { ok: false, error: result.error ?? "no_fee_rule" };
}

/**
 * Where the map starts. The store location lives in app_settings, which only
 * staff can read, so customers get a fixed center of the Valle de Aburrá.
 */
export const MAP_DEFAULT_CENTER: StoreLocation = { lat: 6.2442, lng: -75.5812 };
