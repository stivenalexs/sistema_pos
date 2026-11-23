// Shared by ActionForm (browser) and the server actions it calls (D-056,
// D-077). Kept out of the "use client" file: a server module importing a
// value from it would get a client reference, not the value.

/** Hidden field with the idempotency key of an idempotent ActionForm. */
export const IDEMPOTENCY_FIELD = "idempotencyKey";

export type ActionFormState = {
  status: "idle" | "ok" | "error";
  message?: string;
  /** The values sent, so a rejected form keeps what the person typed. */
  values?: Record<string, string>;
  /** Changes with every final answer; remounts the form (and renews the key). */
  answer?: number;
};
