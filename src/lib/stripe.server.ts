// Stripe integration helpers — pure `fetch` to Stripe REST API, no SDK.
// Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET env vars.
//
// Intended for server-side use only (route handlers and server functions).
// Never import this module in client code.

import { createHmac, timingSafeEqual } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
  customer_email: string | null;
  client_reference_id: string | null;
  metadata: Record<string, string>;
  mode: "payment" | "subscription" | "setup";
  status: "open" | "complete" | "expired";
  payment_status: string | null;
  amount_total: number | null;
  currency: string | null;
  subscription: string | null;
  invoice: string | null;
}

export interface StripeCustomer {
  id: string;
  email: string;
  name: string | null;
  metadata: Record<string, string>;
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  metadata: Record<string, string>;
  items: { data: Array<{ price: { id: string } }> };
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  created: number;
}

// ─── Low-level helpers ───────────────────────────────────────────────────────

/** Basic auth header for Stripe REST API calls. */
function stripeAuth(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

/** POST to Stripe REST API with form-urlencoded body. */
async function stripePost<T>(
  path: string,
  body: Record<string, string | undefined>,
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) params.set(k, v);
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: stripeAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown error");
    throw new Error(`Stripe API ${res.status} on ${path}: ${err}`);
  }
  return res.json() as Promise<T>;
}

/** GET from Stripe REST API. */
async function stripeGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: stripeAuth() },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown error");
    throw new Error(`Stripe API ${res.status} on ${path}: ${err}`);
  }
  return res.json() as Promise<T>;
}

// ─── Exported helpers ────────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout Session.
 *
 * For one-time payments pass `mode: "payment"` and `priceId`.
 * For subscriptions pass `mode: "subscription"` and `priceId`.
 */
export async function createCheckoutSession(params: {
  customerEmail: string;
  priceId: string;
  mode: "payment" | "subscription";
  clientReferenceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<{ sessionId: string; url: string | null }> {
  const body: Record<string, string | undefined> = {
    "mode": params.mode,
    "success_url": params.successUrl,
    "cancel_url": params.cancelUrl,
    "client_reference_id": params.clientReferenceId,
    "customer_email": params.customerEmail,
    "line_items[0][price]": params.priceId,
    "line_items[0][quantity]": "1",
  };
  // Flatten metadata into Stripe's form-encoded key format: metadata[key]=value
  for (const [k, v] of Object.entries(params.metadata)) {
    body[`metadata[${k}]`] = v;
  }

  const session = await stripePost<StripeCheckoutSession>(
    "/checkout/sessions",
    body,
  );
  return { sessionId: session.id, url: session.url };
}

/**
 * Retrieve a Checkout Session (expands customer, subscription, line_items).
 */
export async function retrieveCheckoutSession(
  sessionId: string,
): Promise<StripeCheckoutSession> {
  return stripeGet<StripeCheckoutSession>(
    `/checkout/sessions/${sessionId}`,
  );
}

/**
 * Create a Stripe Billing Portal session for an existing customer.
 */
export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const result = await stripePost<{ url: string }>(
    "/billing_portal/sessions",
    {
      customer: params.customerId,
      return_url: params.returnUrl,
    },
  );
  return { url: result.url };
}

/**
 * Create (or retrieve) a Stripe Customer by email.
 */
export async function createOrRetrieveCustomer(
  email: string,
  metadata: Record<string, string>,
): Promise<StripeCustomer> {
  // Try to find existing customer by email
  const search = await stripeGet<{
    data: StripeCustomer[];
  }>(`/customers?email=${encodeURIComponent(email)}&limit=1`);

  if (search.data.length > 0) {
    const existing = search.data[0];
    // Merge metadata
    if (Object.keys(metadata).length > 0) {
      return stripePost<StripeCustomer>(`/customers/${existing.id}`, {
        "metadata[user_id]": metadata["user_id"] ?? "",
      });
    }
    return existing;
  }

  // Create new customer
  const body: Record<string, string | undefined> = { email };
  for (const [k, v] of Object.entries(metadata)) {
    body[`metadata[${k}]`] = v;
  }
  return stripePost<StripeCustomer>("/customers", body);
}

/**
 * Verify a Stripe webhook signature using HMAC-SHA256.
 *
 * Stripe sends the `stripe-signature` header as:
 *   `t={timestamp},v1={signature}[,v1={signature}]...`
 *
 * Returns the parsed event payload on success, or throws on failure.
 */
export function constructWebhookEvent(
  rawBody: string,
  sigHeader: string | null,
): StripeEvent {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  }
  if (!sigHeader) {
    throw new Error("No Stripe signature header provided");
  }

  // Parse the signature header: t=timestamp,v1=sig1,v1=sig2,...
  const parts = sigHeader.split(",");
  let timestamp = "";
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (key === "t") {
      timestamp = value;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }

  if (!timestamp) {
    throw new Error("No timestamp found in Stripe signature header");
  }
  if (signatures.length === 0) {
    throw new Error("No v1 signature found in Stripe signature header");
  }

  // Compute expected signature: HMAC-SHA256 of `${timestamp}.${rawBody}`
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  // Compare using timing-safe equality
  const expectedBuf = Buffer.from(expected);
  let matched = false;
  for (const sig of signatures) {
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length) {
      try {
        matched = timingSafeEqual(sigBuf, expectedBuf);
        if (matched) break;
      } catch {
        // length mismatch — skip
      }
    }
  }

  if (!matched) {
    throw new Error("Stripe webhook signature verification failed");
  }

  // Optional: verify timestamp is within 5 minutes
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) {
    throw new Error("Stripe webhook timestamp is too old or in the future");
  }

  // Parse and return the event
  return JSON.parse(rawBody) as StripeEvent;
}

/**
 * Handle a completed checkout session — updates the internal DB.
 *
 * Creates/updates: invoices, payments, subscriptions, and optionally grants
 * a role via user_roles.
 */
export async function handleCheckoutCompleted(
  session: StripeCheckoutSession,
): Promise<void> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );

  const userId = session.client_reference_id ??
    session.metadata?.user_id;
  if (!userId) {
    console.warn(
      "[stripe] handleCheckoutCompleted: no user_id in session",
      session.id,
    );
    return;
  }

  const planCode = session.metadata?.plan_code ?? "premium";
  const billingInterval = session.metadata?.billing_interval ?? "monthly";
  const amountTotal = session.amount_total ?? 0;
  const currency = session.currency?.toUpperCase() ?? "USD";
  const stripeSubscriptionId = session.subscription;

  // Generate a unique invoice number
  const invoiceNumber = `STRIPE-${Date.now().toString(36).toUpperCase()}-${session.id.slice(-8)}`;

  // Create payment record (non-critical — invoice/subscription still processed)
  try {
    await supabaseAdmin
      .from("payments")
      .insert({
        user_id: userId,
        amount: amountTotal / 100, // Stripe amounts are in cents
        currency,
        provider: "stripe",
        external_payment_ref: session.id,
        status: "paid",
        paid_at: new Date().toISOString(),
      });
  } catch {
    // payment creation is non-critical; continue
  }

  // Create or update subscription
  let subscriptionId: string | undefined;
  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  // Check if user already has a subscription
  const { data: existingSub } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSub && stripeSubscriptionId) {
    // Update existing subscription
    await supabaseAdmin
      .from("subscriptions")
      .update({
        plan_code: planCode,
        billing_interval: billingInterval,
        status: "active",
        current_period_starts_at: periodStart.toISOString(),
        current_period_ends_at: periodEnd.toISOString(),
        auto_renew: true,
        external_reference: stripeSubscriptionId,
      })
      .eq("id", existingSub.id);
    subscriptionId = existingSub.id;
  } else {
    // Create new subscription
    const { data: newSub } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        user_id: userId,
        plan_code: planCode,
        billing_interval: billingInterval,
        status: "active",
        current_period_starts_at: periodStart.toISOString(),
        current_period_ends_at: periodEnd.toISOString(),
        auto_renew: true,
        external_reference: stripeSubscriptionId ?? null,
      })
      .select("id")
      .single();
    subscriptionId = newSub?.id;
  }

  // Create invoice
  await supabaseAdmin.from("invoices").insert({
    invoice_number: invoiceNumber,
    user_id: userId,
    subscription_id: subscriptionId ?? null,
    amount: amountTotal / 100,
    currency,
    status: "paid",
    issued_at: new Date().toISOString(),
    paid_at: new Date().toISOString(),
  });

  // Grant "user" role if not already present
  try {
    const { data: existingRole } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "user")
      .maybeSingle();
    if (!existingRole) {
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "user" });
    }
  } catch {
    // role grant is non-critical; ignore duplicate key errors
  }
}