// Execution worker — polls queued orders, places them on the user's exchange,
// reports fills back, and reconciles open positions.
//
// Run:   EXCHANGE_ENCRYPTION_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx worker/execution-worker.ts
// Loop:  claim -> place -> report  (every WORKER_INTERVAL_MS, default 5s)
//
// This is a service-role daemon: it reads orders + exchange accounts for ALL
// users (RLS does not apply to service_role). Credentials are decrypted with
// EXCHANGE_ENCRYPTION_KEY at runtime — never logged.

import {
  cancelExchangeOrder,
  fetchExchangeOrderStatus,
  fetchExchangePosition,
  placeExchangeOrder,
  type ExchangeCreds,
  type PlaceOrderInput,
} from "../src/lib/exchanges/executor.server";
import { decryptSecret } from "../src/lib/crypto.server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---- Config ---------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXCHANGE_ENC_KEY = process.env.EXCHANGE_ENCRYPTION_KEY;
const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 5_000);
const CLAIM_LIMIT = Number(process.env.WORKER_CLAIM_LIMIT ?? 10);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !EXCHANGE_ENC_KEY) {
  console.error(
    "[worker] Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXCHANGE_ENCRYPTION_KEY",
  );
  process.exit(1);
}

const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type OrderRow = {
  id: string;
  user_id: string;
  exchange_account_id: string | null;
  symbol: string;
  side: string; // 'long' | 'short'
  order_type: string; // 'market' | 'limit'
  price: number | null;
  quantity: number;
  leverage: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  status: string;
  exchange_order_id: string | null;
  client_order_id?: string | null;
  version?: number;
};

type AccountRow = {
  id: string;
  exchange_code: string;
  encrypted_api_key: string;
  encrypted_api_secret: string;
  passphrase: string | null;
};

// ---- Helpers ---------------------------------------------------------------

function log(scope: string, msg: string): void {
  console.log(`[worker:${scope}] ${new Date().toISOString()} ${msg}`);
}

async function loadAccount(accountId: string | null): Promise<AccountRow | null> {
  if (!accountId) return null;
  const { data, error } = await sb
    .from("exchange_accounts")
    .select("id,exchange_code,encrypted_api_key,encrypted_api_secret,passphrase")
    .eq("id", accountId)
    .maybeSingle();
  if (error) {
    log("db", `loadAccount error: ${error.message}`);
    return null;
  }
  return (data ?? null) as AccountRow | null;
}

function credsOf(acc: AccountRow): ExchangeCreds {
  return {
    apiKey: decryptSecret(acc.encrypted_api_key),
    apiSecret: decryptSecret(acc.encrypted_api_secret),
    passphrase: acc.passphrase ? decryptSecret(acc.passphrase) : undefined,
  };
}

async function insertEvent(
  orderId: string,
  userId: string,
  eventType: string,
  fromStatus: string | null,
  toStatus: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.from("order_events").insert({
    order_id: orderId,
    user_id: userId,
    event_type: eventType,
    from_status: fromStatus,
    to_status: toStatus,
    payload,
  });
  if (error) log("db", `insertEvent ${eventType} error: ${error.message}`);
}

// ---- Step 1: claim ----------------------------------------------------------

async function claimQueued(): Promise<OrderRow[]> {
  const { data, error } = await sb
    .from("orders")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(CLAIM_LIMIT);
  if (error) {
    log("claim", `select error: ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as OrderRow[];
  if (!rows.length) return [];

  // Atomic-ish claim: flip to dispatched, only if still queued.
  const ids = rows.map((r) => r.id);
  const { error: upErr, count } = await sb
    .from("orders")
    .update({ status: "dispatched" })
    .in("id", ids)
    .eq("status", "queued")
    .select("id");
  if (upErr) {
    log("claim", `update error: ${upErr.message}`);
    return [];
  }
  const claimed = (count ?? []) as unknown[];
  for (const r of rows) {
    await insertEvent(r.id, r.user_id, "claim", "queued", "dispatched", {});
  }
  log("claim", `${claimed.length}/${rows.length} orders dispatched`);
  return rows;
}

// ---- Step 2: place ----------------------------------------------------------

async function placeOrder(row: OrderRow, acc: AccountRow): Promise<void> {
  const input: PlaceOrderInput = {
    symbol: row.symbol,
    side: row.side === "long" ? "long" : "short",
    quantity: Number(row.quantity),
    entry: row.price != null ? Number(row.price) : null,
    stopLoss: row.stop_loss != null ? Number(row.stop_loss) : null,
    takeProfit: row.take_profit != null ? Number(row.take_profit) : null,
    leverage: row.leverage != null ? Number(row.leverage) : null,
    clientOrderId: row.id,
  };

  try {
    const result = await placeExchangeOrder(acc.exchange_code, credsOf(acc), input);
    const { error } = await sb
      .from("orders")
      .update({
        status: result.status,
        exchange_order_id: result.exchangeOrderId,
        fill_price: result.fillPrice ?? null,
        filled_quantity: result.filledQuantity ?? null,
        error_message: null,
      })
      .eq("id", row.id);
    if (error) throw error;
    await insertEvent(row.id, row.user_id, `place_${result.status}`, "dispatched", result.status, {
      exchange_order_id: result.exchangeOrderId,
      fill_price: result.fillPrice,
      filled_quantity: result.filledQuantity,
      raw: result.raw,
    });
    log("place", `${row.symbol} ${row.side} -> ${result.status} (${result.exchangeOrderId})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const { error } = await sb
      .from("orders")
      .update({ status: "rejected", error_message: msg.slice(0, 500) })
      .eq("id", row.id);
    if (error) log("place", `reject-update error: ${error.message}`);
    await insertEvent(row.id, row.user_id, "place_rejected", "dispatched", "rejected", {
      error: msg,
    });
    log("place", `${row.symbol} REJECTED: ${msg.slice(0, 200)}`);
  }
}

// ---- Step 3: pending cancels ------------------------------------------------

async function processCancels(): Promise<void> {
  const { data, error } = await sb
    .from("orders")
    .select("*")
    .in("status", ["open", "partial", "dispatched"])
    .eq("cancel_requested", true)
    .limit(50);
  if (error) return;
  for (const row of (data ?? []) as OrderRow[]) {
    const acc = await loadAccount(row.exchange_account_id);
    if (!acc || !row.exchange_order_id) {
      // No exchange ref — just mark cancelled locally.
      await sb
        .from("orders")
        .update({ status: "cancelled", cancel_requested: false })
        .eq("id", row.id);
      await insertEvent(row.id, row.user_id, "cancel_local", row.status, "cancelled", {});
      continue;
    }
    try {
      await cancelExchangeOrder(acc.exchange_code, credsOf(acc), row.symbol, row.exchange_order_id);
      await sb
        .from("orders")
        .update({ status: "cancelled", cancel_requested: false })
        .eq("id", row.id);
      await insertEvent(row.id, row.user_id, "cancel_exchange", row.status, "cancelled", {});
      log("cancel", `${row.symbol} cancelled (${row.exchange_order_id})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await insertEvent(row.id, row.user_id, "cancel_failed", row.status, null, { error: msg });
      log("cancel", `${row.symbol} cancel failed: ${msg.slice(0, 200)}`);
    }
  }
}

// ---- Step 4: reconcile open positions ----------------------------------------

async function reconcilePositions(): Promise<void> {
  const { data, error } = await sb
    .from("orders")
    .select("*")
    .in("status", ["open", "partial"])
    .not("exchange_order_id", "is", null)
    .limit(100);
  if (error) return;
  for (const row of (data ?? []) as OrderRow[]) {
    const acc = await loadAccount(row.exchange_account_id);
    if (!acc || !row.exchange_order_id) continue;
    try {
      const snap = await fetchExchangePosition(acc.exchange_code, credsOf(acc), row.symbol);
      if (!snap) continue; // adapter does not support position fetch
      const flat = Number(snap.positionAmt) === 0;
      if (flat) {
        const { error: upErr } = await sb
          .from("orders")
          .update({
            status: "closed",
            pnl: snap.unrealizedPnl != null ? snap.unrealizedPnl : undefined,
            fill_price: snap.entryPrice ?? undefined,
          })
          .eq("id", row.id);
        if (upErr) log("reconcile", `close-update error: ${upErr.message}`);
        await insertEvent(row.id, row.user_id, "position_closed", row.status, "closed", {
          entry: snap.entryPrice,
          mark: snap.markPrice,
          pnl: snap.unrealizedPnl,
        });
        log("reconcile", `${row.symbol} closed by exchange (pnl=${snap.unrealizedPnl ?? "n/a"})`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("reconcile", `${row.symbol} check failed: ${msg.slice(0, 150)}`);
    }
  }
}

// ---- Stale dispatched watchdog ----------------------------------------------
// If an order was dispatched but never reported within 10 min, and it has no
// exchange ref yet, mark it rejected so it doesn't sit forever.

async function watchdogStaleDispatched(): Promise<void> {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await sb
    .from("orders")
    .select("*")
    .eq("status", "dispatched")
    .lt("updated_at", cutoff)
    .limit(20);
  if (error) return;
  for (const row of (data ?? []) as OrderRow[]) {
    if (row.exchange_order_id) continue; // worker may still be reporting
    await sb
      .from("orders")
      .update({ status: "rejected", error_message: "worker timeout: no fill report" })
      .eq("id", row.id);
    await insertEvent(row.id, row.user_id, "worker_timeout", "dispatched", "rejected", {});
    log("watchdog", `${row.symbol} stale dispatched -> rejected`);
  }
}

// ---- Main loop ----------------------------------------------------------------

async function tick(): Promise<void> {
  try {
    const rows = await claimQueued();
    for (const row of rows) {
      const acc = await loadAccount(row.exchange_account_id);
      if (!acc) {
        await sb
          .from("orders")
          .update({ status: "rejected", error_message: "no exchange account" })
          .eq("id", row.id);
        await insertEvent(row.id, row.user_id, "place_rejected", "dispatched", "rejected", {
          error: "no exchange account linked",
        });
        continue;
      }
      await placeOrder(row, acc);
    }
    await processCancels();
    await reconcilePositions();
    await watchdogStaleDispatched();
  } catch (e) {
    log("tick", `unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(): Promise<void> {
  log("boot", `worker starting (interval=${INTERVAL_MS}ms, claim_limit=${CLAIM_LIMIT})`);
  // Immediate first tick, then loop.
  await tick();
  if (process.env.WORKER_DRY_RUN === "1") {
    log("boot", "dry-run mode: single tick only, exiting");
    process.exit(0);
  }
  setInterval(tick, INTERVAL_MS);
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
