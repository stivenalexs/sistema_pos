import { describe, expect, it } from "vitest";

import { parseOrderRequest } from "./order-request";

const ADDRESS = "8d3c7a9e-2b1f-4c6d-9e8a-1f2b3c4d5e6f";

describe("parseOrderRequest (D-077)", () => {
  it("a missing body or fulfillment means pickup", () => {
    expect(parseOrderRequest(null)).toEqual({ fulfillment: "pickup" });
    expect(parseOrderRequest({})).toEqual({ fulfillment: "pickup" });
    expect(parseOrderRequest("pickup")).toEqual({ fulfillment: "pickup" });
  });

  it("keeps the pickup cédula as typed, up to 40 characters (the database checks the digits)", () => {
    expect(parseOrderRequest({ fulfillment: "pickup", pickupDocument: "1.020.304.050" })).toEqual({
      fulfillment: "pickup",
      pickupDocument: "1.020.304.050",
    });
    expect(parseOrderRequest({ pickupDocument: "1".repeat(41) })).toEqual({ fulfillment: "pickup" });
    expect(parseOrderRequest({ pickupDocument: 1020304050 })).toEqual({ fulfillment: "pickup" });
  });

  it("delivery needs a valid address id", () => {
    expect(parseOrderRequest({ fulfillment: "delivery", addressId: ADDRESS })).toEqual({
      fulfillment: "delivery",
      addressId: ADDRESS,
    });
    expect(parseOrderRequest({ fulfillment: "delivery" })).toBeNull();
    expect(parseOrderRequest({ fulfillment: "delivery", addressId: "x" })).toBeNull();
    expect(parseOrderRequest({ fulfillment: "drone" })).toBeNull();
  });

  it("ignores prices or any other field", () => {
    expect(parseOrderRequest({ fulfillment: "pickup", total_cop: 1, deliveryFeeCop: 0 })).toEqual({ fulfillment: "pickup" });
  });
});
