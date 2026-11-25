import "server-only";

import { processDeliveryAttempt, sendOrderEmail } from "@/modules/delivery";
import { issueCreditNoteJob, issueInvoiceJob } from "@/modules/invoicing";
import { processPaymentEventJob } from "@/modules/payments";
import type { ActionHandlers } from "@/shared/actions/server/worker";

// Registry of action handlers: one entry per action type. Each business module
// exposes its handlers through its public index.ts and they are added here
// (orders, payments, invoicing, pos, ...). Handlers must be idempotent.
export const actionHandlers: ActionHandlers = {
  // Test action: echoes its payload. Used to check the queue end to end.
  noop: async (action) => ({ ok: true, echo: action.payload }),

  // Each module reads and checks its own payload (D-077); an invalid one
  // fails at once (PermanentActionError).

  // Applies a verified Wompi event (D-040). Idempotent in the database.
  process_payment_event: async (action) => processPaymentEventJob(action.payload),

  // Electronic invoice of a paid order through Factus (D-044).
  issue_invoice: async (action) => issueInvoiceJob(action.payload),

  // Credit note for a refunded order (D-044).
  issue_credit_note: async (action) => issueCreditNoteJob(action.payload),

  // Delivery attempt with its proof (D-007, D-045). Idempotent by the key.
  confirm_delivery: async (action) => processDeliveryAttempt(action.userId, action.payload),

  // Email to the customer after a failed delivery (D-068). SMTP errors retry.
  send_email: async (action) => sendOrderEmail(action.payload),
};
