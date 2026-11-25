import { describe, expect, it } from "vitest";

import {
  bogotaToday,
  formatBogotaDateTime,
  formatBogotaLongDateTime,
  formatBogotaShortDateTime,
  formatCalendarDay,
} from "./dates";

// 2026-11-09 03:30 UTC is still Sunday 8 November, 10:30 p. m. in Bogotá.
const LATE_SUNDAY_UTC = "2026-11-09T03:30:00Z";

describe("Bogotá dates (D-075)", () => {
  it("shows UTC timestamps in Colombian time, with plain spaces", () => {
    for (const text of [
      formatBogotaDateTime(LATE_SUNDAY_UTC),
      formatBogotaShortDateTime(LATE_SUNDAY_UTC),
      formatBogotaLongDateTime(new Date(LATE_SUNDAY_UTC)),
    ]) {
      expect(text).toMatch(/\b8\b/);
      expect(text).toMatch(/10:30/);
      expect(text).not.toMatch(/[  ]/);
    }
    expect(formatBogotaLongDateTime(LATE_SUNDAY_UTC)).toMatch(/^domingo/);
  });

  it("keeps a calendar day as it is", () => {
    expect(formatCalendarDay("2026-11-09")).toMatch(/^lunes, 9 de noviembre/);
    expect(formatCalendarDay("2026-11-09", "short")).toMatch(/9/);
  });

  it("today in Colombia, not in UTC", () => {
    expect(bogotaToday(new Date(LATE_SUNDAY_UTC))).toBe("2026-11-08");
  });
});
