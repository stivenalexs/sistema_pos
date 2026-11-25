import { describe, expect, it, vi } from "vitest";

import {
  lookupWompiTransaction,
  type ReconcileDeps,
  runReconciliation,
  type WompiTransaction,
  WOMPI_LOOKUP_TIMEOUT_MS,
} from "./reconcile";

function tx(overrides: Partial<WompiTransaction> = {}): WompiTransaction {
  return { id: "tx-1", status: "APPROVED", reference: "REF-1", amount_in_cents: 100, currency: "COP", ...overrides };
}

function deps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps & { [K in keyof ReconcileDeps]: ReturnType<typeof vi.fn> } {
  return {
    pending: vi.fn(async () => [{ attempt_id: "a-1", transaction_id: "tx-1" }]),
    lookup: vi.fn(async () => ({ kind: "found" as const, transaction: tx() })),
    clearMismatchedHint: vi.fn(async () => {}),
    clearUnknownHint: vi.fn(async () => true),
    applyFinal: vi.fn(async () => {}),
    ...overrides,
  } as never;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("lookupWompiTransaction", () => {
  it("reads the transaction, with the private key and a time limit", async () => {
    const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => json(200, { data: tx() }));
    const result = await lookupWompiTransaction("https://sandbox.wompi.co/v1", "prv_test_x", "tx 1", fetchImpl as never);
    expect(result).toEqual({ kind: "found", transaction: tx() });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://sandbox.wompi.co/v1/transactions/tx%201");
    expect(init.headers).toEqual({ Authorization: "Bearer prv_test_x" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(WOMPI_LOOKUP_TIMEOUT_MS).toBe(10_000);
  });

  it("takes only Wompi's NOT_FOUND_ERROR as not found", async () => {
    const notFound = json(404, { error: { type: "NOT_FOUND_ERROR", reason: "La entidad solicitada no existe" } });
    expect(await lookupWompiTransaction("u", "k", "x", (async () => notFound) as never)).toEqual({ kind: "not_found" });
    // A 404 from something else (a proxy, a wrong URL) is an error, not "unknown".
    const otherNotFound = new Response("<html>", { status: 404 });
    expect(await lookupWompiTransaction("u", "k", "x", (async () => otherNotFound) as never)).toEqual({ kind: "error" });
    expect(await lookupWompiTransaction("u", "k", "x", (async () => json(500, {})) as never)).toEqual({ kind: "error" });
  });

  it("a network error or timeout is an error", async () => {
    const fetchImpl = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    expect(await lookupWompiTransaction("u", "k", "x", fetchImpl as never)).toEqual({ kind: "error" });
  });
});

describe("runReconciliation", () => {
  it("drops a hint that Wompi does not know, and applies nothing", async () => {
    const d = deps({ lookup: vi.fn(async () => ({ kind: "not_found" as const })) });
    const report = await runReconciliation(d);
    expect(d.clearUnknownHint).toHaveBeenCalledWith("a-1", "tx-1");
    expect(d.applyFinal).not.toHaveBeenCalled();
    expect(report).toEqual({ checked: 1, resolved: 0, stillPending: 0, failed: 0, unknownHints: 1 });
  });

  it("a confirmed transaction that Wompi does not find is not dropped (counted as failed)", async () => {
    const d = deps({ lookup: vi.fn(async () => ({ kind: "not_found" as const })), clearUnknownHint: vi.fn(async () => false) });
    expect((await runReconciliation(d)).failed).toBe(1);
  });

  it("does not drop anything on an error, and keeps going with the next attempt", async () => {
    const d = deps({
      pending: vi.fn(async () => [
        { attempt_id: "a-1", transaction_id: "tx-1" },
        { attempt_id: "a-2", transaction_id: "tx-2" },
      ]),
      lookup: vi
        .fn()
        .mockResolvedValueOnce({ kind: "error" })
        .mockResolvedValueOnce({ kind: "found", transaction: tx({ id: "tx-2" }) }),
    });
    const report = await runReconciliation(d);
    expect(d.clearUnknownHint).not.toHaveBeenCalled();
    expect(d.applyFinal).toHaveBeenCalledTimes(1);
    expect(report).toEqual({ checked: 2, resolved: 1, stillPending: 0, failed: 1, unknownHints: 0 });
  });

  it("applies a final state and leaves a pending one", async () => {
    const final = deps();
    expect((await runReconciliation(final)).resolved).toBe(1);
    expect(final.clearMismatchedHint).toHaveBeenCalledWith("a-1", "tx-1", "REF-1");

    const pending = deps({ lookup: vi.fn(async () => ({ kind: "found" as const, transaction: tx({ status: "PENDING" }) })) });
    expect((await runReconciliation(pending)).stillPending).toBe(1);
    expect(pending.applyFinal).not.toHaveBeenCalled();
  });
});
