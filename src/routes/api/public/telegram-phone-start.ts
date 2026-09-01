// Bot-less "Sign in with Telegram" — step 1: request a login code for the phone.
// POST /api/public/telegram-phone-start  { phone } -> { ref }

import { createFileRoute } from "@tanstack/react-router";
import { startPhoneLogin } from "@/lib/telegram-phone-login.server";
import { rateLimitMiddleware } from "@/lib/rate-limit";

export const Route = createFileRoute("/api/public/telegram-phone-start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = rateLimitMiddleware(request, { windowMs: 60_000, maxRequests: 10 });
        if (limited) return limited;

        let body: { phone?: string } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }

        const phone = (body.phone ?? "").replace(/[^\d+]/g, "").trim();
        if (!phone) {
          return Response.json({ error: "Enter your phone number in international format." }, { status: 400 });
        }

        try {
          const { ref } = await startPhoneLogin(phone);
          return Response.json({ ref });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed to send a Telegram code." },
            { status: 400 },
          );
        }
      },
    },
  },
});
