import { beforeEach, describe, expect, it, vi } from "vitest";

import { isStaffRole, staffRoleFromAppMetadata } from "./staff-role";

describe("staffRoleFromAppMetadata (D-075)", () => {
  it("reads only a known role from app_metadata", () => {
    expect(staffRoleFromAppMetadata({ staff_role: "courier" })).toBe("courier");
    expect(staffRoleFromAppMetadata({ staff_role: "owner" })).toBeNull();
    expect(staffRoleFromAppMetadata({ customer_type: "retail" })).toBeNull();
    expect(staffRoleFromAppMetadata(null)).toBeNull();
    expect(staffRoleFromAppMetadata("admin")).toBeNull();
    expect(isStaffRole("constructor")).toBe(false);
  });
});

const auth = vi.hoisted(() => ({ claims: null as Record<string, unknown> | null }));
vi.mock("@/shared/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: async () => ({ data: auth.claims ? { claims: auth.claims } : null }) },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

describe("staff session (D-075)", () => {
  beforeEach(() => {
    auth.claims = null;
  });

  it("gives the session only for the roles asked for", async () => {
    const { getStaffSession, getStaffSessionIn } = await import("./staff-session");
    expect(await getStaffSession()).toBeNull();
    auth.claims = { sub: "u-1", app_metadata: { staff_role: "cashier" } };
    expect(await getStaffSession()).toEqual({ userId: "u-1", role: "cashier" });
    expect(await getStaffSessionIn(["cashier", "admin"])).toEqual({ userId: "u-1", role: "cashier" });
    expect(await getStaffSessionIn(["courier"])).toBeNull();
    // user_metadata never counts.
    auth.claims = { sub: "u-2", app_metadata: {}, user_metadata: { staff_role: "admin" } };
    expect(await getStaffSession()).toBeNull();
  });

  it("a page sends anyone else to the login, back to the same page", async () => {
    const { requireStaffPage } = await import("./staff-session");
    auth.claims = { sub: "u-1", app_metadata: { staff_role: "warehouse" } };
    await expect(requireStaffPage(["admin"], "/admin/cola")).rejects.toThrow("redirect:/login?next=/admin/cola");
    await expect(requireStaffPage(["admin", "warehouse"], "/admin/inventario")).resolves.toEqual({
      userId: "u-1",
      role: "warehouse",
    });
  });
});
