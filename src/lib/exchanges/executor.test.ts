import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  toExchangeSymbol,
  clientOrderIdFor,
  normalizeOrderSize,
  placeExchangeOrder,
  fetchExchangeOrderByClientId,
  __clearInstrumentCaches,
  type InstrumentSpec,
} from "./executor.server";

const SPEC: InstrumentSpec = {
  qtyStep: 0.001,
  tickSize: 0.1,
  minQty: 0.001,
  minNotional: 5,
  contractSize: 1,
};

describe("toExchangeSymbol", () => {
  it("keeps the unified format for binance/bybit/paper", () => {
    expect(toExchangeSymbol("binance", "BTCUSDT")).toBe("BTCUSDT");
    expect(toExchangeSymbol("bybit", "ethusdt")).toBe("ETHUSDT");
    expect(toExchangeSymbol("paper", "SOLUSDT")).toBe("SOLUSDT");
  });

  it("converts to OKX SWAP instrument ids", () => {
    expect(toExchangeSymbol("okx", "BTCUSDT")).toBe("BTC-USDT-SWAP");
    expect(toExchangeSymbol("okx", "ETHUSDC")).toBe("ETH-USDC-SWAP");
  });

  it("converts to KuCoin futures symbols (BTC -> XBT, M suffix)", () => {
    expect(toExchangeSymbol("kucoin", "BTCUSDT")).toBe("XBTUSDTM");
    expect(toExchangeSymbol("kucoin", "ETHUSDT")).toBe("ETHUSDTM");
  });

  it("converts to MEXC futures symbols", () => {
    expect(toExchangeSymbol("mexc", "BTCUSDT")).toBe("BTC_USDT");
  });
});

describe("clientOrderIdFor", () => {
  const UUID = "7b22428f-75ed-59d7-8cf7-2c64242cd3f0"; // 36 chars

  it("keeps full UUIDs on binance (36-char cap)", () => {
    expect(clientOrderIdFor("binance", UUID)).toBe(UUID);
  });

  it("truncates to 32 chars on okx/mexc", () => {
    expect(clientOrderIdFor("okx", UUID)).toHaveLength(32);
    expect(clientOrderIdFor("mexc", UUID)).toHaveLength(32);
  });

  it("strips characters outside [A-Za-z0-9-]", () => {
    expect(clientOrderIdFor("okx", "abc_def.123 x")).toBe("abcdef123x");
  });
});

describe("normalizeOrderSize", () => {
  it("floors quantity to the step", () => {
    const r = normalizeOrderSize(0.0123456, 100, { ...SPEC, minNotional: 0 });
    expect(r.quantity).toBeCloseTo(0.012, 9);
    expect(r.bumped).toBe(false);
  });

  it("bumps up to minQty when below it", () => {
    const r = normalizeOrderSize(0.0004, 100, { ...SPEC, minNotional: 0 });
    expect(r.quantity).toBe(0.001);
    expect(r.bumped).toBe(true);
  });

  it("bumps up to satisfy minNotional (Binance -4164 guard)", () => {
    // 0.001 * 100 = 0.1 USDT notional, below the 5 USDT floor -> 0.05
    const r = normalizeOrderSize(0.001, 100, SPEC);
    expect(r.quantity).toBeCloseTo(0.05, 9);
    expect(r.bumped).toBe(true);
  });

  it("converts base units to contracts when contractSize > 1", () => {
    const okxLike: InstrumentSpec = {
      qtyStep: 1,
      tickSize: 0.1,
      minQty: 1,
      minNotional: 0,
      contractSize: 0.01, // 1 contract = 0.01 BTC
    };
    const r = normalizeOrderSize(0.0123, 50_000, okxLike);
    expect(r.quantity).toBe(1); // 1.23 contracts -> floor 1
  });

  it("raises a sub-step contract quantity to the minimum instead of failing", () => {
    const kcLike: InstrumentSpec = {
      qtyStep: 1,
      tickSize: 0.5,
      minQty: 1,
      minNotional: 0,
      contractSize: 0.001,
    };
    const r = normalizeOrderSize(0.0005, 100_000, kcLike);
    expect(r.quantity).toBe(1);
    expect(r.bumped).toBe(true);
  });

  it("throws on a non-positive quantity", () => {
    expect(() => normalizeOrderSize(0, 100, SPEC)).toThrow();
    expect(() => normalizeOrderSize(-1, 100, SPEC)).toThrow();
  });
});

// ---- binancePlace with a mocked exchange -----------------------------------

type FetchCall = { url: string; method: string };

function mockBinanceExchange(opts?: { failStopLoss?: boolean }) {
  const calls: FetchCall[] = [];
  const fake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });

    const json = (body: unknown, ok = true, status = 200) =>
      ({
        ok,
        status,
        text: async () => JSON.stringify(body),
      }) as unknown as Response;

    if (url.includes("/fapi/v1/exchangeInfo")) {
      return json({
        symbols: [
          {
            symbol: "BTCUSDT",
            filters: [
              { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0.001" },
              { filterType: "PRICE_FILTER", tickSize: "0.10" },
              { filterType: "MIN_NOTIONAL", minNotional: "5" },
            ],
          },
        ],
      });
    }
    if (url.includes("/fapi/v1/leverage")) return json({ leverage: 10 });
    if (url.includes("/fapi/v1/premiumIndex")) return json({ markPrice: "100000.00" });
    if (url.includes("/fapi/v1/order") && method === "POST") {
      const q = new URLSearchParams(url.split("?")[1]);
      const type = q.get("type");
      if (type === "STOP_MARKET" && opts?.failStopLoss) {
        return json({ code: -4130, msg: "mock stop failure" }, false, 400);
      }
      if (type === "STOP_MARKET" || type === "TAKE_PROFIT_MARKET") {
        return json({ orderId: 900, status: "NEW" });
      }
      return json({ orderId: 123, status: "NEW", avgPrice: "0", executedQty: "0" });
    }
    if (url.includes("/fapi/v1/order") && method === "GET") {
      return json({ orderId: 123, status: "FILLED", avgPrice: "100001.5", executedQty: "0.05" });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fake);
  return calls;
}

function param(url: string, key: string): string | null {
  return new URLSearchParams(url.split("?")[1]).get(key);
}

describe("binancePlace (mocked REST)", () => {
  beforeEach(() => __clearInstrumentCaches());
  afterEach(() => vi.unstubAllGlobals());

  const creds = { apiKey: "k", apiSecret: "s" };

  it("rounds qty to stepSize and price to tickSize (-1111 guard)", async () => {
    const calls = mockBinanceExchange();
    const r = await placeExchangeOrder("binance", creds, {
      symbol: "BTCUSDT",
      side: "long",
      quantity: 0.0123456,
      entry: 99876.54321,
      stopLoss: 99000.07,
      takeProfit: 101000.09,
      leverage: 10,
      clientOrderId: "test-order-1",
    });
    expect(r.exchangeOrderId).toBe("123");
    const orderCall = calls.find(
      (c) => c.url.includes("/fapi/v1/order") && param(c.url, "type") === "LIMIT",
    )!;
    expect(param(orderCall.url, "quantity")).toBe("0.012");
    expect(param(orderCall.url, "price")).toBe("99876.5");
    // SL/TP attached with the rounded tick price
    const slCall = calls.find((c) => param(c.url, "type") === "STOP_MARKET")!;
    expect(param(slCall.url, "stopPrice")).toBe("99000");
  });

  it("bumps a tiny market order up to min notional (-4164 guard)", async () => {
    const calls = mockBinanceExchange();
    const r = await placeExchangeOrder("binance", creds, {
      symbol: "BTCUSDT",
      side: "short",
      quantity: 0.00001, // ~1 USDT at 100k — below the 5 USDT floor
      entry: null,
      clientOrderId: "test-order-2",
    });
    const orderCall = calls.find(
      (c) => c.url.includes("/fapi/v1/order") && param(c.url, "type") === "MARKET",
    )!;
    expect(Number(param(orderCall.url, "quantity"))).toBeGreaterThanOrEqual(0.00005);
    expect(r.warnings?.some((w) => w.includes("min qty/notional"))).toBe(true);
  });

  it("surfaces SL/TP attach failures as warnings instead of swallowing them", async () => {
    mockBinanceExchange({ failStopLoss: true });
    const r = await placeExchangeOrder("binance", creds, {
      symbol: "BTCUSDT",
      side: "long",
      quantity: 0.01,
      entry: null,
      stopLoss: 99000,
      clientOrderId: "test-order-3",
    });
    expect(r.warnings?.some((w) => w.includes("stop-loss attach failed"))).toBe(true);
  });

  it("recovers a placed order by clientOrderId after a place error", async () => {
    mockBinanceExchange();
    const r = await fetchExchangeOrderByClientId("binance", creds, "BTCUSDT", "test-order-1");
    expect(r?.status).toBe("filled");
    expect(r?.exchangeOrderId).toBe("123");
  });

  it("returns null for venues without client-id lookup", async () => {
    mockBinanceExchange();
    await expect(
      fetchExchangeOrderByClientId("paper", { apiKey: "", apiSecret: "" }, "BTCUSDT", "x"),
    ).resolves.toBeNull();
  });
});
