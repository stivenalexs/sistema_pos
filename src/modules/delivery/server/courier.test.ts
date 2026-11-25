import { beforeEach, describe, expect, it, vi } from "vitest";

// The session of the request, as the Supabase server client reports it.
const session = vi.hoisted(() => ({ claims: null as Record<string, unknown> | null, rpc: vi.fn() }));

vi.mock("@/shared/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: async () => ({ data: session.claims ? { claims: session.claims } : null }) },
    rpc: session.rpc,
  }),
}));
vi.mock("@/shared/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));

import { acceptDeliveryAttempt } from "./courier";

const ORDER = "8d3c7a9e-2b1f-4c6d-9e8a-1f2b3c4d5e6f";
const KEY = "1d3c7a9e-2b1f-4c6d-9e8a-1f2b3c4d5e6f";

describe("acceptDeliveryAttempt: the body is read only after the session (D-074)", () => {
  beforeEach(() => {
    session.claims = null;
    session.rpc.mockReset();
  });

  it("does not read the body of a visitor or a customer", async () => {
    const readForm = vi.fn();
    expect(await acceptDeliveryAttempt({ orderId: ORDER, idempotencyKey: KEY, readForm })).toEqual({
      ok: false,
      status: 403,
      error: "delivery_forbidden",
    });

    session.claims = { sub: "u-1", app_metadata: { customer_type: "retail" } };
    await acceptDeliveryAttempt({ orderId: ORDER, idempotencyKey: KEY, readForm });
    expect(readForm).not.toHaveBeenCalled();
  });

  it("passes on a body that is too large, before touching the database", async () => {
    session.claims = { sub: "c-1", app_metadata: { staff_role: "courier" } };
    const readForm = vi.fn(async () => ({ ok: false as const, status: 413 as const, error: "payload_too_large" }));
    expect(await acceptDeliveryAttempt({ orderId: ORDER, idempotencyKey: KEY, readForm })).toEqual({
      ok: false,
      status: 413,
      error: "payload_too_large",
    });
    expect(readForm).toHaveBeenCalledTimes(1);
    expect(session.rpc).not.toHaveBeenCalled();
  });
});
