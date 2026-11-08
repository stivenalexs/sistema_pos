import "server-only";

import { createSupabaseServerClient } from "@/shared/supabase/server";

// Invoices and credit notes that need the administrator (D-055).

export type AttentionInvoice = {
  id: string;
  orderId: string;
  referenceCode: string;
  status: string;
  totalCop: number;
  lastError: string | null;
  dianErrors: unknown;
  responseMessage: string | null;
  attempts: number;
  updatedAt: string;
  channel: string;
  actionStatus: string | null;
  actionError: string | null;
};

export type CreditNoteRow = {
  id: string;
  referenceCode: string;
  status: string;
  reason: string;
  lastError: string | null;
  invoiceNumber: string | null;
  createdAt: string;
  actionStatus: string | null;
};

export async function listInvoicesForAdmin(): Promise<{ invoices: AttentionInvoice[]; creditNotes: CreditNoteRow[] }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_invoices");
  if (error) throw new Error(`admin_list_invoices failed: ${error.message}`);
  const raw = data as {
    invoices: {
      id: string; order_id: string; reference_code: string; status: string; total_cop: number; last_error: string | null;
      dian_errors: unknown; response_message: string | null; attempts: number; updated_at: string; channel: string;
      action_status: string | null; action_error: string | null;
    }[];
    credit_notes: {
      id: string; reference_code: string; status: string; reason: string; last_error: string | null;
      invoice_number: string | null; created_at: string; action_status: string | null;
    }[];
  };
  return {
    invoices: raw.invoices.map((i) => ({
      id: i.id,
      orderId: i.order_id,
      referenceCode: i.reference_code,
      status: i.status,
      totalCop: i.total_cop,
      lastError: i.last_error,
      dianErrors: i.dian_errors,
      responseMessage: i.response_message,
      attempts: i.attempts,
      updatedAt: i.updated_at,
      channel: i.channel,
      actionStatus: i.action_status,
      actionError: i.action_error,
    })),
    creditNotes: raw.credit_notes.map((n) => ({
      id: n.id,
      referenceCode: n.reference_code,
      status: n.status,
      reason: n.reason,
      lastError: n.last_error,
      invoiceNumber: n.invoice_number,
      createdAt: n.created_at,
      actionStatus: n.action_status,
    })),
  };
}
