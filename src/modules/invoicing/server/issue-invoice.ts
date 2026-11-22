import "server-only";

import { PermanentActionError } from "@/shared/actions/server/worker";
import { createSupabaseAdminClient } from "@/shared/supabase/admin";
import type { Json } from "@/shared/supabase/database.types";

import { buildBillPayload, type InvoiceData } from "../domain/build-bill";
import { type FactusClient, getFactusClient, getFactusConfig } from "./factus-client";

// Worker jobs for Factus (D-044). Idempotent: Factus deduplicates by
// reference_code and an accepted invoice never changes in our database.
// - Transient errors (network, 5xx, 429) throw FactusTransientError: the
//   queue retries with backoff.
// - Data errors and DIAN rejections are NOT retried blindly: the invoice is
//   marked rejected with the reason (admin inbox) and the job fails for good.

type Deps = {
  client?: FactusClient;
  ivaRatePct?: number;
  numberingRangeId?: number | null;
  creditNoteRangeId?: number | null;
  db?: ReturnType<typeof createSupabaseAdminClient>;
};

// "No responsable" (R-99-PN), the documented default. Factus' sandbox requires
// customer.responsibilities in credit notes (D-066). PROJECT ASSUMPTION for
// wholesale buyers with NIT: their real fiscal responsibilities (RUT) are not
// collected yet.
const DEFAULT_RESPONSIBILITIES = ["R-99-PN"];

type FactusBody = { message?: string; data?: { is_validated?: boolean; errors?: unknown } };

function errorMessage(body: unknown, status: number): string {
  const b = body as FactusBody | null;
  return `${status}: ${b?.message ?? "factus_error"}`.slice(0, 2000);
}

export async function issueInvoice(orderId: string, deps: Deps = {}): Promise<Json> {
  const db = deps.db ?? createSupabaseAdminClient();
  const { data, error } = await db.rpc("prepare_invoice", { p_order_id: orderId });
  if (error) {
    if (error.message.includes("invoice_order_not_invoiceable")) {
      // Expected when the POS sale was voided or the order was marked for
      // refund after the job was queued: there is no sale to invoice, so the
      // job ends without an alert (D-057). Anything else is a real failure.
      const { data: order } = await db
        .from("orders")
        .select("voided_at, needs_refund")
        .eq("id", orderId)
        .maybeSingle();
      if (order && (order.voided_at !== null || order.needs_refund)) {
        return { outcome: "skipped_not_invoiceable", order_id: orderId };
      }
      throw new PermanentActionError("invoice_order_not_invoiceable");
    }
    throw new Error(`prepare_invoice failed: ${error.message}`);
  }
  const invoice = data as InvoiceData & { id: string; status: string };
  if (invoice.status === "accepted") {
    return { outcome: "already_accepted", invoice_id: invoice.id };
  }

  const numberingRangeId = deps.numberingRangeId !== undefined ? deps.numberingRangeId : getFactusConfig().numberingRangeId;
  const payload = buildBillPayload(invoice, deps.ivaRatePct ?? 5, numberingRangeId);
  const client = deps.client ?? getFactusClient();
  const response = await client.post("/v2/bills/validate", payload);
  const body = response.body as FactusBody | null;

  const record = (outcome: string, message: string | null = null) =>
    db.rpc("record_invoice_result", {
      p_invoice_id: invoice.id,
      p_outcome: outcome,
      p_request: payload as unknown as Json,
      p_response: (response.body ?? {}) as Json,
      ...(message ? { p_error: message } : {}),
    });

  if ((response.status === 200 || response.status === 201) && body?.data) {
    if (body.data.is_validated) {
      await record("accepted");
      return { outcome: "accepted", invoice_id: invoice.id };
    }
    // Registered but not validated by the DIAN yet: retry later.
    await record("sent", "not_validated_yet");
    throw new Error("invoice_not_validated_yet");
  }

  if (response.status === 409) {
    // Pending at Factus with the same reference (docs: delete and recreate).
    // Not done automatically: the admin decides (D-044).
    await record("sent", errorMessage(body, 409));
    throw new PermanentActionError("invoice_pending_at_factus");
  }

  // 4xx: data errors, numbering range problems or DIAN rejection.
  await record("rejected", errorMessage(body, response.status));
  throw new PermanentActionError(`invoice_rejected_${response.status}`);
}

export async function issueCreditNote(creditNoteId: string, deps: Deps = {}): Promise<Json> {
  const db = deps.db ?? createSupabaseAdminClient();
  const { data: note, error } = await db
    .from("credit_notes")
    .select("id, reference_code, reason, status, kind, concept_code, invoices (factus_number, reference_code, total_cop, customer, payment_method_code, invoice_lines (sku, name, quantity_units, net_cop, iva_cop, final_cop, line_kind))")
    .eq("id", creditNoteId)
    .maybeSingle();
  if (error || !note) throw new PermanentActionError("credit_note_not_found");
  if (note.status === "accepted") return { outcome: "already_accepted" };

  const invoice = note.invoices as unknown as InvoiceData & {
    factus_number: string | null;
    invoice_lines: (InvoiceData["lines"][number] & { line_kind?: string })[];
  };
  if (!invoice?.factus_number) throw new PermanentActionError("credit_note_invoice_without_number");

  // Products only (D-069): the product lines, without the delivery line,
  // which stays invoiced because the delivery was attempted.
  const productsOnly = note.kind === "products_only";
  const lines = productsOnly
    ? invoice.invoice_lines.filter((line) => (line.line_kind ?? "product") === "product")
    : invoice.invoice_lines;
  if (lines.length === 0) throw new PermanentActionError("credit_note_without_lines");
  const creditedTotal = productsOnly ? lines.reduce((sum, line) => sum + line.final_cop, 0) : invoice.total_cop;

  const bill = buildBillPayload(
    { ...invoice, total_cop: creditedTotal, reference_code: note.reference_code, lines },
    deps.ivaRatePct ?? 5,
    deps.numberingRangeId !== undefined ? deps.numberingRangeId : null,
  );
  const creditNoteRangeId =
    deps.creditNoteRangeId !== undefined ? deps.creditNoteRangeId : getFactusConfig().creditNoteRangeId;
  const payload = {
    reference_code: note.reference_code,
    bill_number: invoice.factus_number,
    // Factus reference tables (D-066, D-069): concept 2 = "Anulación de
    // factura electrónica", 1 = "Devolución parcial de los bienes";
    // operation 20 = credit note that references an invoice.
    correction_concept_code: note.concept_code === "1" ? "1" : "2",
    customization_id: "20",
    // Required by Factus when there is more than one active credit note range.
    ...(creditNoteRangeId !== null ? { numbering_range_id: creditNoteRangeId } : {}),
    // The documentation says customer is optional (taken from the invoice);
    // the sandbox requires it, with its fiscal responsibilities (D-066).
    customer: { ...bill.customer, responsibilities: DEFAULT_RESPONSIBILITIES },
    observation: note.reason.slice(0, 250),
    // Credit notes have no cash_rounding_amount: Factus totals them from the
    // items, so the payment must equal that total (charged − rounding), not
    // the amount charged (D-066).
    payment_details: bill.payment_details.map((detail) => ({
      ...detail,
      amount: (Math.round((Number(detail.amount) - Number(bill.cash_rounding_amount)) * 100) / 100).toFixed(2),
    })),
    items: bill.items.map((item) => ({ ...item, note: note.reason.slice(0, 250) })),
  };

  const client = deps.client ?? getFactusClient();
  const response = await client.post("/v2/credit-notes/validate", payload);
  const body = response.body as FactusBody | null;
  const record = (outcome: string, message: string | null = null) =>
    db.rpc("record_credit_note_result", {
      p_credit_note_id: note.id,
      p_outcome: outcome,
      p_request: payload as unknown as Json,
      p_response: (response.body ?? {}) as Json,
      ...(message ? { p_error: message } : {}),
    });

  if ((response.status === 200 || response.status === 201) && body?.data?.is_validated) {
    await record("accepted");
    return { outcome: "accepted" };
  }
  await record("rejected", errorMessage(body, response.status));
  throw new PermanentActionError(`credit_note_rejected_${response.status}`);
}
