// WebSocket price feed — real-time mark/last prices for the most active
// USD-M perpetual pairs. Uses the exchange's PUBLIC streams (no API key).
//
// - Binance: wss://fstream.binance.com/ws/<symbol>@markPrice
// - Bybit:   wss://stream.bybit.com/v5/public/linear (topic: markPrice.<symbol>)
//
// Node 22 has a native WebSocket global — no dependency required.
// The module keeps an in-memory price map; consumers (paper executor,
// monitor hooks) read it synchronously and fall back to REST on a miss.

export type WsPriceMap = Record<string, number>; // "BTCUSDT" -> price

const DEFAULT_WATCHLIST = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "DOTUSDT",
  "TRXUSDT",
  "MATICUSDT",
  "LTCUSDT",
  "TONUSDT",
  "SHIBUSDT",
  "UNIUSDT",
  "ATOMUSDT",
  "XLMUSDT",
  "NEARUSDT",
  "APTUSDT",
];

const prices: WsPriceMap = {};
const lastUpdate: Record<string, number> = {};
let socket: WebSocket | null = null;
let bybitSocket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let manualClosed = false;

const MAX_RECONNECT_DELAY_MS = 30_000;
const PING_INTERVAL_MS = 20_000;
const STALE_AFTER_MS = 60_000; // a price older than this is treated as stale

// ---- Binance ----------------------------------------------------------------

function connectBinance(): void {
  if (manualClosed) return;
  const symbols = (process.env.WS_WATCHLIST?.split(",") ?? DEFAULT_WATCHLIST)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  try {
    socket = new WebSocket(
      `wss://fstream.binance.com/ws/${symbols
        .map((s) => `${s.toLowerCase()}@markPrice`)
        .join("/")}`,
    );
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectAttempts = 0;
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data)) as {
        s?: string; // symbol
        p?: string; // mark price
      };
      if (data.s && data.p) {
        const sym = data.s.toUpperCase();
        const n = Number(data.p);
        if (Number.isFinite(n) && n > 0) {
          prices[sym] = n;
          lastUpdate[sym] = Date.now();
        }
      }
    } catch {
      // ignore malformed frames (e.g. ping responses)
    }
  };

  socket.onclose = () => {
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    // onclose follows; just ensure we don't double-reconnect
  };
}

// ---- Bybit ------------------------------------------------------------------

function connectBybit(): void {
  if (manualClosed) return;
  try {
    bybitSocket = new WebSocket("wss://stream.bybit.com/v5/public/linear");
  } catch {
    return; // Binance alone is fine
  }

  bybitSocket.onopen = () => {
    const symbols = (process.env.WS_WATCHLIST?.split(",") ?? DEFAULT_WATCHLIST)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    bybitSocket?.send(
      JSON.stringify({
        op: "subscribe",
        args: symbols.map((s) => `markPrice.${s}`),
      }),
    );
  };

  bybitSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data)) as {
        topic?: string;
        data?: Array<{ symbol?: string; markPrice?: string }>;
      };
      if (data.topic?.startsWith("markPrice.") && Array.isArray(data.data)) {
        for (const row of data.data) {
          if (row.symbol) {
            const sym = row.symbol.toUpperCase();
            const n = Number(row.markPrice);
            if (Number.isFinite(n) && n > 0) {
              prices[sym] = n;
              lastUpdate[sym] = Date.now();
            }
          }
        }
      }
    } catch {
      // ignore
    }
  };

  bybitSocket.onclose = () => {
    bybitSocket = null;
    // Bybit is a secondary source; reconnect silently with backoff
    setTimeout(() => connectBybit(), 15_000);
  };

  bybitSocket.onerror = () => {
    // onclose follows
  };
}

// ---- Heartbeat + reconnect ---------------------------------------------------

function scheduleReconnect(): void {
  if (reconnectTimer || manualClosed) return;
  const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * 2 ** reconnectAttempts);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBinance();
  }, delay);
}

function startHeartbeat(): void {
  setInterval(() => {
    // Binance requires a ping frame every 20s or it drops the connection.
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ method: "PING" }));
      } catch {
        // ignore
      }
    }
    // Drop stale prices so consumers fall back to REST when the feed stalls.
    const now = Date.now();
    for (const sym of Object.keys(prices)) {
      if (now - (lastUpdate[sym] ?? 0) > STALE_AFTER_MS) {
        delete prices[sym];
        delete lastUpdate[sym];
      }
    }
  }, PING_INTERVAL_MS);
}

// ---- Public API ---------------------------------------------------------------

/** Read the latest known price (may be stale — caller should treat null as miss). */
export function getWsPrice(symbol: string): number | null {
  const sym = symbol.toUpperCase();
  const n = prices[sym];
  if (n == null) return null;
  const age = Date.now() - (lastUpdate[sym] ?? 0);
  return age > STALE_AFTER_MS ? null : n;
}

/** All prices currently held, oldest-first not guaranteed. */
export function getWsPrices(): WsPriceMap {
  return { ...prices };
}

export function isWsFeedActive(): boolean {
  return (
    (socket?.readyState === WebSocket.OPEN || bybitSocket?.readyState === WebSocket.OPEN) &&
    Object.keys(prices).length > 0
  );
}

/** Subscribe to additional symbols at runtime (e.g. after a signal parse). */
export function subscribeSymbols(symbols: string[]): void {
  const fresh = symbols.map((s) => s.trim().toUpperCase()).filter((s) => s && !(s in prices));
  if (!fresh.length) return;

  // Binance streams can be extended via partial subscribe messages on the
  // combined stream URL — but on a single-symbol URL you must reconnect.
  // Simplest reliable path: merge into the watchlist and reconnect.
  const watchlist = (process.env.WS_WATCHLIST?.split(",") ?? DEFAULT_WATCHLIST)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const merged = Array.from(new Set([...watchlist, ...fresh]));
  process.env.WS_WATCHLIST = merged.join(",");

  // Reconnect both feeds so they pick up the new symbols.
  if (socket) {
    try {
      socket.close();
    } catch {
      // ignore
    }
    socket = null;
  }
  connectBinance();
  if (bybitSocket) {
    try {
      bybitSocket.close();
    } catch {
      // ignore
    }
    bybitSocket = null;
  }
  connectBybit();
}

/** Start the feed (idempotent). Call once at server boot. */
export function startWsPriceFeed(): void {
  if (socket || bybitSocket || manualClosed) return;
  connectBinance();
  connectBybit();
  startHeartbeat();
}

/** Stop the feed (used in tests / shutdown). */
export function stopWsPriceFeed(): void {
  manualClosed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    try {
      socket.close();
    } catch {
      // ignore
    }
    socket = null;
  }
  if (bybitSocket) {
    try {
      bybitSocket.close();
    } catch {
      // ignore
    }
    bybitSocket = null;
  }
}
