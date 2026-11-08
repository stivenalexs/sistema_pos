// POS rules without I/O (D-053). The database prices the sale and checks the
// stock again; these helpers only drive the cashier's screen.

export type PosPaymentMethod = "cash" | "card" | "transfer";

export const POS_PAYMENT_METHODS: readonly PosPaymentMethod[] = ["cash", "card", "transfer"];

export const POS_PAYMENT_LABELS: Record<PosPaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta (datáfono)",
  transfer: "Transferencia",
};

export type PosCatalogItem = {
  productId: string;
  sku: string;
  name: string;
  saleUnit: "unit" | "box";
  unitsPerBox: number;
  minQuantity: number;
  priceCop: number;
  /** In the buyer's sale unit (units, or whole boxes). */
  availableSaleUnits: number;
};

export type PosCart = Record<string, number>;

/** Adds one, never beyond what is available. */
export function addToCart(cart: PosCart, item: PosCatalogItem): PosCart {
  const current = cart[item.productId] ?? 0;
  if (current >= item.availableSaleUnits) return cart;
  const next = current === 0 ? Math.min(Math.max(item.minQuantity, 1), item.availableSaleUnits) : current + 1;
  return { ...cart, [item.productId]: next };
}

/** Sets a quantity (0 removes it), limited to 0..available. */
export function setCartQuantity(cart: PosCart, item: PosCatalogItem, quantity: number): PosCart {
  const safe = Number.isFinite(quantity) ? Math.trunc(quantity) : 0;
  const clamped = Math.max(0, Math.min(safe, item.availableSaleUnits));
  const next = { ...cart };
  if (clamped === 0) delete next[item.productId];
  else next[item.productId] = clamped;
  return next;
}

export type CartLineView = { item: PosCatalogItem; quantity: number; lineTotalCop: number; belowMinimum: boolean };

/** Display totals. The amount charged is the one computed by the server. */
export function cartLines(cart: PosCart, catalog: PosCatalogItem[]): { lines: CartLineView[]; totalCop: number } {
  const lines = catalog
    .filter((item) => (cart[item.productId] ?? 0) > 0)
    .map((item) => {
      const quantity = cart[item.productId] ?? 0;
      return { item, quantity, lineTotalCop: quantity * item.priceCop, belowMinimum: quantity < item.minQuantity };
    });
  return { lines, totalCop: lines.reduce((sum, line) => sum + line.lineTotalCop, 0) };
}

/** Change for a cash payment, or null when the cash does not cover the total. */
export function changeFor(totalCop: number, receivedCop: number | null): number | null {
  if (receivedCop === null || !Number.isSafeInteger(receivedCop) || receivedCop < totalCop) return null;
  return receivedCop - totalCop;
}

/** "100.000", "$ 100.000" or "100000" typed by the cashier, in whole pesos. */
export function parseCashInput(raw: string): number | null {
  const digits = raw.replace(/[$\s.]/g, "");
  if (!/^\d{1,10}$/.test(digits)) return null;
  return Number(digits);
}

export const POS_ERROR_MESSAGES: Record<string, string> = {
  pos_forbidden: "Tu usuario no puede vender en la caja.",
  age_not_confirmed: "Confirma que verificaste la mayoría de edad del comprador.",
  invalid_payment_method: "Elige el medio de pago.",
  customer_not_found: "No encontramos al cliente. Vende como consumidor final o búscalo de nuevo.",
  quote_failed: "Revisa las cantidades: algún producto no está disponible o no cumple el mínimo.",
  cash_insufficient: "El efectivo recibido no alcanza para el total.",
  insufficient_stock: "No hay unidades suficientes de un producto. Ajusta la cantidad.",
  sales_blocked: "Las ventas están suspendidas en este momento.",
  idempotency_key_conflict: "No se pudo registrar la venta. Empieza una venta nueva.",
  invalid_sale: "Revisa la venta: faltan productos o datos.",
};
