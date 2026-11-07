import {
  type AcceptedAction,
  type ActionStatusResponse,
  IDEMPOTENCY_KEY_HEADER,
} from "./action-types";

// Browser helpers for ActionButton. They only send data and read statuses;
// prices and permissions are always decided by the server.

export class ActionRequestError extends Error {
  override name = "ActionRequestError";
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** POSTs an action to an endpoint that answers 202 { trackingId }. */
export async function postAction(
  url: string,
  body: unknown,
  idempotencyKey: string,
): Promise<AcceptedAction> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ActionRequestError("network_error", null);
  }

  if (response.status !== 202 && response.status !== 200) {
    throw new ActionRequestError("request_rejected", response.status);
  }
  const data = (await response.json()) as Partial<AcceptedAction>;
  if (typeof data.trackingId !== "string") {
    throw new ActionRequestError("invalid_response", response.status);
  }
  return { trackingId: data.trackingId };
}

/** Reads the status of an action of the signed-in user. */
export async function fetchActionStatus(
  trackingId: string,
): Promise<ActionStatusResponse> {
  const response = await fetch(`/api/actions/${encodeURIComponent(trackingId)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ActionRequestError("status_unavailable", response.status);
  }
  return (await response.json()) as ActionStatusResponse;
}
