import "server-only";

import { createSupabaseServerClient } from "@/shared/supabase/server";

import type { MovementType } from "../domain/inventory";

// Inventory reads for the admin panel (D-056). Each database function checks
// the admin or warehouse role; these run with the person's session.

export type StockRow = {
  productId: string;
  sku: string;
  name: string;
  origin: "national" | "imported";
  isActive: boolean;
  unitsPerBox: number;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  webSafetyStock: number;
  isLow: boolean;
};

export async function getInventoryOverview(): Promise<StockRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("inventory_overview");
  if (error) throw new Error(`inventory_overview failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    productId: r.product_id,
    sku: r.sku,
    name: r.name,
    origin: r.origin,
    isActive: r.is_active,
    unitsPerBox: r.units_per_box,
    onHand: r.on_hand,
    reserved: r.reserved,
    available: r.available,
    lowStockThreshold: r.low_stock_threshold,
    webSafetyStock: r.web_safety_stock,
    isLow: r.is_low,
  }));
}

export type MovementRow = {
  id: string;
  createdAt: string;
  productId: string;
  sku: string;
  productName: string;
  type: MovementType;
  units: number;
  reason: string | null;
  reference: string | null;
  recordedBy: string | null;
};

export async function getRecentMovements(options: {
  productId?: string;
  includeReservations?: boolean;
  limit?: number;
} = {}): Promise<MovementRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("inventory_recent_movements", {
    p_product_id: options.productId,
    p_include_reservations: options.includeReservations ?? false,
    p_limit: options.limit ?? 50,
  });
  if (error) throw new Error(`inventory_recent_movements failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.movement_id,
    createdAt: r.created_at,
    productId: r.product_id,
    sku: r.sku,
    productName: r.product_name,
    type: r.movement_type,
    units: r.units,
    reason: r.reason,
    reference: r.reference,
    recordedBy: r.recorded_by,
  }));
}

export type InventoryAlerts = { lowStock: number; stockMismatches: number };

export async function getInventoryAlerts(): Promise<InventoryAlerts> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("inventory_alerts");
  if (error) throw new Error(`inventory_alerts failed: ${error.message}`);
  const row = data as { low_stock: number; stock_mismatches: number };
  return { lowStock: row.low_stock, stockMismatches: row.stock_mismatches };
}
