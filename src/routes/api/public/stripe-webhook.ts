// Stripe webhook endpoint. Verifies the Stripe signature header (HMAC-SHA256)
// against STRIPE_WEBHOOK_SECRET, then updates the internal invoices,
// payments and subscriptions tables for relevant events.
//
// Required env: STRIPE_WEBHOOK_SECRET.
//
// Handled events:
//   - checkout.session.completed       → mark invoice/payment/subscription
//   - customer.subscription.updated    → sync period / status
//   - customer.subscription.deleted    → mark subscription cancelled

import { createFileRoute } from "@tanstack/react-router";
import {
  constructWebhookEvent,
  handleCheckoutCompleted,
  type StripeEvent,
} from "@/lib/stripe.server";

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) return new Response("not configured", { status: 503 });

        const raw = await request.text();
        const sig = request.headers.get("stripe-signature");

        let event: StripeEvent;
        try {
          event = constructWebhookEvent(raw, sig);
        } catch (e) {
          const message = e instanceof Error ? e.message : "invalid signature";
          return new Response(message, { status: 401 });
        }

        try {
          switch (event.type) {
            case "checkout.session.completed": {
              const session = event.data.object as unknown as Parameters<
                typeof handleCheckoutCompleted
              >[0];
              await handleCheckoutCompleted(session);
              break;
            }

            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
              const sub = event.data.object as {
                id: string;
                status: string;
                current_period_start: number;
                current_period_end: number;
                customer: string;
              };
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

              const newStatus =
                event.type === "customer.subscription.deleted"
                  ? "cancelled"
                  : sub.status === "active"
                    ? "active"
                    : sub.status === "trialing"
                      ? "trialing"
                      : sub.status === "past_due"
                        ? "past_due"
                        : sub.status === "unpaid"
                          ? "unpaid"
                          : sub.status === "canceled"
                            ? "cancelled"
                            : sub.status;

              // Find our subscription by the Stripe subscription id
              const { data: ours } = await supabaseAdmin
                .from("subscriptions")
                .select("id")
                .eq("external_reference", sub.id)
                .maybeSingle();

              if (ours) {
                const updateFields: Record<string, unknown> = {
                  status: newStatus,
                  current_period_starts_at: new Date(sub.current_period_start * 1000).toISOString(),
                  current_period_ends_at: new Date(sub.current_period_end * 1000).toISOString(),
                };
                if (event.type === "customer.subscription.deleted") {
                  updateFields.auto_renew = false;
                }
                await supabaseAdmin
                  .from("subscriptions")
                  .update(updateFields as never)
                  .eq("id", ours.id);
              }
              break;
            }

            default:
              // Ignore unhandled events (payment_intent.*, invoice.*, etc.)
              break;
          }
        } catch (e) {
          console.error("[stripe-webhook] handler error", e);
          return new Response("handler error", { status: 500 });
        }

        return Response.json({ received: true });
      },
    },
  },
});
