// Pricing types and display helpers (D-036). Pure, no I/O.
// Prices are computed only in the database (get_catalog, quote_items); these
// helpers just shape and format what the server returns.

export type SaleUnit = "unit" | "box";

export type CatalogItem = {
  productId: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string | null;
  volumeMl: number | null;
  origin: "national" | "imported";
  saleUnit: SaleUnit;
  unitsPerBox: number;
  minQuantity: number;
  priceCop: number;
  /** Public URL of the product photo (D-047), or null when it has none. */
  imageUrl: string | null;
};

export type QuoteLineError =
  | "invalid_product"
  | "invalid_quantity"
  | "duplicate_product"
  | "product_unavailable"
  | "below_minimum";

export type QuoteLine = {
  index: number;
  productId: string | null;
  quantity: number | null;
  unitPriceCop: number | null;
  lineTotalCop: number | null;
  baseUnits: number | null;
  minQuantity: number | null;
  error: QuoteLineError | null;
};

export type Quote = {
  ok: boolean;
  saleUnit: SaleUnit;
  totalCop: number | null;
  totalBoxes: number | null;
  totalBaseUnits: number | null;
  lines: QuoteLine[];
};

export type QuoteItemInput = { productId: string; quantity: number };

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formats whole Colombian pesos, e.g. "$ 45.000". */
export function formatCop(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`Amounts in COP must be whole numbers: ${amount}`);
  }
  // Normalise the non-breaking space that Intl puts after the symbol.
  return COP.format(amount).replace(/ /g, " ");
}

export function priceLabel(item: Pick<CatalogItem, "saleUnit" | "priceCop" | "unitsPerBox">): string {
  const price = formatCop(item.priceCop);
  return item.saleUnit === "box"
    ? `${price} por caja de ${item.unitsPerBox}`
    : `${price} c/u`;
}

export function minimumLabel(item: Pick<CatalogItem, "saleUnit" | "minQuantity">): string | null {
  if (item.minQuantity <= 1) return null;
  return item.saleUnit === "box"
    ? `Pedido mínimo: ${item.minQuantity} cajas`
    : `Compra mínima: ${item.minQuantity} unidades`;
}

export const QUOTE_ERROR_MESSAGES: Record<QuoteLineError, string> = {
  invalid_product: "Producto no válido.",
  invalid_quantity: "La cantidad debe ser un número entero mayor que cero.",
  duplicate_product: "El producto está repetido.",
  product_unavailable: "Este producto no está disponible para tu cuenta.",
  below_minimum: "No alcanza la cantidad mínima.",
};
