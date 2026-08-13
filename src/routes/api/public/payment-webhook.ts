// Generic payment webhook (USDT / NowPayments-style providers).
// Verifies HMAC-SHA512 of the raw body against PAYMENT_WEBHOOK_SECRET,
// then updates the matching invoice + subscription.
//
// Required env: PAYMENT_WEBHOOK_SECRET.

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

interface PaymentPayload {
  invoice_id?: string;
  payment_status?: string; // confirmed | finished | failed | expired | ...
  order_id?: string; // our invoice number
  pay_amount?: number;
  price_amount?: number;
  pay_currency?: string;
}

export const Route = createFileRoute("/api/public/payment-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PAYMENT_WEBHOOK_SECRET;
        if (!secret) return new Response("not configured", { status: 503 });

        const raw = await request.text();
        const sig = request.headers.get("x-nowpayments-sig") ?? request.headers.get("x-signature") ?? "";
        const expected = createHmac("sha512", secret).update(raw).digest("hex");
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("invalid signature", { status: 401 });
        }

        let payload: PaymentPayload;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const invoiceNumber = payload.order_id;
        if (!invoiceNumber) return Response.json({ ok: true, ignored: true });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const status = payload.payment_status ?? "";
        const paid = ["confirmed", "finished", "paid"].includes(status);

        const { data: invoice } = await supabaseAdmin
          .from("invoices")
          .update({
            status: paid ? "paid" : status,
            paid_at: paid ? new Date().toISOString() : null,
          })
          .eq("invoice_number", invoiceNumber)
          .select("subscription_id, user_id")
          .maybeSingle();

        if (paid && invoice?.subscription_id) {
          const start = new Date();
          const end = new Date(start);
          end.setMonth(end.getMonth() + 1);
          await supabaseAdmin
            .from("subscriptions")
            .update({
              status: "active",
              current_period_starts_at: start.toISOString(),
              current_period_ends_at: end.toISOString(),
            })
            .eq("id", invoice.subscription_id);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
