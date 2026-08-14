import { describe, it, expect } from "vitest";
import {
  evaluateRisk,
  adaptiveRiskMultiplier,
  classifySymbol,
  type RiskInputs,
} from "./riskEngine";

const baseInput = (over: Partial<RiskInputs> = {}): RiskInputs => ({
  balance: 10_000,
  side: "long",
  entry: 50_000,
  stopLoss: 49_000,
  leverage: 5,
  symbol: "BTCUSDT",
  settings: {
    risk_per_trade_percent: 1,
    max_trade_size_percent: 10,
    max_open_positions: 5,
    daily_loss_limit_percent: 5,
    max_drawdown_percent: 20,
    cooldown_minutes_after_loss: 30,
    auto_stop_after_losses: 3,
  },
  context: {
    openPositions: 0,
    dailyLossPercent: 0,
    drawdownPercent: 0,
    consecutiveLosses: 0,
    minutesSinceLastLoss: null,
    isBlocked: false,
  },
  ...over,
});

describe("riskEngine — evaluateRisk", () => {
  it("allows a healthy trade and sizes quantity from SL distance", () => {
    const d = evaluateRisk(baseInput());
    expect(d.allow).toBe(true);
    expect(d.quantity).toBeGreaterThan(0);
    // entry 50k, SL 49k → 1k risk/unit; 1% of 10k = $100 risk → qty = 0.1
    expect(d.quantity).toBeCloseTo(0.1, 6);
    expect(d.notional).toBeCloseTo(5_000, 4);
    expect(d.leverage).toBe(5);
  });

  it("rejects when user is blocked", () => {
    const d = evaluateRisk(baseInput({ context: { ...baseInput().context, isBlocked: true } }));
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/block/i);
  });

  it("rejects when max open positions reached", () => {
    const d = evaluateRisk(baseInput({ context: { ...baseInput().context, openPositions: 5 } }));
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/max open positions/i);
  });

  it("rejects when daily loss limit hit", () => {
    const d = evaluateRisk(baseInput({ context: { ...baseInput().context, dailyLossPercent: 5 } }));
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/daily loss/i);
  });

  it("rejects when drawdown breached", () => {
    const d = evaluateRisk(baseInput({ context: { ...baseInput().context, drawdownPercent: 21 } }));
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/drawdown/i);
  });

  it("rejects when consecutive-loss auto-stop active", () => {
    const d = evaluateRisk(
      baseInput({ context: { ...baseInput().context, consecutiveLosses: 3 } }),
    );
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/auto-stop/i);
  });

  it("rejects during cooldown after loss", () => {
    const d = evaluateRisk(
      baseInput({ context: { ...baseInput().context, minutesSinceLastLoss: 5 } }),
    );
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/cooldown/i);
  });

  it("caps quantity by max_trade_size_percent", () => {
    const d = evaluateRisk(
      baseInput({ settings: { ...baseInput().settings, max_trade_size_percent: 1 } }),
    );
    // 1% of 10k = $100 notional cap → qty = 100/50000 = 0.002
    expect(d.allow).toBe(true);
    expect(d.notional).toBeLessThanOrEqual(500); // 100*5 lev
  });

  it("applies per-symbol max_leverage cap", () => {
    const d = evaluateRisk(
      baseInput({
        symbol: "BTCUSDT",
        leverage: 20,
        symbolCaps: [
          {
            symbol: "BTCUSDT",
            asset_class: null,
            max_exposure_pct: null,
            max_open_positions: null,
            max_leverage: 3,
            enabled: true,
          },
        ],
      }),
    );
    expect(d.allow).toBe(true);
    expect(d.leverage).toBe(3);
    expect(d.appliedSymbolCap?.scope).toBe("symbol");
  });

  it("rejects when symbol cap exhausted (exposure)", () => {
    const d = evaluateRisk(
      baseInput({
        symbol: "BTCUSDT",
        symbolCaps: [
          {
            symbol: "BTCUSDT",
            asset_class: null,
            max_exposure_pct: 0.5,
            max_open_positions: null,
            max_leverage: null,
            enabled: true,
          },
        ],
        context: {
          ...baseInput().context,
          exposureBySymbol: { BTCUSDT: 50 }, // $50 already > $50 allowed
        },
      }),
    );
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/<= 0|exhausted/i);
  });

  it("rejects invalid stop loss (entry == SL)", () => {
    const d = evaluateRisk(baseInput({ stopLoss: 50_000 }));
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/invalid stop loss/i);
  });
});

describe("riskEngine — adaptiveRiskMultiplier", () => {
  it("defaults to 1.0 neutral", () => {
    expect(
      adaptiveRiskMultiplier({ consecutiveLosses: 0, consecutiveWins: 0, recentWinRate: null }),
    ).toBe(1);
  });

  it("penalises consecutive losses down to floor 0.25", () => {
    expect(
      adaptiveRiskMultiplier({ consecutiveLosses: 1, consecutiveWins: 0, recentWinRate: null }),
    ).toBeCloseTo(0.85, 6);
    expect(
      adaptiveRiskMultiplier({ consecutiveLosses: 10, consecutiveWins: 0, recentWinRate: null }),
    ).toBeCloseTo(0.25, 6);
  });

  it("rewards hot streak capped at 1.5", () => {
    const m = adaptiveRiskMultiplier({
      consecutiveLosses: 0,
      consecutiveWins: 10,
      recentWinRate: null,
    });
    expect(m).toBeLessThanOrEqual(1.5);
    expect(m).toBeGreaterThan(1);
  });

  it("scales by win rate", () => {
    const low = adaptiveRiskMultiplier({
      consecutiveLosses: 0,
      consecutiveWins: 0,
      recentWinRate: 0.3,
    });
    const high = adaptiveRiskMultiplier({
      consecutiveLosses: 0,
      consecutiveWins: 0,
      recentWinRate: 0.7,
    });
    expect(low).toBeLessThan(1);
    expect(high).toBeGreaterThan(1);
  });
});

describe("riskEngine — classifySymbol", () => {
  it("classifies BTC pairs", () => {
    expect(classifySymbol("BTCUSDT")).toBe("BTC");
    expect(classifySymbol("ETHBTC")).toBe("BTC");
  });
  it("classifies ETH pairs", () => {
    expect(classifySymbol("ETHUSDT")).toBe("ETH");
  });
  it("classifies ETH/BTC pair as BTC (base wins)", () => {
    expect(classifySymbol("ETHBTC")).toBe("BTC");
  });
  it("classifies stables", () => {
    expect(classifySymbol("USDTUSDC")).toMatch(/STABLE|ALT/);
  });
  it("falls back to ALT", () => {
    expect(classifySymbol("SOLUSDT")).toBe("ALT");
  });
});
