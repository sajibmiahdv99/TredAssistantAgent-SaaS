// Server-only: fetch wallet balances from exchange REST APIs.
// No CCXT — those packages have Node/native deps incompatible with Workers.
// Each adapter returns a normalized list of { asset, free, used, total }.

import { createHmac } from "crypto";

export type BalanceRow = {
  asset: string;
  free: number;
  used: number;
  total: number;
};

export type FetchInput = {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
};

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// ---- Binance (spot + USD-M futures) ----------------------------------------
async function fetchBinance({ apiKey, apiSecret }: FetchInput): Promise<BalanceRow[]> {
  const ts = Date.now();
  const qs = `timestamp=${ts}&recvWindow=10000`;
  const sig = sign(apiSecret, qs);

  // Spot wallet (api.binance.com)
  const spotRes = await fetch(`https://api.binance.com/api/v3/account?${qs}&signature=${sig}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (!spotRes.ok) throw new Error(`Binance spot ${spotRes.status}: ${await spotRes.text()}`);
  const spotJson = (await spotRes.json()) as {
    balances: { asset: string; free: string; locked: string }[];
  };
  const spotRows: BalanceRow[] = spotJson.balances
    .map((b) => {
      const free = Number(b.free);
      const used = Number(b.locked);
      return { asset: b.asset, free, used, total: free + used };
    })
    .filter((b) => b.total > 0);

  // USD-M Futures wallet (fapi.binance.com) — merged with "-FUT" suffix so
  // spot and futures balances of the same coin stay distinct rows on the UI.
  let futRows: BalanceRow[] = [];
  try {
    const futRes = await fetch(`https://fapi.binance.com/fapi/v2/balance?${qs}&signature=${sig}`, {
      headers: { "X-MBX-APIKEY": apiKey },
    });
    if (!futRes.ok) throw new Error(`Binance futures ${futRes.status}: ${await futRes.text()}`);
    const futJson = (await futRes.json()) as { asset: string; balance: string; availableBalance: string }[];
    futRows = futJson
      .map((b) => {
        const total = Number(b.balance);
        const free = Number(b.availableBalance ?? b.balance);
        const used = Math.max(total - free, 0);
        return { asset: `${b.asset}-FUT`, free, used, total };
      })
      .filter((b) => b.total > 0);
  } catch {
    /* futures disabled/unreachable for this key → keep spot only */
  }

  return [...spotRows, ...futRows];
}

// ---- Bybit (unified v5) ---------------------------------------------------
async function fetchBybit({ apiKey, apiSecret }: FetchInput): Promise<BalanceRow[]> {
  const ts = Date.now().toString();
  const recv = "10000";
  const query = "accountType=UNIFIED";
  const preSign = ts + apiKey + recv + query;
  const sig = sign(apiSecret, preSign);
  const res = await fetch(`https://api.bybit.com/v5/account/wallet-balance?${query}`, {
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": recv,
      "X-BAPI-SIGN": sig,
    },
  });
  if (!res.ok) throw new Error(`Bybit ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    retCode: number;
    retMsg: string;
    result: { list: { coin: { coin: string; walletBalance: string; locked: string }[] }[] };
  };
  if (json.retCode !== 0) throw new Error(`Bybit: ${json.retMsg}`);
  const coins = json.result.list[0]?.coin ?? [];
  return coins
    .map((c) => {
      const total = Number(c.walletBalance);
      const used = Number(c.locked || 0);
      return { asset: c.coin, free: Math.max(total - used, 0), used, total };
    })
    .filter((b) => b.total > 0);
}

// ---- OKX v5 ---------------------------------------------------------------
async function fetchOKX({ apiKey, apiSecret, passphrase }: FetchInput): Promise<BalanceRow[]> {
  const ts = new Date().toISOString();
  const path = "/api/v5/asset/balances";
  const preSign = ts + "GET" + path;
  const sig = sign(apiSecret, preSign);
  const res = await fetch(`https://www.okx.com${path}`, {
    headers: {
      "OK-ACCESS-KEY": apiKey,
      "OK-ACCESS-SIGN": Buffer.from(
        createHmac("sha256", apiSecret).update(preSign).digest(),
      ).toString("base64"),
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": passphrase ?? "",
    },
  });
  if (!res.ok) throw new Error(`OKX ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    code: string;
    data: Array<{ ccy: string; availBal: string; frozenBal: string }>;
  };
  if (json.code !== "0") throw new Error(`OKX balance: code ${json.code}`);
  return json.data
    .map((b) => {
      const free = Number(b.availBal);
      const used = Number(b.frozenBal);
      return { asset: b.ccy, free, used, total: free + used };
    })
    .filter((b) => b.total > 0);
  void sig;
}

// ---- MEXC Futures v1 -------------------------------------------------------
async function fetchMEXC({ apiKey, apiSecret }: FetchInput): Promise<BalanceRow[]> {
  const ts = Date.now().toString();
  const bodyStr = "";
  const sig = sign(apiSecret, bodyStr + ts);
  const res = await fetch("https://futures.mexc.com/api/v1/private/account/assets", {
    headers: {
      ApiKey: apiKey,
      "Request-Time": ts,
      Signature: sig,
    },
  });
  if (!res.ok) throw new Error(`MEXC ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    success: boolean;
    data: Array<{ currency: string; availableBalance: number; frozenBalance: number }>;
  };
  if (!json.success) throw new Error("MEXC balance fetch failed");
  return (json.data ?? [])
    .map((b) => {
      const free = Number(b.availableBalance ?? 0);
      const used = Number(b.frozenBalance ?? 0);
      return { asset: b.currency, free, used, total: free + used };
    })
    .filter((b) => b.total > 0);
}

// ---- KuCoin Futures v1 -----------------------------------------------------
const KUCOIN_API = "https://api-futures.kucoin.com";

function kcSign(secret: string, ts: string, method: string, path: string, body: string): string {
  return createHmac("sha256", secret)
    .update(ts + method + path + body)
    .digest("base64");
}

async function fetchKuCoin({ apiKey, apiSecret, passphrase }: FetchInput): Promise<BalanceRow[]> {
  const ts = Date.now().toString();
  const path = "/api/v1/account-overview?currency=USDT";
  const sig = kcSign(apiSecret, ts, "GET", path, "");
  const passphraseSig = createHmac("sha256", apiSecret)
    .update(passphrase ?? "")
    .digest("base64");
  const res = await fetch(`${KUCOIN_API}${path}`, {
    headers: {
      "KC-API-KEY": apiKey,
      "KC-API-SIGN": sig,
      "KC-API-TIMESTAMP": ts,
      "KC-API-PASSPHRASE": passphraseSig,
      "KC-API-KEY-VERSION": "3",
    },
  });
  if (!res.ok) throw new Error(`KuCoin ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    code: string;
    msg: string;
    data: {
      accountEquity: number;
      availableBalance: number;
      orderMargin: number;
      frozenFunds: number;
      currency: string;
    } | null;
  };
  if (json.code !== "200000") throw new Error(`KuCoin: ${json.msg}`);

  // Also try to fetch other common stablecoin balances
  const rows: BalanceRow[] = [];
  const cur = json.data;
  if (cur) {
    const total = Number(cur.accountEquity ?? 0);
    const frozen = Number(cur.frozenFunds ?? 0) + Number(cur.orderMargin ?? 0);
    const free = total - frozen;
    rows.push({ asset: cur.currency, free: Math.max(free, 0), used: frozen, total });
  }

  // Try BTC as well
  try {
    const btcPath = "/api/v1/account-overview?currency=BTC";
    const btcSig = kcSign(apiSecret, ts, "GET", btcPath, "");
    const btcRes = await fetch(`${KUCOIN_API}${btcPath}`, {
      headers: {
        "KC-API-KEY": apiKey,
        "KC-API-SIGN": btcSig,
        "KC-API-TIMESTAMP": ts,
        "KC-API-PASSPHRASE": passphraseSig,
        "KC-API-KEY-VERSION": "3",
      },
    });
    if (btcRes.ok) {
      const btcJson = (await btcRes.json()) as {
        code: string;
        data: {
          accountEquity: number;
          availableBalance: number;
          orderMargin: number;
          frozenFunds: number;
          currency: string;
        } | null;
      };
      if (btcJson.code === "200000" && btcJson.data) {
        const b = btcJson.data;
        const bTotal = Number(b.accountEquity ?? 0);
        if (bTotal > 0.00001) {
          const bFrozen = Number(b.frozenFunds ?? 0) + Number(b.orderMargin ?? 0);
          rows.push({
            asset: b.currency,
            free: Math.max(bTotal - bFrozen, 0),
            used: bFrozen,
            total: bTotal,
          });
        }
      }
    }
  } catch {
    /* non-critical — skip BTC */
  }

  return rows.filter((r) => r.total > 0);
}

// ---- Generic bridge (MT5 / DEX) -------------------------------------------
async function fetchBridge({ apiKey, apiSecret }: FetchInput): Promise<BalanceRow[]> {
  const url = apiKey.replace(/\/+$/, "") + "/balance";
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiSecret}` } });
  if (!res.ok) throw new Error(`Bridge ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    balances?: Array<{ asset: string; free?: number; used?: number; total?: number }>;
  };
  return (json.balances ?? [])
    .map((b) => {
      const free = Number(b.free ?? 0);
      const used = Number(b.used ?? 0);
      const total = Number(b.total ?? free + used);
      return { asset: b.asset, free, used, total };
    })
    .filter((b) => b.total > 0);
}

const ADAPTERS: Record<string, (i: FetchInput) => Promise<BalanceRow[]>> = {
  binance: fetchBinance,
  bybit: fetchBybit,
  okx: fetchOKX,
  kucoin: fetchKuCoin,
  mexc: fetchMEXC,
  mt5_bridge: fetchBridge,
  dex_bridge: fetchBridge,
};

export async function fetchExchangeBalances(
  exchangeCode: string,
  creds: FetchInput,
): Promise<BalanceRow[]> {
  const adapter = ADAPTERS[exchangeCode];
  if (!adapter) throw new Error(`Balance sync not yet supported for ${exchangeCode}`);
  return adapter(creds);
}

// ---- USD valuation via Binance public tickers ----------------------------
let _priceCache: { at: number; map: Record<string, number> } | null = null;

async function loadPrices(): Promise<Record<string, number>> {
  if (_priceCache && Date.now() - _priceCache.at < 60_000) return _priceCache.map;
  const res = await fetch("https://api.binance.com/api/v3/ticker/price");
  if (!res.ok) return _priceCache?.map ?? {};
  const arr = (await res.json()) as { symbol: string; price: string }[];
  const map: Record<string, number> = {};
  for (const t of arr) map[t.symbol] = Number(t.price);
  _priceCache = { at: Date.now(), map };
  return map;
}

export async function valuateUsd(
  rows: BalanceRow[],
): Promise<(BalanceRow & { usd_value: number | null })[]> {
  const prices = await loadPrices();
  return rows.map((r) => {
    // "-FUT" suffix (Binance futures wallet) — value using the base coin.
    const baseAsset = r.asset.endsWith("-FUT") ? r.asset.slice(0, -4) : r.asset;
    const a = baseAsset.toUpperCase();
    let usd: number | null = null;
    if (
      a === "USDT" ||
      a === "USDC" ||
      a === "BUSD" ||
      a === "FDUSD" ||
      a === "DAI" ||
      a === "TUSD"
    )
      usd = r.total;
    else if (prices[`${a}USDT`]) usd = r.total * prices[`${a}USDT`];
    else if (prices[`${a}BUSD`]) usd = r.total * prices[`${a}BUSD`];
    return { ...r, usd_value: usd };
  });
}
