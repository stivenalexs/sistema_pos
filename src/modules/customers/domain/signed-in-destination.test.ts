import { describe, expect, it } from "vitest";

import { SIGNED_OUT_ONLY_PATHS, signedInDestination } from "./staff";

describe("signedInDestination", () => {
  it("sends each role to its home", () => {
    expect(signedInDestination("admin", null)).toBe("/admin");
    expect(signedInDestination("cashier", null)).toBe("/pos");
    expect(signedInDestination("warehouse", null)).toBe("/admin/inventario");
  });

  it("sends customers to the catalog", () => {
    expect(signedInDestination(undefined, null)).toBe("/");
    expect(signedInDestination("hacker", "/")).toBe("/");
  });

  it("keeps a safe next page the person asked for", () => {
    expect(signedInDestination(undefined, "/cart")).toBe("/cart");
    expect(signedInDestination("admin", "/admin/facturas")).toBe("/admin/facturas");
  });

  it("covers sign-in and sign-up only", () => {
    expect(SIGNED_OUT_ONLY_PATHS).toEqual(["/login", "/signup"]);
  });
});
