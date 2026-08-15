import { describe, it, expect } from "vitest";
import { whaleRiskAdjustment, toSymbol, type WhaleSignal } from "./whaleWatch.server";

describe("whaleRiskAdjustment", () => {
  it("returns neutral when signal is absent or feed failed", () => {
    expect(whaleRiskAdjustment(null)).toEqual({ multiplier: 1, block: false });
    expect(
      whaleRiskAdjustment({
        ok: false,
        symbol: "BTCUSDT",
        buyPressure: null,
        whaleTrades: 0,
        latestAt: null,
        summary: "feed down",
      }),
    ).toEqual({ multiplier: 1, block: false });
  });

  it("returns neutral when not enough whale trades observed", () => {
    const sig: WhaleSignal = {
      ok: true,
      symbol: "BTCUSDT",
      buyPressure: 0.5,
      whaleTrades: 1,
      latestAt: Date.now(),
      summary: "only 1 trade",
    };
    expect(whaleRiskAdjustment(sig)).toEqual({ multiplier: 1, block: false });
  });

  it("penalizes heavy distribution (<= 25% buy-side)", () => {
    const sig: WhaleSignal = {
      ok: true,
      symbol: "BTCUSDT",
      buyPressure: 0.2,
      whaleTrades: 10,
      latestAt: Date.now(),
      summary: "whale DISTRIBUTION on BTC (10 trades, 20% buy-side)",
    };
    const adj = whaleRiskAdjustment(sig);
    expect(adj.multiplier).toBe(0.7);
    expect(adj.block).toBe(false);
    expect(adj.reason).toContain("DISTRIBUTION");
  });

  it("boosts strong accumulation (>= 75% buy-side)", () => {
    const sig: WhaleSignal = {
      ok: true,
      symbol: "BTCUSDT",
      buyPressure: 0.9,
      whaleTrades: 8,
      latestAt: Date.now(),
      summary: "whale ACCUMULATION on BTC",
    };
    expect(whaleRiskAdjustment(sig).multiplier).toBe(1.1);
  });

  it("neutral on mixed activity", () => {
    const sig: WhaleSignal = {
      ok: true,
      symbol: "BTCUSDT",
      buyPressure: 0.5,
      whaleTrades: 6,
      latestAt: Date.now(),
      summary: "mixed whale activity",
    };
    expect(whaleRiskAdjustment(sig).multiplier).toBe(1);
  });
});

describe("toSymbol", () => {
  it("strips quote suffix to base asset", () => {
    expect(toSymbol("BTCUSDT")).toBe("BTC");
    expect(toSymbol("ETHUSDC")).toBe("ETH");
    expect(toSymbol("SOLUSD")).toBe("SOL");
    expect(toSymbol("1000PEPEUSDT")).toBe("1000PEPE");
  });

  it("keeps bare symbols unchanged", () => {
    expect(toSymbol("BTC")).toBe("BTC");
  });
});
