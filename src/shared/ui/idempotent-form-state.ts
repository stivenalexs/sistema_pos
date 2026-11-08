// Shared by IdempotentActionForm (browser) and the server actions it calls.
// Kept out of the "use client" file: a server module importing a value from
// it would get a client reference, not the value.

export const IDEMPOTENCY_FIELD = "idempotencyKey";

export type IdempotentFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
  /** The values sent, so a rejected form keeps what the person typed. */
  values?: Record<string, string>;
  /** Changes with every final answer; renews the idempotency key. */
  answer?: number;
};
