import { describe, expect, it } from "vitest";

import { bogotaLocalToIso, isoToBogotaLocal, parseSalesBlockRule, type RawRuleInput } from "./sales-block-rule";

describe("Colombia time", () => {
  it("reads a date and time typed in Bogotá as UTC-5", () => {
    expect(bogotaLocalToIso("2026-11-14T18:00")).toBe("2026-11-14T23:00:00.000Z");
    expect(bogotaLocalToIso("2026-11-14T22:30")).toBe("2026-11-15T03:30:00.000Z");
  });
  it("writes an instant back in Bogotá time", () => {
    expect(isoToBogotaLocal("2026-11-15T03:30:00Z")).toBe("2026-11-14T22:30");
    expect(isoToBogotaLocal(null)).toBe("");
  });
  it("rejects anything that is not a date and time", () => {
    for (const bad of ["", "2026-11-14", "2026-11-14 18:00", "2026-13-40T99:99", "mañana"]) {
      expect(bogotaLocalToIso(bad)).toBeNull();
    }
  });
});

const RANGE: RawRuleInput = {
  name: "Ley seca elecciones",
  kind: "date_range",
  zoneId: "all",
  channels: ["web", "pos"],
  startsAt: "2026-11-14T18:00",
  endsAt: "2026-11-16T06:00",
  weekdays: [],
  startTime: "",
  endTime: "",
  message: "Ley seca por elecciones.",
};

const WEEKLY: RawRuleInput = {
  ...RANGE,
  name: "Horario nocturno",
  kind: "weekly",
  zoneId: "9a000000-0000-4000-8000-000000000001",
  channels: ["web"],
  startsAt: "",
  endsAt: "",
  weekdays: ["5", "6"],
  startTime: "22:00",
  endTime: "10:00",
};

describe("parseSalesBlockRule", () => {
  it("accepts a date range for the whole department", () => {
    const parsed = parseSalesBlockRule(RANGE);
    expect(parsed).toMatchObject({
      ok: true,
      value: { kind: "date_range", zoneId: null, startsAt: "2026-11-14T23:00:00.000Z", endsAt: "2026-11-16T11:00:00.000Z" },
    });
  });
  it("accepts a weekly window that crosses midnight, with optional validity", () => {
    expect(parseSalesBlockRule(WEEKLY)).toMatchObject({
      ok: true,
      value: { kind: "weekly", weekdays: [5, 6], startTime: "22:00", endTime: "10:00", startsAt: null, endsAt: null },
    });
  });
  it("rejects incomplete or impossible rules", () => {
    for (const bad of [
      { ...RANGE, endsAt: "" },
      { ...RANGE, endsAt: "2026-11-14T17:00" },
      { ...RANGE, channels: [] },
      { ...RANGE, channels: ["web", "telefono"] },
      { ...RANGE, zoneId: "Medellín" },
      { ...RANGE, name: "x" },
      { ...RANGE, message: "" },
      { ...WEEKLY, weekdays: [] },
      { ...WEEKLY, weekdays: ["8"] },
      { ...WEEKLY, startTime: "22:00", endTime: "22:00" },
      { ...WEEKLY, startTime: "25:00" },
      { ...RANGE, kind: "monthly" },
    ]) {
      expect(parseSalesBlockRule(bad).ok).toBe(false);
    }
  });
});
