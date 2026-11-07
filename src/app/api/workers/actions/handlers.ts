import "server-only";

import type { ActionHandlers } from "@/shared/actions/server/worker";

// Registry of action handlers: one entry per action type. Each business module
// exposes its handlers through its public index.ts and they are added here
// (orders, payments, invoicing, pos, ...). Handlers must be idempotent.
export const actionHandlers: ActionHandlers = {
  // Test action: echoes its payload. Used to check the queue end to end.
  noop: async (action) => ({ ok: true, echo: action.payload }),
};
