"use server";

import { refresh } from "next/cache";

import { readRpcResult, rpcFailureMessage } from "@/shared/supabase/rpc-result";
import { createSupabaseServerClient } from "@/shared/supabase/server";
import type { ReasonFormState } from "@/shared/ui/reason-action-form";

import type { PosPaymentMethod } from "../domain/pos";

// POS sales in the admin panel and their void (D-053, D-057). void_pos_sale
// checks the admin role and is idempotent: voiding twice changes nothing.

export type AdminPosSale = {
  orderId: string;
  createdAt: string;
  status: string;
  totalCop: number;
  paymentMethod: PosPaymentMethod | null;
  cashier: string | null;
  customer: string | null;
  /** Bottles (base units), whether sold by unit or by box. */
  units: number;
  invoiceStatus: "pending" | "sent" | "accepted" | "rejected" | null;
  invoiceNumber: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
};

export async function listPosSalesForAdmin(limit = 50): Promise<AdminPosSale[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_pos_sales", { p_limit: limit });
  if (error) throw new Error(`admin_list_pos_sales failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    orderId: r.order_id as string,
    createdAt: r.created_at as string,
    status: r.status as string,
    totalCop: r.total_cop as number,
    paymentMethod: (r.payment_method as PosPaymentMethod | null) ?? null,
    cashier: (r.cashier as string | null) ?? null,
    customer: (r.customer as string | null) ?? null,
    units: r.units as number,
    invoiceStatus: (r.invoice_status as AdminPosSale["invoiceStatus"]) ?? null,
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    voidedAt: (r.voided_at as string | null) ?? null,
    voidReason: (r.void_reason as string | null) ?? null,
    voidedBy: (r.voided_by as string | null) ?? null,
  }));
}

const MESSAGES: Record<string, string> = {
  pos_void_forbidden: "Solo un administrador puede anular ventas.",
  invalid_reason: "Escribe el motivo (entre 3 y 300 caracteres).",
  sale_not_found: "Esa venta no existe.",
  invoice_in_progress:
    "La factura de esta venta se está emitiendo. Espera la respuesta de Factus (revisa Facturas) y vuelve a intentarlo.",
};

export async function voidPosSaleAction(_previous: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  const orderId = formData.get("orderId");
  const reason = formData.get("reason");
  if (typeof orderId !== "string" || typeof reason !== "string") {
    return { status: "error", message: MESSAGES.invalid_reason };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("void_pos_sale", { p_order_id: orderId, p_reason: reason.trim() });
  const result = readRpcResult<{ already_voided?: boolean; credit_note_id?: string | null }>({ data, error }, MESSAGES);
  if (!result.ok) return { status: "error", message: rpcFailureMessage(result, MESSAGES, "No se pudo anular.") };
  refresh();
  if (result.value.already_voided) return { status: "ok", message: "Esa venta ya estaba anulada." };
  return {
    status: "ok",
    message: result.value.credit_note_id
      ? "Venta anulada: el stock volvió al inventario y se pidió la nota crédito."
      : "Venta anulada: el stock volvió al inventario.",
  };
}
