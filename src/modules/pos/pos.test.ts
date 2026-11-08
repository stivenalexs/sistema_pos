import { describe, expect, it } from "vitest";

import { addToCart, cartLines, changeFor, parseCashInput, type PosCatalogItem, setCartQuantity } from "./domain/pos";
import { parsePosSaleInput } from "./server/pos";

const AGU: PosCatalogItem = {
  productId: "00000000-0000-4000-8000-000000000101",
  sku: "NAC-AGU-750",
  name: "Aguardiente",
  saleUnit: "unit",
  unitsPerBox: 12,
  minQuantity: 1,
  priceCop: 45000,
  availableSaleUnits: 2,
};
const BEER: PosCatalogItem = { ...AGU, productId: "00000000-0000-4000-8000-000000000103", sku: "B", name: "Cerveza", minQuantity: 6, priceCop: 4000, availableSaleUnits: 100 };

describe("local cart", () => {
  it("adds up to what is available, starting at the minimum", () => {
    let cart = addToCart({}, AGU);
    cart = addToCart(cart, AGU);
    cart = addToCart(cart, AGU);
    expect(cart[AGU.productId]).toBe(2);
    expect(addToCart({}, BEER)[BEER.productId]).toBe(6);
  });

  it("limits typed quantities and removes with 0", () => {
    expect(setCartQuantity({}, AGU, 9)[AGU.productId]).toBe(2);
    expect(setCartQuantity({ [AGU.productId]: 2 }, AGU, 0)).toEqual({});
    expect(setCartQuantity({}, AGU, Number.NaN)).toEqual({});
  });

  it("shows totals and lines below the minimum", () => {
    const { lines, totalCop } = cartLines({ [AGU.productId]: 2, [BEER.productId]: 3 }, [AGU, BEER]);
    expect(totalCop).toBe(102000);
    expect(lines.find((l) => l.item.sku === "B")?.belowMinimum).toBe(true);
  });
});

describe("cash", () => {
  it("reads what the cashier types", () => {
    expect(parseCashInput("100.000")).toBe(100000);
    expect(parseCashInput("$ 50.000")).toBe(50000);
    expect(parseCashInput("12,5")).toBeNull();
    expect(parseCashInput("")).toBeNull();
  });

  it("gives change only when the cash covers the total", () => {
    expect(changeFor(90000, 100000)).toBe(10000);
    expect(changeFor(90000, 90000)).toBe(0);
    expect(changeFor(90000, 80000)).toBeNull();
    expect(changeFor(90000, null)).toBeNull();
  });
});

describe("parsePosSaleInput", () => {
  const valid = {
    items: [{ productId: AGU.productId, quantity: 2, priceCop: 1 }],
    paymentMethod: "cash",
    cashReceivedCop: 100000,
    customerId: null,
    ageConfirmed: true,
  };

  it("keeps only products and quantities (prices are ignored)", () => {
    expect(parsePosSaleInput(valid)).toEqual({
      items: [{ productId: AGU.productId, quantity: 2 }],
      paymentMethod: "cash",
      cashReceivedCop: 100000,
      customerId: null,
      ageConfirmed: true,
    });
  });

  it("rejects malformed sales", () => {
    expect(parsePosSaleInput({ ...valid, items: [] })).toBeNull();
    expect(parsePosSaleInput({ ...valid, items: [{ productId: "x", quantity: 1 }] })).toBeNull();
    expect(parsePosSaleInput({ ...valid, items: [{ productId: AGU.productId, quantity: 1.5 }] })).toBeNull();
    expect(parsePosSaleInput({ ...valid, paymentMethod: "bitcoin" })).toBeNull();
    expect(parsePosSaleInput({ ...valid, ageConfirmed: "true" })).toBeNull();
    expect(parsePosSaleInput({ ...valid, customerId: "abc" })).toBeNull();
  });
});
