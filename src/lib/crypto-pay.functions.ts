// Crypto (USDT via Trust Wallet) billing — server functions.
// No Stripe/gateway: the customer pays USDT to the operator's wallet, submits
// the transaction hash, and we verify it on-chain (TronGrid TRC-20 / BSC RPC
// BEP-20) before activating the subscription.
//
// Required env:
//   USDT_TRON_ADDRESS    — operator Trust Wallet USDT (TRC-20) receive address (T...)
//   TRONGRID_API_KEY     — free TronGrid API key (TRC-20 verification)
//   BSC_USDT_ADDRESS     — operator USDT (BEP-20) receive address (0x...)
//   VITE_APP_URL         — for invoice callback URLs (optional)

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// TRC-20 USDT contract on Tron (decimals = 6).
const USDT_TRON_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_TRON_DECIMALS = 6;
// BEP-20 USDT contract on BSC / BNB Smart Chain (decimals = 18).
const USDT_BSC_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
const USDT_BSC_DECIMALS = 18;
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BSC_RPC_URLS = ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com"];

interface NetConfig {
  id: string;
  label: string;
  network: string;
  address: string;
  contract: string;
  decimals: number;
  enabled: boolean;
}

function tronAddress(): string {
  return process.env.USDT_TRON_ADDRESS ?? "";
}
function bscAddress(): string {
  return process.env.BSC_USDT_ADDRESS ?? "";
}
function apiKey(): string {
  return process.env.TRONGRID_API_KEY ?? "";
}

function networks(): NetConfig[] {
  return [
    {
      id: "tron",
      label: "USDT (TRC-20)",
      network: "TRC-20",
      address: tronAddress(),
      contract: USDT_TRON_CONTRACT,
      decimals: USDT_TRON_DECIMALS,
      enabled: !!tronAddress(),
    },
    {
      id: "bsc",
      label: "USDT (BEP-20)",
      network: "BSC",
      address: bscAddress(),
      contract: USDT_BSC_CONTRACT,
      decimals: USDT_BSC_DECIMALS,
      enabled: !!bscAddress(),
    },
  ];
}

function getNet(id: string): NetConfig {
  const n = networks().find((x) => x.id === id && x.enabled) ?? networks().find((x) => x.id === id);
  if (!n || !n.enabled) throw new Error("Selected payment network is not configured.");
  return n;
}

// ─── Public payment info ─────────────────────────────────────────────────────

export const getCryptoPayInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const enabledNetworks = networks().filter((n) => n.enabled);
    if (enabledNetworks.length === 0) {
      return { enabled: false as const, networks: [] };
    }

    // Current/active subscription + latest pending invoice for this user.
    const [subRes, invRes] = await Promise.all([
      context.supabase
        .from("subscriptions")
        .select("id,plan_code,status,billing_interval,current_period_ends_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase
        .from("invoices")
        .select("id,invoice_number,amount,currency,status,created_at")
        .eq("user_id", context.userId)
        .in("status", ["pending", "submitted"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const primary = enabledNetworks[0];
    return {
      enabled: true as const,
      networks: enabledNetworks,
      network: primary.network,
      address: primary.address,
      contract: primary.contract,
      decimals: primary.decimals,
      subscription: subRes.data,
      pendingInvoice: invRes.data,
    };
  });

// ─── Start a payment (create pending subscription + invoice) ─────────────────

export const startCryptoPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        planCode: z.string().min(1).max(32),
        billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
        network: z.enum(["tron", "bsc"]).default("tron"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const net = getNet(data.network);

    // Writes go through the service-role client (bypasses RLS) so users can't
    // insert/activate billing rows of their own via REST. Loaded lazily inside
    // the handler — top-level import would ship the service key to the client.
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const { data: plan, error: planErr } = await admin
      .from("plans")
      .select("code,name,monthly_price,yearly_price")
      .eq("code", data.planCode)
      .eq("is_active", true)
      .maybeSingle();
    if (planErr) throw new Error(planErr.message);
    if (!plan) throw new Error("Plan not found or inactive.");

    const amount =
      data.billingInterval === "yearly" ? Number(plan.yearly_price) : Number(plan.monthly_price);
    if (!amount || amount <= 0) throw new Error("Invalid plan price.");

    // Find or create a pending subscription for the user.
    const { data: existing } = await admin
      .from("subscriptions")
      .select("id,status")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let subscriptionId = existing?.id;
    if (!subscriptionId) {
      const now = new Date();
      const end = new Date(now);
      end.setMonth(end.getMonth() + (data.billingInterval === "yearly" ? 12 : 1));
      const { data: sub, error: subErr } = await admin
        .from("subscriptions")
        .insert({
          user_id: context.userId,
          plan_code: data.planCode,
          status: "pending",
          billing_interval: data.billingInterval,
          current_period_starts_at: now.toISOString(),
          current_period_ends_at: end.toISOString(),
          auto_renew: true,
        })
        .select("id")
        .single();
      if (subErr) throw new Error(subErr.message);
      subscriptionId = sub.id as string;
    } else if (existing?.status === "active") {
      // Already active — don't create a duplicate pending flow.
      return { alreadyActive: true as const, invoiceNumber: null, amount: 0, network: net.network, address: net.address };
    } else {
      // Refresh plan/billing on the existing pending subscription.
      const end = new Date();
      end.setMonth(end.getMonth() + (data.billingInterval === "yearly" ? 12 : 1));
      await admin
        .from("subscriptions")
        .update({
          plan_code: data.planCode,
          status: "pending",
          billing_interval: data.billingInterval,
          current_period_ends_at: end.toISOString(),
        })
        .eq("id", subscriptionId);
    }

    const invoiceNumber = `TW-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .insert({
        user_id: context.userId,
        subscription_id: subscriptionId,
        invoice_number: invoiceNumber,
        amount,
        currency: "USD",
        status: "pending",
        issued_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (invErr) throw new Error(invErr.message);

    return {
      alreadyActive: false as const,
      invoiceNumber,
      subscriptionId,
      invoiceId: invoice.id as string,
      amount,
      currency: "USD",
      networkId: net.id,
      network: net.network,
      contract: net.contract,
      address: net.address,
      decimals: net.decimals,
    };
  });

// ─── Verify an on-chain payment and activate the subscription ────────────────

export const verifyCryptoPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        invoiceNumber: z.string().min(1).max(64),
        txHash: z.string().min(10).max(128),
        network: z.enum(["tron", "bsc"]).default("tron"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Activation writes go through the service-role client (bypasses RLS) so a
    // user can't flip their own subscription to active via REST without paying.
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    // The invoice must belong to the caller.
    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .select("id,amount,status,subscription_id,user_id")
      .eq("invoice_number", data.invoiceNumber)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.status === "paid") return { paid: true as const, alreadyPaid: true as const };
    if (!invoice.subscription_id) throw new Error("Invoice has no attached subscription.");

    const net = getNet(data.network);
    const confirmed = net.network.toUpperCase().includes("BSC")
      ? await confirmOnchainUsdtBsc(net.address, data.txHash, invoice.amount)
      : await confirmOnchainUsdt(net.address, data.txHash, invoice.amount);

    if (!confirmed.ok) {
      return { paid: false as const, reason: confirmed.reason };
    }

    // Activate: mark invoice paid + activate subscription (+1 month).
    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);

    await admin
      .from("invoices")
      .update({ status: "paid", paid_at: now.toISOString() })
      .eq("id", invoice.id);

    await admin
      .from("subscriptions")
      .update({
        status: "active",
        current_period_starts_at: now.toISOString(),
        current_period_ends_at: end.toISOString(),
      })
      .eq("id", invoice.subscription_id);

    return { paid: true as const, alreadyPaid: false as const };
  });

// ─── On-chain verification — TRC-20 (TronGrid) ───────────────────────────────

interface Trc20Transfer {
  transaction_id: string;
  from: string;
  to: string;
  value: string;
  block_timestamp: number;
  token_info?: { address?: string; symbol?: string; decimals?: number };
}

async function confirmOnchainUsdt(
  toAddress: string,
  txHash: string,
  requiredAmount: number,
): Promise<{ ok: boolean; reason?: string }> {
  const tx = txHash.trim().toLowerCase();
  const query = new URLSearchParams({
    limit: "100",
    contract_address: USDT_TRON_CONTRACT,
    only_confirmed: "true",
  });
  const url = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(toAddress)}/transactions/trc20?${query}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", ...(apiKey() ? { "TRON-PRO-API-KEY": apiKey() } : {}) },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, reason: "Could not reach TronGrid." };
  }
  if (!res.ok) return { ok: false, reason: `TronGrid ${res.status}` };

  const body = (await res.json()) as { data?: Trc20Transfer[] };
  const transfers = body.data ?? [];

  const match = transfers.find(
    (t) =>
      t.transaction_id.toLowerCase() === tx &&
      t.to.toLowerCase() === toAddress.toLowerCase() &&
      (t.token_info?.symbol ?? "USDT").toUpperCase() === "USDT",
  );

  if (!match) {
    return {
      ok: false,
      reason:
        "No confirmed USDT (TRC-20) transfer to this wallet matching that tx hash. Double-check the network is TRC-20 and the tx is confirmed.",
    };
  }

  const decimals = match.token_info?.decimals ?? USDT_TRON_DECIMALS;
  const amount = Number(match.value) / 10 ** decimals;
  if (amount < requiredAmount) {
    return { ok: false, reason: `Amount received (${amount.toFixed(2)} USDT) is less than required (${requiredAmount.toFixed(2)}).` };
  }

  return { ok: true };
}

// ─── On-chain verification — BEP-20 (BSC RPC) ────────────────────────────────

async function confirmOnchainUsdtBsc(
  toAddress: string,
  txHash: string,
  requiredAmount: number,
): Promise<{ ok: boolean; reason?: string }> {
  const tx = txHash.trim();

  for (const rpc of BSC_RPC_URLS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [tx] }),
        signal: AbortSignal.timeout(15000),
      });
      const json = (await res.json()) as {
        result?: { status?: string; logs?: Array<{ address: string; topics: string[]; data: string }> };
      };
      const receipt = json.result;
      if (!receipt || receipt.status !== "0x1") continue;

      const transfer = (receipt.logs ?? []).find(
        (l) =>
          l.address.toLowerCase() === USDT_BSC_CONTRACT.toLowerCase() &&
          l.topics[0]?.toLowerCase() === TRANSFER_SIG,
      );
      if (!transfer) return { ok: false, reason: "No USDT (BEP-20) Transfer event found in this transaction." };

      const to = "0x" + transfer.topics[2].slice(26);
      const value = BigInt(`0x${transfer.data.slice(0, 66) || "0"}`);
      const amount = Number(value) / 10 ** USDT_BSC_DECIMALS;

      if (to.toLowerCase() !== toAddress.toLowerCase()) {
        return { ok: false, reason: "That transfer's recipient is not the operator wallet." };
      }
      if (amount < requiredAmount) {
        return { ok: false, reason: `Amount received (${amount.toFixed(2)} USDT) is less than required (${requiredAmount.toFixed(2)}).` };
      }
      return { ok: true };
    } catch {
      // try next RPC
    }
  }

  return { ok: false, reason: "Could not confirm the transaction on BSC." };
}
