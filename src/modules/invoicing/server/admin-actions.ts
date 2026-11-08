"use server";

import { refresh } from "next/cache";

import { createSupabaseServerClient } from "@/shared/supabase/server";
import type { ReasonFormState } from "@/shared/ui/reason-action-form";

// Retry a rejected invoice or credit note with the same reference (D-055).

const MESSAGES: Record<string, string> = {
  admin_forbidden: "Solo un administrador puede hacer esto.",
  invalid_reason: "Escribe el motivo (entre 3 y 300 caracteres).",
  invoice_not_found: "No encontramos esa factura.",
  invoice_accepted: "Esa factura ya fue aceptada.",
  order_not_invoiceable: "Ese pedido ya no se factura (venta anulada o reembolso).",
  credit_note_not_found: "No encontramos esa nota crédito.",
  credit_note_accepted: "Esa nota crédito ya fue aceptada.",
  action_not_failed: "La emisión todavía está en proceso; espera a que termine.",
};

async function run(fn: "retry_invoice" | "retry_credit_note", idName: string, formData: FormData): Promise<ReasonFormState> {
  const id = formData.get(idName);
  const reason = formData.get("reason");
  if (typeof id !== "string" || typeof reason !== "string") return { status: "error", message: MESSAGES.invalid_reason };
  const supabase = await createSupabaseServerClient();
  const { data, error } =
    fn === "retry_invoice"
      ? await supabase.rpc("retry_invoice", { p_invoice_id: id, p_reason: reason.trim() })
      : await supabase.rpc("retry_credit_note", { p_credit_note_id: id, p_reason: reason.trim() });
  const result = data as { ok: boolean; error?: string } | null;
  const code = error ? Object.keys(MESSAGES).find((k) => error.message.includes(k)) : result?.ok ? null : result?.error;
  if (error || code) return { status: "error", message: (code && MESSAGES[code]) ?? "No se pudo reintentar." };
  refresh();
  return { status: "ok", message: "Enviada de nuevo a Factus. El estado se actualiza en unos segundos." };
}

export async function retryInvoiceAction(_previous: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  return run("retry_invoice", "invoiceId", formData);
}

export async function retryCreditNoteAction(_previous: ReasonFormState, formData: FormData): Promise<ReasonFormState> {
  return run("retry_credit_note", "creditNoteId", formData);
}
