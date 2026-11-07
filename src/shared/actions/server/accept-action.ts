import "server-only";

import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/shared/supabase/admin";
import type { Json } from "@/shared/supabase/database.types";

import {
  type AcceptedAction,
  IDEMPOTENCY_KEY_HEADER,
  isUuid,
} from "../action-types";

export class InvalidIdempotencyKeyError extends Error {
  override name = "InvalidIdempotencyKeyError";
}

/** The key already belongs to another user or another action type. */
export class IdempotencyConflictError extends Error {
  override name = "IdempotencyConflictError";
}

type EnqueueRpc = (args: {
  p_idempotency_key: string;
  p_type: string;
  p_user_id: string | null;
  p_payload: Json;
  p_max_attempts?: number;
}) => Promise<{
  data: { tracking_id: string; created: boolean }[] | null;
  error: { message: string } | null;
}>;

export type AcceptActionInput = {
  idempotencyKey: string;
  type: string;
  /**
   * Id of the user, ALREADY VERIFIED by the endpoint from its session.
   * Null only for system actions (webhooks, scheduled jobs).
   */
  userId: string | null;
  payload: Json;
  maxAttempts?: number;
};

function defaultEnqueue(): EnqueueRpc {
  // The only place where a user request uses the secret key (D-034): the
  // queue functions are not exposed to the browser, so that nobody can
  // enqueue work without passing the endpoint's validation.
  const admin = createSupabaseAdminClient();
  return async (args) => {
    const { data, error } = await admin.rpc("enqueue_action", {
      ...args,
      // The generated types mark every function argument as non-null, but
      // enqueue_action accepts null for system actions.
      p_user_id: args.p_user_id as string,
    });
    return { data, error };
  };
}

/**
 * Saves the action and its queue message in one transaction and returns the
 * tracking_id. Call it only after validating the input and the permissions.
 * Repeating the call with the same key returns the same tracking_id.
 */
export async function acceptAction(
  input: AcceptActionInput,
  enqueue: EnqueueRpc = defaultEnqueue(),
): Promise<AcceptedAction & { created: boolean }> {
  if (!isUuid(input.idempotencyKey)) {
    throw new InvalidIdempotencyKeyError("Idempotency key must be a UUID.");
  }

  const { data, error } = await enqueue({
    p_idempotency_key: input.idempotencyKey,
    p_type: input.type,
    p_user_id: input.userId,
    p_payload: input.payload,
    ...(input.maxAttempts === undefined
      ? {}
      : { p_max_attempts: input.maxAttempts }),
  });

  if (error) {
    if (error.message.includes("idempotency_key_conflict")) {
      throw new IdempotencyConflictError(error.message);
    }
    throw new Error(`enqueue_action failed: ${error.message}`);
  }

  const row = data?.[0];
  if (!row) {
    throw new Error("enqueue_action returned no row.");
  }
  return { trackingId: row.tracking_id, created: row.created };
}

/** Reads the Idempotency-Key header sent by ActionButton. */
export function readIdempotencyKey(request: Request): string | null {
  const key = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim();
  return key && isUuid(key) ? key : null;
}

/** Standard 202 answer for an accepted action. */
export function acceptedResponse(action: AcceptedAction): NextResponse {
  return NextResponse.json<AcceptedAction>(
    { trackingId: action.trackingId },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
