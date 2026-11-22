"use server";

import { refresh } from "next/cache";

import { createSupabaseServerClient } from "@/shared/supabase/server";
import type { ReasonFormState } from "@/shared/ui/reason-action-form";

// Orders whose money must be returned (D-040, D-055). The administrator
// returns it in the Wompi dashboard and records it here.

export type RefundRow = {
  /** The whole order, or one duplicate payment of it (D-072). */
  kind: "order" | "payment";
  /** The payment attempt to refund when kind is "payment". */
  attemptId: string | null;
  orderId: string;
  status: string;
  totalCop: number;
  /** What to return: the whole order, or only the products (D-068). */
  refundAmountCop: number;
  /** Products only: a partial credit note when it is recorded (D-069). */
  productsOnly: boolean;
  refundReason: string;
  paidAt: string | null;
  customer: string;
  email: string | null;
  transactionId: string | null;
};

export async function listRefunds(): Promise<RefundRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_refunds");
  if (error) throw new Error(`admin_list_refunds failed: ${error.message}`);
  return ((data ?? []) as {
    kind: "order" | "payment"; attempt_id: string | null;
    order_id: string; status: string; total_cop: number; refund_amount_cop: number; products_only: boolean;
    refund_reason: string; paid_at: string | null;
    customer: string; email: string | null; transaction_id: string | null;
  }[]).map((r) => ({
    kind: r.kind,
    attemptId: r.attempt_id,
    orderId: r.order_id,
    status: r.status,
    totalCop: r.total_cop,
    refundAmountCop: r.refund_amount_cop,
    productsOnly: r.products_only,
    refundReason: r.refund_reason,
    paidAt: r.paid_at,
    customer: r.customer,
    email: r.email,
    transactionId: r.transaction_id,
  }));
}

const MESSAGES: Record<string, string> = {
  admin_forbidden: "Solo un administrador puede hacer esto.",
  invalid_reference: "Escribe la referencia del reembolso en Wompi (entre 3 y 120 caracteres).",
  invalid_reason: "Escribe una nota (entre 3 y 300 caracteres).",
  order_not_refundable: "Ese pedido no está marcado para reembolso.",
  // Products only (D-069): the partial credit note needs the invoice issued.
  invoice_in_progress: "La factura de este pedido todavía se está emitiendo. Registra el reembolso en unos minutos.",
};

export async function markRefundedAction(_previous: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  const orderId = formData.get("orderId");
  const reference = formData.get("reference");
  const note = formData.get("note");
  if (typeof orderId !== "string" || typeof reference !== "string" || typeof note !== "string") {
    return { status: "error", message: MESSAGES.invalid_reference };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("mark_order_refunded", {
    p_order_id: orderId,
    p_reference: reference.trim(),
    p_note: note.trim(),
  });
  const result = data as { ok: boolean; error?: string } | null;
  const code = error ? Object.keys(MESSAGES).find((k) => error.message.includes(k)) : result?.ok ? null : result?.error;
  if (error || code) return { status: "error", message: (code && MESSAGES[code]) ?? "No se pudo registrar." };
  refresh();
  return { status: "ok", message: "Reembolso registrado." };
}

const ATTEMPT_MESSAGES: Record<string, string> = {
  admin_forbidden: "Solo un administrador puede hacer esto.",
  invalid_reference: "Escribe la referencia del reembolso en Wompi (entre 3 y 120 caracteres).",
  invalid_reason: "Escribe una nota (entre 3 y 300 caracteres).",
  attempt_not_refundable: "Ese pago no está marcado para reembolso.",
};

/** Records the refund of a duplicate payment; the order is not touched (D-072). */
export async function markAttemptRefundedAction(_previous: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  const attemptId = formData.get("attemptId");
  const reference = formData.get("reference");
  const note = formData.get("note");
  if (typeof attemptId !== "string" || typeof reference !== "string" || typeof note !== "string") {
    return { status: "error", message: ATTEMPT_MESSAGES.invalid_reference };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("mark_attempt_refunded", {
    p_attempt_id: attemptId,
    p_reference: reference.trim(),
    p_note: note.trim(),
  });
  const result = data as { ok: boolean; error?: string } | null;
  const code = error ? Object.keys(ATTEMPT_MESSAGES).find((k) => error.message.includes(k)) : result?.ok ? null : result?.error;
  if (error || code) return { status: "error", message: (code && ATTEMPT_MESSAGES[code]) ?? "No se pudo registrar." };
  refresh();
  return { status: "ok", message: "Reembolso del pago duplicado registrado." };
}
