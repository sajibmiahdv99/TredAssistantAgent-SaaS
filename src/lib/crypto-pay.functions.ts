// Crypto (USDT TRC-20 via Trust Wallet) billing — server functions.
// No Stripe/gateway: the customer pays USDT to the operator's Trust Wallet
// address, submits the TRC-20 transaction hash, and we verify it on-chain via
// TronGrid before activating the subscription.
//
// Required env:
//   USDT_TRON_ADDRESS    — operator Trust Wallet (TRC-20) USDT receive address (T...)
//   TRONGRID_API_KEY     — free TronGrid API key (optional but recommended)
//   VITE_APP_URL         — for invoice callback URLs (optional)

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// TRC-20 USDT contract on Tron (decimals = 6).
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_DECIMALS = 6;
const NETWORK = "TRC-20";
const PROVIDER = "trustwallet-usdt-trc20";

function usdtAddress(): string {
  return process.env.USDT_TRON_ADDRESS ?? "";
}

function apiKey(): string {
  return process.env.TRONGRID_API_KEY ?? "";
}

// ─── Public payment info ─────────────────────────────────────────────────────

export const getCryptoPayInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const address = usdtAddress();
    if (!address) {
      return { enabled: false as const, network: NETWORK };
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

    return {
      enabled: true as const,
      network: NETWORK,
      address,
      contract: USDT_CONTRACT,
      decimals: USDT_DECIMALS,
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
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const address = usdtAddress();
    if (!address) throw new Error("USDT_TRON_ADDRESS is not configured.");

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
      return { alreadyActive: true as const, invoiceNumber: null, amount: 0, network: NETWORK, address };
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
      network: NETWORK,
      contract: USDT_CONTRACT,
      address,
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
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const address = usdtAddress();
    if (!address) throw new Error("USDT_TRON_ADDRESS is not configured.");

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

    const confirmed = await confirmOnchainUsdt(address, data.txHash, invoice.amount);

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

// ─── On-chain verification via TronGrid ──────────────────────────────────────

interface Trc20Transfer {
  transaction_id: string;
  from: string;
  to: string;
  value: string; // raw value (USDT decimals = 6)
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
    contract_address: USDT_CONTRACT,
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

  const decimals = match.token_info?.decimals ?? USDT_DECIMALS;
  const amount = Number(match.value) / 10 ** decimals;
  if (amount < requiredAmount) {
    return { ok: false, reason: `Amount received (${amount.toFixed(2)} USDT) is less than required (${requiredAmount.toFixed(2)}).` };
  }

  return { ok: true };
}
