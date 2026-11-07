import { describe, expect, it } from "vitest";

import { formatCop, minimumLabel, priceLabel } from "./pricing";

describe("formatCop", () => {
  it("formats whole pesos with dots as thousands separator", () => {
    expect(formatCop(45000)).toBe("$ 45.000");
    expect(formatCop(1150000)).toBe("$ 1.150.000");
    expect(formatCop(0)).toBe("$ 0");
  });

  it("refuses non-integer amounts (money is never a float)", () => {
    expect(() => formatCop(10.5)).toThrow();
  });
});

describe("labels", () => {
  it("shows the price per unit or per box", () => {
    expect(priceLabel({ saleUnit: "unit", priceCop: 45000, unitsPerBox: 12 })).toBe("$ 45.000 c/u");
    expect(priceLabel({ saleUnit: "box", priceCop: 480000, unitsPerBox: 12 })).toBe(
      "$ 480.000 por caja de 12",
    );
  });

  it("shows the minimum only when it is above one", () => {
    expect(minimumLabel({ saleUnit: "unit", minQuantity: 1 })).toBeNull();
    expect(minimumLabel({ saleUnit: "unit", minQuantity: 6 })).toBe("Compra mínima: 6 unidades");
    expect(minimumLabel({ saleUnit: "box", minQuantity: 3 })).toBe("Pedido mínimo: 3 cajas");
  });
});
