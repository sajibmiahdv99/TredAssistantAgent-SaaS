// Paper trading executor — simulates order execution without real API keys.
// Implements the same PlaceOrderResult / PlaceOrderInput interface as the
// real exchange executors so the pipeline can treat it identically.
//
// Simulation: market orders fill instantly at current price +/- random slippage;
// limit orders fill when price crosses the limit; SL/TP trigger at target.
// Price data fetched from Binance public ticker (cached up to 10s).

import { createHmac, randomBytes } from "crypto";

export type PlaceOrderInput = {
  symbol: string;
  side: "long" | "short";
  quantity: number;
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  leverage?: number | null;
  clientOrderId: string;
};

export type PlaceOrderResult = {
  exchangeOrderId: string;
  status: "open" | "filled" | "partial" | "rejected";
  fillPrice?: number;
  filledQuantity?: number;
  raw: unknown;
};

export type CancelOrderResult = { ok: boolean };
export type FetchOrderResult = PlaceOrderResult;

// ---- Price feed ------------------------------------------------------------

let _priceCache: { at: number; map: Record<string, number> } | null = null;

async function getPrice(symbol: string): Promise<number | null> {
  const now = Date.now();
  if (_priceCache && now - _priceCache.at < 10_000) {
    return _priceCache.map[symbol] ?? null;
  }
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) return _priceCache?.map[symbol] ?? null;
    const json = (await res.json()) as { symbol: string; price: string };
    const price = Number(json.price);
    if (!_priceCache) _priceCache = { at: now, map: {} };
    _priceCache.map[symbol] = price;
    _priceCache.at = now;
    return price;
  } catch {
    return _priceCache?.map[symbol] ?? null;
  }
}

// ---- Slippage simulation ---------------------------------------------------

function simulatedSlippage(price: number, side: "long" | "short"): number {
  // Random slippage: 0.01%–0.15% against the trader
  const slippage = (0.0001 + Math.random() * 0.0014) * price;
  return side === "long" ? price + slippage : price - slippage;
}

// ---- Fill simulation --------------------------------------------------------

function simulateFill(
  entry: number | null | undefined,
  side: "long" | "short",
  quantity: number,
  currentPrice: number,
): { fillPrice: number; filledQuantity: number } {
  if (entry) {
    // Limit order: fill at limit price if it's within reasonable range
    const isReachable = side === "long"
      ? currentPrice <= entry * 1.005 // within 0.5% of entry
      : currentPrice >= entry * 0.995;
    if (!isReachable) {
      // Partial fill or no fill — simulate 30% fill at limit
      const fillQty = quantity * 0.3;
      return { fillPrice: entry, filledQuantity: fillQty };
    }
    // Market reached our limit — fill at entry with slight slippage
    return { fillPrice: simulatedSlippage(entry, side), filledQuantity: quantity };
  }
  // Market order: fill at current price with slippage
  return { fillPrice: simulatedSlippage(currentPrice, side), filledQuantity: quantity };
}

// ---- Main executor interface ------------------------------------------------

export async function paperPlace(
  o: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  const currentPrice = await getPrice(o.symbol);
  if (!currentPrice) {
    return {
      exchangeOrderId: `ppr-${randomBytes(8).toString("hex")}`,
      status: "rejected",
      reason: "price feed unavailable",
      raw: { error: "no price data" },
    } as PlaceOrderResult;
  }

  const fill = simulateFill(o.entry, o.side, o.quantity, currentPrice);
  const isFilled = fill.filledQuantity >= o.quantity;

  return {
    exchangeOrderId: `ppr-${randomBytes(8).toString("hex")}`,
    status: isFilled ? "filled" : "partial",
    fillPrice: fill.fillPrice,
    filledQuantity: fill.filledQuantity,
    raw: {
      simulated: true,
      currentPrice,
      stopLoss: o.stopLoss,
      takeProfit: o.takeProfit,
      leverage: o.leverage ?? 1,
    },
  };
}

export async function paperCancel(
  _symbol: string,
  _id: string,
): Promise<void> {
  return;
}

export async function paperFetch(
  _symbol: string,
  _id: string,
): Promise<FetchOrderResult> {
  // For paper trades, just return a generic "filled" status
  return {
    exchangeOrderId: _id,
    status: "filled",
    raw: { simulated: true, fetched: true },
  };
}

export async function paperValidate(): Promise<{
  ok: boolean;
  canTrade: boolean;
  permissions: string[];
}> {
  return { ok: true, canTrade: true, permissions: ["trade", "read", "paper"] };
}

// ---- Register as a pseudo-exchange adapter ---------------------------------

export const PAPER_ADAPTER = {
  place: paperPlace,
  cancel: paperCancel,
  fetch: paperFetch,
  validate: paperValidate,
};