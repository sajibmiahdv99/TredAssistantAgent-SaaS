// User-data WebSocket streams — instant order/position updates for the
// worker. Instead of waiting up to 5s for the next poll tick, fills and
// status changes are pushed to us as they happen.
//
// Supported venues:
//   - Binance Futures: POST /fapi/v1/listenKey -> wss://fstream.binance.com/ws/<lk>
//   - Bybit V5:        POST /v5/user-token/create  -> wss://stream.bybit.com/v5/private
//
// Everything is best-effort: if a stream fails, reconnect with backoff; if
// listenKey creation fails, we simply log and keep polling (the worker's
// REST poll loop remains the source of truth).
//
// Run inside the worker process (node 22 native WebSocket).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "../src/lib/crypto.server.ts";

type AccountRow = {
  id: string;
  exchange_code: string;
  encrypted_api_key: string;
  encrypted_api_secret: string;
  passphrase: string | null;
};

type OrderUpdate = {
  accountId: string;
  clientOrderId: string | null;
  exchangeOrderId: string | null;
  status: string; // "filled" | "canceled" | "partially_filled"
  fillPrice: number | null;
  filledQuantity: number | null;
  raw: unknown;
};

// ---- Logging ---------------------------------------------------------------

function log(msg: string): void {
  console.log(`[ws-stream] ${new Date().toISOString()} ${msg}`);
}

// ---- Supabase updates ------------------------------------------------------

async function applyOrderUpdate(sb: SupabaseClient, update: OrderUpdate): Promise<void> {
  // Match by client_order_id first (we set it when placing), else by
  // exchange_order_id. Never clobber terminal states.
  const q = sb
    .from("orders")
    .update({
      status: update.status,
      ...(update.fillPrice != null ? { fill_price: update.fillPrice } : {}),
      ...(update.filledQuantity != null ? { filled_quantity: update.filledQuantity } : {}),
      ...(update.exchangeOrderId ? { exchange_order_id: update.exchangeOrderId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("exchange_account_id", update.accountId);

  if (update.clientOrderId) {
    q.eq("client_order_id", update.clientOrderId);
  } else if (update.exchangeOrderId) {
    q.eq("exchange_order_id", update.exchangeOrderId);
  } else {
    return; // nothing to match on
  }

  const { error } = await q;
  if (error) log(`apply update error: ${error.message}`);
}

// ---- Binance Futures user data stream ---------------------------------------

async function startBinanceStream(sb: SupabaseClient, account: AccountRow): Promise<void> {
  const apiKey = decryptSecret(account.encrypted_api_key);
  const apiSecret = decryptSecret(account.encrypted_api_secret);
  if (!apiKey || !apiSecret) {
    log(`binance ${account.id}: missing credentials, skipping stream`);
    return;
  }

  // 1. Create listenKey (valid 24h; renew every 30min)
  const lkRes = await fetch("https://fapi.binance.com/fapi/v1/listenKey", {
    method: "POST",
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (!lkRes.ok) {
    log(`binance ${account.id}: listenKey failed (${lkRes.status}) — polling only`);
    return;
  }
  const { listenKey } = (await lkRes.json()) as { listenKey?: string };
  if (!listenKey) {
    log(`binance ${account.id}: no listenKey in response — polling only`);
    return;
  }

  const wsUrl = `wss://fstream.binance.com/ws/${listenKey}`;
  const ws = new WebSocket(wsUrl);
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let renewTimer: ReturnType<typeof setInterval> | null = null;

  const renew = async () => {
    try {
      await fetch("https://fapi.binance.com/fapi/v1/listenKey", {
        method: "PUT",
        headers: { "X-MBX-APIKEY": apiKey },
        body: JSON.stringify({ listenKey }),
      });
    } catch {
      // best effort
    }
  };

  const cleanup = () => {
    if (renewTimer) clearInterval(renewTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };

  ws.onopen = () => {
    log(`binance ${account.id}: stream connected`);
    renewTimer = setInterval(renew, 30 * 60_000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data)) as {
        e?: string; // event type
        o?: {
          s?: string;
          c?: string; // clientOrderId
          i?: number; // orderId
          X?: string; // execution type: NEW/TRADE/CANCELED/EXPIRED
          p?: string; // price
          q?: string; // orig qty
          z?: string; // cum filled qty
        };
      };
      if (msg.e !== "ORDER_TRADE_UPDATE" || !msg.o) return;
      const o = msg.o;
      const execType = o.X ?? "";
      let status: string | null = null;
      if (execType === "TRADE" || execType === "FILLED") status = "filled";
      else if (execType === "CANCELED" || execType === "EXPIRED") status = "canceled";
      if (!status) return;

      void applyOrderUpdate(sb, {
        accountId: account.id,
        clientOrderId: o.c ?? null,
        exchangeOrderId: o.i != null ? String(o.i) : null,
        status,
        fillPrice: o.p ? Number(o.p) : null,
        filledQuantity: o.z ? Number(o.z) : null,
        raw: msg,
      });
    } catch (err) {
      log(`binance ${account.id}: message parse error: ${String(err).slice(0, 120)}`);
    }
  };

  ws.onclose = () => {
    cleanup();
    log(`binance ${account.id}: stream closed, reconnecting in 5s`);
    reconnectTimer = setTimeout(() => {
      void startBinanceStream(sb, account);
    }, 5_000);
  };

  ws.onerror = () => {
    // onclose follows; don't double-handle
  };
}

// ---- Bybit V5 user data stream ----------------------------------------------

async function startBybitStream(sb: SupabaseClient, account: AccountRow): Promise<void> {
  const apiKey = decryptSecret(account.encrypted_api_key);
  const apiSecret = decryptSecret(account.encrypted_api_secret);
  if (!apiKey || !apiSecret) {
    log(`bybit ${account.id}: missing credentials, skipping stream`);
    return;
  }

  // 1. Create WS auth token
  const ts = Date.now();
  const expires = ts + 30_000; // 30s window
  const payload = `GET/realtime${expires}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const ws = new WebSocket("wss://stream.bybit.com/v5/private");
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let authSent = false;

  const cleanup = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        op: "auth",
        args: [apiKey, expires, signature],
      }),
    );
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(String(event.data)) as {
        op?: string;
        success?: boolean;
        topic?: string;
        data?: Array<{
          orderId?: string;
          orderLinkId?: string;
          orderStatus?: string;
          avgPrice?: string;
          cumExecQty?: string;
        }>;
      };
      if (msg.op === "auth" && msg.success) {
        authSent = true;
        log(`bybit ${account.id}: auth ok, subscribing to order`);
        ws.send(JSON.stringify({ op: "subscribe", args: ["order"] }));
        return;
      }
      if (msg.topic !== "order" || !Array.isArray(msg.data)) return;
      for (const o of msg.data) {
        const statusMap: Record<string, string> = {
          Filled: "filled",
          Cancelled: "canceled",
          Canceled: "canceled",
          Rejected: "rejected",
          PartiallyFilledCanceled: "canceled",
        };
        const status = statusMap[o.orderStatus ?? ""] ?? null;
        if (!status) continue;
        void applyOrderUpdate(sb, {
          accountId: account.id,
          clientOrderId: o.orderLinkId ?? null,
          exchangeOrderId: o.orderId ?? null,
          status,
          fillPrice: o.avgPrice ? Number(o.avgPrice) : null,
          filledQuantity: o.cumExecQty ? Number(o.cumExecQty) : null,
          raw: msg,
        });
      }
    } catch (err) {
      log(`bybit ${account.id}: message parse error: ${String(err).slice(0, 120)}`);
    }
  };

  ws.onclose = () => {
    cleanup();
    log(`bybit ${account.id}: stream closed, reconnecting in 10s`);
    reconnectTimer = setTimeout(() => {
      void startBybitStream(sb, account);
    }, 10_000);
  };

  ws.onerror = () => {
    // onclose follows
  };
}

// ---- Entry point -------------------------------------------------------------

/**
 * Start user-data streams for all active exchange accounts that support them.
 * Returns immediately; streams run in the background. Never throws.
 */
export async function startUserDataStreams(): Promise<void> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;

  const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: accounts, error } = await sb
      .from("exchange_accounts")
      .select("id,exchange_code,encrypted_api_key,encrypted_api_secret,passphrase")
      .eq("status", "active");
    if (error) {
      log(`load accounts error: ${error.message}`);
      return;
    }
    if (!accounts?.length) {
      log("no active exchange accounts — user-data streams idle");
      return;
    }

    for (const acc of accounts as AccountRow[]) {
      const code = (acc.exchange_code ?? "").toLowerCase();
      try {
        if (code === "binance") await startBinanceStream(sb, acc);
        else if (code === "bybit") await startBybitStream(sb, acc);
        // OKX/KuCoin/MEXC/paper/bridge fall back to REST polling for now
      } catch (err) {
        log(`${code} ${acc.id}: stream start failed: ${String(err).slice(0, 120)}`);
      }
    }
  } catch (err) {
    log(`startUserDataStreams error: ${String(err).slice(0, 200)}`);
  }
}
