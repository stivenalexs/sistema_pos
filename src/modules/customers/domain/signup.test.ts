import { describe, expect, it } from "vitest";

import { validateSignup } from "./signup";

const TODAY = "2026-11-07";

const VALID = {
  fullName: "Ana Gómez",
  email: "Ana@Example.com ",
  password: "clave1234",
  birthDate: "1990-03-03",
  customerType: "retail",
  acceptAge: "on",
  acceptTerms: "on",
  acceptPrivacy: "on",
};

describe("validateSignup", () => {
  it("accepts a valid retail customer and normalises the email", () => {
    const result = validateSignup(VALID, TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.email).toBe("ana@example.com");
      expect(result.data.businessName).toBeNull();
    }
  });

  it("rejects someone under 18", () => {
    const result = validateSignup({ ...VALID, birthDate: "2008-11-08" }, TODAY);
    expect(result).toEqual({
      ok: false,
      errors: { birthDate: "Debes tener 18 años o más para registrarte." },
    });
  });

  it("accepts someone who turns 18 today", () => {
    expect(validateSignup({ ...VALID, birthDate: "2008-11-07" }, TODAY).ok).toBe(true);
  });

  it("requires every legal acceptance", () => {
    const result = validateSignup(
      { ...VALID, acceptAge: undefined, acceptTerms: "off", acceptPrivacy: "" },
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        "acceptAge",
        "acceptPrivacy",
        "acceptTerms",
      ]);
    }
  });

  it("requires letters and numbers in the password", () => {
    const result = validateSignup({ ...VALID, password: "solamenteletras" }, TODAY);
    expect(result.ok).toBe(false);
  });

  it("requires business name and NIT for wholesale", () => {
    const result = validateSignup({ ...VALID, customerType: "wholesale" }, TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.businessName).toBeDefined();
      expect(result.errors.nit).toBeDefined();
    }
  });

  it("accepts a wholesale customer with a NIT written with dots", () => {
    const result = validateSignup(
      { ...VALID, customerType: "wholesale", businessName: "Licores SAS", nit: "900.123.456-7" },
      TODAY,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.nit).toBe("900123456-7");
  });

  it("rejects a customer type that is not offered", () => {
    expect(validateSignup({ ...VALID, customerType: "admin" }, TODAY).ok).toBe(false);
  });
});
