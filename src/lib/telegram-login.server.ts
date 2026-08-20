// Shared state + helpers for "Login with Telegram" (Cornix-style bot login).
// The auth page asks the server for a one-time login token, the user presses
// /start hermes_<token> on the bot, the webhook resolves the token to their
// Telegram identity, and the browser exchanges it for a session.

import { randomBytes } from "crypto";

type PendingLogin = {
  ready: boolean;
  email: string | null;
  password: string | null;
  expiresAt: number;
};

const pendingLogins = new Map<string, PendingLogin>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export function createPendingLogin(): { token: string; url: string } {
  const token = randomBytes(24).toString("hex");
  pendingLogins.set(token, { ready: false, email: null, password: null, expiresAt: Date.now() + TTL_MS });
  const bot = process.env.TELEGRAM_BOT_USERNAME ?? "tradingsaasauth_bot";
  return { token, url: `https://t.me/${bot}?start=hermes_${token}` };
}

export function getPendingLogin(token: string): PendingLogin | undefined {
  const login = pendingLogins.get(token);
  if (!login) return undefined;
  if (Date.now() > login.expiresAt) {
    pendingLogins.delete(token);
    return undefined;
  }
  return login;
}

/** Called by the webhook when the user presses /start hermes_<token>. */
export async function resolveTelegramLogin(
  token: string,
  tgUserId: string,
  firstName: string | null,
  username: string | null,
): Promise<{ ok: boolean; message: string }> {
  const login = getPendingLogin(token);
  if (!login) return { ok: false, message: "This login link has expired. Please try again in the browser." };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // telegram_identities is newer than the generated types — use an untyped handle.
  const db = supabaseAdmin as unknown as {
    from: (table: string) => {
      select: (cols: string) => any;
      insert: (rows: unknown) => Promise<{ error: unknown }>;
    };
  };

  const email = `tg_${tgUserId}@telegram.login`;
  const fullName = firstName || username || `Telegram ${tgUserId}`;
  const password = randomBytes(16).toString("base64url");

  try {
    // Find an existing user linked to this Telegram account.
    const { data: identity } = await db
      .from("telegram_identities")
      .select("user_id")
      .eq("tg_user_id", Number(tgUserId))
      .maybeSingle();

    if (identity) {
      // Existing user — rotate the password for this one-time sign-in.
      await supabaseAdmin.auth.admin.updateUserById(identity.user_id, { password });
      await supabaseAdmin.auth.admin.updateUserById(identity.user_id, {
        user_metadata: { full_name: fullName },
      });
    } else {
      // New user — create the auth account (trigger creates profile/roles/balances).
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr) throw new Error(createErr.message);
      if (!created?.user) throw new Error("Could not create user");

      await db.from("telegram_identities").insert({
        tg_user_id: Number(tgUserId),
        user_id: created.user.id,
        tg_username: username,
        first_name: firstName,
      });
    }

    login.ready = true;
    login.email = email;
    login.password = password;
    return { ok: true, message: "✅ Login confirmed! Return to the browser." };
  } catch (err) {
    console.error("telegram login resolve failed", err);
    return { ok: false, message: "Something went wrong while linking your account. Please try again." };
  }
}

/** Send a Telegram message to a chat via the bot (best effort). */
export async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // best effort
  }
}
