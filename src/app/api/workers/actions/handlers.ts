import "server-only";

import { processPaymentEvent } from "@/modules/payments";
import { PermanentActionError, type ActionHandlers } from "@/shared/actions/server/worker";

// Registry of action handlers: one entry per action type. Each business module
// exposes its handlers through its public index.ts and they are added here
// (orders, payments, invoicing, pos, ...). Handlers must be idempotent.
export const actionHandlers: ActionHandlers = {
  // Test action: echoes its payload. Used to check the queue end to end.
  noop: async (action) => ({ ok: true, echo: action.payload }),

  // Applies a verified Wompi event (D-040). Idempotent in the database.
  process_payment_event: async (action) => {
    const payload = action.payload as { event_id?: unknown } | null;
    if (!payload || typeof payload.event_id !== "string") {
      throw new PermanentActionError("invalid_payload");
    }
    return { outcome: await processPaymentEvent(payload.event_id) };
  },
};
