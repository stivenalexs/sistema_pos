import "server-only";

import { createHash } from "node:crypto";

import { acceptAction } from "@/shared/actions/server/accept-action";
import { createSupabaseAdminClient } from "@/shared/supabase/admin";
import type { Json } from "@/shared/supabase/database.types";
import { createSupabaseServerClient } from "@/shared/supabase/server";

import { buildCheckoutUrl, checkoutRedirectUrl } from "./checkout";
import { verifyWompiEvent } from "./verify-signature";
import { getWompiConfig } from "./wompi-config";

// Payments with Wompi (D-040). The webhook is the source of truth; the
// browser redirect is only a hint for the reconciliation job.

// ---------------------------------------------------------------------------
// Start a payment (customer session, RLS)
// ---------------------------------------------------------------------------

export type StartPaymentResult =
  | { ok: true; trackingId: string; checkoutUrl: string }
  | { ok: false; error: "insufficient_stock" | "payment_in_progress" | "payment_order_not_payable" | "idempotency_key_conflict" };

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

  const result = data as { ok: boolean; tracking_id?: string; attempt?: AttemptRow; error?: string };
  if (!result.ok || !result.attempt || !result.tracking_id) {
    return { ok: false, error: (result.error ?? "payment_order_not_payable") as "payment_order_not_payable" };
  }

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

type WompiTransaction = {
  id: string;
  status: string;
  reference: string;
  amount_in_cents: number;
  currency: string;
  payment_method_type?: string;
  status_message?: string | null;
};

export type ReconcileReport = { checked: number; resolved: number; stillPending: number; failed: number };

/**
 * Asks Wompi (GET /v1/transactions/{id}, private key) about pending attempts
 * older than `minAgeMinutes` whose transaction id is known, and applies the
 * final answers with the same logic as the webhook.
 */
export async function reconcilePayments(minAgeMinutes = 15): Promise<ReconcileReport> {
  const config = getWompiConfig();
  const admin = createSupabaseAdminClient();
  const { data: pending, error } = await admin.rpc("payments_to_reconcile", {
    p_min_age_minutes: minAgeMinutes,
  });
  if (error) throw new Error(`payments_to_reconcile failed: ${error.message}`);

  const report: ReconcileReport = { checked: 0, resolved: 0, stillPending: 0, failed: 0 };
  for (const row of pending ?? []) {
    report.checked += 1;
    try {
      const response = await fetch(`${config.apiUrl}/transactions/${encodeURIComponent(row.transaction_id)}`, {
        headers: { Authorization: `Bearer ${config.privateKey}` },
        cache: "no-store",
      });
      if (!response.ok) {
        report.failed += 1;
        continue;
      }
      const body = (await response.json()) as { data?: WompiTransaction };
      const tx = body.data;
      if (tx) {
        // A browser hint can point to a transaction of another attempt: the
        // payment is still applied by its own reference below, and the wrong
        // hint is dropped so it is not asked about again (D-040).
        await admin.rpc("clear_mismatched_payment_hint", {
          p_attempt_id: row.attempt_id,
          p_transaction_id: row.transaction_id,
          p_wompi_reference: tx.reference,
        });
      }
      if (!tx || tx.status === "PENDING") {
        report.stillPending += 1;
        continue;
      }

      const payload = { event: "transaction.updated", data: { transaction: tx }, sent_at: new Date().toISOString() };
      const { data: stored, error: storeError } = await admin.rpc("store_payment_event", {
        p_checksum: `RECONCILE-${tx.id}-${tx.status}`,
        p_source: "reconciliation",
        p_payload: payload as unknown as Json,
      });
      if (storeError) throw new Error(storeError.message);
      await processPaymentEvent((stored as { event_id: string }).event_id);
      report.resolved += 1;
    } catch {
      report.failed += 1;
    }
  }
  return report;
}
