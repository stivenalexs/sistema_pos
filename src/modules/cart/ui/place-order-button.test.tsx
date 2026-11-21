// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeIdDocument } from "@/shared/id-document";

import { PlaceOrderButton } from "./place-order-button";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("normalizeIdDocument (D-067)", () => {
  it("accepts 5 to 12 digits typed with dots, spaces or dashes", () => {
    expect(normalizeIdDocument("1.020.304.050")).toBe("1020304050");
    expect(normalizeIdDocument(" 43 123-456 ")).toBe("43123456");
  });
  it("refuses letters and lengths outside 5 to 12", () => {
    expect(normalizeIdDocument("12a45")).toBeNull();
    expect(normalizeIdDocument("1234")).toBeNull();
    expect(normalizeIdDocument("1234567890123")).toBeNull();
  });
});

describe("PlaceOrderButton with the pickup cédula (D-067)", () => {
  it("stays locked until the cédula is valid and sends it in the body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ trackingId: "t", orderId: "o" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PlaceOrderButton choice={{ fulfillment: "pickup" }} needsPickupDocument />);

    const button = screen.getByRole("button", { name: "Confirmar pedido" });
    expect(button).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Cédula de quien recogerá el pedido"), {
      target: { value: "1.020.304.050" },
    });
    expect(button).toHaveProperty("disabled", false);

    await act(async () => {
      fireEvent.click(button);
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ fulfillment: "pickup", pickupDocument: "1.020.304.050" });
  });

  it("does not ask for a cédula for delivery or for a NIT customer", () => {
    render(<PlaceOrderButton choice={{ fulfillment: "delivery", addressId: "a" }} needsPickupDocument />);
    expect(screen.queryByLabelText("Cédula de quien recogerá el pedido")).toBeNull();
    cleanup();
    render(<PlaceOrderButton choice={{ fulfillment: "pickup" }} />);
    expect(screen.queryByLabelText("Cédula de quien recogerá el pedido")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar pedido" })).toHaveProperty("disabled", false);
  });
});

