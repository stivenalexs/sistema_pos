import "server-only";

import { type Quote, type QuoteLine, quoteItems, type SaleUnit } from "@/modules/pricing";
import { createSupabaseServerClient } from "@/shared/supabase/server";

export type CartLine = {
  productId: string;
  name: string;
  quantity: number;
  quote: QuoteLine | null;
  /** Units the web can still sell, in the customer's sale unit. */
  availableSaleUnits: number | null;
};

export type CartView = {
  lines: CartLine[];
  quote: Quote | null;
  saleUnit: SaleUnit;
};

/**
 * The signed-in customer's cart, priced by the server. Never trusts a price
 * from the browser: the cart stores only product and quantity.
 */
export async function getCartView(): Promise<CartView> {
  const supabase = await createSupabaseServerClient();

  const { data: rawItems, error } = await supabase.rpc("get_cart_items");
  if (error) throw new Error(`get_cart_items failed: ${error.message}`);
  const items = (rawItems ?? []) as { product_id: string; quantity: number }[];

  if (items.length === 0) {
    return { lines: [], quote: null, saleUnit: "unit" };
  }

  const ids = items.map((item) => item.product_id);
  const [quote, products, availability] = await Promise.all([
    quoteItems(items.map((item) => ({ productId: item.product_id, quantity: item.quantity }))),
    // RLS: a product the customer cannot see (e.g. imported for retail) has no name here.
    supabase.from("products").select("id, name").in("id", ids),
    supabase.rpc("get_web_availability"),
  ]);

  const names = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  const available = new Map(
    (availability.data ?? []).map((a) => [a.product_id, a.available_sale_units]),
  );

  return {
    saleUnit: quote.saleUnit,
    quote,
    lines: items.map((item, index) => ({
      productId: item.product_id,
      name: names.get(item.product_id) ?? "Producto no disponible",
      quantity: item.quantity,
      quote: quote.lines[index] ?? null,
      availableSaleUnits: available.get(item.product_id) ?? null,
    })),
  };
}
