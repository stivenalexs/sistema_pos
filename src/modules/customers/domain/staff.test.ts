import { describe, expect, it } from "vitest";

import { cleanReason, isStaffRole, passwordError, validateInvite } from "./staff";

describe("validateInvite", () => {
  it("normalizes a valid invitation", () => {
    expect(validateInvite({ email: " Cajera@Test.CO ", fullName: " Ana Gómez ", phone: "", role: "cashier" })).toEqual({
      ok: true,
      value: { email: "cajera@test.co", fullName: "Ana Gómez", phone: null, role: "cashier" },
    });
  });

  it("rejects bad fields and unknown roles", () => {
    const result = validateInvite({ email: "no-es-correo", fullName: "A", phone: "abc", role: "owner" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["email", "fullName", "phone", "role"]);
  });
});

describe("passwordError", () => {
  it("uses the sign-up rule: 8+ characters with letters and digits", () => {
    expect(passwordError("abc12345")).toBeNull();
    expect(passwordError("abcdefgh")).not.toBeNull();
    expect(passwordError("12345678")).not.toBeNull();
    expect(passwordError("ab12")).not.toBeNull();
  });
});

describe("helpers", () => {
  it("accepts only known staff roles", () => {
    expect(isStaffRole("courier")).toBe(true);
    expect(isStaffRole("customer")).toBe(false);
  });

  it("requires a 3 to 300 character reason", () => {
    expect(cleanReason("  NIT verificado ")).toBe("NIT verificado");
    expect(cleanReason("ok")).toBeNull();
    expect(cleanReason("x".repeat(301))).toBeNull();
  });
});
