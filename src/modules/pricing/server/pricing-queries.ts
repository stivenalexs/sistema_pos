import "server-only";

import { createSupabaseServerClient } from "@/shared/supabase/server";

import type { CatalogItem, Quote, QuoteItemInput, QuoteLine } from "../domain/pricing";

// Server-side access to the pricing functions (D-036). They run with the
// user's session, so RLS decides what each customer can see and pay.

/** Catalog with prices for the current user (or visitor). */
export async function getCatalog(): Promise<CatalogItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_catalog");
  if (error) throw new Error(`get_catalog failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    brand: row.brand,
    volumeMl: row.volume_ml,
    origin: row.origin,
    saleUnit: row.sale_unit === "box" ? "box" : "unit",
    unitsPerBox: row.units_per_box,
    minQuantity: row.min_quantity,
    priceCop: row.price_cop,
  }));
}

type RawQuoteLine = {
  index: number;
  product_id: string | null;
  quantity: number | null;
  unit_price_cop: number | null;
  line_total_cop: number | null;
  base_units: number | null;
  min_quantity: number | null;
  error: QuoteLine["error"];
};

type RawQuote = {
  ok: boolean;
  sale_unit: "unit" | "box";
  total_cop: number | null;
  total_boxes: number | null;
  total_base_units: number | null;
  lines: RawQuoteLine[];
};

/**
 * Prices items for the current user. Only product ids and quantities are
 * sent: the price always comes from the database.
 */
export async function quoteItems(items: QuoteItemInput[]): Promise<Quote> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("quote_items", {
    p_items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
  });
  if (error) throw new Error(`quote_items failed: ${error.message}`);

  const raw = data as RawQuote;
  return {
    ok: raw.ok,
    saleUnit: raw.sale_unit,
    totalCop: raw.total_cop,
    totalBoxes: raw.total_boxes,
    totalBaseUnits: raw.total_base_units,
    lines: raw.lines.map((line) => ({
      index: line.index,
      productId: line.product_id,
      quantity: line.quantity,
      unitPriceCop: line.unit_price_cop,
      lineTotalCop: line.line_total_cop,
      baseUnits: line.base_units,
      minQuantity: line.min_quantity,
      error: line.error,
    })),
  };
}
