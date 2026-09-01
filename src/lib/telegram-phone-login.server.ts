// Bot-less "Sign in with Telegram" — phone + code via MTProto (api_id + api_hash).
// No bot token, no bot chat: Telegram dispatches the login code to the phone,
// the user enters it here, and we link their Telegram identity to an app account.

import { randomBytes } from "crypto";
import {
  sendLoginCode,
  verifyLoginCode,
  verifyLoginPassword,
  friendlyTelegramError,
} from "@/lib/telegram/mtproto.server";
import { resolveTelegramIdentity } from "@/lib/telegram-login.server";

type Attempt = {
  phone: string;
  phoneCodeHash: string;
  partialSession: string;
  status: "code_sent" | "needs_password";
  expiresAt: number;
};
const attempts = new Map<string, Attempt>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

function prune() {
  const now = Date.now();
  for (const [k, a] of attempts) {
    if (now > a.expiresAt) attempts.delete(k);
  }
}

/** Step 1: ask Telegram to send a login code to the phone. Returns an attempt ref. */
export async function startPhoneLogin(phone: string): Promise<{ ref: string }> {
  prune();
  let sent;
  try {
    sent = await sendLoginCode(phone);
  } catch (err) {
    throw new Error(friendlyTelegramError(err));
  }
  const ref = randomBytes(12).toString("base64url");
  attempts.set(ref, {
    phone,
    phoneCodeHash: sent.phoneCodeHash,
    partialSession: sent.sessionString,
    status: "code_sent",
    expiresAt: Date.now() + TTL_MS,
  });
  return { ref };
}

/** Step 2: submit the code (and optional 2FA password), then resolve the identity. */
export async function verifyPhoneLogin(args: {
  ref: string;
  code: string;
  password?: string;
}): Promise<{ email: string; password: string } | { needsPassword: true }> {
  const a = attempts.get(args.ref);
  if (!a || Date.now() > a.expiresAt) {
    throw new Error("That Telegram login has expired. Please start again.");
  }

  let result;
  try {
    result = await verifyLoginCode({
      partialSession: a.partialSession,
      phone: a.phone,
      phoneCodeHash: a.phoneCodeHash,
      code: args.code,
    });
    if (result.kind === "needs_password" && args.password) {
      result = await verifyLoginPassword({
        partialSession: result.sessionString,
        password: args.password,
      });
    }
  } catch (err) {
    throw new Error(friendlyTelegramError(err));
  }

  if (result.kind === "needs_password") {
    // Remember the partial session (still not logged in) for the password step.
    attempts.set(args.ref, { ...a, status: "needs_password" });
    return { needsPassword: true };
  }

  attempts.delete(args.ref);
  return resolveTelegramIdentity(
    result.userId,
    result.firstName,
    result.username,
    result.sessionString,
  );
}
