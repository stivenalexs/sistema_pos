import { describe, expect, it } from "vitest";

import { parseSalesBlock, salesBlockUntilText } from "./sales-block";

const RAW = {
  block_id: "11111111-1111-4111-8111-111111111111",
  name: "Ley seca",
  message: "Ley seca en Medellín por elecciones.",
  // 2026-11-09 06:00 in Bogotá.
  ends_at: "2026-11-09T11:00:00+00:00",
};

describe("parseSalesBlock", () => {
  it("reads the object returned by the database", () => {
    expect(parseSalesBlock(RAW)).toEqual({
      blockId: RAW.block_id,
      name: "Ley seca",
      message: "Ley seca en Medellín por elecciones.",
      endsAt: RAW.ends_at,
    });
  });

  it("returns null when there is no block or the shape is wrong", () => {
    expect(parseSalesBlock(null)).toBeNull();
    expect(parseSalesBlock({ ...RAW, ends_at: "mañana" })).toBeNull();
    expect(parseSalesBlock({ ...RAW, message: 3 })).toBeNull();
  });
});

describe("salesBlockUntilText", () => {
  it("says until when, in Colombian time", () => {
    const block = parseSalesBlock(RAW);
    expect(block).not.toBeNull();
    const text = salesBlockUntilText(block!);
    expect(text).toContain("9 de noviembre");
    expect(text).toMatch(/6:00/);
    expect(text).toContain("hora de Colombia");
  });
});
