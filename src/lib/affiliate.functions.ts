// Affiliate commission pipeline.
//
// 1. distributeAffiliateCommissions() — called after a subscription payment
//    is confirmed. Walks the referral chain (up to 7 levels) and inserts
//    affiliate_commissions rows at 30% / 10% / 5% for levels 1/2/3.
// 2. requestPayout() — user converts available balance into a payout request.
// 3. getAffiliateOverview() — combined stats for the user dashboard.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Commission rates by level: L1 = direct, L2 = referred-by-referrer, ...
export const COMMISSION_RATES: Record<number, number> = {
  1: 30, // 30% direct
  2: 10, // 10% second level
  3: 5, // 5% third level
};
export const MAX_AFFILIATE_DEPTH = 3;

export type CommissionResult = {
  commissionsCreated: number;
  totalCommission: number;
  details: Array<{ referredById: string; level: number; rate: number; amount: number }>;
};

/**
 * Distribute affiliate commissions for a confirmed subscription payment.
 * Call from the payment webhook (NowPayments / Stripe) after the invoice
 * is marked paid. Idempotent per (subscription_id, level).
 */
export async function distributeAffiliateCommissions(params: {
  subscriptionId: string;
  subscriberId: string;
  amount: number; // payment amount in USD-equivalent
}): Promise<CommissionResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Find the subscriber's affiliate link (who referred them?)
  // Check the affiliates table for the subscriber's referral chain
  const { data: subAffiliate } = await supabaseAdmin
    .from("affiliates")
    .select("referred_by,parent_affiliate_id")
    .eq("user_id", params.subscriberId)
    .maybeSingle();

  const referredByUserId = subAffiliate?.referred_by as string | null | undefined;
  if (!referredByUserId) {
    return { commissionsCreated: 0, totalCommission: 0, details: [] };
  }

  // Walk the chain: referred_by -> their affiliate row -> their referrer, etc.
  const chain: Array<{ userId: string; level: number }> = [];
  let currentUserId: string | null = referredByUserId;
  let level = 1;

  while (currentUserId && level <= MAX_AFFILIATE_DEPTH) {
    chain.push({ userId: currentUserId, level });

    const {
      data: aff,
    }: {
      data: {
        user_id: string;
        is_approved: boolean | null;
        is_recurring_eligible: boolean | null;
        parent_affiliate_id: string | null;
      } | null;
    } = await supabaseAdmin
      .from("affiliates")
      .select("user_id,is_approved,is_recurring_eligible,parent_affiliate_id")
      .eq("user_id", currentUserId)
      .maybeSingle();

    if (!aff || aff.is_approved === false) break; // unapproved affiliate gets nothing
    currentUserId = (aff.parent_affiliate_id as string | null) ?? null;
    level++;
  }

  // Insert commission rows (skip if already exists for this subscription+level)
  const details: CommissionResult["details"] = [];
  let totalCommission = 0;

  for (const link of chain) {
    const rate = COMMISSION_RATES[link.level];
    if (rate == null) continue;
    const amount = (params.amount * rate) / 100;

    const { data: existing } = await supabaseAdmin
      .from("affiliate_commissions")
      .select("id")
      .eq("subscription_id", params.subscriptionId)
      .eq("referred_by_id", link.userId)
      .eq("level", link.level)
      .maybeSingle();
    if (existing) continue; // idempotent

    const { error } = await supabaseAdmin.from("affiliate_commissions").insert({
      referred_by_id: link.userId,
      subscriber_id: params.subscriberId,
      subscription_id: params.subscriptionId,
      level: link.level,
      rate,
      amount,
      status: "pending",
    });
    if (error) {
      console.error("[affiliate] commission insert failed", error.message);
      continue;
    }

    // Adjust affiliate counters via SQL-safe increment: read-modify-write
    const { data: affRow } = await supabaseAdmin
      .from("affiliates")
      .select("total_earned,total_pending")
      .eq("user_id", link.userId)
      .maybeSingle();
    await supabaseAdmin
      .from("affiliates")
      .update({
        total_earned: Number(affRow?.total_earned ?? 0) + amount,
        total_pending: Number(affRow?.total_pending ?? 0) + amount,
      })
      .eq("user_id", link.userId);

    // Credit the user's available balance
    const { data: bal } = await supabaseAdmin
      .from("user_balances")
      .select("available_balance,pending_commission")
      .eq("user_id", link.userId)
      .maybeSingle();
    await supabaseAdmin.from("user_balances").upsert({
      user_id: link.userId,
      available_balance: Number(bal?.available_balance ?? 0) + amount,
      pending_commission: Number(bal?.pending_commission ?? 0) + amount,
      updated_at: new Date().toISOString(),
    });

    details.push({ referredById: link.userId, level: link.level, rate, amount });
    totalCommission += amount;
  }

  return { commissionsCreated: details.length, totalCommission, details };
}

// ---- User-facing -----------------------------------------------------------

export const getAffiliateOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const uid = context.userId;

    const [aff, cm, profile] = await Promise.all([
      sb.from("affiliates").select("*").eq("user_id", uid).maybeSingle(),
      sb
        .from("affiliate_commissions")
        .select("id,amount,level,status,created_at")
        .eq("referred_by_id", uid)
        .order("created_at", { ascending: false })
        .limit(100),
      sb.from("profiles").select("referral_code").eq("id", uid).maybeSingle(),
    ]);
    if (aff.error) throw new Error(aff.error.message);
    if (cm.error) throw new Error(cm.error.message);

    const commissions = (cm.data ?? []) as Array<{
      id: string;
      amount: number;
      level: number;
      status: string;
      created_at: string;
    }>;
    const pending = commissions
      .filter((c) => c.status === "pending")
      .reduce((s, c) => s + Number(c.amount), 0);
    const paid = commissions
      .filter((c) => c.status === "paid")
      .reduce((s, c) => s + Number(c.amount), 0);

    return {
      affiliate: aff.data,
      referralCode: profile.data?.referral_code ?? aff.data?.referral_code ?? null,
      referredBy: aff.data?.referred_by ?? null,
      commissions,
      totals: { pending, paid, earned: pending + paid },
      rates: COMMISSION_RATES,
    };
  });

export const requestPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        amount: z.number().positive().max(100_000),
        method: z.enum(["usdt_trc20", "usdt_erc20", "bank_transfer"]),
        address: z.string().min(8).max(256),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    // Check available balance
    const { data: bal } = await supabaseAdmin
      .from("user_balances")
      .select("available_balance,pending_withdrawal")
      .eq("user_id", uid)
      .maybeSingle();
    const available = Number(bal?.available_balance ?? 0);
    if (data.amount > available) {
      throw new Error(`Insufficient balance: ${available.toFixed(2)} available`);
    }

    // Reserve funds
    await supabaseAdmin
      .from("user_balances")
      .update({
        available_balance: available - data.amount,
        pending_withdrawal: Number(bal?.pending_withdrawal ?? 0) + data.amount,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", uid);

    // Create payout row
    const { data: payout, error } = await supabaseAdmin
      .from("payouts")
      .insert({
        user_id: uid,
        amount: data.amount,
        method: data.method,
        status: "pending",
        notes: JSON.stringify({ address: data.address }),
      })
      .select("id,amount,method,status")
      .single();
    if (error) {
      // Rollback the reservation
      await supabaseAdmin.from("user_balances").upsert({
        user_id: uid,
        available_balance: available,
        pending_withdrawal: Number(bal?.pending_withdrawal ?? 0),
        updated_at: new Date().toISOString(),
      });
      throw new Error(error.message);
    }

    return payout;
  });
