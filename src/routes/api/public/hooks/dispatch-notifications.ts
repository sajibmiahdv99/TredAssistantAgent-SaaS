// Cron hook: dispatches pending in-app notifications to Email + Telegram channels
// based on user_notification_prefs. Auth: requires CRON_SECRET in `x-cron-secret`.
import { createFileRoute } from "@tanstack/react-router";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) m |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return m === 0;
}

const BATCH = 50;
const MAX_ATTEMPTS = 5;

type NotifRow = {
  id: string;
  user_id: string;
  event_type: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  email_dispatched_at: string | null;
  telegram_dispatched_at: string | null;
  dispatch_attempts: number;
};

type PrefsRow = {
  user_id: string;
  email: string | null;
  telegram_chat_id: string | null;
  channel_email: boolean;
  channel_telegram: boolean;
  evt_fill: boolean;
  evt_sl_tp: boolean;
  evt_error: boolean;
  evt_invalid_keys: boolean;
  evt_new_signal: boolean;
};

function isEventAllowed(p: PrefsRow, evt: string): boolean {
  switch (evt) {
    case "evt_fill":
    case "fill":
      return p.evt_fill;
    case "evt_sl_tp":
    case "sl_hit":
    case "tp_hit":
    case "exchange_closed":
      return p.evt_sl_tp;
    case "evt_error":
    case "error":
      return p.evt_error;
    case "evt_invalid_keys":
    case "invalid_keys":
      return p.evt_invalid_keys;
    case "evt_new_signal":
    case "new_signal":
      return p.evt_new_signal;
    default:
      return true;
  }
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
}

async function sendEmailViaResend(
  apiKey: string,
  fromAddr: string,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from: fromAddr, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderEmailHtml(title: string, body: string | null, evt: string): string {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#ffffff;padding:24px;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em">${escapeHtml(evt)}</div>
    <h2 style="margin:8px 0 12px;font-size:20px">${escapeHtml(title)}</h2>
    <p style="margin:0;color:#334155;line-height:1.5">${escapeHtml(body || "")}</p>
  </div></body></html>`;
}

export const Route = createFileRoute("/api/public/hooks/dispatch-notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        const got = request.headers.get("x-cron-secret") || "";
        if (!secret || !safeEqual(got, secret)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const tgToken = process.env.TELEGRAM_BOT_TOKEN || "";
        const resendKey = process.env.RESEND_API_KEY || "";
        const emailFrom = process.env.EMAIL_FROM || "Notifications <onboarding@resend.dev>";

        const { data: notifs, error: nerr } = await supabaseAdmin
          .from("notifications")
          .select(
            "id, user_id, event_type, title, body, metadata, email_dispatched_at, telegram_dispatched_at, dispatch_attempts",
          )
          .or("email_dispatched_at.is.null,telegram_dispatched_at.is.null")
          .lt("dispatch_attempts", MAX_ATTEMPTS)
          .order("created_at", { ascending: true })
          .limit(BATCH);

        if (nerr) {
          return new Response(JSON.stringify({ error: nerr.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const rows = (notifs ?? []) as NotifRow[];
        if (rows.length === 0) {
          return new Response(JSON.stringify({ ok: true, processed: 0 }), {
            headers: { "content-type": "application/json" },
          });
        }

        const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
        const { data: prefs } = await supabaseAdmin
          .from("user_notification_prefs")
          .select(
            "user_id, email, telegram_chat_id, channel_email, channel_telegram, evt_fill, evt_sl_tp, evt_error, evt_invalid_keys, evt_new_signal",
          )
          .in("user_id", userIds);
        const prefMap = new Map<string, PrefsRow>();
        for (const p of (prefs ?? []) as PrefsRow[]) prefMap.set(p.user_id, p);

        let emailSent = 0;
        let tgSent = 0;
        let skipped = 0;
        let failed = 0;

        for (const n of rows) {
          const p = prefMap.get(n.user_id);
          const patch: {
            dispatch_attempts: number;
            email_dispatched_at?: string;
            telegram_dispatched_at?: string;
            last_dispatch_error?: string | null;
          } = {
            dispatch_attempts: (n.dispatch_attempts ?? 0) + 1,
          };
          const errors: string[] = [];

          // Email
          if (!n.email_dispatched_at) {
            if (!p || !p.channel_email || !p.email || !isEventAllowed(p, n.event_type)) {
              patch.email_dispatched_at = new Date().toISOString();
              skipped++;
            } else if (!resendKey) {
              errors.push("RESEND_API_KEY missing");
            } else {
              try {
                await sendEmailViaResend(
                  resendKey,
                  emailFrom,
                  p.email,
                  n.title,
                  renderEmailHtml(n.title, n.body, n.event_type),
                );
                patch.email_dispatched_at = new Date().toISOString();
                emailSent++;
              } catch (e) {
                errors.push(`email: ${(e as Error).message}`);
              }
            }
          }

          // Telegram
          if (!n.telegram_dispatched_at) {
            if (!p || !p.channel_telegram || !p.telegram_chat_id || !isEventAllowed(p, n.event_type)) {
              patch.telegram_dispatched_at = new Date().toISOString();
              skipped++;
            } else if (!tgToken) {
              errors.push("TELEGRAM_BOT_TOKEN missing");
            } else {
              try {
                const text = `<b>${escapeHtml(n.title)}</b>\n${escapeHtml(n.body || "")}`;
                await sendTelegram(tgToken, p.telegram_chat_id, text);
                patch.telegram_dispatched_at = new Date().toISOString();
                tgSent++;
              } catch (e) {
                errors.push(`telegram: ${(e as Error).message}`);
              }
            }
          }

          if (errors.length > 0) {
            patch.last_dispatch_error = errors.join(" | ");
            failed++;
          } else {
            patch.last_dispatch_error = null;
          }

          await supabaseAdmin.from("notifications").update(patch).eq("id", n.id);
        }

        return new Response(
          JSON.stringify({
            ok: true,
            processed: rows.length,
            emailSent,
            tgSent,
            skipped,
            failed,
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
