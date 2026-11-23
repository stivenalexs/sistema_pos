import "server-only";

import { createHash } from "node:crypto";

import { acceptAction } from "@/shared/actions/server/accept-action";
import { createSupabaseAdminClient } from "@/shared/supabase/admin";
import type { Json } from "@/shared/supabase/database.types";
import { readRpcResult } from "@/shared/supabase/rpc-result";
import { createSupabaseServerClient } from "@/shared/supabase/server";

import { buildCheckoutUrl, checkoutRedirectUrl } from "./checkout";
import { verifyWompiEvent } from "./verify-signature";
import { lookupWompiTransaction, type ReconcileReport, runReconciliation } from "./reconcile";
import { getWompiConfig } from "./wompi-config";

// Payments with Wompi (D-040). The webhook is the source of truth; the
// browser redirect is only a hint for the reconciliation job.

// ---------------------------------------------------------------------------
// Start a payment (customer session, RLS)
// ---------------------------------------------------------------------------

export type StartPaymentResult =
  | { ok: true; trackingId: string; checkoutUrl: string }
  | { ok: false; error: "insufficient_stock" | "payment_in_progress" | "payment_order_not_payable" | "sales_blocked" | "idempotency_key_conflict" };

const PAYMENT_REFUSALS = ["insufficient_stock", "payment_in_progress", "payment_order_not_payable", "sales_blocked"] as const;
type PaymentRefusal = (typeof PAYMENT_REFUSALS)[number];

function isPaymentRefusal(code: string | null): code is PaymentRefusal {
  return (PAYMENT_REFUSALS as readonly (string | null)[]).includes(code);
}

type AttemptRow = { id: string; reference: string; amount_in_cents: number; expires_at: string };

export async function startPayment(input: {
  orderId: string;
  idempotencyKey: string;
  siteOrigin: string;
}): Promise<StartPaymentResult> {
  const config = getWompiConfig();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("start_payment", {
    p_order_id: input.orderId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    if (error.message.includes("idempotency_key_conflict")) {
      return { ok: false, error: "idempotency_key_conflict" };
    }
    throw new Error(`start_payment failed: ${error.message}`);
  }

  const answer = readRpcResult<{ tracking_id?: string; attempt?: AttemptRow }>({ data, error: null }, {});
  if (!answer.ok || !answer.value.attempt || !answer.value.tracking_id) {
    const code = answer.ok ? null : answer.code;
    return { ok: false, error: isPaymentRefusal(code) ? code : "payment_order_not_payable" };
  }
  const result = { tracking_id: answer.value.tracking_id, attempt: answer.value.attempt };

  const [{ data: claims }, { data: customer }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("customers").select("full_name").maybeSingle(),
  ]);
  const email = typeof claims?.claims.email === "string" ? claims.claims.email : null;

  return {
    ok: true,
    trackingId: result.tracking_id,
    checkoutUrl: buildCheckoutUrl(config, {
      reference: result.attempt.reference,
      amountInCents: result.attempt.amount_in_cents,
      expiresAt: result.attempt.expires_at,
      redirectUrl: checkoutRedirectUrl(input.siteOrigin, input.orderId),
      customerEmail: email,
      customerFullName: customer?.full_name ?? null,
    }),
  };
}

/** Stores the ?id= of the Wompi redirect as an UNVERIFIED hint. */
export async function recordPaymentRedirect(orderId: string, transactionId: string | null) {
  if (!transactionId) return;
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("record_payment_redirect", {
    p_order_id: orderId,
    p_transaction_id: transactionId,
  });
}

// ---------------------------------------------------------------------------
// Webhook (no session: verified by signature)
// ---------------------------------------------------------------------------

/** Deterministic UUID from the event checksum: the same event, the same action. */
export function eventIdempotencyKey(checksum: string): string {
  const hex = createHash("sha256").update(`wompi-event:${checksum.toUpperCase()}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

export type WebhookResult = { status: 200 | 400 | 401; outcome: string };

/**
 * Verifies, stores once and enqueues a Wompi event. Answers fast: the event
 * is applied later by the worker (process_payment_event).
 */
export async function handleWompiWebhook(rawBody: string, checksumHeader: string | null): Promise<WebhookResult> {
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, outcome: "invalid_json" };
  }

  const check = verifyWompiEvent(event, checksumHeader, getWompiConfig().eventsSecret);
  if (!check.valid) {
    // Not stored: an unsigned event is never trusted.
    return { status: 401, outcome: check.reason };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("store_payment_event", {
    p_checksum: check.checksum,
    p_source: "webhook",
    p_payload: event as Json,
  });
  if (error) throw new Error(`store_payment_event failed: ${error.message}`);
  const stored = data as { event_id: string; created: boolean };

  await acceptAction({
    idempotencyKey: eventIdempotencyKey(check.checksum),
    type: "process_payment_event",
    userId: null,
    payload: { event_id: stored.event_id },
  });
  return { status: 200, outcome: stored.created ? "stored" : "duplicate" };
}

/** Worker handler: applies a stored event atomically and idempotently. */
export async function processPaymentEvent(eventId: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("apply_payment_event", { p_event_id: eventId });
  if (error) throw new Error(`apply_payment_event failed: ${error.message}`);
  return data as string;
}

// ---------------------------------------------------------------------------
// Reconciliation (worker, private key)
// ---------------------------------------------------------------------------

/**
 * Asks Wompi (GET /v1/transactions/{id}, private key) about pending attempts
 * older than `minAgeMinutes` whose transaction id is known, by turns (D-073),
 * and applies the final answers with the same logic as the webhook. A
 * browser hint that Wompi does not know is dropped.
 */
export async function reconcilePayments(minAgeMinutes = 15): Promise<ReconcileReport> {
  const config = getWompiConfig();
  const admin = createSupabaseAdminClient();
  return runReconciliation({
    async pending() {
      const { data, error } = await admin.rpc("payments_to_reconcile", { p_min_age_minutes: minAgeMinutes });
      if (error) throw new Error(`payments_to_reconcile failed: ${error.message}`);
      return data ?? [];
    },
    lookup: (transactionId) => lookupWompiTransaction(config.apiUrl, config.privateKey, transactionId),
    async clearMismatchedHint(attemptId, transactionId, wompiReference) {
      const { error } = await admin.rpc("clear_mismatched_payment_hint", {
        p_attempt_id: attemptId,
        p_transaction_id: transactionId,
        p_wompi_reference: wompiReference,
      });
      if (error) throw new Error(error.message);
    },
    async clearUnknownHint(attemptId, transactionId) {
      const { data, error } = await admin.rpc("clear_unknown_payment_hint", {
        p_attempt_id: attemptId,
        p_transaction_id: transactionId,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async applyFinal(tx) {
      const payload = { event: "transaction.updated", data: { transaction: tx }, sent_at: new Date().toISOString() };
      const { data: stored, error: storeError } = await admin.rpc("store_payment_event", {
        p_checksum: `RECONCILE-${tx.id}-${tx.status}`,
        p_source: "reconciliation",
        p_payload: payload as unknown as Json,
      });
      if (storeError) throw new Error(storeError.message);
      await processPaymentEvent((stored as { event_id: string }).event_id);
    },
  });
}
