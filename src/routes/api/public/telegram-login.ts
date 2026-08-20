// "Login with Telegram" endpoints.
// POST /api/public/telegram-login/start  -> { token, url }  (t.me/<bot>?start=hermes_<token>)
// POST /api/public/telegram-login/status -> { status: "waiting" } | { status: "ready", email, password }

import { createFileRoute } from "@tanstack/react-router";
import { createPendingLogin, getPendingLogin } from "@/lib/telegram-login.server";
import { rateLimitMiddleware } from "@/lib/rate-limit";

export const Route = createFileRoute("/api/public/telegram-login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = rateLimitMiddleware(request, { windowMs: 60_000, maxRequests: 30 });
        if (limited) return limited;

        let body: { action?: string; token?: string } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }

        if (body.action === "start") {
          const { token, url } = createPendingLogin();
          return Response.json({ token, url });
        }

        if (body.action === "status" && body.token) {
          const login = getPendingLogin(body.token);
          if (!login) {
            return Response.json({ status: "expired" });
          }
          if (!login.ready || !login.email || !login.password) {
            return Response.json({ status: "waiting" });
          }
          return Response.json({ status: "ready", email: login.email, password: login.password });
        }

        return Response.json({ error: "invalid action" }, { status: 400 });
      },
    },
  },
});
