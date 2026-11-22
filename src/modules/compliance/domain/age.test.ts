import { describe, expect, it } from "vitest";

import { hasPassedAgeGate, isAgeGateExempt, safeNextPath } from "./age-gate";
import { isOfLegalAge, isValidIsoDate, latestAdultBirthDate, todayInColombia } from "./age";

describe("isOfLegalAge", () => {
  it("accepts someone who turns 18 today", () => {
    expect(isOfLegalAge("2008-11-07", "2026-11-07")).toBe(true);
  });

  it("rejects someone who turns 18 tomorrow", () => {
    expect(isOfLegalAge("2008-11-08", "2026-11-07")).toBe(false);
  });

  it("handles a 29 February birthday like the database", () => {
    expect(latestAdultBirthDate("2026-02-28")).toBe("2008-02-28");
    expect(isOfLegalAge("2008-02-29", "2026-02-28")).toBe(false);
    expect(isOfLegalAge("2008-02-29", "2026-03-01")).toBe(true);
  });

  it("rejects invalid dates", () => {
    expect(isOfLegalAge("1990-02-30", "2026-11-07")).toBe(false);
    expect(isOfLegalAge("07/11/1990", "2026-11-07")).toBe(false);
  });
});

describe("isValidIsoDate", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2023-02-29")).toBe(false);
    expect(isValidIsoDate("2024-13-01")).toBe(false);
  });
});

describe("todayInColombia", () => {
  it("uses Colombian time, not UTC", () => {
    // 2026-11-08 03:00 UTC is still 2026-11-07 at 22:00 in Bogotá.
    expect(todayInColombia(new Date("2026-11-08T03:00:00Z"))).toBe("2026-11-07");
  });
});

describe("age gate", () => {
  it("exempts the gate itself, APIs and auth callbacks", () => {
    expect(isAgeGateExempt("/age-check")).toBe(true);
    expect(isAgeGateExempt("/api/workers/actions")).toBe(true);
    expect(isAgeGateExempt("/auth/confirm")).toBe(true);
  });

  it("protects every other page", () => {
    expect(isAgeGateExempt("/")).toBe(false);
    expect(isAgeGateExempt("/signup")).toBe(false);
    expect(isAgeGateExempt("/age-checkout")).toBe(false);
  });

  it("only accepts the exact cookie value", () => {
    expect(hasPassedAgeGate("1")).toBe(true);
    expect(hasPassedAgeGate("true")).toBe(false);
    expect(hasPassedAgeGate(undefined)).toBe(false);
  });

  it("never redirects outside the site", () => {
    expect(safeNextPath("/signup")).toBe("/signup");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("/age-check?next=/")).toBe("/");
  });

  it("refuses control characters that browsers strip into //host (D-072)", () => {
    const tab = String.fromCharCode(9);
    const lf = String.fromCharCode(10);
    const cr = String.fromCharCode(13);
    const nul = String.fromCharCode(0);
    expect(safeNextPath(`/${tab}/evil.example`)).toBe("/");
    expect(safeNextPath(decodeURIComponent("%2F%09%2Fevil.example"))).toBe("/");
    expect(safeNextPath(`/${lf}/evil.example`)).toBe("/");
    expect(safeNextPath(`/${cr}${lf}/evil.example`)).toBe("/");
    expect(safeNextPath(`/${nul}/evil.example`)).toBe("/");
    expect(safeNextPath("/orders/abc?x=1#y")).toBe("/orders/abc?x=1#y");
    expect(safeNextPath("/admin/facturas")).toBe("/admin/facturas");
  });
});
