// Shared Telegram identity resolution for bot-less login.
// Links a Telegram user_id to an app account (create or rotate credential) and
// returns one-time email+password so the client can complete sign-in.
// This is Telegram-identity ownership only — no bot, no bot token.

import { randomBytes } from "crypto";

/**
 * Resolve a Telegram identity to an app account and return one-time
 * email+password credentials for the client to sign in with.
 * - If the Telegram user already has an app account, rotate its password.
 * - Otherwise create the app account (trigger creates profile/roles/balances).
 */
export async function resolveTelegramIdentity(
  tgUserId: string | number,
  firstName: string | null,
  username: string | null,
  sessionString?: string,
): Promise<{ email: string; password: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { encryptSession } = await import("@/lib/crypto.server");
  type TelegramIdentityRow = { user_id: string };
  type TelegramIdentityQuery = {
    eq: (
      column: string,
      value: string | number,
    ) => { maybeSingle: () => Promise<{ data: TelegramIdentityRow | null }> };
  };

  // telegram_identities is newer than the generated types — provide the minimal
  // query shape used here instead of falling back to `any`.
  const db = supabaseAdmin as unknown as {
    from: (table: string) => {
      select: (cols: string) => TelegramIdentityQuery;
      insert: (rows: unknown) => Promise<{ error: unknown }>;
    };
  };

  const id = Number(tgUserId);
  const email = `tg_${id}@telegram.login`;
  const fullName = firstName || username || `Telegram ${id}`;
  const password = randomBytes(16).toString("base64url");

  const { data: identity } = await db
    .from("telegram_identities")
    .select("user_id")
    .eq("tg_user_id", id)
    .maybeSingle();

  let appUserId: string;
  if (identity) {
    appUserId = identity.user_id;
    // Existing user — rotate password for this one-time sign-in.
    await supabaseAdmin.auth.admin.updateUserById(appUserId, { password });
    await supabaseAdmin.auth.admin.updateUserById(appUserId, {
      user_metadata: { full_name: fullName },
    });
  } else {
    // New user — create the auth account.
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createErr) throw new Error(createErr.message);
    if (!created?.user) throw new Error("Could not create user");
    appUserId = created.user.id;

    await db.from("telegram_identities").insert({
      tg_user_id: id,
      user_id: appUserId,
      tg_username: username,
      first_name: firstName,
    });
  }

  // Persist the MTProto session so channel polling + notifications work
  // bot-less (no bot token). Stores the session encrypted per app user.
  if (sessionString) {
    const { data: existingAcc } = await supabaseAdmin
      .from("telegram_accounts")
      .select("id")
      .eq("user_id", appUserId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingAcc?.id) {
      await supabaseAdmin
        .from("telegram_accounts")
        .update({
          session_ref: encryptSession(sessionString),
          status: "active",
          tg_user_id: id,
          tg_username: username,
          label: "Phone login",
        })
        .eq("id", existingAcc.id);
    } else {
      await supabaseAdmin.from("telegram_accounts").insert({
        user_id: appUserId,
        label: "Phone login",
        status: "active",
        session_ref: encryptSession(sessionString),
        tg_user_id: id,
        tg_username: username,
      });
    }
  }

  return { email, password };
}
