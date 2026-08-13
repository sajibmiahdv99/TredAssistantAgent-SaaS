import { describe, it, expect } from "vitest";
import { buildEntryLadder } from "./pipeline.functions";

describe("pipeline — buildEntryLadder", () => {
  const base = { entry: 100, side: "long" as const, totalQty: 10 };

  it("returns single entry for single mode", () => {
    const r = buildEntryLadder({ ...base, mode: "single", levels: 1, rangePercent: 2, distribution: "equal" });
    expect(r).toHaveLength(1);
    expect(r[0].price).toBe(100);
    expect(r[0].qty).toBe(10);
  });

  it("returns single entry when levels <= 1", () => {
    const r = buildEntryLadder({ ...base, mode: "scale_in", levels: 1, rangePercent: 2, distribution: "equal" });
    expect(r).toHaveLength(1);
  });

  it("creates 3 equal-weighted scale-in levels for long", () => {
    const r = buildEntryLadder({ ...base, mode: "scale_in", levels: 3, rangePercent: 3, distribution: "equal" });
    expect(r).toHaveLength(3);
    // long: entry steps down (cheaper entries); first level = entry
    expect(r[0].price).toBe(base.entry);
    expect(r[0].qty).toBeCloseTo(10 / 3, 4);
    expect(r[1].qty).toBeCloseTo(10 / 3, 4);
    expect(r[2].price).toBeLessThan(r[1].price);
  });

  it("front-loads distribution", () => {
    const r = buildEntryLadder({ ...base, mode: "scale_in", levels: 3, rangePercent: 3, distribution: "front_loaded" });
    expect(r[0].qty).toBeGreaterThan(r[1].qty);
    expect(r[1].qty).toBeGreaterThan(r[2].qty);
  });

  it("back-loads distribution", () => {
    const r = buildEntryLadder({ ...base, mode: "scale_in", levels: 3, rangePercent: 3, distribution: "back_loaded" });
    expect(r[0].qty).toBeLessThan(r[1].qty);
    expect(r[1].qty).toBeLessThan(r[2].qty);
  });

  it("handles short side (steps up)", () => {
    const r = buildEntryLadder({ ...base, entry: 100, side: "short", mode: "scale_in", levels: 2, rangePercent: 2, distribution: "equal" });
    expect(r).toHaveLength(2);
    // short: entry steps up (higher entries)
    expect(r[0].price).toBeGreaterThanOrEqual(100);
    expect(r[1].price).toBeGreaterThan(r[0].price);
  });
});