// Bot-less "Sign in with Telegram" — step 2: submit the code (and optional 2FA).
// POST /api/public/telegram-phone-verify  { ref, code, password? }
//   -> { email, password }  |  { needsPassword: true }

import { createFileRoute } from "@tanstack/react-router";
import { verifyPhoneLogin } from "@/lib/telegram-phone-login.server";
import { rateLimitMiddleware } from "@/lib/rate-limit";

export const Route = createFileRoute("/api/public/telegram-phone-verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = rateLimitMiddleware(request, { windowMs: 60_000, maxRequests: 20 });
        if (limited) return limited;

        let body: { ref?: string; code?: string; password?: string } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }

        if (!body.ref || !body.code) {
          return Response.json({ error: "Missing code." }, { status: 400 });
        }

        try {
          const result = await verifyPhoneLogin({
            ref: body.ref,
            code: body.code,
            password: body.password,
          });
          return Response.json(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Telegram login failed.";
          return Response.json({ error: msg }, { status: 400 });
        }
      },
    },
  },
});
