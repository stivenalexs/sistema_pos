// Types shared by the browser and the server for async actions (D-034).

export type ActionStatus = "queued" | "processing" | "succeeded" | "failed";

export const FINAL_ACTION_STATUSES: readonly ActionStatus[] = [
  "succeeded",
  "failed",
];

export function isFinalActionStatus(status: ActionStatus): boolean {
  return FINAL_ACTION_STATUSES.includes(status);
}

/** Body of a 202 answer from any endpoint that accepts an action. */
export type AcceptedAction = {
  trackingId: string;
};

/** Body of GET /api/actions/{trackingId}. */
export type ActionStatusResponse = {
  trackingId: string;
  status: ActionStatus;
  /** True while the action waits for a retry after a failed attempt. */
  retrying: boolean;
  result: unknown;
};

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
