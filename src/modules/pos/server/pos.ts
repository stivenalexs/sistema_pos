import "server-only";

import { createSupabaseServerClient } from "@/shared/supabase/server";

import { type PosCatalogItem, type PosPaymentMethod, POS_PAYMENT_METHODS } from "../domain/pos";

// POS server side (D-053). Everything runs with the cashier's session; the
// database checks the role, prices the sale, takes the stock and enqueues
// the invoice in one transaction.

export type PosStaff = { userId: string; role: "cashier" | "admin" };

export async function getPosStaff(): Promise<PosStaff | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const role = (claims?.app_metadata as { staff_role?: unknown } | undefined)?.staff_role;
  if (!claims?.sub || (role !== "cashier" && role !== "admin")) return null;
  return { userId: claims.sub, role };
}

export type PosCustomer = {
  id: string;
  fullName: string;
  customerType: "retail" | "wholesale";
  wholesaleStatus: "pending" | "approved" | "rejected" | null;
};

/** A registered customer by cédula/NIT or email, or null. */
export async function findPosCustomer(query: string): Promise<PosCustomer | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("find_pos_customer", { p_query: query.slice(0, 120) });
  if (error) throw new Error(`find_pos_customer failed: ${error.message}`);
  const row = data as { id?: string; full_name?: string; customer_type?: string; wholesale_status?: string | null } | null;
  if (!row?.id || !row.full_name) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    customerType: row.customer_type === "wholesale" ? "wholesale" : "retail",
    wholesaleStatus: (row.wholesale_status ?? null) as PosCustomer["wholesaleStatus"],
  };
}

export type PosCatalog = { ok: true; saleUnit: "unit" | "box"; items: PosCatalogItem[] } | { ok: false; error: "customer_not_found" };

export async function getPosCatalog(customerId: string | null): Promise<PosCatalog> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_pos_catalog", {
    // The function accepts null (default retail buyer); the types mark it as string.
    p_customer_id: customerId as string,
  });
  if (error) throw new Error(`get_pos_catalog failed: ${error.message}`);
  const result = data as {
    ok: boolean;
    sale_unit?: "unit" | "box";
    items?: {
      product_id: string;
      sku: string;
      name: string;
      sale_unit: "unit" | "box";
      units_per_box: number;
      min_quantity: number;
      price_cop: number;
      available_sale_units: number;
    }[];
  };
  if (!result.ok) return { ok: false, error: "customer_not_found" };
  return {
    ok: true,
    saleUnit: result.sale_unit ?? "unit",
    items: (result.items ?? []).map((item) => ({
      productId: item.product_id,
      sku: item.sku,
      name: item.name,
      saleUnit: item.sale_unit,
      unitsPerBox: item.units_per_box,
      minQuantity: item.min_quantity,
      priceCop: item.price_cop,
      availableSaleUnits: item.available_sale_units,
    })),
  };
}

export type PosSaleInput = {
  items: { productId: string; quantity: number }[];
  paymentMethod: PosPaymentMethod;
  cashReceivedCop: number | null;
  customerId: string | null;
  ageConfirmed: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the request body. Prices are never read from it. */
export function parsePosSaleInput(body: unknown): PosSaleInput | null {
  const b = body as Partial<Record<keyof PosSaleInput, unknown>> | null;
  if (!b || !Array.isArray(b.items) || b.items.length === 0 || b.items.length > 100) return null;
  const items: PosSaleInput["items"] = [];
  for (const raw of b.items) {
    const item = raw as { productId?: unknown; quantity?: unknown };
    if (typeof item.productId !== "string" || !UUID.test(item.productId)) return null;
    if (typeof item.quantity !== "number" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) return null;
    items.push({ productId: item.productId, quantity: item.quantity });
  }
  if (typeof b.paymentMethod !== "string" || !(POS_PAYMENT_METHODS as readonly string[]).includes(b.paymentMethod)) return null;
  const cash = b.cashReceivedCop;
  if (cash !== null && cash !== undefined && (typeof cash !== "number" || !Number.isSafeInteger(cash) || cash < 0)) return null;
  const customerId = b.customerId;
  if (customerId !== null && customerId !== undefined && (typeof customerId !== "string" || !UUID.test(customerId))) return null;
  if (typeof b.ageConfirmed !== "boolean") return null;
  return {
    items,
    paymentMethod: b.paymentMethod as PosPaymentMethod,
    cashReceivedCop: typeof cash === "number" ? cash : null,
    customerId: typeof customerId === "string" ? customerId : null,
    ageConfirmed: b.ageConfirmed,
  };
}

export type PosSaleResult =
  | { ok: true; created: boolean; trackingId: string; orderId: string }
  | { ok: false; error: string; detail?: unknown };

export async function createPosSale(idempotencyKey: string, input: PosSaleInput): Promise<PosSaleResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_pos_sale", {
    p_idempotency_key: idempotencyKey,
    p_items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
    p_payment_method: input.paymentMethod,
    // The function accepts null for the fields that do not apply.
    p_cash_received_cop: input.cashReceivedCop as number,
    p_customer_id: input.customerId as string,
    p_age_confirmed: input.ageConfirmed,
  });
  if (error) {
    if (error.message.includes("idempotency_key_conflict")) return { ok: false, error: "idempotency_key_conflict" };
    if (error.message.includes("pos_forbidden")) return { ok: false, error: "pos_forbidden" };
    throw new Error(`create_pos_sale failed: ${error.message}`);
  }
  const result = data as {
    ok: boolean;
    created?: boolean;
    tracking_id?: string;
    order_id?: string;
    error?: string;
    block?: unknown;
    product_id?: string;
    available_units?: number;
  };
  if (result.ok && result.tracking_id && result.order_id) {
    return { ok: true, created: result.created ?? false, trackingId: result.tracking_id, orderId: result.order_id };
  }
  return {
    ok: false,
    error: result.error ?? "invalid_sale",
    detail: result.block ?? (result.product_id ? { productId: result.product_id, availableUnits: result.available_units } : undefined),
  };
}

export type PosReceipt = {
  orderId: string;
  createdAt: string;
  totalCop: number;
  paymentMethod: PosPaymentMethod;
  cashReceivedCop: number | null;
  changeCop: number | null;
  invoiceStatus: string | null;
  items: { name: string; quantity: number; saleUnit: string; lineTotalCop: number }[];
};

/** Receipt of a POS sale (RLS: staff reads every order). */
export async function getPosReceipt(orderId: string): Promise<PosReceipt | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("orders")
    .select(
      "id, created_at, total_cop, pos_payment_method, cash_received_cop, change_cop, channel, invoices (status), order_items (product_name, quantity, sale_unit, line_total_cop)",
    )
    .eq("id", orderId)
    .eq("channel", "pos")
    .maybeSingle();
  if (!data) return null;
  const invoices = data.invoices as unknown as { status: string }[] | { status: string } | null;
  const invoice = Array.isArray(invoices) ? invoices[0] : invoices;
  return {
    orderId: data.id,
    createdAt: data.created_at,
    totalCop: data.total_cop,
    paymentMethod: (data.pos_payment_method ?? "cash") as PosPaymentMethod,
    cashReceivedCop: data.cash_received_cop,
    changeCop: data.change_cop,
    invoiceStatus: invoice?.status ?? null,
    items: data.order_items.map((item) => ({
      name: item.product_name,
      quantity: item.quantity,
      saleUnit: item.sale_unit,
      lineTotalCop: item.line_total_cop,
    })),
  };
}
