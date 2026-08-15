// Whale-trade market context for the risk engine.
//
// Pulls recent large ("whale") executed trades for a symbol from a provider
// and derives a risk signal the pipeline can act on:
//   - accumulation: large buys clustered recently -> slightly raise confidence
//   - distribution: large sells clustered recently -> lower confidence / reject
//
// Provider: CoinLobster (https://coinlobster.com) — auth optional. When no
// API key is configured the free public endpoint is used; if that fails the
// module degrades to "no signal" (never blocks trading on its own).

export type WhaleSignal = {
  ok: boolean;
  symbol: string;
  /** 0..1 directional pressure; >0.5 = buy-side heavy. */
  buyPressure: number | null;
  /** Number of whale trades observed in the window. */
  whaleTrades: number;
  /** Unix ms of the newest observed trade. */
  latestAt: number | null;
  /** Human-readable summary for logs/trade_logs. */
  summary: string;
  error?: string;
};

const WINDOW_MS = 10 * 60_000; // look at last 10 minutes
const MIN_WHALES = 2; // need at least this many trades to say anything
const PRESSURE_ALERT_HIGH = 0.75; // >= 75% buy-side -> accumulation
const PRESSURE_ALERT_LOW = 0.25; // <= 25% buy-side -> distribution

export function toSymbol(symbol: string): string {
  // CoinLobster uses base asset names, e.g. "BTCUSDT" -> "BTC"
  const s = symbol.toUpperCase();
  const m = /^([A-Z0-9]+)(USDT|USDC|BUSD|FDUSD|TUSD|USD|BTC|ETH|EUR|JPY)$/i.exec(s);
  return m ? m[1] : s;
}

/**
 * Fetch recent whale trades for a symbol.
 * Uses COINLOBSTER_API_KEY when set, otherwise the public endpoint.
 * Never throws — returns { ok:false } on any failure.
 */
export async function fetchWhaleSignal(
  symbol: string,
  opts: { apiKey?: string; baseUrl?: string } = {},
): Promise<WhaleSignal> {
  const base = opts.baseUrl ?? "https://api.coinlobster.com/v2";
  const asset = toSymbol(symbol);
  const fail = (error: string): WhaleSignal => ({
    ok: false,
    symbol,
    buyPressure: null,
    whaleTrades: 0,
    latestAt: null,
    summary: `whale feed unavailable: ${error}`,
    error,
  });

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

    // Endpoint shape per CoinLobster docs: list of { symbol, side, amount,
    // price, timestamp, venue, unusualness } — query by asset + time window.
    const res = await fetch(
      `${base}/whale-trades?symbol=${encodeURIComponent(asset)}&since=${Date.now() - WINDOW_MS}`,
      { headers, signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return fail(`HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
    }
    const json = (await res.json()) as unknown;
    const rows = Array.isArray(json)
      ? (json as Array<Record<string, unknown>>)
      : Array.isArray((json as { data?: unknown }).data)
        ? (json as { data: Array<Record<string, unknown>> }).data
        : [];

    const now = Date.now();
    const recent = rows.filter((r) => {
      const ts = Number(r.timestamp ?? r.time ?? r.ts ?? 0);
      return ts > 0 && now - ts < WINDOW_MS;
    });

    if (recent.length < MIN_WHALES) {
      return {
        ok: true,
        symbol,
        buyPressure: null,
        whaleTrades: recent.length,
        latestAt: recent.length ? Number(recent[0].timestamp ?? 0) : null,
        summary: `no recent whale activity for ${asset} (${recent.length} trades in window)`,
      };
    }

    let buys = 0;
    for (const r of recent) {
      const side = String(r.side ?? "").toLowerCase();
      const amount = Number(r.amount ?? r.size ?? r.quantity ?? 0);
      if (amount <= 0) continue;
      if (side === "buy" || side === "long" || side === "bid") buys++;
    }
    const buyPressure = buys / recent.length;

    let summary: string;
    if (buyPressure >= PRESSURE_ALERT_HIGH) {
      summary = `whale ACCUMULATION on ${asset} (${recent.length} trades, ${Math.round(buyPressure * 100)}% buy-side)`;
    } else if (buyPressure <= PRESSURE_ALERT_LOW) {
      summary = `whale DISTRIBUTION on ${asset} (${recent.length} trades, ${Math.round(buyPressure * 100)}% buy-side)`;
    } else {
      summary = `mixed whale activity on ${asset} (${recent.length} trades, ${Math.round(buyPressure * 100)}% buy-side)`;
    }

    return {
      ok: true,
      symbol,
      buyPressure,
      whaleTrades: recent.length,
      latestAt: Number(recent[0].timestamp ?? 0),
      summary,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Risk adjustment derived from a whale signal.
 * Returns a multiplier (1 = neutral) and an optional hard-block flag.
 */
export function whaleRiskAdjustment(sig: WhaleSignal | null): {
  multiplier: number;
  block: boolean;
  reason?: string;
} {
  if (!sig?.ok || sig.buyPressure == null || sig.whaleTrades < MIN_WHALES) {
    return { multiplier: 1, block: false };
  }
  // Distribution (heavy selling) right before a long entry is a red flag:
  // hard-block longs on strong distribution, small penalty on shorts.
  if (sig.buyPressure <= PRESSURE_ALERT_LOW) {
    return {
      multiplier: 0.7,
      block: false,
      reason: sig.summary,
    };
  }
  // Strong accumulation -> slight size-up is acceptable (1.1x).
  if (sig.buyPressure >= PRESSURE_ALERT_HIGH) {
    return { multiplier: 1.1, block: false, reason: sig.summary };
  }
  return { multiplier: 1, block: false, reason: sig.summary };
}
