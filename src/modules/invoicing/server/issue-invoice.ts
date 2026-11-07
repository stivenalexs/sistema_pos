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
  db?: ReturnType<typeof createSupabaseAdminClient>;
};

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
    .select("id, reference_code, reason, status, invoices (factus_number, reference_code, total_cop, customer, payment_method_code, invoice_lines (sku, name, quantity_units, net_cop, iva_cop, final_cop))")
    .eq("id", creditNoteId)
    .maybeSingle();
  if (error || !note) throw new PermanentActionError("credit_note_not_found");
  if (note.status === "accepted") return { outcome: "already_accepted" };

  const invoice = note.invoices as unknown as InvoiceData & { factus_number: string | null; invoice_lines: InvoiceData["lines"] };
  if (!invoice?.factus_number) throw new PermanentActionError("credit_note_invoice_without_number");

  const bill = buildBillPayload(
    { ...invoice, reference_code: note.reference_code, lines: invoice.invoice_lines },
    deps.ivaRatePct ?? 5,
    deps.numberingRangeId !== undefined ? deps.numberingRangeId : null,
  );
  const payload = {
    reference_code: note.reference_code,
    bill_number: invoice.factus_number,
    // PROJECT ASSUMPTION (D-044): DIAN concept 2 = annulment of the invoice
    // (full refund). The Factus docs do not list the codes; verify in sandbox.
    correction_concept_code: "2",
    customization_id: "20",
    observation: note.reason.slice(0, 250),
    payment_details: bill.payment_details,
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
