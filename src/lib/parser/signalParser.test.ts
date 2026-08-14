import { describe, it, expect } from "vitest";
import { parseSignal, PARSER_VERSION } from "./signalParser";

describe("signalParser — parseSignal", () => {
  it("parses a full English signal", () => {
    const r = parseSignal("BTCUSDT LONG entry 67250 SL 66800 TP1 68000 TP2 69000 lev 10x");
    expect(r.symbol).toBe("BTCUSDT");
    expect(r.side).toBe("long");
    expect(r.entry).toBe(67250);
    expect(r.stopLoss).toBe(66800);
    expect(r.takeProfit).toEqual([68000, 69000]);
    expect(r.leverage).toBe(10);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.parserVersion).toBe(PARSER_VERSION);
  });

  it("parses short signal with / separator", () => {
    const r = parseSignal("ETH/USDT SHORT sell@3450 stop 3520 target 3380");
    expect(r.symbol).toBe("ETHUSDT");
    expect(r.side).toBe("short");
    expect(r.entry).toBe(3450);
    expect(r.stopLoss).toBe(3520);
    expect(r.takeProfit[0]).toBe(3380);
  });

  it("parses comma decimal entry", () => {
    const r = parseSignal("SOLUSDT long entry 142,5 sl 138");
    expect(r.entry).toBe(142.5);
  });

  it("handles empty text", () => {
    const r = parseSignal("");
    expect(r.error).toBe("empty text");
    expect(r.confidence).toBe(0);
  });

  it("returns low confidence for gibberish", () => {
    const r = parseSignal("good morning everyone! ☕");
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.error).toBe("low confidence");
  });

  it("is case-insensitive", () => {
    const r = parseSignal("btcusdt LONG Entry 100 SL 99 TP1 110");
    expect(r.symbol).toBe("BTCUSDT");
    expect(r.side).toBe("long");
    expect(r.entry).toBe(100);
  });

  it("parses leverage written as 20x", () => {
    const r = parseSignal("BTCUSDT long entry 30000 sl 29000 tp 32000 20x");
    expect(r.leverage).toBe(20);
  });
});
