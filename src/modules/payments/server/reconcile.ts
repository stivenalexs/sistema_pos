// Reconciliation loop (D-040, D-073), without I/O of its own so it can be
// tested: payments.ts wires it to Supabase and to Wompi.

export type WompiTransaction = {
  id: string;
  status: string;
  reference: string;
  amount_in_cents: number;
  currency: string;
  payment_method_type?: string;
  status_message?: string | null;
};

export type ReconcileReport = {
  checked: number;
  resolved: number;
  stillPending: number;
  failed: number;
  /** Browser hints that Wompi does not know (404), dropped. */
  unknownHints: number;
};

export type TransactionLookup =
  | { kind: "found"; transaction: WompiTransaction }
  | { kind: "not_found" }
  | { kind: "error" };

export type ReconcileDeps = {
  pending: () => Promise<{ attempt_id: string; transaction_id: string }[]>;
  lookup: (transactionId: string) => Promise<TransactionLookup>;
  /** The hint points to a transaction of another attempt (D-040). */
  clearMismatchedHint: (attemptId: string, transactionId: string, wompiReference: string) => Promise<void>;
  /** Wompi does not know the hint's transaction (D-073). Never drops a confirmed id. */
  clearUnknownHint: (attemptId: string, transactionId: string) => Promise<boolean>;
  /** Stores and applies a final state with the webhook's logic. */
  applyFinal: (transaction: WompiTransaction) => Promise<void>;
};

/** Time limit of each question to Wompi. */
export const WOMPI_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * GET /v1/transactions/{id} with the private key. Wompi answers 404 with
 * error.type NOT_FOUND_ERROR for an id it does not know (checked in the
 * sandbox, 2026-11-22); only that answer counts as "not found".
 */
export async function lookupWompiTransaction(
  apiUrl: string,
  privateKey: string,
  transactionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TransactionLookup> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${privateKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(WOMPI_LOOKUP_TIMEOUT_MS),
    });
  } catch {
    return { kind: "error" };
  }
  if (response.status === 404) {
    const body = (await response.json().catch(() => null)) as { error?: { type?: string } } | null;
    return body?.error?.type === "NOT_FOUND_ERROR" ? { kind: "not_found" } : { kind: "error" };
  }
  if (!response.ok) return { kind: "error" };
  const body = (await response.json().catch(() => null)) as { data?: WompiTransaction } | null;
  return body?.data ? { kind: "found", transaction: body.data } : { kind: "error" };
}

export async function runReconciliation(deps: ReconcileDeps): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, resolved: 0, stillPending: 0, failed: 0, unknownHints: 0 };
  for (const row of await deps.pending()) {
    report.checked += 1;
    try {
      const found = await deps.lookup(row.transaction_id);
      if (found.kind === "not_found") {
        if (await deps.clearUnknownHint(row.attempt_id, row.transaction_id)) report.unknownHints += 1;
        else report.failed += 1;
        continue;
      }
      if (found.kind === "error") {
        report.failed += 1;
        continue;
      }
      const tx = found.transaction;
      // A hint can point to a transaction of another attempt: the payment is
      // still applied by its own reference below, and the wrong hint is
      // dropped so it is not asked about again (D-040).
      await deps.clearMismatchedHint(row.attempt_id, row.transaction_id, tx.reference);
      if (tx.status === "PENDING") {
        report.stillPending += 1;
        continue;
      }
      await deps.applyFinal(tx);
      report.resolved += 1;
    } catch {
      report.failed += 1;
    }
  }
  return report;
}
