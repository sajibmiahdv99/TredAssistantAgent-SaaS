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
const BSC_RPC_URLS = ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com"];

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
            fromBlock: "0x" + (BigInt(await latestBscBlock(rpc)) - 20000n).toString(16),
            toBlock: "latest",
            topics: [TRANSFER_SIG, null, padded],
          }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      const json = (await res.json()) as {
        result?: Array<{ topics: string[]; data: string; transactionHash: string }>;
      };
      const logs = json.result ?? [];
      // newest first
      for (const l of logs.slice().reverse()) {
        const to = "0x" + l.topics[2].slice(26);
        const value = BigInt(`0x${l.data.slice(0, 66) || "0"}`);
        const amount = Number(value) / 10 ** USDT_BSC_DECIMALS;
        if (to.toLowerCase() === operatorTag && Math.abs(amount - minAmount) < 0.005 && !usedTx.has(l.transactionHash)) {
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
  const json = (await res.json()) as { result?: string };
  return BigInt(json.result ?? "0x0");
}

// ─── TRC-20 scan (TronGrid) ───────────────────────────────────────────────────

interface Trc20Transfer {
  transaction_id: string;
  to: string;
  value: string;
  token_info?: { decimals?: number };
}

async function findTronTransfer(
  operator: string,
  minAmount: number,
  usedTx: Set<string>,
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
      if (to === operator.toLowerCase() && Math.abs(amount - minAmount) < 0.005 && !usedTx.has(t.transaction_id)) {
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
    .select("id,amount,status,subscription_id,user_id,invoice_number")
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
  }>;
  if (!pending.length) return { checked: 0, confirmed: 0 };

  const usedTx = new Set<string>();
  let confirmed = 0;

  for (const inv of pending) {
    const net = invoiceNetwork(inv.invoice_number);
    const operator = net === "bsc" ? process.env.BSC_USDT_ADDRESS : process.env.USDT_TRON_ADDRESS;
    if (!operator) continue;

    const tx = net === "bsc" ? await findBscTransfer(operator, inv.amount, usedTx) : await findTronTransfer(operator, inv.amount, usedTx);
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
