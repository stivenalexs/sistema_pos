import { describe, expect, it } from "vitest";

import { inventoryErrorMessage, isUuid, parseWholeNumber, unitsWithBoxes } from "./inventory";

describe("parseWholeNumber", () => {
  it("accepts whole numbers inside the range", () => {
    expect(parseWholeNumber("12", 1, 100)).toBe(12);
    expect(parseWholeNumber(" 0 ", 0, 100)).toBe(0);
  });
  it("rejects decimals, signs, text and values out of range", () => {
    for (const value of ["1.5", "-3", "1e3", "doce", "", "0", "101", null]) {
      expect(parseWholeNumber(value, 1, 100)).toBeNull();
    }
  });
});

describe("inventoryErrorMessage", () => {
  it("translates the database code inside the error text", () => {
    expect(inventoryErrorMessage("inventory_insufficient_stock")).toMatch(/disponibles/);
    expect(inventoryErrorMessage('duplicate key value violates unique constraint "inventory_movements_idempotency_key_key"')).toMatch(
      /Recarga/,
    );
    expect(inventoryErrorMessage("inventory_count_below_reserved")).toMatch(/reservado/);
  });
  it("falls back to a generic message", () => {
    expect(inventoryErrorMessage("connection reset")).toMatch(/No se pudo registrar/);
  });
});

describe("unitsWithBoxes", () => {
  it("shows boxes only when there is at least one", () => {
    expect(unitsWithBoxes(5, 12)).toBe("5 u.");
    expect(unitsWithBoxes(12, 12)).toBe("12 u. (1 caja de 12)");
    expect(unitsWithBoxes(30, 12)).toBe("30 u. (2 cajas de 12 + 6)");
    expect(unitsWithBoxes(7, 1)).toBe("7 u.");
  });
});

describe("isUuid", () => {
  it("accepts a v4 uuid and rejects anything else", () => {
    expect(isUuid("9a000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("9a000000")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
