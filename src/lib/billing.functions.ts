// Billing server functions — Stripe-powered checkout, portal, and pricing plans.
// All functions are server-side only and never bundle to the client.
//
// Requires env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO_MONTHLY.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PricingPlan {
  code: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number | null;
  stripePriceId: string | null;
  features: string[];
  cta: string;
  highlighted: boolean;
}

// ─── Pricing plans ───────────────────────────────────────────────────────────

/** Static pricing plans with Stripe price IDs from env vars. */
export const getPricingPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const proMonthly = process.env.STRIPE_PRICE_PRO_MONTHLY ?? "";

    const plans: PricingPlan[] = [
      {
        code: "starter",
        name: "Starter",
        description: "Get started with automated trading signals.",
        monthlyPrice: 29,
        yearlyPrice: 290,
        stripePriceId: null,
        features: [
          "Up to 20 trades / day",
          "3 open positions",
          "10% max trade size",
          "Basic signals",
        ],
        cta: "Coming soon",
        highlighted: false,
      },
      {
        code: "premium",
        name: "Premium",
        description: "For active traders who need more capacity.",
        monthlyPrice: 79,
        yearlyPrice: 790,
        stripePriceId: proMonthly || null,
        features: [
          "Up to 50 trades / day",
          "10 open positions",
          "25% max trade size",
          "Premium signals",
          "Priority support",
        ],
        cta: proMonthly ? "Subscribe" : "Coming soon",
        highlighted: true,
      },
      {
        code: "professional",
        name: "Professional",
        description: "Maximum performance and unlimited capacity.",
        monthlyPrice: 199,
        yearlyPrice: 1990,
        stripePriceId: null,
        features: [
          "Unlimited trades",
          "50 open positions",
          "50% max trade size",
          "All signals & sources",
          "Dedicated support",
        ],
        cta: "Coming soon",
        highlighted: false,
      },
    ];

    return plans;
  });

// ─── Subscription checkout ───────────────────────────────────────────────────

export const createSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        priceId: z.string().min(1),
        planCode: z.string().min(1),
        billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new Error(
        "Stripe payments are not configured yet. Please check back later.",
      );
    }

    const { createCheckoutSession, createOrRetrieveCustomer } = await import(
      "@/lib/stripe.server"
    );

    // Get the user's email from their profile
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    const email = profile?.email ?? `${context.userId}@placeholder.local`;

    // Create or retrieve Stripe customer
    const customer = await createOrRetrieveCustomer(email, {
      user_id: context.userId,
    });

    const origin = process.env.VITE_APP_URL ?? "http://localhost:3000";

    const result = await createCheckoutSession({
      customerEmail: email,
      priceId: data.priceId,
      mode: "subscription",
      clientReferenceId: context.userId,
      successUrl: `${origin}/app/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/app/billing`,
      metadata: {
        user_id: context.userId,
        plan_code: data.planCode,
        billing_interval: data.billingInterval,
        stripe_customer_id: customer.id,
      },
    });

    return { url: result.url, sessionId: result.sessionId };
  });

// ─── Billing portal ──────────────────────────────────────────────────────────

export const getBillingPortalUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new Error(
        "Stripe billing portal is not configured yet. Please check back later.",
      );
    }

    const { createBillingPortalSession } = await import(
      "@/lib/stripe.server"
    );

    // Find the user's active subscription with a Stripe external reference
    const { data: sub } = await context.supabase
      .from("subscriptions")
      .select("external_reference")
      .eq("user_id", context.userId)
      .not("external_reference", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub?.external_reference) {
      throw new Error("No active Stripe subscription found for this user.");
    }

    // Retrieve the Stripe subscription to get the customer ID
    const stripeSub = await fetchStripeSubscription(sub.external_reference);

    if (!stripeSub.customer) {
      throw new Error("Could not resolve Stripe customer ID.");
    }

    const origin = process.env.VITE_APP_URL ?? "http://localhost:3000";

    const result = await createBillingPortalSession({
      customerId: stripeSub.customer,
      returnUrl: `${origin}/app/billing`,
    });

    return { url: result.url };
  });

// ─── Internal helper ─────────────────────────────────────────────────────────

async function fetchStripeSubscription(
  subId: string,
): Promise<{ customer: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");

  const res = await fetch(
    `https://api.stripe.com/v1/subscriptions/${subId}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      },
    },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown error");
    throw new Error(`Stripe API ${res.status}: ${err}`);
  }
  return res.json() as Promise<{ customer: string }>;
}