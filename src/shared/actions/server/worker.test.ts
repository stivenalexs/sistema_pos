import { describe, expect, it, vi } from "vitest";

import { acceptAction, IdempotencyConflictError, InvalidIdempotencyKeyError } from "./accept-action";
import {
  type ActionQueue,
  type ClaimedAction,
  PermanentActionError,
  runActionsWorker,
} from "./worker";
import { isAuthorizedWorkerRequest } from "./worker-auth";

function claimed(overrides: Partial<ClaimedAction> = {}): ClaimedAction {
  return {
    actionId: "a-1",
    type: "noop",
    userId: "u-1",
    payload: {},
    attempt: 1,
    maxAttempts: 5,
    ...overrides,
  };
}

// Hands out the queued actions in order, as many as asked for.
function fakeQueue(queued: ClaimedAction[]) {
  return {
    claim: vi.fn(async (batch: number) => queued.splice(0, batch)),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  } satisfies ActionQueue;
}

describe("runActionsWorker", () => {
  it("completes an action with the handler result", async () => {
    const queue = fakeQueue([claimed({ payload: { n: 1 } })]);
    const report = await runActionsWorker(queue, {
      noop: async (a) => ({ echo: a.payload }),
    });

    expect(queue.complete).toHaveBeenCalledWith("a-1", { echo: { n: 1 } });
    expect(report).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
  });

  it("fails an unknown action type permanently", async () => {
    const queue = fakeQueue([claimed({ type: "does_not_exist" })]);
    await runActionsWorker(queue, {});

    expect(queue.fail).toHaveBeenCalledWith(
      "a-1",
      "unknown_action_type: does_not_exist",
      true,
    );
  });

  it("does not treat inherited object keys as handlers", async () => {
    const queue = fakeQueue([claimed({ type: "constructor" })]);
    await runActionsWorker(queue, {});
    expect(queue.fail).toHaveBeenCalledWith("a-1", expect.any(String), true);
  });

  it("retries a handler that fails midway, then succeeds", async () => {
    const queue = fakeQueue([claimed({ attempt: 1 })]);
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout talking to provider"))
      .mockResolvedValueOnce({ ok: true });

    await runActionsWorker(queue, { noop: handler });
    expect(queue.fail).toHaveBeenCalledWith("a-1", "timeout talking to provider", false);
    expect(queue.complete).not.toHaveBeenCalled();

    // After the backoff the queue hands it out again.
    const retry = fakeQueue([claimed({ attempt: 2 })]);
    await runActionsWorker(retry, { noop: handler });
    expect(retry.complete).toHaveBeenCalledWith("a-1", { ok: true });
  });

  it("fails at once on a PermanentActionError", async () => {
    const queue = fakeQueue([claimed()]);
    await runActionsWorker(queue, {
      noop: async () => {
        throw new PermanentActionError("invalid_payload");
      },
    });
    expect(queue.fail).toHaveBeenCalledWith("a-1", "invalid_payload", true);
  });

  it("keeps processing after one action fails", async () => {
    const queue = fakeQueue([
      claimed({ actionId: "a-1", type: "boom" }),
      claimed({ actionId: "a-2" }),
    ]);
    const report = await runActionsWorker(queue, {
      boom: async () => {
        throw new Error("boom");
      },
      noop: async () => ({ ok: true }),
    });
    expect(report).toEqual({ claimed: 2, succeeded: 1, failed: 1 });
  });

  it("claims one action at a time, only after the previous one ended (D-073)", async () => {
    const queue = fakeQueue([]);
    const events: string[] = [];
    const items = [claimed({ actionId: "a-1" }), claimed({ actionId: "a-2" })];
    queue.claim.mockImplementation(async (batch: number) => {
      events.push(`claim:${batch}`);
      return items.splice(0, batch);
    });
    await runActionsWorker(queue, {
      noop: async (a) => {
        events.push(`run:${a.actionId}`);
        return null;
      },
    });
    expect(events).toEqual(["claim:1", "run:a-1", "claim:1", "run:a-2", "claim:1"]);
    expect(queue.claim).toHaveBeenCalledWith(1, 120);
  });

  it("stops claiming after its time budget and after maxActions", async () => {
    let clock = 0;
    const slow = fakeQueue([claimed({ actionId: "a-1" }), claimed({ actionId: "a-2" })]);
    const report = await runActionsWorker(
      slow,
      {
        noop: async () => {
          clock += 60_000;
          return null;
        },
      },
      { now: () => clock },
    );
    expect(report.claimed).toBe(1);

    const many = fakeQueue([claimed({ actionId: "a-1" }), claimed({ actionId: "a-2" }), claimed({ actionId: "a-3" })]);
    expect((await runActionsWorker(many, { noop: async () => null }, { maxActions: 2 })).claimed).toBe(2);
  });
});

describe("acceptAction", () => {
  const KEY = "8d3c7a9e-2b1f-4c6d-9e8a-1f2b3c4d5e6f";

  it("returns the tracking_id from the database", async () => {
    const enqueue = vi.fn(async () => ({
      data: [{ tracking_id: "t-1", created: true }],
      error: null,
    }));
    const result = await acceptAction(
      { idempotencyKey: KEY, type: "noop", userId: "u-1", payload: {} },
      enqueue,
    );
    expect(result).toEqual({ trackingId: "t-1", created: true });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ p_idempotency_key: KEY, p_user_id: "u-1" }),
    );
  });

  it("rejects a key that is not a UUID before touching the database", async () => {
    const enqueue = vi.fn();
    await expect(
      acceptAction({ idempotencyKey: "123", type: "noop", userId: "u-1", payload: {} }, enqueue),
    ).rejects.toBeInstanceOf(InvalidIdempotencyKeyError);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("maps a key conflict to IdempotencyConflictError", async () => {
    const enqueue = vi.fn(async () => ({
      data: null,
      error: { message: "idempotency_key_conflict" },
    }));
    await expect(
      acceptAction({ idempotencyKey: KEY, type: "noop", userId: "u-1", payload: {} }, enqueue),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});

describe("isAuthorizedWorkerRequest", () => {
  const SECRET = "s".repeat(40);

  it("accepts the right bearer secret", () => {
    expect(isAuthorizedWorkerRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a missing, malformed or wrong secret", () => {
    expect(isAuthorizedWorkerRequest(null, SECRET)).toBe(false);
    expect(isAuthorizedWorkerRequest(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedWorkerRequest(`Bearer ${"x".repeat(40)}`, SECRET)).toBe(false);
    expect(isAuthorizedWorkerRequest("Bearer short", SECRET)).toBe(false);
  });
});

describe("requirePayloadText (D-077)", () => {
  it("reads a required text field, and fails for good without it", async () => {
    const { requirePayloadText } = await import("./worker");
    expect(requirePayloadText({ order_id: "o-1" }, "order_id")).toBe("o-1");
    for (const bad of [null, [], "o-1", {}, { order_id: 1 }, { order_id: "" }]) {
      expect(() => requirePayloadText(bad, "order_id")).toThrow(PermanentActionError);
    }
  });
});
