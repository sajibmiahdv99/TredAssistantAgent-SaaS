// Server-only: place / cancel / fetch orders on real exchanges via REST.
// Targets USD-M perpetual futures (leverage-friendly auto-trading).
// No CCXT — Workers-compatible fetch + HMAC only.

import { createHmac } from "crypto";
import { paperPlace, paperCancel, paperFetch, paperValidate } from "./paperExecutor.server.ts";

export type PlaceOrderInput = {
  symbol: string; // e.g. "BTCUSDT"
  side: "long" | "short"; // normalised
  quantity: number;
  entry?: number | null; // null = market
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
  /** Non-fatal problems (e.g. SL/TP attach failed — position is UNPROTECTED). */
  warnings?: string[];
  raw: unknown;
};

export type ExchangeCreds = {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
};

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function qs(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
}

// ---- Shared: symbol mapping, client order ids, resilience ----------------

/**
 * Orders are stored with a unified Binance-style symbol ("BTCUSDT"). Each
 * venue has its own contract naming — convert at the adapter boundary so no
 * other code has to care.
 */
export function toExchangeSymbol(exchangeCode: string, symbol: string): string {
  const s = symbol.toUpperCase().trim();
  const base = baseAssetOf(s);
  const quote = s.length > base.length ? s.slice(base.length) : "USDT";
  switch (exchangeCode) {
    case "okx":
      return `${base}-${quote}-SWAP`; // BTCUSDT -> BTC-USDT-SWAP
    case "kucoin":
      // KuCoin futures perps carry an M suffix; BTC trades as XBT there.
      return `${base === "BTC" ? "XBT" : base}${quote}M`;
    case "mexc":
      return `${base}_${quote}`; // BTCUSDT -> BTC_USDT
    default:
      return s; // binance / bybit / paper / bridges use the unified format
  }
}

/**
 * Exchange-safe client order id. OKX and MEXC cap at 32 chars and reject
 * anything outside [A-Za-z0-9-]; Binance/Bybit cap at 36; KuCoin at 40.
 * Callers may pass a full UUID — we normalise per venue so placement never
 * fails on id format, and so WS/reconciliation matching stays consistent.
 */
export function clientOrderIdFor(exchangeCode: string, base: string): string {
  const clean = base.replace(/[^A-Za-z0-9-]/g, "");
  const max = exchangeCode === "okx" || exchangeCode === "mexc" ? 32 : 36;
  return clean.slice(0, max);
}

const REQUEST_TIMEOUT_MS = 15_000;

function isRetryableStatus(status: number): boolean {
  return status === 418 || status === 429 || status >= 500;
}

/**
 * fetch with a hard timeout. `allowRetry` enables up to 2 retries with
 * backoff on rate-limit (418/429) and 5xx — only for idempotent calls.
 * NEVER allow retries on order placement: a retried POST can double-place;
 * place failures are recovered via fetchExchangeOrderByClientId instead.
 */
export async function fetchText(
  url: string,
  init: RequestInit = {},
  allowRetry = true,
): Promise<{ status: number; ok: boolean; text: string }> {
  const maxAttempts = allowRetry ? 3 : 1;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const text = await res.text();
      if (res.ok) return { status: res.status, ok: true, text };
      if (allowRetry && isRetryableStatus(res.status)) {
        lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        continue;
      }
      return { status: res.status, ok: false, text };
    } catch (e) {
      lastErr = e;
      if (!allowRetry) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---- Shared: instrument precision (qty step / tick / min notional) -------

export type InstrumentSpec = {
  qtyStep: number; // minimum quantity increment (base units or lots, venue-dependent)
  tickSize: number; // minimum price increment
  minQty: number; // minimum order quantity (same unit as qtyStep)
  minNotional: number; // minimum order value in quote currency, 0 = none
  contractSize: number; // base units per contract/lot (1 = venue trades in base units)
};

const instrumentCache = new Map<string, { at: number; spec: InstrumentSpec }>();
const INSTRUMENT_TTL_MS = 6 * 60 * 60 * 1000;

/** Test hook: drop all cached instrument specs. */
export function __clearInstrumentCaches(): void {
  instrumentCache.clear();
  binancePrecisionCache.clear();
}

function floorToStep(v: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return v;
  return Math.floor((v + 1e-9) / step) * step;
}

function ceilToStep(v: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return v;
  return Math.ceil((v - 1e-9) / step) * step;
}

export type NormalizedSize = {
  /** Quantity in the unit the venue expects (base units, or contracts when contractSize > 1). */
  quantity: number;
  bumped: boolean; // true when the quantity was raised to satisfy minQty/minNotional
};

/**
 * Consistent size normalisation for every venue: floor to the qty step, then
 * bump UP to satisfy minQty and minNotional (a too-small order is otherwise
 * rejected — Binance -4164 and equivalents). Throws when the size rounds to
 * zero, because no venue can place that.
 */
export function normalizeOrderSize(
  rawQty: number,
  refPrice: number | null,
  spec: InstrumentSpec,
): NormalizedSize {
  const step = spec.qtyStep;
  // Convert base-unit qty into the venue's trading unit (contracts when needed).
  const unitQty = spec.contractSize > 1 ? rawQty / spec.contractSize : rawQty;
  if (!Number.isFinite(unitQty) || unitQty <= 0) {
    throw new Error(`Order qty ${rawQty} is not positive in venue units`);
  }
  let qty = floorToStep(unitQty, step);
  let bumped = false;
  if (qty <= 0) {
    // Below one step: raise to the venue minimum if there is one, else reject.
    if (spec.minQty > 0) {
      qty = spec.minQty;
      bumped = true;
    } else {
      throw new Error(
        `Rounded qty 0 from ${rawQty} (step ${step}, contractSize ${spec.contractSize})`,
      );
    }
  }
  if (spec.minQty > 0 && qty < spec.minQty) {
    qty = spec.minQty;
    bumped = true;
  }
  if (spec.minNotional > 0 && refPrice != null && refPrice > 0) {
    const notional = qty * spec.contractSize * refPrice;
    if (notional < spec.minNotional) {
      qty = ceilToStep(spec.minNotional / (spec.contractSize * refPrice), step);
      bumped = true;
    }
  }
  return { quantity: qty, bumped };
}

function normalizePrice(v: number, spec: InstrumentSpec): number {
  return floorToStep(v, spec.tickSize);
}

// ---- Binance USD-M Futures ------------------------------------------------
const BINANCE_FAPI = "https://fapi.binance.com";

// Symbol precision filters (LOT_SIZE stepSize for qty, PRICE_FILTER tickSize for price).
// Cached per symbol; exchangeInfo is a public endpoint (no auth/signature needed).
const binancePrecisionCache = new Map<
  string,
  { lotStep: number; tickSize: number; minQty: number; minNotional: number }
>();

async function binanceSymbolPrecision(
  symbol: string,
): Promise<{ lotStep: number; tickSize: number; minQty: number; minNotional: number }> {
  const hit = binancePrecisionCache.get(symbol);
  if (hit) return hit;
  const res = await fetchText(
    `${BINANCE_FAPI}/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(symbol)}`,
  );
  const j = JSON.parse(res.text) as {
    symbols?: Array<{
      symbol: string;
      filters?: Array<{ filterType: string; stepSize?: string; tickSize?: string; minQty?: string; minNotional?: string; notional?: string }>;
    }>;
  };
  const s = (j.symbols ?? []).find((x) => x.symbol === symbol);
  const lot = (s?.filters ?? []).find((f) => f.filterType === "LOT_SIZE");
  const price = (s?.filters ?? []).find((f) => f.filterType === "PRICE_FILTER");
  const minNotionalFilter =
    (s?.filters ?? []).find((f) => f.filterType === "MIN_NOTIONAL") ??
    (s?.filters ?? []).find((f) => f.filterType === "NOTIONAL");
  const info = {
    lotStep: lot?.stepSize ? Number(lot.stepSize) : NaN,
    tickSize: price?.tickSize ? Number(price.tickSize) : NaN,
    minQty: lot?.minQty ? Number(lot.minQty) : 0,
    minNotional: minNotionalFilter
      ? Number(minNotionalFilter.minNotional ?? minNotionalFilter.notional ?? 0)
      : 0,
  };
  binancePrecisionCache.set(symbol, info);
  return info;
}

// Reference price for the min-notional check on MARKET orders.
async function binanceMarkPrice(symbol: string): Promise<number> {
  const res = await fetchText(
    `${BINANCE_FAPI}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`,
  );
  const j = JSON.parse(res.text) as { markPrice?: string };
  return Number(j.markPrice) || 0;
}

async function binanceSigned(
  creds: ExchangeCreds,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number | undefined>,
  allowRetry = true,
): Promise<unknown> {
  const ts = Date.now();
  const body = qs({ ...params, timestamp: ts, recvWindow: 10000 });
  const sig = sign(creds.apiSecret, body);
  const url = `${BINANCE_FAPI}${path}?${body}&signature=${sig}`;
  const res = await fetchText(
    url,
    { method, headers: { "X-MBX-APIKEY": creds.apiKey } },
    allowRetry,
  );
  if (!res.ok) throw new Error(`Binance ${res.status}: ${res.text}`);
  return res.text ? JSON.parse(res.text) : {};
}

async function binancePlace(creds: ExchangeCreds, o: PlaceOrderInput): Promise<PlaceOrderResult> {
  const warnings: string[] = [];
  const coid = clientOrderIdFor("binance", o.clientOrderId);

  // Set leverage first (idempotent; ignore errors that just say "no change")
  if (o.leverage && o.leverage > 1) {
    await binanceSigned(creds, "POST", "/fapi/v1/leverage", {
      symbol: o.symbol,
      leverage: Math.floor(o.leverage),
    }).catch(() => undefined);
  }

  const side = o.side === "long" ? "BUY" : "SELL";
  const type = o.entry ? "LIMIT" : "MARKET";

  // Round qty/price to the contract's precision (stepSize / tickSize) — otherwise
  // Binance rejects with code -1111 "Precision is over the maximum defined for this asset".
  const pre = await binanceSymbolPrecision(o.symbol);
  const spec: InstrumentSpec = {
    qtyStep: pre.lotStep,
    tickSize: pre.tickSize,
    minQty: pre.minQty,
    minNotional: pre.minNotional,
    contractSize: 1,
  };
  const entry = o.entry != null ? normalizePrice(o.entry, spec) : o.entry;
  const sl = o.stopLoss != null ? normalizePrice(o.stopLoss, spec) : o.stopLoss;
  const tp = o.takeProfit != null ? normalizePrice(o.takeProfit, spec) : o.takeProfit;

  // Binance USD-M minimum notional (e.g. 5 USDT). For market orders use the live mark price
  // as the reference; for limit orders use the limit price. Bump qty up to meet the floor so
  // the account can actually trade small balances instead of getting -4164.
  const refPrice =
    type === "LIMIT" && entry ? entry : await binanceMarkPrice(o.symbol).catch(() => 0);
  const sized = normalizeOrderSize(o.quantity, refPrice > 0 ? refPrice : null, spec);
  const qty = sized.quantity;
  if (sized.bumped) {
    warnings.push(
      `qty raised from ${o.quantity} to ${qty} to satisfy min qty/notional for ${o.symbol}`,
    );
  }

  const params: Record<string, string | number | undefined> = {
    symbol: o.symbol,
    side,
    type,
    quantity: qty,
    newClientOrderId: coid,
  };
  if (type === "LIMIT") {
    params.price = entry!;
    params.timeInForce = "GTC";
  }

  // No retry on placement — a timed-out POST may still have been accepted.
  // Callers recover via fetchExchangeOrderByClientId.
  const placed = (await binanceSigned(creds, "POST", "/fapi/v1/order", params, false)) as {
    orderId: number;
    status: string;
    avgPrice?: string;
    executedQty?: string;
  };

  // Best-effort attach SL / TP as reduce-only stop/limit orders. Failures are
  // surfaced as warnings so callers can alert — a filled order without its
  // protective stops is a naked position.
  const closeSide = side === "BUY" ? "SELL" : "BUY";
  if (sl) {
    const r = await binanceSigned(creds, "POST", "/fapi/v1/order", {
      symbol: o.symbol,
      side: closeSide,
      type: "STOP_MARKET",
      stopPrice: sl,
      closePosition: "true",
      newClientOrderId: `${coid}-sl`,
    }).catch((e) => e as Error);
    if (r instanceof Error) {
      warnings.push(`stop-loss attach failed: ${r.message.slice(0, 150)}`);
    }
  }
  if (tp) {
    const r = await binanceSigned(creds, "POST", "/fapi/v1/order", {
      symbol: o.symbol,
      side: closeSide,
      type: "TAKE_PROFIT_MARKET",
      stopPrice: tp,
      closePosition: "true",
      newClientOrderId: `${coid}-tp`,
    }).catch((e) => e as Error);
    if (r instanceof Error) {
      warnings.push(`take-profit attach failed: ${r.message.slice(0, 150)}`);
    }
  }

  const status = mapBinanceStatus(placed.status);
  return {
    exchangeOrderId: String(placed.orderId),
    status,
    fillPrice: placed.avgPrice ? Number(placed.avgPrice) : undefined,
    filledQuantity: placed.executedQty ? Number(placed.executedQty) : undefined,
    warnings: warnings.length ? warnings : undefined,
    raw: placed,
  };
}

function mapBinanceStatus(s: string): PlaceOrderResult["status"] {
  switch (s) {
    case "FILLED":
      return "filled";
    case "PARTIALLY_FILLED":
      return "partial";
    case "NEW":
      return "open";
    case "REJECTED":
    case "EXPIRED":
    case "CANCELED":
      return "rejected";
    default:
      return "open";
  }
}

async function binanceCancel(
  creds: ExchangeCreds,
  symbol: string,
  exchangeOrderId: string,
): Promise<void> {
  await binanceSigned(creds, "DELETE", "/fapi/v1/order", { symbol, orderId: exchangeOrderId });
}

async function binanceFetch(
  creds: ExchangeCreds,
  symbol: string,
  exchangeOrderId: string,
): Promise<PlaceOrderResult> {
  const r = (await binanceSigned(creds, "GET", "/fapi/v1/order", {
    symbol,
    orderId: exchangeOrderId,
  })) as {
    orderId: number;
    status: string;
    avgPrice?: string;
    executedQty?: string;
  };
  return {
    exchangeOrderId: String(r.orderId),
    status: mapBinanceStatus(r.status),
    fillPrice: r.avgPrice ? Number(r.avgPrice) : undefined,
    filledQuantity: r.executedQty ? Number(r.executedQty) : undefined,
    raw: r,
  };
}

async function binanceFetchByClientId(
  creds: ExchangeCreds,
  symbol: string,
  clientOrderId: string,
): Promise<PlaceOrderResult> {
  const r = (await binanceSigned(creds, "GET", "/fapi/v1/order", {
    symbol,
    origClientOrderId: clientOrderIdFor("binance", clientOrderId),
  })) as {
    orderId: number;
    status: string;
    avgPrice?: string;
    executedQty?: string;
  };
  return {
    exchangeOrderId: String(r.orderId),
    status: mapBinanceStatus(r.status),
    fillPrice: r.avgPrice ? Number(r.avgPrice) : undefined,
    filledQuantity: r.executedQty ? Number(r.executedQty) : undefined,
    raw: r,
  };
}

// ---- Bybit v5 Linear Perp -------------------------------------------------
const BYBIT = "https://api.bybit.com";

async function bybitSigned(
  creds: ExchangeCreds,
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown>,
  allowRetry = true,
): Promise<unknown> {
  const ts = Date.now().toString();
  const recv = "10000";
  const body =
    method === "GET" ? qs(params as Record<string, string | number>) : JSON.stringify(params);
  const preSign = ts + creds.apiKey + recv + body;
  const sig = sign(creds.apiSecret, preSign);
  const url = method === "GET" ? `${BYBIT}${path}?${body}` : `${BYBIT}${path}`;
  const res = await fetchText(
    url,
    {
      method,
      headers: {
        "X-BAPI-API-KEY": creds.apiKey,
        "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-RECV-WINDOW": recv,
        "X-BAPI-SIGN": sig,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? body : undefined,
    },
    allowRetry,
  );
  if (!res.ok) throw new Error(`Bybit ${res.status}: ${res.text}`);
  const json = JSON.parse(res.text) as { retCode: number; retMsg: string; result: unknown };
  if (json.retCode !== 0) throw new Error(`Bybit: ${json.retMsg}`);
  return json.result;
}

async function bybitSpec(symbol: string): Promise<InstrumentSpec | null> {
  const key = `bybit:${symbol}`;
  const hit = instrumentCache.get(key);
  if (hit && Date.now() - hit.at < INSTRUMENT_TTL_MS) return hit.spec;
  try {
    const res = await fetchText(
      `${BYBIT}/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(symbol)}`,
    );
    const j = JSON.parse(res.text) as {
      result?: {
        list?: Array<{
          lotSizeFilter?: { qtyStep?: string; minOrderQty?: string; minNotionalValue?: string };
          priceFilter?: { tickPrice?: string };
        }>;
      };
    };
    const row = j.result?.list?.[0];
    if (!row) return null;
    const spec: InstrumentSpec = {
      qtyStep: Number(row.lotSizeFilter?.qtyStep ?? 0) || 0,
      tickSize: Number(row.priceFilter?.tickPrice ?? 0) || 0,
      minQty: Number(row.lotSizeFilter?.minOrderQty ?? 0) || 0,
      minNotional: Number(row.lotSizeFilter?.minNotionalValue ?? 0) || 0,
      contractSize: 1,
    };
    instrumentCache.set(key, { at: Date.now(), spec });
    return spec;
  } catch {
    return null; // best-effort: trade unrounded rather than not at all
  }
}

async function bybitPlace(creds: ExchangeCreds, o: PlaceOrderInput): Promise<PlaceOrderResult> {
  const warnings: string[] = [];
  const coid = clientOrderIdFor("bybit", o.clientOrderId);

  if (o.leverage && o.leverage > 1) {
    await bybitSigned(creds, "POST", "/v5/position/set-leverage", {
      category: "linear",
      symbol: o.symbol,
      buyLeverage: String(Math.floor(o.leverage)),
      sellLeverage: String(Math.floor(o.leverage)),
    }).catch(() => undefined);
  }

  // Precision + min-size normalisation (same rules as Binance: floor to step,
  // bump up to min qty / min notional so small accounts don't get rejected).
  let qty: number = o.quantity;
  let entry = o.entry;
  let sl = o.stopLoss;
  let tp = o.takeProfit;
  const spec = await bybitSpec(o.symbol);
  if (spec) {
    entry = entry != null ? normalizePrice(entry, spec) : entry;
    sl = sl != null ? normalizePrice(sl, spec) : sl;
    tp = tp != null ? normalizePrice(tp, spec) : tp;
    let refPrice: number | null = entry ?? null;
    if (refPrice == null && spec.minNotional > 0) {
      refPrice = await fetchExchangeTicker("bybit", o.symbol);
    }
    // Rounded-to-zero is never placeable — normalizeOrderSize throws there.
    const sized = normalizeOrderSize(o.quantity, refPrice, spec);
    qty = sized.quantity;
    if (sized.bumped) {
      warnings.push(`qty raised from ${o.quantity} to ${qty} to satisfy min qty/notional for ${o.symbol}`);
    }
  }

  const placed = (await bybitSigned(
    creds,
    "POST",
    "/v5/order/create",
    {
      category: "linear",
      symbol: o.symbol,
      side: o.side === "long" ? "Buy" : "Sell",
      orderType: entry ? "Limit" : "Market",
      qty: String(qty),
      price: entry ? String(entry) : undefined,
      timeInForce: entry ? "GTC" : undefined,
      stopLoss: sl ? String(sl) : undefined,
      takeProfit: tp ? String(tp) : undefined,
      orderLinkId: coid,
    },
    false, // never auto-retry placement — recover via orderLinkId lookup
  )) as { orderId: string; orderLinkId: string };

  return {
    exchangeOrderId: placed.orderId,
    status: "open",
    warnings: warnings.length ? warnings : undefined,
    raw: placed,
  };
}

async function bybitCancel(
  creds: ExchangeCreds,
  symbol: string,
  exchangeOrderId: string,
): Promise<void> {
  await bybitSigned(creds, "POST", "/v5/order/cancel", {
    category: "linear",
    symbol,
    orderId: exchangeOrderId,
  });
}

async function bybitFetch(
  creds: ExchangeCreds,
  symbol: string,
  exchangeOrderId: string,
): Promise<PlaceOrderResult> {
  const r = (await bybitSigned(creds, "GET", "/v5/order/realtime", {
    category: "linear",
    symbol,
    orderId: exchangeOrderId,
  })) as {
    list: { orderId: string; orderStatus: string; avgPrice?: string; cumExecQty?: string }[];
  };
  const row = r.list?.[0];
  if (!row) throw new Error("bybit: order not found");
  return {
    exchangeOrderId: row.orderId,
    status: mapBybitStatus(row.orderStatus),
    fillPrice: row.avgPrice ? Number(row.avgPrice) : undefined,
    filledQuantity: row.cumExecQty ? Number(row.cumExecQty) : undefined,
    raw: row,
  };
}

function mapBybitStatus(s: string): PlaceOrderResult["status"] {
  switch (s) {
    case "Filled":
      return "filled";
    case "PartiallyFilled":
      return "partial";
    case "New":
    case "Created":
    case "Untriggered":
      return "open";
    case "Rejected":
    case "Cancelled":
    case "Deactivated":
      return "rejected";
    default:
      return "open";
  }
}

// ---- OKX v5 ---------------------------------------------------------------
const OKX = "https://www.okx.com";

async function bybitFetchByClientId(
  creds: ExchangeCreds,
  symbol: string,
  clientOrderId: string,
): Promise<PlaceOrderResult> {
  const coid = clientOrderIdFor("bybit", clientOrderId);
  // Realtime covers live + recently filled; history covers the rest.
  for (const path of ["/v5/order/realtime", "/v5/order/history"]) {
    const r = (await bybitSigned(creds, "GET", path, {
      category: "linear",
      symbol,
      orderLinkId: coid,
    })) as {
      list: { orderId: string; orderStatus: string; avgPrice?: string; cumExecQty?: string }[];
    };
    const row = r.list?.[0];
    if (row) {
      return {
        exchangeOrderId: row.orderId,
        status: mapBybitStatus(row.orderStatus),
        fillPrice: row.avgPrice ? Number(row.avgPrice) : undefined,
        filledQuantity: row.cumExecQty ? Number(row.cumExecQty) : undefined,
        raw: row,
      };
    }
  }
  throw new Error("bybit: order not found by orderLinkId");
}

function okxSign(secret: string, ts: string, method: string, path: string, body: string): string {
  const preSign = ts + method + path + body;
  return createHmac("sha256", secret).update(preSign).digest("base64");
}

async function okxRequest(
  creds: ExchangeCreds,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  allowRetry = true,
): Promise<unknown> {
  const ts = new Date().toISOString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const sig = okxSign(creds.apiSecret, ts, method, path, bodyStr);
  const url = `${OKX}${path}`;
  const res = await fetchText(
    url,
    {
      method,
      headers: {
        "OK-ACCESS-KEY": creds.apiKey,
        "OK-ACCESS-SIGN": sig,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": creds.passphrase ?? "",
        "Content-Type": "application/json",
      },
      body: bodyStr || undefined,
    },
    allowRetry,
  );
  if (!res.ok) throw new Error(`OKX ${res.status}: ${res.text.slice(0, 200)}`);
  const json = JSON.parse(res.text) as { code: string; msg: string; data: unknown };
  if (json.code !== "0") throw new Error(`OKX: ${json.msg}`);
  return json.data;
}

// OKX SWAP sizes are in CONTRACTS, not base units: sz = baseQty / ctVal,
// rounded to lotSz, minimum minSz. Prices round to tickSz.
async function okxSpec(instId: string): Promise<InstrumentSpec | null> {
  const key = `okx:${instId}`;
  const hit = instrumentCache.get(key);
  if (hit && Date.now() - hit.at < INSTRUMENT_TTL_MS) return hit.spec;
  try {
    const res = await fetchText(
      `${OKX}/api/v5/public/instruments?instType=SWAP&instId=${encodeURIComponent(instId)}`,
    );
    const j = JSON.parse(res.text) as {
      data?: Array<{ lotSz?: string; tickSz?: string; minSz?: string; ctVal?: string }>;
    };
    const row = j.data?.[0];
    if (!row) return null;
    const spec: InstrumentSpec = {
      qtyStep: Number(row.lotSz ?? 0) || 0,
      tickSize: Number(row.tickSz ?? 0) || 0,
      minQty: Number(row.minSz ?? 0) || 0,
      minNotional: 0,
      contractSize: Number(row.ctVal ?? 1) || 1,
    };
    instrumentCache.set(key, { at: Date.now(), spec });
    return spec;
  } catch {
    return null;
  }
}

async function okxPlace(creds: ExchangeCreds, o: PlaceOrderInput): Promise<PlaceOrderResult> {
  const instId = toExchangeSymbol("okx", o.symbol);
  const coid = clientOrderIdFor("okx", o.clientOrderId);
  const warnings: string[] = [];

  let sz: number = o.quantity;
  let px: number | null = o.entry ?? null;
  const spec = await okxSpec(instId);
  if (spec) {
    px = px != null ? normalizePrice(px, spec) : px;
    const sized = normalizeOrderSize(o.quantity, px, spec);
    sz = sized.quantity;
    if (sized.bumped) {
      warnings.push(`qty raised from ${o.quantity} to ${sz * spec.contractSize} (${sz} contracts) to satisfy min size for ${instId}`);
    }
  } else {
    warnings.push(`instrument spec unavailable for ${instId} — sent unrounded size`);
  }

  const body: Record<string, unknown> = {
    instId,
    tdMode: "cross",
    side: o.side === "long" ? "buy" : "sell",
    posSide: o.side === "long" ? "long" : "short",
    ordType: o.entry ? "limit" : "market",
    sz: String(sz),
    clOrdId: coid,
  };
  if (px) body.px = String(px);
  if (o.leverage && o.leverage > 1) {
    await okxRequest(creds, "POST", "/api/v5/account/set-leverage", {
      instId,
      lever: String(Math.floor(o.leverage)),
      mgnMode: "cross",
    }).catch(() => undefined);
  }
  const data = (await okxRequest(creds, "POST", "/api/v5/trade/order", body, false)) as Array<{
    ordId: string;
    sCode: string;
    sMsg: string;
  }>;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || row.sCode !== "0") throw new Error(`OKX order failed: ${row?.sMsg}`);
  return {
    exchangeOrderId: row.ordId,
    status: "open",
    warnings: warnings.length ? warnings : undefined,
    raw: row,
  };
}

async function okxFetchByClientId(
  creds: ExchangeCreds,
  symbol: string,
  clientOrderId: string,
): Promise<PlaceOrderResult> {
  const instId = toExchangeSymbol("okx", symbol);
  const data = (await okxRequest(
    creds,
    "GET",
    `/api/v5/trade/order?instId=${encodeURIComponent(instId)}&clOrdId=${encodeURIComponent(clientOrderIdFor("okx", clientOrderId))}`,
  )) as Array<{ ordId: string; state: string; avgPx?: string; accFillSz?: string }>;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error("OKX: order not found by clOrdId");
  const stMap: Record<string, PlaceOrderResult["status"]> = {
    filled: "filled",
    partially_filled: "partial",
    live: "open",
    canceled: "rejected",
    mmp_canceled: "rejected",
  };
  return {
    exchangeOrderId: row.ordId,
    status: stMap[row.state] ?? "open",
    fillPrice: row.avgPx ? Number(row.avgPx) : undefined,
    filledQuantity: row.accFillSz ? Number(row.accFillSz) : undefined,
    raw: row,
  };
}

async function okxCancel(creds: ExchangeCreds, symbol: string, id: string): Promise<void> {
  await okxRequest(creds, "POST", "/api/v5/trade/cancel-order", {
    instId: toExchangeSymbol("okx", symbol),
    ordId: id,
  });
}

async function okxFetch(
  creds: ExchangeCreds,
  symbol: string,
  id: string,
): Promise<PlaceOrderResult> {
  const instId = toExchangeSymbol("okx", symbol);
  const data = (await okxRequest(
    creds,
    "GET",
    `/api/v5/trade/order?instId=${encodeURIComponent(instId)}&ordId=${encodeURIComponent(id)}`,
  )) as Array<{ ordId: string; state: string; avgPx?: string; accFillSz?: string }>;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new Error("OKX: order not found");
  const stMap: Record<string, PlaceOrderResult["status"]> = {
    filled: "filled",
    partially_filled: "partial",
    live: "open",
    canceled: "rejected",
    mmp_canceled: "rejected",
  };
  return {
    exchangeOrderId: row.ordId,
    status: stMap[row.state] ?? "open",
    fillPrice: row.avgPx ? Number(row.avgPx) : undefined,
    filledQuantity: row.accFillSz ? Number(row.accFillSz) : undefined,
    raw: row,
  };
}

async function okxValidate(creds: ExchangeCreds): Promise<ValidationResult> {
  try {
    await okxRequest(creds, "GET", "/api/v5/account/balance");
    return { ok: true, canTrade: true, permissions: ["trade", "read"] };
  } catch (e) {
    return {
      ok: false,
      canTrade: false,
      permissions: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---- KuCoin Futures v1 ---------------------------------------------------
const KUCOIN_FUTURES = "https://api-futures.kucoin.com";

function kcSign(secret: string, ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", secret)
    .update(ts + method + path + body)
    .digest("base64");
}

async function kcRequest(
  creds: ExchangeCreds,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  allowRetry = true,
): Promise<unknown> {
  const ts = Date.now().toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const sig = kcSign(creds.apiSecret, ts, method, path, bodyStr);
  const passphraseSig = createHmac("sha256", creds.apiSecret)
    .update(creds.passphrase ?? "")
    .digest("base64");
  const url = `${KUCOIN_FUTURES}${path}`;
  const res = await fetchText(
    url,
    {
      method,
      headers: {
        "KC-API-KEY": creds.apiKey,
        "KC-API-SIGN": sig,
        "KC-API-TIMESTAMP": ts,
        "KC-API-PASSPHRASE": passphraseSig,
        "KC-API-KEY-VERSION": "3",
        "Content-Type": "application/json",
      },
      body: bodyStr || undefined,
    },
    allowRetry,
  );
  if (!res.ok) throw new Error(`KuCoin ${res.status}: ${res.text.slice(0, 200)}`);
  const json = JSON.parse(res.text) as { code: string; msg: string; data: unknown };
  if (json.code !== "200000") throw new Error(`KuCoin: ${json.msg}`);
  return json.data;
}

// KuCoin futures sizes are in LOTS: size = baseQty / multiplier, integer
// steps of lotSize. Prices round to tickSize.
async function kcSpec(symbol: string): Promise<InstrumentSpec | null> {
  const key = `kucoin:${symbol}`;
  const hit = instrumentCache.get(key);
  if (hit && Date.now() - hit.at < INSTRUMENT_TTL_MS) return hit.spec;
  try {
    const res = await fetchText(
      `${KUCOIN_FUTURES}/api/v1/contracts/${encodeURIComponent(symbol)}`,
    );
    const j = JSON.parse(res.text) as {
      data?: { tickSize?: number; multiplier?: number; lotSize?: number };
    };
    if (!j.data) return null;
    const lotSize = Number(j.data.lotSize ?? 1) || 1;
    const spec: InstrumentSpec = {
      qtyStep: lotSize,
      tickSize: Number(j.data.tickSize ?? 0) || 0,
      minQty: lotSize,
      minNotional: 0,
      contractSize: Number(j.data.multiplier ?? 1) || 1,
    };
    instrumentCache.set(key, { at: Date.now(), spec });
    return spec;
  } catch {
    return null;
  }
}

async function kcPlace(creds: ExchangeCreds, o: PlaceOrderInput): Promise<PlaceOrderResult> {
  const symbol = toExchangeSymbol("kucoin", o.symbol);
  const coid = clientOrderIdFor("kucoin", o.clientOrderId);
  const warnings: string[] = [];

  let size: number = o.quantity;
  let px: number | null = o.entry ?? null;
  const spec = await kcSpec(symbol);
  if (spec) {
    px = px != null ? normalizePrice(px, spec) : px;
    const sized = normalizeOrderSize(o.quantity, px, spec);
    size = Math.round(sized.quantity); // KuCoin lot counts are integers
    if (size < 1) size = 1;
    if (sized.bumped) {
      warnings.push(`qty raised from ${o.quantity} to ${size * spec.contractSize} (${size} lots) to satisfy min size for ${symbol}`);
    }
  } else {
    size = Math.max(1, Math.round(o.quantity));
    warnings.push(`instrument spec unavailable for ${symbol} — size guessed in lots`);
  }

  const body: Record<string, unknown> = {
    clientOid: coid,
    side: o.side === "long" ? "buy" : "sell",
    symbol,
    type: o.entry ? "limit" : "market",
    size,
    leverage: o.leverage ? String(Math.floor(o.leverage)) : "1",
  };
  if (px) body.price = String(px);
  if (o.stopLoss) body.stopPrice = String(o.stopLoss);
  const data = (await kcRequest(creds, "POST", "/api/v1/orders", body, false)) as {
    orderId: string;
  };
  return {
    exchangeOrderId: data.orderId,
    status: "open",
    warnings: warnings.length ? warnings : undefined,
    raw: data,
  };
}

async function kcCancel(creds: ExchangeCreds, _symbol: string, id: string): Promise<void> {
  await kcRequest(creds, "DELETE", `/api/v1/orders/${id}`);
}

async function kcFetch(
  creds: ExchangeCreds,
  _symbol: string,
  id: string,
): Promise<PlaceOrderResult> {
  const data = (await kcRequest(creds, "GET", `/api/v1/orders/${id}`)) as {
    id: string;
    status: string;
    dealValue?: string;
    dealSize?: string;
  };
  const stMap: Record<string, PlaceOrderResult["status"]> = {
    done: "filled",
    open: "open",
    active: "open",
    cancelled: "rejected",
  };
  return {
    exchangeOrderId: data.id,
    status: stMap[data.status] ?? "open",
    filledQuantity: data.dealSize ? Number(data.dealSize) : undefined,
    raw: data,
  };
}

async function kcValidate(creds: ExchangeCreds): Promise<ValidationResult> {
  try {
    await kcRequest(creds, "GET", "/api/v1/account-overview?currency=USDT");
    return { ok: true, canTrade: true, permissions: ["trade", "read"] };
  } catch (e) {
    return {
      ok: false,
      canTrade: false,
      permissions: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---- MEXC Futures v1 ----------------------------------------------------
const MEXC_FUTURES = "https://futures.mexc.com";

function mexcSign(secret: string, ts: string, body: string): string {
  return createHmac("sha256", secret)
    .update(body + ts)
    .digest("hex");
}

async function mexcRequest(
  creds: ExchangeCreds,
  method: "GET" | "POST",
  path: string,
  params?: Record<string, unknown>,
  allowRetry = true,
): Promise<unknown> {
  const ts = Date.now().toString();
  const bodyStr = params ? JSON.stringify(params) : "";
  const sig = mexcSign(creds.apiSecret, ts, bodyStr);
  const url =
    method === "GET" && params
      ? `${MEXC_FUTURES}${path}?${Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join("&")}`
      : `${MEXC_FUTURES}${path}`;
  const res = await fetchText(
    url,
    {
      method,
      headers: {
        ApiKey: creds.apiKey,
        "Request-Time": ts,
        Signature: sig,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? bodyStr : undefined,
    },
    allowRetry,
  );
  if (!res.ok) throw new Error(`MEXC ${res.status}: ${res.text.slice(0, 200)}`);
  const json = JSON.parse(res.text) as {
    success: boolean;
    code: number;
    message?: string;
    data: unknown;
  };
  if (!json.success) throw new Error(`MEXC: ${json.message ?? json.code}`);
  return json.data;
}

// MEXC futures sizes are integer CONTRACTS (vol); contractSize converts
// contracts <-> base units. Prices round to priceUnit.
async function mexcSpec(symbol: string): Promise<InstrumentSpec | null> {
  const key = `mexc:${symbol}`;
  const hit = instrumentCache.get(key);
  if (hit && Date.now() - hit.at < INSTRUMENT_TTL_MS) return hit.spec;
  try {
    const data = (await mexcPublicDetail(symbol)) as {
      priceUnit?: number;
      minVol?: number;
      contractSize?: number;
    } | null;
    if (!data) return null;
    const spec: InstrumentSpec = {
      qtyStep: 1, // vol is an integer contract count
      tickSize: Number(data.priceUnit ?? 0) || 0,
      minQty: Number(data.minVol ?? 1) || 1,
      minNotional: 0,
      contractSize: Number(data.contractSize ?? 1) || 1,
    };
    instrumentCache.set(key, { at: Date.now(), spec });
    return spec;
  } catch {
    return null;
  }
}

async function mexcPublicDetail(symbol: string): Promise<unknown> {
  const res = await fetchText(
    `${MEXC_FUTURES}/api/v1/contract/detail?symbol=${encodeURIComponent(symbol)}`,
  );
  const j = JSON.parse(res.text) as { success?: boolean; data?: unknown };
  return j.success ? (j.data ?? null) : null;
}

async function mexcPlace(creds: ExchangeCreds, o: PlaceOrderInput): Promise<PlaceOrderResult> {
  const symbol = toExchangeSymbol("mexc", o.symbol);
  const coid = clientOrderIdFor("mexc", o.clientOrderId);
  const warnings: string[] = [];
  // MEXC side: 1=open_long, 2=close_short, 3=open_short, 4=close_long
  const side = o.side === "long" ? 1 : 3;

  let vol: number = o.quantity;
  let px: number | null = o.entry ?? null;
  const spec = await mexcSpec(symbol);
  if (spec) {
    px = px != null ? normalizePrice(px, spec) : px;
    const sized = normalizeOrderSize(o.quantity, px, spec);
    vol = Math.round(sized.quantity);
    if (sized.bumped) {
      warnings.push(`qty raised from ${o.quantity} to ${vol * spec.contractSize} (${vol} contracts) to satisfy min size for ${symbol}`);
    }
  } else {
    vol = Math.max(1, Math.round(o.quantity));
    warnings.push(`instrument spec unavailable for ${symbol} — size guessed in contracts`);
  }

  const body: Record<string, unknown> = {
    symbol,
    externalOid: coid,
    side,
    orderType: o.entry ? 1 : 5, // 1=limit, 5=market
    vol,
    leverage: o.leverage ? Math.floor(o.leverage) : 1,
    openType: 2, // cross
  };
  if (px) body.price = px;
  if (o.stopLoss) body.stopLossPrice = o.stopLoss;
  if (o.takeProfit) body.takeProfitPrice = o.takeProfit;
  const data = (await mexcRequest(creds, "POST", "/api/v1/private/order/submit", body, false)) as {
    orderId: string;
  };
  return {
    exchangeOrderId: data.orderId,
    status: "open",
    warnings: warnings.length ? warnings : undefined,
    raw: data,
  };
}

async function mexcCancel(creds: ExchangeCreds, symbol: string, id: string): Promise<void> {
  await mexcRequest(creds, "POST", "/api/v1/private/order/cancel", {
    orderId: id,
    symbol: toExchangeSymbol("mexc", symbol),
  });
}

async function mexcFetch(
  creds: ExchangeCreds,
  _symbol: string,
  id: string,
): Promise<PlaceOrderResult> {
  const data = (await mexcRequest(creds, "GET", `/api/v1/private/order/get/${id}`)) as {
    orderId: string;
    state: number;
    avgPrice?: number;
    filledVolume?: number;
  };
  const stMap: Record<number, PlaceOrderResult["status"]> = {
    2: "filled",
    4: "partial",
    1: "open",
    3: "rejected",
    5: "rejected",
  };
  return {
    exchangeOrderId: data.orderId,
    status: stMap[data.state] ?? "open",
    fillPrice: data.avgPrice ?? undefined,
    filledQuantity: data.filledVolume ?? undefined,
    raw: data,
  };
}

async function mexcValidate(creds: ExchangeCreds): Promise<ValidationResult> {
  try {
    await mexcRequest(creds, "GET", "/api/v1/private/account/assets");
    return { ok: true, canTrade: true, permissions: ["trade", "read"] };
  } catch (e) {
    return {
      ok: false,
      canTrade: false,
      permissions: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---- Validation (signed read to confirm key + trade permission) ----------
export type ValidationResult = {
  ok: boolean;
  canTrade: boolean;
  permissions: string[];
  error?: string;
};

async function binanceValidate(creds: ExchangeCreds): Promise<ValidationResult> {
  try {
    const r = (await binanceSigned(creds, "GET", "/fapi/v2/account", {})) as {
      canTrade: boolean;
      canDeposit: boolean;
      canWithdraw: boolean;
    };
    const perms: string[] = [];
    if (r.canTrade) perms.push("trade");
    if (r.canDeposit) perms.push("deposit");
    if (r.canWithdraw) perms.push("withdraw");
    return { ok: true, canTrade: !!r.canTrade, permissions: perms };
  } catch (e) {
    return { ok: false, canTrade: false, permissions: [], error: friendlyError(e, "binance") };
  }
}

async function bybitValidate(creds: ExchangeCreds): Promise<ValidationResult> {
  try {
    const r = (await bybitSigned(creds, "GET", "/v5/user/query-api", {})) as {
      permissions?: Record<string, string[]>;
      readOnly?: number;
    };
    const flat = Object.values(r.permissions ?? {}).flat();
    const canTrade =
      !r.readOnly &&
      (flat.includes("Order") ||
        flat.includes("ContractTrade") ||
        flat.includes("DerivativesTrade"));
    return { ok: true, canTrade, permissions: flat };
  } catch (e) {
    return { ok: false, canTrade: false, permissions: [], error: friendlyError(e, "bybit") };
  }
}

function friendlyError(e: unknown, prefix: string): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/-2014|API-key format invalid|Invalid API-key/i.test(raw)) return "API key is malformed.";
  if (/-2015|Invalid API-key, IP, or permissions/i.test(raw))
    return "Invalid key, IP not whitelisted, or missing futures permission.";
  if (/-2008|signature/i.test(raw)) return "API secret is incorrect (bad signature).";
  if (/10003|10004|10005|invalid api key/i.test(raw)) return "Bybit rejected the API key.";
  if (/timestamp|recvWindow/i.test(raw)) return "Clock drift — please retry.";
  return `${prefix}: ${raw.slice(0, 200)}`;
}

// ---- Generic Bridge (MT5 / DEX self-hosted) -------------------------------
// Customer runs a small HTTP bridge against their MT5 terminal or DEX wallet.
// Credentials: apiKey = bridge base URL, apiSecret = bearer token.
// Bridge must implement: POST /place, POST /cancel, GET /order, GET /position,
// GET /ticker, GET /balance, GET /health (all JSON).
async function bridgeReq<T>(
  creds: ExchangeCreds,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = creds.apiKey.replace(/\/+$/, "") + path;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.apiSecret}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bridge ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function bridgePlace(c: ExchangeCreds, o: PlaceOrderInput): Promise<PlaceOrderResult> {
  const r = await bridgeReq<{
    orderId: string;
    status: string;
    fillPrice?: number;
    filledQuantity?: number;
    raw?: unknown;
  }>(c, "POST", "/place", o);
  const s = r.status?.toLowerCase();
  const status: PlaceOrderResult["status"] =
    s === "filled"
      ? "filled"
      : s === "partial"
        ? "partial"
        : s === "rejected"
          ? "rejected"
          : "open";
  return {
    exchangeOrderId: r.orderId,
    status,
    fillPrice: r.fillPrice,
    filledQuantity: r.filledQuantity,
    raw: r.raw ?? r,
  };
}
async function bridgeCancel(c: ExchangeCreds, symbol: string, id: string): Promise<void> {
  await bridgeReq(c, "POST", "/cancel", { symbol, orderId: id });
}
async function bridgeFetch(
  c: ExchangeCreds,
  symbol: string,
  id: string,
): Promise<PlaceOrderResult> {
  const r = await bridgeReq<{
    orderId: string;
    status: string;
    fillPrice?: number;
    filledQuantity?: number;
    raw?: unknown;
  }>(c, "GET", `/order?symbol=${encodeURIComponent(symbol)}&orderId=${encodeURIComponent(id)}`);
  const s = r.status?.toLowerCase();
  const status: PlaceOrderResult["status"] =
    s === "filled"
      ? "filled"
      : s === "partial"
        ? "partial"
        : s === "rejected"
          ? "rejected"
          : "open";
  return {
    exchangeOrderId: r.orderId,
    status,
    fillPrice: r.fillPrice,
    filledQuantity: r.filledQuantity,
    raw: r.raw ?? r,
  };
}
async function bridgeValidate(c: ExchangeCreds): Promise<ValidationResult> {
  if (!/^https?:\/\//i.test(c.apiKey)) {
    return {
      ok: false,
      canTrade: false,
      permissions: [],
      error: "Bridge URL must start with http(s)://",
    };
  }
  try {
    const r = await bridgeReq<{
      ok?: boolean;
      canTrade?: boolean;
      permissions?: string[];
      venue?: string;
    }>(c, "GET", "/health");
    return {
      ok: r.ok !== false,
      canTrade: r.canTrade !== false,
      permissions: r.permissions ?? ["spot", "futures"],
    };
  } catch (e) {
    return {
      ok: false,
      canTrade: false,
      permissions: [],
      error: e instanceof Error ? e.message : "Bridge unreachable",
    };
  }
}

// ---- Dispatcher -----------------------------------------------------------
type Adapter = {
  place: (c: ExchangeCreds, o: PlaceOrderInput) => Promise<PlaceOrderResult>;
  cancel: (c: ExchangeCreds, symbol: string, id: string) => Promise<void>;
  fetch: (c: ExchangeCreds, symbol: string, id: string) => Promise<PlaceOrderResult>;
  validate: (c: ExchangeCreds) => Promise<ValidationResult>;
};
const ADAPTERS: Record<string, Adapter> = {
  binance: {
    place: binancePlace,
    cancel: binanceCancel,
    fetch: binanceFetch,
    validate: binanceValidate,
  },
  bybit: { place: bybitPlace, cancel: bybitCancel, fetch: bybitFetch, validate: bybitValidate },
  okx: { place: okxPlace, cancel: okxCancel, fetch: okxFetch, validate: okxValidate },
  kucoin: { place: kcPlace, cancel: kcCancel, fetch: kcFetch, validate: kcValidate },
  mexc: { place: mexcPlace, cancel: mexcCancel, fetch: mexcFetch, validate: mexcValidate },
  mt5_bridge: {
    place: bridgePlace,
    cancel: bridgeCancel,
    fetch: bridgeFetch,
    validate: bridgeValidate,
  },
  dex_bridge: {
    place: bridgePlace,
    cancel: bridgeCancel,
    fetch: bridgeFetch,
    validate: bridgeValidate,
  },
  paper: {
    place: (_c, o) => paperPlace(o),
    cancel: (_c, s, id) => paperCancel(s, id),
    fetch: (_c, s, id) => paperFetch(s, id),
    validate: () => paperValidate(),
  },
};

export function isBridgeExchange(code: string): boolean {
  return code === "mt5_bridge" || code === "dex_bridge";
}

export async function validateExchangeCreds(
  exchangeCode: string,
  creds: ExchangeCreds,
): Promise<ValidationResult> {
  const a = ADAPTERS[exchangeCode];
  if (!a)
    return {
      ok: false,
      canTrade: false,
      permissions: [],
      error: `Exchange ${exchangeCode} not yet supported`,
    };
  return a.validate(creds);
}

export async function placeExchangeOrder(
  exchangeCode: string,
  creds: ExchangeCreds,
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  const a = ADAPTERS[exchangeCode];
  if (!a) throw new Error(`Execution not yet supported for ${exchangeCode}`);
  return a.place(creds, input);
}

export async function cancelExchangeOrder(
  exchangeCode: string,
  creds: ExchangeCreds,
  symbol: string,
  exchangeOrderId: string,
): Promise<void> {
  const a = ADAPTERS[exchangeCode];
  if (!a) throw new Error(`Execution not yet supported for ${exchangeCode}`);
  return a.cancel(creds, symbol, exchangeOrderId);
}

export async function fetchExchangeOrderStatus(
  exchangeCode: string,
  creds: ExchangeCreds,
  symbol: string,
  exchangeOrderId: string,
): Promise<PlaceOrderResult> {
  const a = ADAPTERS[exchangeCode];
  if (!a) throw new Error(`Execution not yet supported for ${exchangeCode}`);
  return a.fetch(creds, symbol, exchangeOrderId);
}

/**
 * Recovery lookup by OUR client order id. Used after a place call fails with
 * a network/timeout error — the exchange may have accepted the order anyway,
 * and re-placing would double the position. Returns null when the venue does
 * not support client-id lookup (paper/bridge) or the order truly isn't there.
 */
export async function fetchExchangeOrderByClientId(
  exchangeCode: string,
  creds: ExchangeCreds,
  symbol: string,
  clientOrderId: string,
): Promise<PlaceOrderResult | null> {
  try {
    if (exchangeCode === "binance") return await binanceFetchByClientId(creds, symbol, clientOrderId);
    if (exchangeCode === "bybit") return await bybitFetchByClientId(creds, symbol, clientOrderId);
    if (exchangeCode === "okx") return await okxFetchByClientId(creds, symbol, clientOrderId);
    return null; // kucoin/mexc/paper/bridge: no safe client-id lookup
  } catch {
    return null; // "not found" and lookup errors both mean: not recoverable
  }
}

export function isExchangeExecutable(code: string): boolean {
  return code in ADAPTERS;
}

// ---- Public ticker (no auth) ---------------------------------------------
// Returns last price for a USD-M perp pair. Used by position monitor.
// Binance + Bybit direct; any other exchange falls back to CoinGecko's
// simple/price endpoint (free, no key) so monitor hooks still get a price.

const COINGECKO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  LTC: "litecoin",
  TRX: "tron",
  MATIC: "matic-network",
  POL: "matic-network",
  TON: "the-open-network",
  SHIB: "shiba-inu",
  UNI: "uniswap",
  ATOM: "cosmos",
  XLM: "stellar",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  SUI: "sui",
  INJ: "injective-protocol",
  FET: "fetch-ai",
  FIL: "filecoin",
  AAVE: "aave",
  MKR: "maker",
  PEPE: "pepe",
  WIF: "dogwifcoin",
  BONK: "bonk",
  SEI: "sei-network",
  TIA: "celestia",
  JUP: "jupiter-exchange-solana",
  PYTH: "pyth-network",
  ENA: "ethena",
  ONDO: "ondo-finance",
  WLD: "worldcoin-wld",
};

function baseAssetOf(symbol: string): string {
  const s = symbol.toUpperCase();
  const m = /^([A-Z0-9]+)(USDT|USDC|BUSD|FDUSD|TUSD|USD|BTC|ETH|EUR|JPY)$/.exec(s);
  return m ? m[1] : s;
}

export async function fetchExchangeTicker(
  exchangeCode: string,
  symbol: string,
): Promise<number | null> {
  try {
    if (exchangeCode === "binance") {
      const res = await fetchText(
        `${BINANCE_FAPI}/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`,
      );
      if (!res.ok) return null;
      const j = JSON.parse(res.text) as { price?: string };
      const n = j.price ? Number(j.price) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    if (exchangeCode === "bybit") {
      const res = await fetchText(
        `${BYBIT}/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`,
      );
      if (!res.ok) return null;
      const j = JSON.parse(res.text) as { result?: { list?: Array<{ lastPrice?: string }> } };
      const p = j.result?.list?.[0]?.lastPrice;
      const n = p ? Number(p) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    // CoinGecko fallback for every other exchange (okx/kucoin/mexc/bridge…)
    const base = baseAssetOf(symbol);
    const id = COINGECKO_ID[base] ?? base.toLowerCase();
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, { usd?: number }>;
    const n = j[id]?.usd;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// ---- Live position fetch (signed) ----------------------------------------
// Returns the open position for `symbol`, or null when flat.
// Used by the position-sync worker to reconcile DB rows with exchange truth
// (e.g. detect exchange-side SL/TP execution).
export type PositionSnapshot = {
  positionAmt: number; // signed: + long, - short, 0 = flat
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
  raw: unknown;
};

export async function fetchExchangePosition(
  exchangeCode: string,
  creds: ExchangeCreds,
  symbol: string,
): Promise<PositionSnapshot | null> {
  if (exchangeCode === "binance") {
    const r = (await binanceSigned(creds, "GET", "/fapi/v2/positionRisk", { symbol })) as Array<{
      positionAmt: string;
      entryPrice: string;
      markPrice: string;
      unRealizedProfit: string;
    }>;
    const row = Array.isArray(r) ? r[0] : null;
    if (!row) return null;
    const amt = Number(row.positionAmt);
    return {
      positionAmt: Number.isFinite(amt) ? amt : 0,
      entryPrice: row.entryPrice ? Number(row.entryPrice) : null,
      markPrice: row.markPrice ? Number(row.markPrice) : null,
      unrealizedPnl: row.unRealizedProfit ? Number(row.unRealizedProfit) : null,
      raw: row,
    };
  }
  if (exchangeCode === "bybit") {
    const r = (await bybitSigned(creds, "GET", "/v5/position/list", {
      category: "linear",
      symbol,
    })) as {
      list?: Array<{
        size: string;
        side: string;
        avgPrice: string;
        markPrice: string;
        unrealisedPnl: string;
      }>;
    };
    const row = r.list?.[0];
    if (!row) return null;
    const size = Number(row.size);
    const signed = row.side === "Sell" ? -size : size;
    return {
      positionAmt: Number.isFinite(signed) ? signed : 0,
      entryPrice: row.avgPrice ? Number(row.avgPrice) : null,
      markPrice: row.markPrice ? Number(row.markPrice) : null,
      unrealizedPnl: row.unrealisedPnl ? Number(row.unrealisedPnl) : null,
      raw: row,
    };
  }
  if (isBridgeExchange(exchangeCode)) {
    try {
      const r = await bridgeReq<{
        positionAmt?: number;
        entryPrice?: number;
        markPrice?: number;
        unrealizedPnl?: number;
        raw?: unknown;
      }>(creds, "GET", `/position?symbol=${encodeURIComponent(symbol)}`);
      return {
        positionAmt: Number(r.positionAmt ?? 0),
        entryPrice: r.entryPrice ?? null,
        markPrice: r.markPrice ?? null,
        unrealizedPnl: r.unrealizedPnl ?? null,
        raw: r.raw ?? r,
      };
    } catch {
      return null;
    }
  }
  return null;
}
