// Background auto-confirm for crypto payments (USDT TRC-20 / BEP-20).
// Runs inside the worker (service_role) on its own interval: it finds pending
// invoices, discovers a matching on-chain transfer to the operator wallet, and
// activates the subscription — so the customer never has to paste a TXID.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, USDT_TRON_ADDRESS, BSC_USDT_ADDRESS,
//      TRONGRID_API_KEY (optional).

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USDT_TRON_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_BSC_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
const USDT_BSC_DECIMALS = 18;
const TRANSFER_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
// Prefer RPCs proven to serve eth_getLogs; datased.binance.org is rate-limited for
// log queries, so it's a fallback only.
const BSC_RPC_URLS = ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org", "https://bsc-dataseed1.defibit.io"];
// Absorb exchange network fees: the customer sends exactly the amount shown, but
// the exchange deducts a small network fee, so the operator wallet nets minAmount - fee.
// Accept any on-chain amount within this window of the invoice amount.
const NETWORK_FEE_ABSORB = 0.5;
// Used transfer hashes (module-level, persists across 60s loop runs so one on-chain
// transfer confirms at most one invoice).
const usedTx = new Set<string>();
// Worker re-scans every ~60s and a BEP-20 deposit lands within minutes, so a ~8000
// block window (~6.7h) is enough for fresh payments AND catches a payment that was
// pending a while (publicnode serves up to ~10000 blocks before its archive limit;
// a huge window gets "limit exceeded" / "archive requires a personal token").
const BSC_SCAN_BLOCKS = 8000;

function log(scope: string, msg: string): void {
  console.log(`[crypto-confirm:${scope}] ${new Date().toISOString()} ${msg}`);
}

function invoiceNetwork(invoiceNumber: string): "tron" | "bsc" {
  return (invoiceNumber ?? "").toUpperCase().includes("-BSC-") ? "bsc" : "tron";
}

// ─── BEP-20 scan (BSC RPC eth_getLogs) ───────────────────────────────────────

async function findBscTransfer(
  operator: string,
  minAmount: number,
  usedTx: Set<string>,
  minLandedAtMs?: number,
): Promise<string | null> {
  const operatorTag = operator.toLowerCase();
  const padded = "0x" + operatorTag.slice(2).padStart(64, "0");
  for (const rpc of BSC_RPC_URLS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getLogs",
          params: [{
            address: USDT_BSC_CONTRACT,
            fromBlock: "0x" + (BigInt(await latestBscBlock(rpc)) - BigInt(BSC_SCAN_BLOCKS)).toString(16),
            toBlock: "latest",
            topics: [TRANSFER_SIG, null, padded],
          }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      const json = (await res.json()) as {
        result?: Array<{ topics: string[]; data: string; transactionHash: string; blockNumber: string }>;
        error?: { message?: string };
      };
      // A JSON-RPC error (e.g. "limit exceeded") has no result — treat it as a
      // failed RPC so we fall through to the next endpoint instead of silently
      // reporting "no transfers found".
      if (json.error) throw new Error(`bsc rpc: ${json.error.message ?? "unknown error"}`);
      const logs = json.result ?? [];
      // newest first
      for (const l of logs.slice().reverse()) {
        const to = "0x" + l.topics[2].slice(26);
        const value = BigInt(`0x${l.data.slice(2, 66) || "0"}`);
        const amount = Number(value) / 10 ** USDT_BSC_DECIMALS;
        if (to.toLowerCase() === operatorTag && amount >= minAmount - NETWORK_FEE_ABSORB && amount <= minAmount + NETWORK_FEE_ABSORB && !usedTx.has(l.transactionHash)) {
          // A payment must have LANDED at/after the invoice was created. This stops a
          // stale transfer that is still inside the scan window from falsifying a newer
          // invoice (e.g. the same tx reconfirming a second invoice on restart).
          if (minLandedAtMs != null) {
            const blk = await fetch(rpc, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [l.blockNumber, false] }),
              signal: AbortSignal.timeout(15000),
            }).then((r) => r.json() as Promise<{ result?: { timestamp?: string }; error?: { message?: string } }>);
            if (blk.error) throw new Error(`bsc block: ${blk.error.message ?? "unknown error"}`);
            const landedMs = parseInt((blk.result?.timestamp ?? "0"), 16) * 1000;
            if (landedMs < minLandedAtMs) continue;
          }
          return l.transactionHash;
        }
      }
      return null;
    } catch (e) {
      log("bsc", `rpc error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return null;
}

async function latestBscBlock(rpc: string): Promise<bigint> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error) throw new Error(`bsc blockNumber: ${json.error.message ?? "unknown error"}`);
  if (!json.result) throw new Error("bsc blockNumber: no result");
  return BigInt(json.result);
}

// ─── TRC-20 scan (TronGrid) ───────────────────────────────────────────────────

interface Trc20Transfer {
  transaction_id: string;
  to: string;
  value: string;
  token_info?: { decimals?: number };
  block_timestamp?: number;
}

async function findTronTransfer(
  operator: string,
  minAmount: number,
  usedTx: Set<string>,
  minLandedAtMs?: number,
): Promise<string | null> {
  const query = new URLSearchParams({ limit: "50", contract_address: USDT_TRON_CONTRACT, only_confirmed: "true" });
  const url = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(operator)}/transactions/trc20?${query}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...(process.env.TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY } : {}) },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Trc20Transfer[] };
    for (const t of (body.data ?? []).slice().reverse()) {
      const to = (t.to ?? "").toLowerCase();
      const decimals = t.token_info?.decimals ?? 6;
      const amount = Number(t.value) / 10 ** decimals;
      if (to === operator.toLowerCase() && amount >= minAmount - NETWORK_FEE_ABSORB && amount <= minAmount + NETWORK_FEE_ABSORB && !usedTx.has(t.transaction_id)) {
        // Only match a transfer that landed at/after the invoice was created (see BSC path).
        if (minLandedAtMs != null && (t.block_timestamp == null || t.block_timestamp < minLandedAtMs)) continue;
        return t.transaction_id;
      }
    }
  } catch (e) {
    log("tron", `trongrid error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return null;
}

// ─── Reconcile ────────────────────────────────────────────────────────────────

export async function confirmPendingCryptoPayments(): Promise<{ checked: number; confirmed: number }> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return { checked: 0, confirmed: 0 };
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: invoices, error } = await admin
    .from("invoices")
    .select("id,amount,status,subscription_id,user_id,invoice_number,created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    log("db", `select error: ${error.message}`);
    return { checked: 0, confirmed: 0 };
  }

  const pending = (invoices ?? []) as Array<{
    id: string;
    amount: number;
    subscription_id: string | null;
    user_id: string;
    invoice_number: string;
    created_at: string;
  }>;
  if (!pending.length) return { checked: 0, confirmed: 0 };

  // A single on-chain transfer must confirm AT MOST ONE invoice. Module-level so
  // it persists across the 60s loop runs — otherwise the same tx confirms a second
  // pending invoice on the next tick.
  let confirmed = 0;

  for (const inv of pending) {
    const net = invoiceNetwork(inv.invoice_number);
    const operator = net === "bsc" ? process.env.BSC_USDT_ADDRESS : process.env.USDT_TRON_ADDRESS;
    if (!operator) continue;

    const tx = net === "bsc" ? await findBscTransfer(operator, inv.amount, usedTx, new Date(inv.created_at).getTime()) : await findTronTransfer(operator, inv.amount, usedTx, new Date(inv.created_at).getTime());
    if (!tx) continue;

    usedTx.add(tx);
    try {
      const now = new Date();
      const end = new Date(now);
      end.setMonth(end.getMonth() + 1);

      const { error: invUpErr } = await admin
        .from("invoices")
        .update({ status: "paid", paid_at: now.toISOString() })
        .eq("id", inv.id);
      if (invUpErr) log("db", `invoice update error: ${invUpErr.message}`);

      if (inv.subscription_id) {
        const { error: subUpErr } = await admin
          .from("subscriptions")
          .update({
            status: "active",
            current_period_starts_at: now.toISOString(),
            current_period_ends_at: end.toISOString(),
          })
          .eq("id", inv.subscription_id);
        if (subUpErr) log("db", `subscription update error: ${subUpErr.message}`);
      }

      confirmed++;
      log("confirm", `AUTO-CONFIRMED ${inv.invoice_number} (${net}) tx=${tx} amount=${inv.amount}`);
    } catch (e) {
      log("confirm", `error for ${inv.invoice_number}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { checked: pending.length, confirmed };
}
