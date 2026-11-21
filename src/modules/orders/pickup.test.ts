import { describe, expect, it } from "vitest";

import { canConfirmPickup } from "./domain/pickup";

describe("canConfirmPickup (D-067)", () => {
  it("only for paid or preparing pickup orders not marked for refund", () => {
    expect(canConfirmPickup({ fulfillment: "pickup", status: "paid", needsRefund: false })).toBe(true);
    expect(canConfirmPickup({ fulfillment: "pickup", status: "preparing", needsRefund: false })).toBe(true);
    expect(canConfirmPickup({ fulfillment: "pickup", status: "awaiting_payment", needsRefund: false })).toBe(false);
    expect(canConfirmPickup({ fulfillment: "pickup", status: "delivered", needsRefund: false })).toBe(false);
    expect(canConfirmPickup({ fulfillment: "pickup", status: "paid", needsRefund: true })).toBe(false);
    expect(canConfirmPickup({ fulfillment: "delivery", status: "paid", needsRefund: false })).toBe(false);
  });
});
